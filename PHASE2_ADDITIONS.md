# PHASE2_ADDITIONS.md — Instructions for Claude Code

Read this entire file before writing a single line of code. Build each feature in the exact order specified. Do not move to the next feature until the current one is complete. After all features are built, follow the final instruction to update CLAUDE.md.

---

## Context

Phase 1 and Phase 2 core features are already built and working. The existing codebase has:
- `@ThreadNote` mention handler that summarises threads and saves to Neon Postgres
- Prisma ORM with `users`, `thread_notes`, `conversations` tables
- OpenAI Responses API for summaries, `text-embedding-3-large` for embeddings
- Bolt AI Assistant panel with RAG search and conversation memory
- Socket Mode, local dev, dev sandbox workspace

You are now adding 4 new features to the existing codebase. Read CLAUDE.md for full project context before starting.

---

## New packages to install

```bash
npm install node-cron
npm install -D @types/node-cron
```

No other new packages. Use Node.js built-in `Intl.DateTimeFormat` for timezone handling — do not add a date library.

---

## Schema changes

Add these columns to the existing Prisma schema. Do not replace the schema — only add to it.

Add to the `User` model:

```prisma
timezone              String   @default("Asia/Kolkata") @map("timezone")
weeklyDigestEnabled   Boolean  @default(true) @map("weekly_digest_enabled")
dailyDigestEnabled    Boolean  @default(true) @map("daily_digest_enabled")
lastWeeklyDigestAt    DateTime? @map("last_weekly_digest_at")
lastDailyDigestAt     DateTime? @map("last_daily_digest_at")
```

Add to the `ThreadNote` model:

```prisma
threadUrl  String? @map("thread_url")
```

After updating the schema run:

```bash
npm run db:migrate
# migration name when prompted: phase2_additions
npm run db:generate
```

Verify the new columns exist in Neon dashboard before continuing.

---

## Feature 1 — Re-summarise on Update

**What it does**: When a user invokes `@ThreadNote` on a thread that was already saved, overwrite the existing record instead of creating a duplicate. Old summary, decisions, action items, tags, and embedding are all replaced with the new ones.

**File to update**: `src/kb.ts`

**Change**: The `saveThreadNote` function currently does a create. Convert it to an upsert using Prisma's `upsert` on the unique constraint `(slackWorkspaceId, slackUserId, channelId, threadTs)`.

Pattern:
```typescript
// Step 1: upsert the record without embedding
const note = await prisma.threadNote.upsert({
  where: {
    slackWorkspaceId_slackUserId_channelId_threadTs: {
      slackWorkspaceId,
      slackUserId,
      channelId,
      threadTs,
    },
  },
  update: {
    summaryMarkdown,
    decisions,
    actionItems,
    tags,
    threadUrl,
    savedAt: new Date(),
  },
  create: {
    slackWorkspaceId,
    slackUserId,
    channelId,
    channelName,
    threadTs,
    summaryMarkdown,
    decisions,
    actionItems,
    tags,
    threadUrl,
  },
});

// Step 2: always update embedding via raw SQL regardless of create or update
await prisma.$executeRaw`
  UPDATE thread_notes
  SET embedding = ${`[${embedding.join(",")}]`}::vector
  WHERE id = ${note.id}
`;
```

**File to update**: `src/slack-utils.ts`

Add a `getThreadPermalink` helper function:

```typescript
export async function getThreadPermalink(
  client: WebClient,
  channelId: string,
  threadTs: string
): Promise<string | undefined> {
  try {
    const resp = await client.chat.getPermalink({
      channel: channelId,
      message_ts: threadTs,
    });
    return resp.permalink as string;
  } catch {
    return undefined;
  }
}
```

**File to update**: `src/index.ts`

In `processMention`, before calling `saveThreadNote`, call `getThreadPermalink` and pass `threadUrl` into `saveThreadNote`.

---

## Feature 2 & 3 — Daily and Weekly Digest

Both digests share the same core logic. Build them together.

**Digest delivery**: DM from ThreadNote directly to the user (1-to-1).

**Digest content**:
- A header line (e.g. "Your ThreadNote Weekly Digest")
- List of threads saved in the relevant period, each with:
  - One-line summary (first sentence of `summaryMarkdown`)
  - Slack thread link (`threadUrl` stored in DB)
- If nothing saved: a friendly message explaining how to use ThreadNote

**Timing**:
- Daily: every day at 10:00 AM in user's local timezone
- Weekly: every Monday at 10:00 AM in user's local timezone

**Persistence across restarts**: Digest state is stored in `lastDailyDigestAt` and `lastWeeklyDigestAt` columns on the `users` table. On app startup, immediately check for any missed digests and send them before the cron schedule starts.

---

### New file: `src/digest.ts`

Four exports:

**`getOneLinerSummary(summaryMarkdown: string): string`**

Extract the first meaningful sentence from the summary markdown. Strip markdown formatting (asterisks, hashes) before returning. Max 120 characters, truncate with ellipsis if longer.

**`buildDailyDigestMessage(threads: ThreadNoteRow[]): string`**

Returns Slack mrkdwn formatted string. Example structure:

```
*Your ThreadNote Daily Digest* — Monday, 19 May 2026

Here's what you saved today:

• <https://slack.com/...|RabbitMQ UAT load balancer removal> — Team decided to remove LB and route traffic directly to VM.
• <https://slack.com/...|Q2 sprint planning> — Sprint goals finalised with 3 key deliverables assigned.

_Tap any link to jump to the original thread._
```

If `threads` is empty:

```
*Your ThreadNote Daily Digest*

Nothing was saved today — that's okay!

Here's a quick reminder of how to use ThreadNote:
• Mention *@ThreadNote* in any Slack thread to summarise and save it
• Say *@ThreadNote tldr* for a quick summary
• Say *@ThreadNote action items* to extract tasks
• Open ThreadNote directly to search your saved knowledge base
```

**`buildWeeklyDigestMessage(threads: ThreadNoteRow[], weekStart: string): string`**

Same structure as daily but header says "Weekly Digest" and covers the past 7 days. `weekStart` is a formatted date string like "12 May 2026".

**`sendDigestDM(client: WebClient, slackUserId: string, message: string): Promise<void>`**

Opens a DM channel with the user and sends the message:

```typescript
const dmChannel = await client.conversations.open({ users: slackUserId });
const channelId = dmChannel.channel?.id;
if (!channelId) return;
await client.chat.postMessage({
  channel: channelId,
  text: message,
});
```

---

### New file: `src/scheduler.ts`

**Timezone helper — `getCurrentTimeInTimezone(timezone: string)`**

Use `Intl.DateTimeFormat` to get current hour, minute, and day of week in the given timezone. Returns `{ hour: number, minute: number, dayName: string }`.

```typescript
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
```

**`isDailyDigestDue(user: User): boolean`**

Returns true if:
- `user.dailyDigestEnabled` is true
- Current time in `user.timezone` is 10:00 AM or later
- `user.lastDailyDigestAt` is null OR it was not set today in `user.timezone`

To check "not today in user's timezone", compare the date portion only using `Intl.DateTimeFormat` with `year`, `month`, `day` parts.

**`isWeeklyDigestDue(user: User): boolean`**

Returns true if:
- `user.weeklyDigestEnabled` is true
- Current day in `user.timezone` is Monday
- Current time in `user.timezone` is 10:00 AM or later
- `user.lastWeeklyDigestAt` is null OR it was not set this week in `user.timezone`

**`processDigestsForUser(user: User, client: WebClient): Promise<void>`**

Checks both daily and weekly due conditions and sends the relevant digest. After sending, update `lastDailyDigestAt` or `lastWeeklyDigestAt` in the DB immediately.

For daily: query `thread_notes` where `slackWorkspaceId = user.slackWorkspaceId AND slackUserId = user.slackUserId AND savedAt >= start of today in user timezone`.

For weekly: same but `savedAt >= start of Monday this week in user timezone`.

Build the message using `buildDailyDigestMessage` or `buildWeeklyDigestMessage` from `digest.ts` and send via `sendDigestDM`.

**`checkAndSendAllDigests(client: WebClient): Promise<void>`**

Fetches all users from DB and calls `processDigestsForUser` for each. This is called on startup AND by the cron job.

```typescript
export async function checkAndSendAllDigests(client: WebClient): Promise<void> {
  const users = await prisma.user.findMany();
  await Promise.allSettled(
    users.map((user) => processDigestsForUser(user, client))
  );
}
```

Use `Promise.allSettled` so one user's failure doesn't stop others.

**`startScheduler(client: WebClient): void`**

Start a `node-cron` job that runs every hour on the hour. On each tick, call `checkAndSendAllDigests`.

```typescript
import cron from "node-cron";

export function startScheduler(client: WebClient): void {
  // Run every hour on the hour
  cron.schedule("0 * * * *", async () => {
    console.log("[Scheduler] Running digest check...");
    await checkAndSendAllDigests(client);
  });
  console.log("[Scheduler] Started — hourly digest check active");
}
```

---

## Feature 4 — App Home Tab Settings UI

**What it shows**: A settings panel where users can toggle daily/weekly digests and change their timezone. Pre-filled with values from the DB. On first open, auto-detect timezone from Slack's `users.info` `tz` field and save it if not already set.

**New scope needed**: `im:write` — for opening DM channels to send digests.

**New event needed**: `app_home_opened` — fires when user opens the app home tab.

---

### Updated Slack manifest

Replace the existing manifest with this:

```yaml
display_information:
  name: ThreadNote
  description: AI thread summarizer and personal knowledge base
  background_color: "#2c3e50"
features:
  bot_user:
    display_name: ThreadNote
    always_online: true
  app_home:
    home_tab_enabled: true
    messages_tab_enabled: false
    messages_tab_read_only_enabled: false
  assistant:
    suggested_prompts:
      - title: "What was decided recently?"
        message: "What were the key decisions from my recently saved threads?"
      - title: "Show my open action items"
        message: "What are my open action items from saved threads?"
      - title: "Summarise my knowledge base"
        message: "Give me a summary of everything I have saved so far."
oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - channels:history
      - groups:history
      - im:history
      - im:write
      - mpim:history
      - chat:write
      - users:read
      - channels:read
      - groups:read
      - reactions:read
      - assistant:write
settings:
  event_subscriptions:
    bot_events:
      - app_mention
      - app_home_opened
      - assistant_thread_started
      - assistant_thread_context_changed
      - message.im
  interactivity:
    is_enabled: true
  org_deploy_enabled: false
  socket_mode_enabled: true
  token_rotation_enabled: false
```

Note: `interactivity` is now `true` — required for button clicks and action handlers on the home tab.

After updating the manifest, reinstall the app to the workspace.

---

### New file: `src/home.ts`

**`buildHomeView(user: UserFromDB): object`**

Returns a Bolt-compatible view object for `client.views.publish`. Build it as Block Kit blocks.

Structure:

```
Header: "ThreadNote Settings"
Divider

Section: "Digest Preferences"
Text: "ThreadNote will DM you a digest of your saved threads."

--- Daily Digest ---
Section with two columns:
  Left:  "Daily Digest"  +  subtext "Sent every day at 10:00 AM"
  Right: Overflow/radio buttons (enabled/disabled)
        action_id: "toggle_daily_digest"
        value: current state

Section:
  "Timezone" label
  Static select dropdown — common timezone options
  action_id: "select_timezone"
  initial_option: user's current timezone

Divider

--- Weekly Digest ---
Section with two columns:
  Left:  "Weekly Digest"  +  subtext "Sent every Monday at 10:00 AM"
  Right: radio buttons (enabled/disabled)
        action_id: "toggle_weekly_digest"

Divider

Section with Save button:
  Button text: "Save Settings"
  action_id: "save_home_settings"
  style: "primary"

Divider

Context block: "Timezone auto-detected from your Slack profile. Change it above if incorrect."
```

Timezone dropdown options — include at minimum:
- Asia/Kolkata (IST, UTC+5:30)
- Asia/Singapore (SGT, UTC+8)
- Asia/Dubai (GST, UTC+4)
- Europe/London (GMT/BST)
- America/New_York (EST/EDT)
- America/Los_Angeles (PST/PDT)
- UTC

**`publishHomeView(client: WebClient, userId: string, user: UserFromDB): Promise<void>`**

```typescript
await client.views.publish({
  user_id: userId,
  view: {
    type: "home",
    blocks: buildHomeView(user).blocks,
  },
});
```

**`handleHomeOpened(event, client): Promise<void>`**

1. Look up user in DB by `(workspaceId, userId)`
2. If user doesn't exist yet — upsert with defaults. Then fetch their Slack timezone from `client.users.info({ user: userId })` and update the `timezone` field in DB with `resp.user.tz`
3. If user exists but `timezone` is still the default "Asia/Kolkata" — fetch from Slack and update only if Slack returns a different value
4. Publish home view with current user settings

**`handleSaveSettings(action, body, client, ack): Promise<void>`**

This handler reads the current state of all inputs from `body.view.state.values` and saves to DB. Call `ack()` first. Then update the user's `weeklyDigestEnabled`, `dailyDigestEnabled`, and `timezone` in Prisma. Then republish the home view.

Note: Since inputs are individual action handlers (toggle and select) rather than a form submit, you need to store intermediate state. The simplest approach: register separate action handlers for each action_id that immediately save to DB on change, removing the need for a Save button. This is simpler and more immediate.

Revised approach — no Save button. Three separate action handlers:
- `toggle_daily_digest` → immediately update `dailyDigestEnabled` in DB → republish home
- `toggle_weekly_digest` → immediately update `weeklyDigestEnabled` in DB → republish home
- `select_timezone` → immediately update `timezone` in DB → republish home

---

### Update `src/index.ts`

Add these registrations after existing handlers:

```typescript
import { handleHomeOpened, handleSaveSettings } from "./home.js";
import { startScheduler, checkAndSendAllDigests } from "./scheduler.js";

// App Home Tab
app.event("app_home_opened", async ({ event, client, ack }) => {
  if (typeof ack === "function") await ack();
  await handleHomeOpened(event, client);
});

// Home Tab action handlers
app.action("toggle_daily_digest", async ({ body, client, ack }) => {
  await ack();
  // extract new value from body.actions[0].selected_option.value
  // update DB, republish home
});

app.action("toggle_weekly_digest", async ({ body, client, ack }) => {
  await ack();
});

app.action("select_timezone", async ({ body, client, ack }) => {
  await ack();
});
```

After `await app.start()` and the startup log, add:

```typescript
// Check for any missed digests on startup (handles server restarts)
checkAndSendAllDigests(app.client).catch(console.error);

// Start the hourly digest scheduler
startScheduler(app.client);
```

---

## Build Order

Build in this exact sequence:

1. Install `node-cron` and `@types/node-cron`
2. Update `prisma/schema.prisma` with new columns
3. Run `npm run db:migrate` (name: `phase2_additions`) then `npm run db:generate`
4. Add `getThreadPermalink` to `src/slack-utils.ts`
5. Update `saveThreadNote` in `src/kb.ts` to upsert + pass `threadUrl`
6. Update `src/index.ts` to fetch and pass `threadUrl` when saving
7. Create `src/digest.ts` with all four exports
8. Create `src/scheduler.ts` with timezone helper, due-check functions, and cron setup
9. Update Slack manifest and reinstall app
10. Create `src/home.ts` with home view builder and action handlers
11. Register all new events and actions in `src/index.ts`
12. Add startup digest check and scheduler start to `src/index.ts`

---

## Testing Checklist

After building, verify each feature works:

**Re-summarise on update**
- [ ] Invoke `@ThreadNote` on a thread — confirm row saved in `thread_notes`
- [ ] Add a new message to the same thread, invoke `@ThreadNote` again
- [ ] Confirm only ONE row exists for that thread in Neon (not two)
- [ ] Confirm `summary_markdown` was updated with the new summary

**Digest**
- [ ] Temporarily change the cron to `* * * * *` (every minute) for testing
- [ ] Confirm a DM arrives from ThreadNote with saved threads listed
- [ ] Confirm empty state message if no threads saved
- [ ] Restore cron to `0 * * * *` after testing

**App Home Tab**
- [ ] Click on ThreadNote in Slack sidebar — confirm home tab appears with settings
- [ ] Toggle daily digest off — confirm `daily_digest_enabled = false` in Neon
- [ ] Change timezone — confirm `timezone` updated in Neon
- [ ] Toggle back on — confirm it updates correctly

---

## Do NOT Do

- Do not add any new npm packages beyond `node-cron` and `@types/node-cron`
- Do not use a date library — use `Intl.DateTimeFormat` from Node.js built-ins
- Do not store digest state in memory — always read from and write to Postgres
- Do not break any existing Phase 1 or Phase 2 functionality
- Do not modify `threadnote_system_prompt.md`
- Do not add a web dashboard or any HTTP endpoints

---

## Final Instruction — Update CLAUDE.md

After all features are built and the testing checklist above is verified, update `CLAUDE.md` as follows:

1. Find the section `## Phase 2 — CURRENT WORK` and rename it to `## Phase 2 — COMPLETED`

2. Inside that section, find `## Phase 2 Current Status` and replace the entire checklist with:

```markdown
## Phase 2 Status — ALL COMPLETED

### Core features
- [x] Neon Postgres + pgvector + Prisma setup
- [x] users, thread_notes, conversations tables
- [x] OpenAI embeddings on every saved summary
- [x] KB save on every @ThreadNote invocation
- [x] Per-user KB isolation
- [x] AI Assistant panel with RAG and conversation memory

### Phase 2 additions
- [x] Re-summarise on update (upsert, old summary replaced)
- [x] Thread permalink saved with every thread note
- [x] Daily digest — DM at 10 AM in user's timezone
- [x] Weekly digest — DM every Monday at 10 AM in user's timezone
- [x] Persistent scheduler via node-cron + Postgres state (survives restarts)
- [x] App Home Tab settings UI — timezone, digest toggles
- [x] Auto-detect timezone from Slack user profile on first open
```

3. Append this new section at the bottom of `CLAUDE.md` before the Global Gotchas section:

```markdown
## Phase 2 Additions — New Files and Packages

### New packages added
- node-cron — hourly digest scheduler
- @types/node-cron — TypeScript types

### New files
- src/digest.ts — digest message builder and DM sender
- src/scheduler.ts — cron setup, timezone logic, digest due-check
- src/home.ts — App Home Tab Block Kit view and action handlers

### New columns added (migration: phase2_additions)
On users table: timezone, weekly_digest_enabled, daily_digest_enabled,
last_weekly_digest_at, last_daily_digest_at
On thread_notes table: thread_url

### New Slack scopes added
- im:write (for opening DM channels to send digests)

### New Slack events added
- app_home_opened

### New action_ids registered
- toggle_daily_digest
- toggle_weekly_digest
- select_timezone

### Important patterns added
- Upsert pattern for saveThreadNote — use Prisma upsert on unique constraint
- Digest due-check uses Intl.DateTimeFormat — no date library
- Scheduler runs every hour; also fires on startup to catch missed digests
- Home tab actions save to DB immediately on change — no Save button
```

4. Add these entries to the Global Gotchas table at the bottom:

```markdown
| Cron not firing | Confirm node-cron is started after app.start() in index.ts |
| DM not delivered | Confirm im:write scope is active — reinstall app after manifest update |
| Home tab blank | Confirm app_home_opened event is in manifest AND interactivity is enabled |
| Timezone wrong | Check users table — timezone column should match Slack's tz field from users.info |
| Duplicate digests after restart | Check last_daily_digest_at and last_weekly_digest_at — should be set after each send |
```

After updating CLAUDE.md, your task is complete.
