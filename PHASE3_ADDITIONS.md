# PHASE3_ADDITIONS.md — Instructions for Claude Code

Read this entire file before writing a single line of code. Build each feature in the exact order specified in the Build Order section. After all features are built and tested, follow the final instruction to update CLAUDE.md.

---

## Context

Phase 1 and Phase 2 are fully built and working. ThreadNote is currently deployed on Render using Socket Mode with a single hardcoded bot token for one workspace. Phase 3 makes ThreadNote publicly distributable — any Slack workspace can install it via an "Add to Slack" button without going through the Marketplace.

Read CLAUDE.md fully before starting. Do not modify anything that is working unless explicitly instructed in this file.

---

## What Phase 3 Builds

1. **Multi-workspace OAuth** — every new workspace gets its own token stored in Postgres via Bolt's InstallationStore
2. **Socket Mode retained** — no change to how Bolt receives events. Socket Mode continues in both local dev and production.
3. **Small Express server** — added only for the OAuth endpoints and landing page. Event handling stays on the WebSocket.
4. **Graceful rate limit handling** — progress updates for threads over 15 messages
5. **Welcome DM** — when a workspace installs ThreadNote, DM the installing user
6. **Minimal landing page** — served from the Express server at the root URL

---

## Confirmed Decisions — Do Not Change

| Decision | Choice |
|----------|--------|
| Slack connection | Socket Mode — unchanged in both dev and production |
| Event handling | WebSocket via Socket Mode — no HTTP Events API |
| Express server | Added only for OAuth routes and landing page, not for events |
| Landing page | Minimal — install button + what it does |
| Rate limit handling | Graceful pagination with progress updates |
| Data deletion | Not in Phase 3 — add later |
| Welcome message | Yes — DM the installing user on first install only |
| Onboarding | Silent — no channel announcements, just the welcome DM |
| App name on OAuth screen | ThreadNote |
| Pricing | Completely free — no billing, no usage caps |

---

## New Packages to Install

```bash
npm install express
npm install -D @types/express
```

No other new packages. Bolt's OAuth support is already included in `@slack/bolt`.

---

## New Environment Variables

Add these to Render's environment tab AND to your local `.env`.
Keep all existing Phase 1 and Phase 2 variables unchanged.

```
# Phase 3 — OAuth
SLACK_CLIENT_ID=...        # api.slack.com/apps → Basic Information → App Credentials
SLACK_CLIENT_SECRET=...    # api.slack.com/apps → Basic Information → App Credentials
SLACK_STATE_SECRET=...     # any long random string — prevents CSRF in OAuth flow
APP_URL=https://your-app.onrender.com   # your Render URL, no trailing slash
PORT=3000
```

Note: `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` stay in `.env` unchanged. They are still used — Socket Mode requires `SLACK_APP_TOKEN`, and `SLACK_BOT_TOKEN` is used as the fallback token for your personal workspace in local dev.

---

## Schema Changes

Add a new `installations` table. Do not modify any existing tables.

Add to `prisma/schema.prisma`:

```prisma
model Installation {
  id                String    @id @default(cuid())
  teamId            String    @map("team_id")
  teamName          String?   @map("team_name")
  botToken          String    @map("bot_token")
  botUserId         String?   @map("bot_user_id")
  botId             String?   @map("bot_id")
  appId             String?   @map("app_id")
  installedByUserId String?   @map("installed_by_user_id")
  installedAt       DateTime  @default(now()) @map("installed_at")
  isActive          Boolean   @default(true) @map("is_active")

  @@unique([teamId])
  @@map("installations")
}
```

After updating the schema:

```bash
npm run db:migrate
# migration name when prompted: phase3_oauth
npm run db:generate
```

Verify the `installations` table exists in Neon before continuing.

---

## Architecture Overview

This is how the two servers coexist:

```
Render (one process)
├── Bolt App (Socket Mode)
│   └── WebSocket connection to Slack
│       Handles: app_mention, assistant events, app_home_opened, actions
│
└── Express Server (HTTP on PORT 3000)
    Handles:
    ├── GET  /              → landing page (index.html)
    ├── GET  /slack/install → redirects to Slack OAuth authorise URL
    └── GET  /slack/oauth_redirect → handles OAuth callback, stores token
```

Bolt and Express run in the same Node.js process. Bolt manages the WebSocket. Express manages HTTP. They share the same Prisma client and InstallationStore.

---

## Build Order

Build exactly in this sequence. Do not skip steps.

---

### Step 1 — Install packages and run migration

```bash
npm install express
npm install -D @types/express
npm run db:migrate   # name: phase3_oauth
npm run db:generate
```

---

### Step 2 — Create `src/installation-store.ts`

Bolt's InstallationStore backed by Prisma. Bolt calls these methods automatically — you never call them manually.

```typescript
import type {
  InstallationStore,
  Installation,
  InstallationQuery,
} from "@slack/oauth";
import { prisma } from "./db.js";

export const prismaInstallationStore: InstallationStore = {
  storeInstallation: async (installation: Installation) => {
    const teamId = installation.team?.id;
    if (!teamId) throw new Error("No team ID in installation");

    const existing = await prisma.installation.findUnique({
      where: { teamId },
    });

    await prisma.installation.upsert({
      where: { teamId },
      update: {
        botToken: installation.bot?.token ?? "",
        botUserId: installation.bot?.userId,
        botId: installation.bot?.id,
        appId: installation.appId,
        teamName: installation.team?.name,
        installedByUserId: installation.user?.id,
        isActive: true,
      },
      create: {
        teamId,
        teamName: installation.team?.name,
        botToken: installation.bot?.token ?? "",
        botUserId: installation.bot?.userId,
        botId: installation.bot?.id,
        appId: installation.appId,
        installedByUserId: installation.user?.id,
      },
    });

    // Send welcome DM only on brand new installations, not reinstalls
    if (!existing && installation.user?.id && installation.bot?.token) {
      const { sendWelcomeDM } = await import("./welcome.js");
      sendWelcomeDM(installation.bot.token, installation.user.id).catch(
        console.error
      );
    }
  },

  fetchInstallation: async (query: InstallationQuery<boolean>) => {
    const teamId = query.teamId;
    if (!teamId) throw new Error("No team ID in query");

    const record = await prisma.installation.findUnique({
      where: { teamId },
    });

    if (!record || !record.isActive) {
      throw new Error(`No active installation found for team ${teamId}`);
    }

    return {
      team: { id: record.teamId, name: record.teamName ?? undefined },
      bot: {
        token: record.botToken,
        userId: record.botUserId ?? "",
        id: record.botId ?? undefined,
        scopes: [],
      },
      appId: record.appId ?? undefined,
      user: {
        id: record.installedByUserId ?? "",
        scopes: [],
        token: undefined,
      },
    } as Installation;
  },

  deleteInstallation: async (query: InstallationQuery<boolean>) => {
    const teamId = query.teamId;
    if (!teamId) return;
    await prisma.installation.updateMany({
      where: { teamId },
      data: { isActive: false },
    });
  },
};
```

---

### Step 3 — Create `src/welcome.ts`

Sends a welcome DM to the user who installed ThreadNote.

```typescript
import { WebClient } from "@slack/web-api";

const WELCOME_MESSAGE = `👋 Hi! I'm *ThreadNote* — your AI-powered Slack thread summariser and personal knowledge base.

Here's how to use me:

*Summarising threads*
Mention @ThreadNote in any thread to get an instant summary:
• \`@ThreadNote\` or \`@ThreadNote go ahead\` → full structured summary
• \`@ThreadNote tldr\` → quick 2-3 sentence summary
• \`@ThreadNote action items\` → tasks with owners and deadlines
• \`@ThreadNote decisions\` → key decisions only
• \`@ThreadNote draft followup\` → write a follow-up message for the thread

_My responses are private — only you can see my summaries._

*Your knowledge base*
Every thread I summarise is automatically saved to your personal knowledge base. Click on me in the Slack sidebar to chat and ask questions like:
• "What did we decide about the API redesign?"
• "What are my open action items this week?"
• "Summarise everything I saved last week"

Give it a try — mention me in any thread to get started! 🚀`;

export async function sendWelcomeDM(
  botToken: string,
  userId: string
): Promise<void> {
  const client = new WebClient(botToken);
  try {
    const dm = await client.conversations.open({ users: userId });
    const channelId = dm.channel?.id;
    if (!channelId) return;
    await client.chat.postMessage({
      channel: channelId,
      text: WELCOME_MESSAGE,
    });
    console.log(`[Welcome] Sent welcome DM to user ${userId}`);
  } catch (err) {
    console.error("[Welcome] Failed to send welcome DM:", err);
  }
}
```

---

### Step 4 — Update `src/slack-utils.ts` for graceful rate limit handling

Replace the existing `fetchFullThread` function with this version. It handles pagination with progress reporting. The 62-second delay only applies between pages when a thread has more than 15 messages — single-page threads are completely unaffected.

New signature:

```typescript
export async function fetchFullThread(
  client: WebClient,
  channel: string,
  threadTs: string,
  onProgress?: (page: number, estimatedTotal: number) => Promise<void>
): Promise<SlackMessage[]>
```

New implementation:

```typescript
export async function fetchFullThread(
  client: WebClient,
  channel: string,
  threadTs: string,
  onProgress?: (page: number, estimatedTotal: number) => Promise<void>
): Promise<SlackMessage[]> {
  const messages: SlackMessage[] = [];

  // First request
  const firstResp = await client.conversations.replies({
    channel,
    ts: threadTs,
    limit: 15,
  });

  if (firstResp.messages) {
    messages.push(...(firstResp.messages as SlackMessage[]));
  }

  // Single page — return immediately, no delay
  if (!firstResp.has_more) {
    return messages;
  }

  // Multi-page — estimate total pages from reply_count on parent message
  const parent = firstResp.messages?.[0] as SlackMessage & {
    reply_count?: number;
  };
  const replyCount = parent?.reply_count ?? 0;
  const estimatedPages = Math.ceil((replyCount + 1) / 15);

  // Report page 1 progress
  if (onProgress) {
    await onProgress(1, estimatedPages).catch(console.error);
  }

  let cursor = firstResp.response_metadata?.next_cursor;
  let page = 1;

  while (cursor) {
    page++;

    // Wait 62 seconds between pages to respect 1 req/min rate limit
    // for non-Marketplace distributed apps
    await new Promise((resolve) => setTimeout(resolve, 62_000));

    const resp = await client.conversations.replies({
      channel,
      ts: threadTs,
      cursor,
      limit: 15,
    });

    if (resp.messages) {
      // Skip the first message on subsequent pages — it's the parent repeated
      messages.push(...(resp.messages.slice(1) as SlackMessage[]));
    }

    if (onProgress) {
      await onProgress(page, estimatedPages).catch(console.error);
    }

    if (!resp.has_more) break;
    cursor = resp.response_metadata?.next_cursor;
    if (!cursor) break;
  }

  return messages;
}
```

---

### Step 5 — Update `src/index.ts` to pass progress callback

In the `processMention` function, update the `fetchFullThread` call to pass an `onProgress` callback that updates the placeholder ephemeral message:

```typescript
const messages = await fetchFullThread(
  client,
  channel,
  threadTs,
  async (page: number, totalPages: number) => {
    if (totalPages <= 1) return; // No progress needed for single-page threads
    await client.chat.update({
      channel,
      ts: placeholder.ts!,
      text: `:hourglass_flowing_sand: ThreadNote is reading the thread — fetching page ${page} of ~${totalPages}…`,
    });
  }
);
```

No other changes to existing handlers. Do not touch the Bolt app initialisation — Socket Mode stays as-is.

---

### Step 6 — Create `src/oauth-server.ts`

A small standalone Express server that handles only the OAuth flow and serves the landing page. This runs alongside the Bolt Socket Mode app in the same process.

```typescript
import express from "express";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { prismaInstallationStore } from "./installation-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createOAuthServer(): express.Application {
  const expressApp = express();

  const CLIENT_ID = process.env.SLACK_CLIENT_ID!;
  const CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET!;
  const STATE_SECRET = process.env.SLACK_STATE_SECRET!;
  const APP_URL = process.env.APP_URL!;

  const REDIRECT_URI = `${APP_URL}/slack/oauth_redirect`;

  const SCOPES = [
    "app_mentions:read",
    "channels:history",
    "groups:history",
    "im:history",
    "im:write",
    "mpim:history",
    "chat:write",
    "users:read",
    "channels:read",
    "groups:read",
    "reactions:read",
    "assistant:write",
  ].join(",");

  // Landing page
  expressApp.get("/", async (_req, res) => {
    try {
      const html = await readFile(
        join(__dirname, "../public/index.html"),
        "utf-8"
      );
      res.setHeader("Content-Type", "text/html");
      res.send(html);
    } catch {
      res.status(500).send("Landing page not found");
    }
  });

  // Initiate OAuth — redirect to Slack's authorise URL
  expressApp.get("/slack/install", (_req, res) => {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      scope: SCOPES,
      redirect_uri: REDIRECT_URI,
      state: STATE_SECRET,
    });
    res.redirect(
      `https://slack.com/oauth/v2/authorize?${params.toString()}`
    );
  });

  // OAuth callback — exchange code for token and store it
  expressApp.get("/slack/oauth_redirect", async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
      console.error("[OAuth] Error from Slack:", error);
      res.send("Installation cancelled.");
      return;
    }

    if (state !== STATE_SECRET) {
      res.status(400).send("Invalid state parameter.");
      return;
    }

    try {
      // Exchange the code for a token
      const tokenResp = await fetch("https://slack.com/api/oauth.v2.access", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code: code as string,
          redirect_uri: REDIRECT_URI,
        }),
      });

      const data = (await tokenResp.json()) as {
        ok: boolean;
        error?: string;
        team?: { id: string; name: string };
        bot_user_id?: string;
        access_token?: string;
        app_id?: string;
        authed_user?: { id: string };
      };

      if (!data.ok) {
        throw new Error(data.error ?? "OAuth failed");
      }

      // Build installation object and store it
      const installation = {
        team: { id: data.team!.id, name: data.team!.name },
        bot: {
          token: data.access_token!,
          userId: data.bot_user_id!,
          scopes: [],
          id: undefined,
        },
        appId: data.app_id,
        user: {
          id: data.authed_user?.id ?? "",
          scopes: [],
          token: undefined,
        },
      };

      await prismaInstallationStore.storeInstallation(installation as never);

      console.log(`[OAuth] Workspace ${data.team!.name} installed ThreadNote`);
      res.send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:60px">
          <h2>✅ ThreadNote installed successfully!</h2>
          <p>Head back to Slack — I've sent you a welcome message to get started.</p>
          <a href="slack://open">Open Slack</a>
        </body></html>
      `);
    } catch (err) {
      console.error("[OAuth] Token exchange failed:", err);
      res.status(500).send("Installation failed. Please try again.");
    }
  });

  return expressApp;
}
```

---

### Step 7 — Update `src/index.ts` to start the OAuth server

At the bottom of `src/index.ts`, after `await app.start()`, add:

```typescript
import { createOAuthServer } from "./oauth-server.js";

// Start OAuth + landing page Express server
const PORT = parseInt(process.env.PORT ?? "3000", 10);
const oauthServer = createOAuthServer();
oauthServer.listen(PORT, () => {
  console.log(`🌐 ThreadNote OAuth server running on port ${PORT}`);
});
```

The Bolt Socket Mode app and Express server now run together in one process. Bolt handles Slack events over WebSocket. Express handles OAuth and serves the landing page over HTTP.

---

### Step 8 — Create `public/index.html`

Create a `public/` directory at the project root and add `index.html`. This is the minimal landing page served at the root URL.

Requirements:
- ThreadNote name and one-line tagline
- 3-step explanation of how it works
- Official "Add to Slack" button linking to `/slack/install`
- Privacy Policy and Terms of Service links in the footer (use `#` as href for now — Himanshu will replace with real URLs)
- Clean minimal design — pure HTML and inline CSS, no frameworks, no JavaScript
- Under 120 lines total

Official Add to Slack button markup (use exactly this):

```html
<a href="/slack/install">
  <img
    alt="Add to Slack"
    height="40"
    width="139"
    src="https://platform.slack-edge.com/img/add_to_slack.png"
    srcset="
      https://platform.slack-edge.com/img/add_to_slack.png    1x,
      https://platform.slack-edge.com/img/add_to_slack@2x.png 2x
    "
  />
</a>
```

Content to include:

```
Hero:
  ThreadNote
  Turn your Slack threads into a searchable knowledge base.

How it works:
  1. Mention @ThreadNote in any Slack thread
  2. Get an instant private summary, decisions, and action items
  3. Chat with ThreadNote to search everything you've saved

[Add to Slack button]

Footer:
  Privacy Policy | Terms of Service
```

Style guidance — dark and clean:
- Background: #1a1a2e or #0f0f1a
- Text: #ffffff and #a0a0b0 for secondary
- Accent: #4f46e5 or #6366f1 (indigo)
- Font: system-ui or Inter (load from Google Fonts)
- Centered layout, max-width 680px, generous padding
- The Add to Slack button should be the most prominent element after the headline

---

### Step 9 — Update Slack app manifest

The manifest needs one addition — a redirect URL for OAuth. Everything else stays the same as Phase 2. Update in api.slack.com/apps → App Manifest.

Only change needed — add `redirect_urls` under `oauth_config`:

```yaml
oauth_config:
  redirect_urls:
    - https://your-app.onrender.com/slack/oauth_redirect
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
```

Replace `https://your-app.onrender.com` with the actual Render URL. Everything else in the manifest is unchanged — `socket_mode_enabled: true` stays, no `request_url` needed.

After updating the manifest, go to Basic Information → App Credentials and copy `Client ID`, `Client Secret`. Add them to Render environment variables along with a generated `SLACK_STATE_SECRET`.

---

## Testing Checklist

### Rate limit handling
- [ ] Thread with ≤15 messages — confirm instant response, no progress update shown
- [ ] Thread with 16+ messages — confirm progress message appears ("fetching page 1 of ~2…") and final summary appears after the wait
- [ ] Confirm single-page threads are completely unaffected by the 62s delay

### OAuth and multi-workspace
- [ ] Visit `https://your-app.onrender.com/` — confirm landing page loads with Add to Slack button
- [ ] Click Add to Slack — confirm Slack OAuth screen appears with "ThreadNote" as the app name and "App is not approved by Slack" notice
- [ ] Complete installation in a test workspace — confirm success page shown
- [ ] Check Neon — confirm a row exists in `installations` table with correct `team_id` and `bot_token`
- [ ] Mention `@ThreadNote` in a thread in the newly installed workspace — confirm it responds correctly

### Welcome DM
- [ ] Complete fresh install — confirm welcome DM arrives immediately
- [ ] Uninstall and reinstall — confirm welcome DM is NOT sent again on reinstall
- [ ] Confirm `isActive` is set back to `true` on reinstall

### Landing page
- [ ] Root URL loads the landing page
- [ ] Add to Slack button is visible and clicking it starts the OAuth flow
- [ ] Privacy Policy and Terms of Service links present in footer
- [ ] Page looks clean on mobile

---

## Do NOT Do

- Do not switch to HTTP Events API — Socket Mode stays in both local dev and production
- Do not remove `SLACK_BOT_TOKEN` or `SLACK_APP_TOKEN` from env — still needed for Socket Mode
- Do not add the 62-second delay for single-page threads — delay only goes between paginated requests when `has_more` is true
- Do not send welcome DM on reinstallation — only brand new first-time installs
- Do not add billing, Stripe, or usage caps — completely free
- Do not add data deletion commands — deferred to later
- Do not modify the system prompt or any LLM logic
- Do not touch any Phase 1 or Phase 2 handlers

---

## New Files Summary

```
threadnote/
├── public/
│   └── index.html                  ← NEW: minimal landing page
├── src/
│   ├── installation-store.ts       ← NEW: Prisma-backed Bolt InstallationStore
│   ├── welcome.ts                  ← NEW: welcome DM content and sender
│   ├── oauth-server.ts             ← NEW: Express server for OAuth + landing page
│   ├── index.ts                    ← UPDATED: start OAuth server + progress callback
│   └── slack-utils.ts              ← UPDATED: fetchFullThread with onProgress + delay
└── prisma/
    └── schema.prisma               ← UPDATED: installations table added
```

---

## Final Instruction — Update CLAUDE.md

After all features are built and the testing checklist is fully verified, update `CLAUDE.md` as follows:

1. Find the Phase 2 status section and add a new section below it:

```markdown
## Phase 3 — Public Launch — COMPLETED

### Goal
Make ThreadNote publicly distributable. Any Slack workspace can install
via the Add to Slack button at threadnote.co without Marketplace approval.

### Confirmed decisions
- Socket Mode retained in both local dev and production — no HTTP Events API
- Multi-workspace OAuth via Prisma InstallationStore
- Small Express server runs alongside Bolt for OAuth endpoints and landing page
- Rate limit: graceful pagination with 62s delay between pages, progress updates shown
- Welcome DM sent to installing user on first install only, not on reinstalls
- Completely free — no billing, no usage caps
- Minimal landing page served from Express at root URL

### New files
- src/installation-store.ts — Prisma InstallationStore for multi-workspace OAuth
- src/welcome.ts — welcome DM content and sender
- src/oauth-server.ts — Express server for /slack/install, /slack/oauth_redirect, landing page
- public/index.html — minimal landing page

### Updated files
- src/index.ts — starts OAuth Express server alongside Bolt, passes progress callback
- src/slack-utils.ts — fetchFullThread with onProgress and 62s inter-page delay
- prisma/schema.prisma — installations table added

### New environment variables
- SLACK_CLIENT_ID
- SLACK_CLIENT_SECRET
- SLACK_STATE_SECRET
- APP_URL
- PORT

### New migration
- phase3_oauth — adds installations table

### Rate limit behaviour
- Threads ≤15 messages: instant, zero delay, no progress update shown
- Threads 16-30 messages: one 62s wait for page 2, progress shown
- Threads 31-45 messages: two 62s waits, progress shown per page
- Only affects non-Marketplace installations — personal workspace and TabSquare unaffected
```

2. Add these to the Global Gotchas table:

```markdown
| OAuth redirect mismatch | Redirect URL in manifest must exactly match APP_URL + /slack/oauth_redirect |
| Welcome DM sent twice on reinstall | Check existing record BEFORE upsert in storeInstallation |
| installations table missing | Run npm run db:migrate then npm run db:generate |
| Landing page 404 | Confirm public/index.html exists and __dirname path is correct in oauth-server.ts |
| SLACK_CLIENT_ID undefined | Add to Render environment variables — not the same as SLACK_BOT_TOKEN |
| Rate limit 429 from Slack | Increase delay from 62s to 70s in fetchFullThread |
```
