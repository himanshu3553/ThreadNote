/**
 * CLI: npm run capture -- "<slack-thread-url>" <name>
 *
 * Fetches a Slack thread, resolves all user IDs to display names, and saves
 * a self-contained JSON to tests/sample_threads/<name>.json so the eval
 * harness can run without making any Slack API calls.
 *
 * URL format: https://<workspace>.slack.com/archives/<CHANNEL_ID>/p<TIMESTAMP>
 * Example:    https://acme.slack.com/archives/C0123456/p1715600000001000
 */

import { WebClient } from "@slack/web-api";
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { SlackMessage } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── URL parsing ─────────────────────────────────────────────────────────────

/**
 * Converts a Slack thread permalink to a channel ID + thread timestamp.
 * Slack encodes "1715600000.001000" as "p1715600000001000" in URLs.
 */
function parseThreadUrl(url: string): { channel: string; threadTs: string } {
  const match = url.match(/\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})/);
  if (!match) {
    throw new Error(
      `Cannot parse Slack thread URL: "${url}"\n` +
        `Expected format: https://<workspace>.slack.com/archives/<CHANNEL>/p<TIMESTAMP>`
    );
  }
  return { channel: match[1], threadTs: `${match[2]}.${match[3]}` };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const [, , url, name] = process.argv;

  if (!url || !name) {
    console.error('Usage: npm run capture -- "<slack-thread-url>" <name>');
    console.error("Example: npm run capture -- \"https://acme.slack.com/archives/C0123456/p1715600000001000\" my-thread");
    process.exit(1);
  }

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN is not set");

  const client = new WebClient(token);
  const { channel, threadTs } = parseThreadUrl(url);

  console.log(`Fetching thread ${threadTs} from channel ${channel}…`);

  // Paginate through all thread replies.
  const messages: SlackMessage[] = [];
  let cursor: string | undefined;
  do {
    const resp = await client.conversations.replies({
      channel,
      ts: threadTs,
      cursor,
      limit: 200,
    });
    messages.push(...((resp.messages ?? []) as SlackMessage[]));
    cursor = resp.has_more ? resp.response_metadata?.next_cursor : undefined;
  } while (cursor);

  console.log(`  ${messages.length} messages found`);

  // Resolve every unique user ID to a display name.
  const uniqueUserIds = [
    ...new Set(messages.map((m) => m.user).filter(Boolean) as string[]),
  ];
  const nameMap: Record<string, string> = {};
  for (const userId of uniqueUserIds) {
    try {
      const resp = await client.users.info({ user: userId });
      nameMap[userId] = resp.user?.real_name ?? resp.user?.name ?? userId;
    } catch {
      nameMap[userId] = userId;
    }
  }

  // Resolve the channel name.
  let channelName = channel;
  try {
    const resp = await client.conversations.info({ channel });
    channelName = resp.channel?.name ?? channel;
  } catch {
    // keep the raw channel ID
  }

  const output = {
    channel,
    channelName,
    threadTs,
    capturedAt: new Date().toISOString(),
    nameMap,
    messages,
  };

  const outDir = join(__dirname, "sample_threads");
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, `${name}.json`);
  await writeFile(outPath, JSON.stringify(output, null, 2), "utf-8");

  console.log(`✅ Saved to ${outPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
