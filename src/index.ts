import { App } from "@slack/bolt";
import { processMention } from "./processor.js";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

app.event("app_mention", async (args) => {
  const { event, client } = args;

  // Ignore bot-generated mentions to prevent response loops.
  if ((event as { bot_id?: string }).bot_id) return;

  // Fire-and-forget: we've already ACK'd Slack; processing happens async.
  processMention(event, client).catch((err) =>
    console.error("ThreadNote: unhandled error in processMention:", err)
  );
});

await app.start();
console.log("⚡ ThreadNote is running (Socket Mode)");
