import { App } from "@slack/bolt";
import { processMention } from "./processor.js";
import { threadNoteAssistant } from "./assistant.js";
import { closeDb } from "./db.js";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

app.event("app_mention", async (args) => {
  const { event, client, context } = args;

  // Ignore bot-generated mentions to prevent response loops.
  if ((event as { bot_id?: string }).bot_id) return;

  const workspaceId = context.teamId ?? "";

  // Fire-and-forget: we've already ACK'd Slack; processing happens async.
  processMention(event, client, workspaceId).catch((err) =>
    console.error("ThreadNote: unhandled error in processMention:", err)
  );
});

app.assistant(threadNoteAssistant);

await app.start();
console.log("⚡ ThreadNote is running (Socket Mode)");

async function shutdown() {
  await app.stop();
  await closeDb();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
