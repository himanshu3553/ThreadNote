import type { WebClient } from "@slack/web-api";
import type { SlackMessage } from "./types.js";

// ─── In-memory caches (reset on process restart; no TTL needed for Phase 1) ──

const userCache = new Map<string, string>();
const channelCache = new Map<string, string>();

// ─── Slack API helpers ────────────────────────────────────────────────────────

export async function getUserName(
  client: WebClient,
  userId: string | undefined
): Promise<string> {
  if (!userId) return "unknown";

  const cached = userCache.get(userId);
  if (cached) return cached;

  try {
    const resp = await client.users.info({ user: userId });
    const name = resp.user?.real_name ?? resp.user?.name ?? userId;
    userCache.set(userId, name);
    return name;
  } catch {
    return userId;
  }
}

export async function getChannelName(
  client: WebClient,
  channelId: string
): Promise<string> {
  const cached = channelCache.get(channelId);
  if (cached) return cached;

  try {
    const resp = await client.conversations.info({ channel: channelId });
    const name = resp.channel?.name ?? channelId;
    channelCache.set(channelId, name);
    return name;
  } catch {
    return channelId;
  }
}

/**
 * Returns the Slack permalink for the root message of a thread.
 * Uses chat.getPermalink — no extra OAuth scopes required.
 * Returns null on failure so callers can degrade gracefully.
 */
export async function getThreadPermalink(
  client: WebClient,
  channel: string,
  threadTs: string
): Promise<string | null> {
  try {
    const resp = await client.chat.getPermalink({ channel, message_ts: threadTs });
    return (resp.permalink as string) ?? null;
  } catch {
    return null;
  }
}

// ─── Mention + link resolution ────────────────────────────────────────────────

/**
 * Replaces Slack-encoded tokens with human-readable equivalents:
 *   <@U123>        → @FullName
 *   <#C123|name>   → #name
 *   <url|text>     → [text](url)
 *   <url>          → url
 */
export async function resolveMentions(
  text: string,
  client: WebClient
): Promise<string> {
  if (!text) return "";

  // Resolve all user IDs in parallel before doing string replacements.
  const userIds = [...text.matchAll(/<@([A-Z0-9]+)>/g)].map((m) => m[1]);
  const uniqueIds = [...new Set(userIds)];
  const resolvedNames = await Promise.all(
    uniqueIds.map((id) => getUserName(client, id))
  );
  const userMap = new Map(uniqueIds.map((id, i) => [id, resolvedNames[i] as string]));

  return text
    .replace(/<@([A-Z0-9]+)>/g, (_, id: string) => `@${userMap.get(id) ?? id}`)
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, (_, name: string) => `#${name}`)
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, (_, url: string, label: string) => `[${label}](${url})`)
    .replace(/<(https?:\/\/[^>]+)>/g, (_, url: string) => url);
}

// ─── Thread fetching ──────────────────────────────────────────────────────────

const FILTERED_SUBTYPES = new Set([
  "tombstone",
  "channel_join",
  "channel_leave",
  "channel_topic",
  "channel_purpose",
]);

export async function fetchFullThread(
  client: WebClient,
  channel: string,
  threadTs: string,
  onProgress?: (page: number, estimatedTotal: number) => Promise<void>
): Promise<SlackMessage[]> {
  const messages: SlackMessage[] = [];

  // First request
  const firstResp = await client.conversations.replies({
    channel,
    ts: threadTs,
    limit: 15,
  });

  if (firstResp.messages) {
    messages.push(...(firstResp.messages as SlackMessage[]));
  }

  // Single page — return immediately, no delay
  if (!firstResp.has_more) {
    return messages;
  }

  // Multi-page — estimate total pages from reply_count on parent message
  const parent = firstResp.messages?.[0] as SlackMessage & {
    reply_count?: number;
  };
  const replyCount = parent?.reply_count ?? 0;
  const estimatedPages = Math.ceil((replyCount + 1) / 15);

  // Report page 1 progress
  if (onProgress) {
    await onProgress(1, estimatedPages).catch(console.error);
  }

  let cursor = firstResp.response_metadata?.next_cursor;
  let page = 1;

  while (cursor) {
    page++;

    // Wait 62 seconds between pages to respect 1 req/min rate limit
    // for non-Marketplace distributed apps
    await new Promise((resolve) => setTimeout(resolve, 62_000));

    const resp = await client.conversations.replies({
      channel,
      ts: threadTs,
      cursor,
      limit: 15,
    });

    if (resp.messages) {
      // Skip the first message on subsequent pages — it's the parent repeated
      messages.push(...(resp.messages.slice(1) as SlackMessage[]));
    }

    if (onProgress) {
      await onProgress(page, estimatedPages).catch(console.error);
    }

    if (!resp.has_more) break;
    cursor = resp.response_metadata?.next_cursor;
    if (!cursor) break;
  }

  return messages;
}

// ─── Thread formatting ────────────────────────────────────────────────────────

export async function formatThreadForLLM(
  messages: SlackMessage[],
  client: WebClient,
  channelName: string
): Promise<string> {
  if (messages.length === 0) return "";

  const participantIds = new Set(messages.map((m) => m.user).filter(Boolean) as string[]);
  const participantNames = await Promise.all(
    [...participantIds].map((id) => getUserName(client, id))
  );

  const firstTs = parseFloat(messages[0].ts);
  const lastTs = parseFloat(messages[messages.length - 1].ts);
  const toUtcString = (epochSecs: number) =>
    new Date(epochSecs * 1000).toISOString().slice(0, 16).replace("T", " ");

  const header = [
    "=== Thread Metadata ===",
    `Channel: #${channelName}`,
    `Participants: ${participantNames.sort().join(", ")}`,
    `Total messages: ${messages.length}`,
    `Date range: ${toUtcString(firstTs)} UTC to ${toUtcString(lastTs)} UTC`,
    "",
    "=== Conversation ===",
    "",
  ];

  const body: string[] = [];
  for (const msg of messages) {
    if (msg.subtype && FILTERED_SUBTYPES.has(msg.subtype)) continue;

    const speaker = msg.user
      ? await getUserName(client, msg.user)
      : `bot:${msg.bot_id ?? "unknown"}`;

    const timestamp = toUtcString(parseFloat(msg.ts));
    const text = await resolveMentions(msg.text ?? "", client);

    body.push(`[${timestamp} UTC] ${speaker}:`);
    body.push(text);

    if (msg.reactions && msg.reactions.length > 0) {
      const reactionStr = msg.reactions.map((r) => `:${r.name}: x${r.count}`).join(", ");
      body.push(`  [reactions: ${reactionStr}]`);
    }

    body.push("");
  }

  return [...header, ...body].join("\n");
}

// ─── Markdown → Slack mrkdwn converter ───────────────────────────────────────

/**
 * Converts standard Markdown (as produced by the LLM) to Slack mrkdwn.
 *
 * Key transforms:
 *   **bold**         → *bold*
 *   # Heading        → *Heading*
 *   ~~strike~~       → ~strike~
 *   [label](url)     → <url|label>
 *   pipe tables      → bullet rows (Slack does not render HTML tables)
 */
export function markdownToSlackMrkdwn(text: string): string {
  let out = text;

  // Bold first so headings that contain **bold** convert cleanly.
  out = out.replace(/\*\*(.+?)\*\*/gs, "*$1*");

  // Headings (#, ##, … → bold line).
  out = out.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");

  // Strikethrough.
  out = out.replace(/~~(.+?)~~/gs, "~$1~");

  // Markdown links → Slack angle-bracket links.
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "<$2|$1>");

  // Pipe tables → bullet rows.
  out = convertMarkdownTables(out);

  return out;
}

function convertMarkdownTables(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const next = lines[i + 1] ?? "";

    if (isPipeRow(line) && isSeparatorRow(next)) {
      // Skip header row and separator row; convert each data row to a bullet.
      i += 2;
      while (i < lines.length && isPipeRow(lines[i])) {
        result.push("• " + parsePipeRow(lines[i]).join(" | "));
        i++;
      }
    } else {
      result.push(line);
      i++;
    }
  }

  return result.join("\n");
}

function isPipeRow(line: string): boolean {
  return /^\|.+\|$/.test(line.trim());
}

function isSeparatorRow(line: string): boolean {
  return /^\|[\s|:-]+\|$/.test(line.trim());
}

function parsePipeRow(line: string): string[] {
  return line
    .split("|")
    .map((cell) => cell.trim())
    .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
}
