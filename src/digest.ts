import type { WebClient } from "@slack/web-api";

export interface ThreadNoteRow {
  id: string;
  channel_name: string | null;
  thread_ts: string;
  summary_markdown: string;
  thread_url: string | null;
  saved_at: Date;
}

export function getOneLinerSummary(summaryMarkdown: string): string {
  // Strip markdown formatting (headings, bold, bullet leaders) then find the first sentence.
  const stripped = summaryMarkdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/gs, "$1")
    .replace(/\*(.+?)\*/gs, "$1")
    .replace(/^[-*•]\s+/gm, "")
    .trim();

  // Take text up to the first sentence-ending punctuation followed by whitespace or end.
  const match = stripped.match(/^(.+?[.!?])(?:\s|$)/s);
  const sentence = match ? match[1].trim() : stripped.split("\n")[0].trim();

  if (sentence.length <= 120) return sentence;
  return sentence.slice(0, 117) + "...";
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function buildDailyDigestMessage(threads: ThreadNoteRow[]): string {
  const dateStr = formatDate(new Date());

  if (threads.length === 0) {
    return [
      `*Your ThreadNote Daily Digest*`,
      ``,
      `Nothing was saved today — that's okay!`,
      ``,
      `Here's a quick reminder of how to use ThreadNote:`,
      `• Mention *@ThreadNote* in any Slack thread to summarise and save it`,
      `• Say *@ThreadNote tldr* for a quick summary`,
      `• Say *@ThreadNote action items* to extract tasks`,
      `• Open ThreadNote directly to search your saved knowledge base`,
    ].join("\n");
  }

  const items = threads.map((t) => {
    const summary = getOneLinerSummary(t.summary_markdown);
    const label = t.channel_name ? `#${t.channel_name} thread` : "Saved thread";
    const link = t.thread_url
      ? `<${t.thread_url}|${label}>`
      : label;
    return `• ${link} — ${summary}`;
  });

  return [
    `*Your ThreadNote Daily Digest* — ${dateStr}`,
    ``,
    `Here's what you saved today:`,
    ``,
    ...items,
    ``,
    `_Tap any link to jump to the original thread._`,
  ].join("\n");
}

export function buildWeeklyDigestMessage(threads: ThreadNoteRow[], weekStart: string): string {
  const dateStr = formatDate(new Date());

  if (threads.length === 0) {
    return [
      `*Your ThreadNote Weekly Digest*`,
      ``,
      `Nothing was saved this week — that's okay!`,
      ``,
      `Here's a quick reminder of how to use ThreadNote:`,
      `• Mention *@ThreadNote* in any Slack thread to summarise and save it`,
      `• Say *@ThreadNote tldr* for a quick summary`,
      `• Say *@ThreadNote action items* to extract tasks`,
      `• Open ThreadNote directly to search your saved knowledge base`,
    ].join("\n");
  }

  const items = threads.map((t) => {
    const summary = getOneLinerSummary(t.summary_markdown);
    const label = t.channel_name ? `#${t.channel_name} thread` : "Saved thread";
    const link = t.thread_url
      ? `<${t.thread_url}|${label}>`
      : label;
    return `• ${link} — ${summary}`;
  });

  return [
    `*Your ThreadNote Weekly Digest* — week of ${weekStart} (sent ${dateStr})`,
    ``,
    `Here's what you saved this week:`,
    ``,
    ...items,
    ``,
    `_Tap any link to jump to the original thread._`,
  ].join("\n");
}

export async function sendDigestDM(
  client: WebClient,
  slackUserId: string,
  message: string
): Promise<void> {
  const dmChannel = await client.conversations.open({ users: slackUserId });
  const channelId = dmChannel.channel?.id;
  if (!channelId) return;
  await client.chat.postMessage({ channel: channelId, text: message });
}
