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
 * Posts an ephemeral message visible only to the invoking user.
 * Ephemeral messages cannot be updated, so every response (placeholder,
 * result, error) is a separate postEphemeral call.
 */
async function postEphemeral(
  client: WebClient,
  channel: string,
  userId: string,
  threadTs: string,
  text: string
): Promise<void> {
  await client.chat.postEphemeral({ channel, user: userId, thread_ts: threadTs, text });
}

/**
 * Full processing pipeline for a single @ThreadNote mention:
 *   1. Post an ephemeral placeholder so the invoking user gets instant feedback.
 *   2. Fetch the full thread, excluding the trigger message.
 *   3. Format the thread as a transcript.
 *   4. Call the LLM and convert the output to Slack mrkdwn.
 *   5. Post the result as ephemeral message(s) — only the invoking user sees them.
 */
export async function processMention(
  event: MentionEvent,
  client: WebClient
): Promise<void> {
  const channel = event.channel;
  const userId = event.user;
  const threadTs = (event as { thread_ts?: string }).thread_ts ?? event.ts;

  // app_mention events always carry a user, but the type allows undefined.
  // Nothing to do (and no one to notify) if it's absent.
  if (!userId) {
    console.error("ThreadNote: app_mention event missing user field — skipping");
    return;
  }

  // Strip the bot mention token to get the user's instruction; fall back to "go ahead".
  const rawText = (event as { text?: string }).text ?? "";
  const instruction = rawText.replace(/<@[A-Z0-9]+>/g, "").trim() || "go ahead";

  // Ephemeral placeholder — visible only to the invoking user.
  await postEphemeral(
    client, channel, userId, threadTs,
    ":hourglass_flowing_sand: ThreadNote is reading the thread…"
  );

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
      await postEphemeral(
        client, channel, userId, threadTs,
        ":information_source: This thread has no content yet. Mention me once the discussion has progressed."
      );
      return;
    }

    const transcript = await formatThreadForLLM(messages, client, channelName);
    const rawSummary = await callLLM(transcript, instruction);
    const footer = permalink ? `\n\n<${permalink}|View original thread>` : "";
    const summary = markdownToSlackMrkdwn(rawSummary) + footer;

    // Each chunk is a separate ephemeral message (ephemeral messages cannot be updated).
    for (const chunk of chunkText(summary)) {
      await postEphemeral(client, channel, userId, threadTs, chunk);
    }
  } catch (err) {
    console.error("ThreadNote error:", err);
    const errMsg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    await postEphemeral(
      client, channel, userId, threadTs,
      `:x: ThreadNote ran into an error: \`${errMsg}\``
    );
  }
}
