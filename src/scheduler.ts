import cron from "node-cron";
import type { WebClient } from "@slack/web-api";
import { prisma } from "./db.js";
import type { User } from "../generated/prisma/index.js";
import {
  buildDailyDigestMessage,
  buildWeeklyDigestMessage,
  sendDigestDM,
  type ThreadNoteRow,
} from "./digest.js";

function getCurrentTimeInTimezone(timezone: string): {
  hour: number;
  minute: number;
  dayName: string;
} {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    weekday: "long",
    hour12: false,
  }).formatToParts(now);

  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0");
  const dayName = parts.find((p) => p.type === "weekday")?.value ?? "";
  return { hour, minute, dayName };
}

function getDatePartsInTimezone(date: Date, timezone: string): { year: string; month: string; day: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  return {
    year: parts.find((p) => p.type === "year")?.value ?? "",
    month: parts.find((p) => p.type === "month")?.value ?? "",
    day: parts.find((p) => p.type === "day")?.value ?? "",
  };
}

function isSameDay(a: Date, b: Date, timezone: string): boolean {
  const ap = getDatePartsInTimezone(a, timezone);
  const bp = getDatePartsInTimezone(b, timezone);
  return ap.year === bp.year && ap.month === bp.month && ap.day === bp.day;
}

function startOfDayInTimezone(timezone: string): Date {
  const now = new Date();
  const { year, month, day } = getDatePartsInTimezone(now, timezone);
  // Build an ISO string for midnight in that timezone by re-parsing with the offset.
  // Safest approach: use a date string that Intl can resolve.
  const localMidnight = new Date(`${year}-${month}-${day}T00:00:00`);
  // Adjust: find offset between UTC and the timezone at midnight local time.
  const utcMidnight = new Date(
    Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day), 0, 0, 0)
  );
  // We need actual UTC time corresponding to midnight in the timezone.
  // Use the formatToParts trick: find what UTC time gives us midnight in the tz.
  // Simpler: subtract the offset. Get offset by comparing UTC to local parts.
  const nowUtc = now.getTime();
  const tzParts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  }).formatToParts(now);
  const tzHour = parseInt(tzParts.find((p) => p.type === "hour")?.value ?? "0");
  const tzMin = parseInt(tzParts.find((p) => p.type === "minute")?.value ?? "0");
  const tzSec = parseInt(tzParts.find((p) => p.type === "second")?.value ?? "0");
  const tzSecondsIntoDay = tzHour * 3600 + tzMin * 60 + tzSec;
  const startOfTzDay = new Date(nowUtc - tzSecondsIntoDay * 1000);
  // Zero out sub-second precision.
  startOfTzDay.setMilliseconds(0);
  return startOfTzDay;
  void localMidnight; // suppress unused warning
  void utcMidnight;
}

function startOfMondayThisWeekInTimezone(timezone: string): Date {
  const now = new Date();
  const { dayName } = getCurrentTimeInTimezone(timezone);
  const dayOrder: Record<string, number> = {
    Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3,
    Friday: 4, Saturday: 5, Sunday: 6,
  };
  const daysFromMonday = dayOrder[dayName] ?? 0;
  const todayStart = startOfDayInTimezone(timezone);
  return new Date(todayStart.getTime() - daysFromMonday * 86400 * 1000);
}

export function isDailyDigestDue(user: User): boolean {
  if (!user.dailyDigestEnabled) return false;
  const { hour } = getCurrentTimeInTimezone(user.timezone);
  if (hour < 10) return false;
  if (!user.lastDailyDigestAt) return true;
  return !isSameDay(user.lastDailyDigestAt, new Date(), user.timezone);
}

export function isWeeklyDigestDue(user: User): boolean {
  if (!user.weeklyDigestEnabled) return false;
  const { hour, dayName } = getCurrentTimeInTimezone(user.timezone);
  if (dayName !== "Monday") return false;
  if (hour < 10) return false;
  if (!user.lastWeeklyDigestAt) return true;
  // Check not already sent this week: last sent must be before Monday of this week.
  const mondayStart = startOfMondayThisWeekInTimezone(user.timezone);
  return user.lastWeeklyDigestAt < mondayStart;
}

export async function processDigestsForUser(user: User, client: WebClient): Promise<void> {
  const daily = isDailyDigestDue(user);
  const weekly = isWeeklyDigestDue(user);

  if (!daily && !weekly) return;

  if (daily) {
    const todayStart = startOfDayInTimezone(user.timezone);
    const threads = await prisma.$queryRaw<ThreadNoteRow[]>`
      SELECT id, channel_name, thread_ts, summary_markdown, thread_url, saved_at
      FROM thread_notes
      WHERE slack_workspace_id = ${user.slackWorkspaceId}
        AND slack_user_id = ${user.slackUserId}
        AND saved_at >= ${todayStart}
      ORDER BY saved_at ASC
    `;
    const message = buildDailyDigestMessage(threads);
    await sendDigestDM(client, user.slackUserId, message);
    await prisma.user.update({
      where: { slackWorkspaceId_slackUserId: { slackWorkspaceId: user.slackWorkspaceId, slackUserId: user.slackUserId } },
      data: { lastDailyDigestAt: new Date() },
    });
    console.log(`[Scheduler] Daily digest sent to ${user.slackUserId}`);
  }

  if (weekly) {
    const mondayStart = startOfMondayThisWeekInTimezone(user.timezone);
    const threads = await prisma.$queryRaw<ThreadNoteRow[]>`
      SELECT id, channel_name, thread_ts, summary_markdown, thread_url, saved_at
      FROM thread_notes
      WHERE slack_workspace_id = ${user.slackWorkspaceId}
        AND slack_user_id = ${user.slackUserId}
        AND saved_at >= ${mondayStart}
      ORDER BY saved_at ASC
    `;
    const weekStart = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: user.timezone,
    }).format(mondayStart);
    const message = buildWeeklyDigestMessage(threads, weekStart);
    await sendDigestDM(client, user.slackUserId, message);
    await prisma.user.update({
      where: { slackWorkspaceId_slackUserId: { slackWorkspaceId: user.slackWorkspaceId, slackUserId: user.slackUserId } },
      data: { lastWeeklyDigestAt: new Date() },
    });
    console.log(`[Scheduler] Weekly digest sent to ${user.slackUserId}`);
  }
}

export async function checkAndSendAllDigests(client: WebClient): Promise<void> {
  const users = await prisma.user.findMany();
  await Promise.allSettled(users.map((user) => processDigestsForUser(user, client)));
}

export function startScheduler(client: WebClient): void {
  cron.schedule("0 * * * *", async () => {
    console.log("[Scheduler] Running digest check...");
    await checkAndSendAllDigests(client);
  });
  console.log("[Scheduler] Started — hourly digest check active");
}
