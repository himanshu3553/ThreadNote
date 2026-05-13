import type { SlackEventMiddlewareArgs } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import {
  fetchFullThread,
  formatThreadForLLM,
  getChannelName,
  getThreadPermalink,
  markdownToSlackMrkdwn,
} from "./slack-utils.js";
import { callLLM } from "./llm.js";

type MentionEvent = SlackEventMiddlewareArgs<"app_mention">["event"];

// Slack hard-caps messages at ~3 000 chars; stay safely under that.
const SLACK_MSG_MAX = 2900;

function* chunkText(text: string, size = SLACK_MSG_MAX): Generator<string> {
  for (let i = 0; i < text.length; i += size) {
    yield text.slice(i, i + size);
  }
}

/**
 * Full processing pipeline for a single @ThreadNote mention:
 *   1. Post a placeholder so the user gets instant feedback.
 *   2. Fetch the full thread, excluding the trigger message.
 *   3. Format the thread as a transcript.
 *   4. Call the LLM and convert the output to Slack mrkdwn.
 *   5. Update the placeholder (and post overflow chunks as replies).
 */
export async function processMention(
  event: MentionEvent,
  client: WebClient
): Promise<void> {
  const channel = event.channel;
  const threadTs = (event as { thread_ts?: string }).thread_ts ?? event.ts;

  // Strip the bot mention token to get the user's instruction; fall back to "go ahead".
  const rawText = (event as { text?: string }).text ?? "";
  const instruction = rawText.replace(/<@[A-Z0-9]+>/g, "").trim() || "go ahead";

  const placeholder = await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: ":hourglass_flowing_sand: ThreadNote is reading the thread…",
  });

  if (!placeholder.ok || !placeholder.ts) {
    console.error("ThreadNote: failed to post placeholder");
    return;
  }

  try {
    // Fetch channel name and thread permalink in parallel.
    const [channelName, permalink] = await Promise.all([
      getChannelName(client, channel),
      getThreadPermalink(client, channel, threadTs),
    ]);

    // Fetch the full thread and remove the trigger message itself.
    let messages = await fetchFullThread(client, channel, threadTs);
    messages = messages.filter((m) => m.ts !== event.ts);

    if (messages.length === 0) {
      await client.chat.update({
        channel,
        ts: placeholder.ts,
        text: ":information_source: This thread has no content yet. Mention me once the discussion has progressed.",
      });
      return;
    }

    const transcript = await formatThreadForLLM(messages, client, channelName);
    const rawSummary = await callLLM(transcript, instruction);
    const footer = permalink ? `\n\n<${permalink}|View original thread>` : "";
    const summary = markdownToSlackMrkdwn(rawSummary) + footer;

    // Update the placeholder with the first chunk; any overflow becomes new replies.
    const chunks = [...chunkText(summary)];
    await client.chat.update({ channel, ts: placeholder.ts, text: chunks[0] });

    for (const chunk of chunks.slice(1)) {
      await client.chat.postMessage({ channel, thread_ts: threadTs, text: chunk });
    }
  } catch (err) {
    console.error("ThreadNote error:", err);
    const errMsg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    await client.chat.update({
      channel,
      ts: placeholder.ts,
      text: `:x: ThreadNote ran into an error: \`${errMsg}\``,
    });
  }
}
