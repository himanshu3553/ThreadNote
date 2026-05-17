import type { WebClient } from "@slack/web-api";
import { prisma } from "./db.js";
import type { User } from "../generated/prisma/index.js";

type UserFromDB = User;

const TIMEZONE_OPTIONS = [
  { value: "Asia/Kolkata", label: "IST — Asia/Kolkata (UTC+5:30)" },
  { value: "Asia/Singapore", label: "SGT — Asia/Singapore (UTC+8)" },
  { value: "Asia/Dubai", label: "GST — Asia/Dubai (UTC+4)" },
  { value: "Europe/London", label: "GMT/BST — Europe/London" },
  { value: "America/New_York", label: "EST/EDT — America/New_York" },
  { value: "America/Los_Angeles", label: "PST/PDT — America/Los_Angeles" },
  { value: "UTC", label: "UTC" },
];

export function buildHomeView(user: UserFromDB): { blocks: object[] } {
  const tzOption = TIMEZONE_OPTIONS.find((o) => o.value === user.timezone) ?? TIMEZONE_OPTIONS[0]!;

  return {
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "ThreadNote Settings", emoji: false },
      },
      { type: "divider" },
      {
        type: "section",
        text: { type: "mrkdwn", text: "*Digest Preferences*\nThreadNote will DM you a digest of your saved threads." },
      },
      // Daily digest toggle
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Daily Digest*\nSent every day at 10:00 AM in your timezone`,
        },
        accessory: {
          type: "radio_buttons",
          action_id: "toggle_daily_digest",
          initial_option: {
            text: { type: "plain_text", text: user.dailyDigestEnabled ? "Enabled" : "Disabled" },
            value: user.dailyDigestEnabled ? "enabled" : "disabled",
          },
          options: [
            { text: { type: "plain_text", text: "Enabled" }, value: "enabled" },
            { text: { type: "plain_text", text: "Disabled" }, value: "disabled" },
          ],
        },
      },
      // Weekly digest toggle
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Weekly Digest*\nSent every Monday at 10:00 AM in your timezone`,
        },
        accessory: {
          type: "radio_buttons",
          action_id: "toggle_weekly_digest",
          initial_option: {
            text: { type: "plain_text", text: user.weeklyDigestEnabled ? "Enabled" : "Disabled" },
            value: user.weeklyDigestEnabled ? "enabled" : "disabled",
          },
          options: [
            { text: { type: "plain_text", text: "Enabled" }, value: "enabled" },
            { text: { type: "plain_text", text: "Disabled" }, value: "disabled" },
          ],
        },
      },
      { type: "divider" },
      // Timezone select
      {
        type: "section",
        text: { type: "mrkdwn", text: "*Timezone*" },
        accessory: {
          type: "static_select",
          action_id: "select_timezone",
          placeholder: { type: "plain_text", text: "Select timezone" },
          initial_option: {
            text: { type: "plain_text", text: tzOption.label },
            value: tzOption.value,
          },
          options: TIMEZONE_OPTIONS.map((o) => ({
            text: { type: "plain_text", text: o.label },
            value: o.value,
          })),
        },
      },
      { type: "divider" },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Timezone auto-detected from your Slack profile. Change it above if incorrect. Settings are saved immediately on change.",
          },
        ],
      },
    ],
  };
}

export async function publishHomeView(
  client: WebClient,
  userId: string,
  user: UserFromDB
): Promise<void> {
  await client.views.publish({
    user_id: userId,
    view: {
      type: "home",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      blocks: buildHomeView(user).blocks as any,
    },
  });
}

export async function handleHomeOpened(
  event: { user: string; view?: { team_id?: string } },
  client: WebClient
): Promise<void> {
  const userId = event.user;

  // Derive workspaceId from the auth test when not available on event.
  let workspaceId: string;
  try {
    const auth = await client.auth.test();
    workspaceId = (auth.team_id as string) ?? "";
  } catch {
    console.error("ThreadNote: could not determine workspace from auth.test");
    return;
  }

  if (!workspaceId) return;

  let user = await prisma.user.findUnique({
    where: { slackWorkspaceId_slackUserId: { slackWorkspaceId: workspaceId, slackUserId: userId } },
  });

  if (!user) {
    // First visit — create with defaults then detect timezone from Slack.
    user = await prisma.user.upsert({
      where: { slackWorkspaceId_slackUserId: { slackWorkspaceId: workspaceId, slackUserId: userId } },
      create: { slackWorkspaceId: workspaceId, slackUserId: userId },
      update: {},
    });
    // Try to auto-detect timezone.
    try {
      const resp = await client.users.info({ user: userId });
      const tz = resp.user?.tz;
      if (tz && tz !== user.timezone) {
        user = await prisma.user.update({
          where: { slackWorkspaceId_slackUserId: { slackWorkspaceId: workspaceId, slackUserId: userId } },
          data: { timezone: tz },
        });
      }
    } catch {
      // Non-fatal — keep default timezone.
    }
  } else if (user.timezone === "Asia/Kolkata") {
    // Existing user still on default — check Slack for a different value.
    try {
      const resp = await client.users.info({ user: userId });
      const tz = resp.user?.tz;
      if (tz && tz !== user.timezone) {
        user = await prisma.user.update({
          where: { slackWorkspaceId_slackUserId: { slackWorkspaceId: workspaceId, slackUserId: userId } },
          data: { timezone: tz },
        });
      }
    } catch {
      // Non-fatal.
    }
  }

  await publishHomeView(client, userId, user);
}

async function getUserAndPublish(
  client: WebClient,
  workspaceId: string,
  userId: string
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { slackWorkspaceId_slackUserId: { slackWorkspaceId: workspaceId, slackUserId: userId } },
  });
  if (!user) return;
  await publishHomeView(client, userId, user);
}

export async function handleToggleDailyDigest(
  body: { user?: { id?: string }; view?: { team_id?: string } },
  client: WebClient,
  value: string
): Promise<void> {
  const userId = body.user?.id;
  const workspaceId = body.view?.team_id;
  if (!userId || !workspaceId) return;

  await prisma.user.update({
    where: { slackWorkspaceId_slackUserId: { slackWorkspaceId: workspaceId, slackUserId: userId } },
    data: { dailyDigestEnabled: value === "enabled" },
  });
  await getUserAndPublish(client, workspaceId, userId);
}

export async function handleToggleWeeklyDigest(
  body: { user?: { id?: string }; view?: { team_id?: string } },
  client: WebClient,
  value: string
): Promise<void> {
  const userId = body.user?.id;
  const workspaceId = body.view?.team_id;
  if (!userId || !workspaceId) return;

  await prisma.user.update({
    where: { slackWorkspaceId_slackUserId: { slackWorkspaceId: workspaceId, slackUserId: userId } },
    data: { weeklyDigestEnabled: value === "enabled" },
  });
  await getUserAndPublish(client, workspaceId, userId);
}

export async function handleSelectTimezone(
  body: { user?: { id?: string }; view?: { team_id?: string } },
  client: WebClient,
  timezone: string
): Promise<void> {
  const userId = body.user?.id;
  const workspaceId = body.view?.team_id;
  if (!userId || !workspaceId) return;

  await prisma.user.update({
    where: { slackWorkspaceId_slackUserId: { slackWorkspaceId: workspaceId, slackUserId: userId } },
    data: { timezone },
  });
  await getUserAndPublish(client, workspaceId, userId);
}
