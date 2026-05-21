import { App } from "@slack/bolt";
import type { InstallationQuery } from "@slack/oauth";
import { processMention } from "./processor.js";
import { threadNoteAssistant } from "./assistant.js";
import { closeDb } from "./db.js";
import {
  handleHomeOpened,
  handleToggleDailyDigest,
  handleToggleWeeklyDigest,
  handleSelectTimezone,
} from "./home.js";
import { startScheduler, checkAndSendAllDigests } from "./scheduler.js";
import { createOAuthServer } from "./oauth-server.js";
import { prismaInstallationStore } from "./installation-store.js";

// Custom authorize: looks up the correct workspace token from the installations
// table for every incoming event. Keeps Bolt from starting its own HTTP server
// (which would conflict with our Express OAuth server on the same port).
const app = new App({
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  authorize: async ({ teamId }) => {
    const installation = await prismaInstallationStore.fetchInstallation({
      teamId,
      isEnterpriseInstall: false,
    } as InstallationQuery<false>);
    return {
      botToken: installation.bot?.token,
      botId: installation.bot?.id,
      botUserId: installation.bot?.userId,
    };
  },
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

// App Home Tab
app.event("app_home_opened", async ({ event, client }) => {
  await handleHomeOpened(event as { user: string; view?: { team_id?: string } }, client);
});

// Home Tab action handlers — save to DB immediately on change
app.action("toggle_daily_digest", async ({ body, client, ack, action }) => {
  await ack();
  const value = (action as { selected_option?: { value?: string } }).selected_option?.value ?? "enabled";
  await handleToggleDailyDigest(
    body as { user?: { id?: string }; view?: { team_id?: string } },
    client,
    value
  );
});

app.action("toggle_weekly_digest", async ({ body, client, ack, action }) => {
  await ack();
  const value = (action as { selected_option?: { value?: string } }).selected_option?.value ?? "enabled";
  await handleToggleWeeklyDigest(
    body as { user?: { id?: string }; view?: { team_id?: string } },
    client,
    value
  );
});

app.action("select_timezone", async ({ body, client, ack, action }) => {
  await ack();
  const timezone = (action as { selected_option?: { value?: string } }).selected_option?.value ?? "Asia/Kolkata";
  await handleSelectTimezone(
    body as { user?: { id?: string }; view?: { team_id?: string } },
    client,
    timezone
  );
});

await app.start();
console.log("⚡ ThreadNote is running (Socket Mode)");

// Start OAuth + landing page Express server
const PORT = parseInt(process.env.PORT ?? "3000", 10);
const oauthServer = createOAuthServer();
oauthServer.listen(PORT, () => {
  console.log(`🌐 ThreadNote OAuth server running on port ${PORT}`);
});

// Check for any missed digests on startup (handles server restarts)
checkAndSendAllDigests(app.client).catch(console.error);

// Start the hourly digest scheduler
startScheduler(app.client);

async function shutdown() {
  await app.stop();
  await closeDb();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
