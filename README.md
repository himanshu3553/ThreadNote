# ThreadNote

A Slack bot that turns any thread into a structured summary and saves it to a personal, searchable knowledge base. Chat with your saved threads through Slack's AI Assistant panel.

---

## Features

**Thread summarisation** — Mention `@ThreadNote` in any thread. It replies with a clean summary: title, TL;DR, key decisions, and action items. Only you see the response (ephemeral).

**Auto-save to knowledge base** — Every `@ThreadNote` invocation automatically saves the summary and a vector embedding to your personal knowledge base in Neon Postgres. Invoking it again on the same thread overwrites the old summary with the latest one (no duplicates).

**AI Assistant chat** — Open the ThreadNote AI panel in Slack and ask questions in plain English. ThreadNote does a semantic search over your saved threads and replies with context from your own history. Responses use proper Slack formatting and include inline source links to the original threads.

**Daily & weekly digest** — ThreadNote DMs you a digest of saved threads every day at 10 AM and every Monday at 10 AM (in your local timezone). Toggle each digest on/off from the Home tab.

**App Home Tab settings** — Click ThreadNote in the Slack sidebar to open a settings panel. Toggle daily/weekly digests and change your timezone. Settings save instantly.

**Public distribution** — Any Slack workspace can install ThreadNote via the Add to Slack button on the landing page. No Slack Marketplace approval required. Each workspace gets its own bot token stored in Postgres. Installing user receives a welcome DM automatically.

---

## How it works

### @mention flow

1. User mentions `@ThreadNote` in a Slack thread with an optional instruction.
2. Bot ACKs Slack immediately (within 3 seconds) and processes async.
3. Full thread is fetched via `conversations.replies` with pagination (62s delay between pages for threads over 15 messages — progress shown in the thread).
4. Transcript sent to OpenAI (`gpt-5.4`, Responses API).
5. Response converted from Markdown to Slack mrkdwn and posted as an ephemeral message (only visible to you).
6. Summary + embedding saved to Neon Postgres automatically.

### OAuth install flow

1. Visitor clicks **Add to Slack** on the landing page.
2. Landing page routes to `/slack/install` which redirects to Slack's OAuth authorise URL with a state secret.
3. User approves → Slack redirects to `/slack/oauth_redirect` with a code.
4. Server exchanges the code for a bot token via `oauth.v2.access`.
5. Token stored in the `installations` table via `prismaInstallationStore`.
6. Welcome DM sent to the installing user.
7. All future events from that workspace are authenticated using the stored token.

### AI Assistant chat flow

1. User opens the ThreadNote AI panel in Slack and sends a message.
2. Bot generates an embedding for the user's question.
3. pgvector cosine similarity search retrieves the top 5 relevant saved threads.
4. Last 15 messages of the conversation are loaded from Postgres.
5. OpenAI call with KB context + conversation history + new question.
6. Response posted in the assistant panel; both turns saved to conversation history.

---

## Usage

### Thread summarisation

Mention `@ThreadNote` in any Slack thread:

| Instruction | Output |
|---|---|
| `@ThreadNote` *(no instruction)* | Full note: title, TL;DR, context, key decisions |
| `@ThreadNote tldr` | 2–3 sentence digest |
| `@ThreadNote action items` | Action item table with owners and deadlines |
| `@ThreadNote decisions only` | Decision log |
| `@ThreadNote status` | Status tracker |
| `@ThreadNote draft followup` | Ready-to-send Slack follow-up |
| `@ThreadNote email this` | Email-ready summary |
| `@ThreadNote analyze` | Risk, blocker, and ambiguity analysis |

### AI Assistant chat

In Slack, click the **✦ AI** icon in the left sidebar (or search for ThreadNote under Apps). Ask anything:

- *"What were the key decisions from my recently saved threads?"*
- *"What are my open action items?"*
- *"Give me a summary of everything I have saved so far."*

---

## Prerequisites

Before starting, make sure you have:

- **Node.js v24+** — check with `node --version`
- **npm** — comes with Node.js
- **A Neon account** — free tier at [neon.tech](https://neon.tech)
- **An OpenAI account** — with API access at [platform.openai.com](https://platform.openai.com)
- **A Slack workspace** — where you have admin permissions to install apps and enable AI features

---

## Setup

### 1. Create a Neon Postgres database

1. Sign in at [neon.tech](https://neon.tech) and create a new project.
2. Once the project is created, open the **SQL Editor** and run:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
3. Go to the **Dashboard → Connection Details**. You will see two connection strings:
   - **Pooled connection** (hostname contains `-pooler`) → use this for `DATABASE_URL`
   - **Direct connection** (hostname without `-pooler`) → use this for `DIRECT_URL`

   For local development both can be the same string (the direct connection URL).

### 2. Create a Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → click **Create New App** → choose **From a manifest**.
2. Select your workspace and paste this YAML manifest:

```yaml
display_information:
  name: ThreadNote
  description: AI thread summarizer and personal knowledge base
  background_color: "#2c3e50"
features:
  app_home:
    home_tab_enabled: true
    messages_tab_enabled: true
    messages_tab_read_only_enabled: false
  bot_user:
    display_name: ThreadNote
    always_online: true
  assistant_view:
    assistant_description: Thread Note taker
    suggested_prompts:
      - title: FYI
        message: FYI
      - title: Summary
        message: Summary
      - title: Noted
        message: Noted
      - title: Ok
        message: Ok
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
  pkce_enabled: false
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
  is_mcp_enabled: false
```

3. Click **Next** → **Create**.

4. **Get your `SLACK_APP_TOKEN`** — In the left sidebar go to **Settings → Basic Information → App-Level Tokens** → click **Generate Token and Scopes** → add the `connections:write` scope → click **Generate** → copy the token (starts with `xapp-`).

5. **Get your `SLACK_BOT_TOKEN`** — In the left sidebar go to **Settings → Install App** → click **Install to Workspace** → approve the permissions → copy the **Bot User OAuth Token** (starts with `xoxb-`).

6. **Enable the AI Assistant feature** — In the left sidebar go to **Features → App Assistant** → enable **Agents & AI Apps**.

7. **Enable AI at workspace level** — In your Slack workspace go to **Settings & Administration → Workspace Settings** → search for **Agents** → enable **Agents & AI Apps**. (You must do this at both the app level and workspace level.)

8. **Reinstall the app** — Go back to **Settings → Install App** → click **Reinstall to Workspace** to apply the `assistant:write` scope.

> **Note:** After enabling the AI agent feature, direct messaging to the bot is turned off by Slack. You will interact with ThreadNote through the **✦ AI** panel in the Slack sidebar instead.

9. **Enable public distribution** — Go to **Settings → Manage Distribution** → complete the checklist → click **Activate Public Distribution**. This allows other workspaces to install via OAuth. It does not submit to the Marketplace.

### 3. Clone and install

```bash
git clone <repo-url>
cd threadnote
npm install
```

### 4. Configure environment variables

Create a `.env` file in the project root (`.env.example` is intentionally gitignored — create this from scratch):

```env
# Slack — Socket Mode
SLACK_BOT_TOKEN=xoxb-...        # from step 2.5 — kept for reference, not used by Bolt directly
SLACK_APP_TOKEN=xapp-...        # from step 2.4 — App-Level Token for Socket Mode WebSocket

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.4

# Neon Postgres — from step 1.3
DATABASE_URL=postgresql://user:password@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require
DIRECT_URL=postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require

# Embeddings
OPENAI_EMBEDDING_MODEL=text-embedding-3-large

# OAuth — public distribution
SLACK_CLIENT_ID=...             # api.slack.com/apps → Basic Information → App Credentials
SLACK_CLIENT_SECRET=...         # api.slack.com/apps → Basic Information → App Credentials
SLACK_STATE_SECRET=...          # any long random string — generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
APP_URL=https://your-app.onrender.com   # your public URL, no trailing slash
PORT=3000
```

Where to find each value:
- `SLACK_BOT_TOKEN` — Slack app dashboard → **Install App** → Bot User OAuth Token
- `SLACK_APP_TOKEN` — Slack app dashboard → **Basic Information → App-Level Tokens** → generate with `connections:write` scope
- `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` — Slack app dashboard → **Basic Information → App Credentials**
- `OPENAI_API_KEY` — [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- `DATABASE_URL` — Neon dashboard → **Connection Details** → Pooled connection string (hostname contains `-pooler`)
- `DIRECT_URL` — Neon dashboard → **Connection Details** → Direct connection string (hostname without `-pooler`). For local dev both can be the same string.

> **Important:** `.env` must be fully configured before running the migration in the next step.

### 5. Enable pgvector on Neon (required before migration)

In the Neon dashboard → SQL Editor, run this against your database:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

This must be done before running migrations — the schema uses the `vector` type and the migration will fail without it.

### 6. Run the database migration and generate the Prisma client

```bash
npm run db:migrate    # applies all pending migrations to Neon
npm run db:generate   # generates the local TypeScript Prisma client
```

> **Important:** `generated/prisma/` is gitignored — it must be created on every new machine by running `npm run db:generate`. The app will crash at startup if this step is skipped.

You should see all four tables (`users`, `thread_notes`, `conversations`, `installations`) in the Neon dashboard under **Tables**.

### 7. Invite the bot to channels

In any Slack channel you want ThreadNote to read, run:

```
/invite @ThreadNote
```

The bot must be a member of a channel to fetch thread messages from it.

### 8. Start the bot

```bash
npm run dev     # development — restarts automatically on file changes
npm run start   # production — run once
```

You should see:

```
⚡ ThreadNote is running (Socket Mode)
🌐 ThreadNote OAuth server running on port 3000
[Scheduler] Started — hourly digest check active
```

If any users already exist in the database and a digest is due (past 10 AM), you will also see `[Scheduler] Daily digest sent to ...` immediately on startup.

The bot is now live. Mention `@ThreadNote` in any thread it has access to, open the **✦ AI** section in the Slack sidebar to chat with your knowledge base, or click ThreadNote in the sidebar to open the Home tab settings.

---

## Branching strategy

| Branch | Purpose | Deployed to |
|--------|---------|-------------|
| `main` | Production releases | Render — auto-deploys on every push to `main` |
| `dev` | Active development | Local only — merge to `main` when ready to release |

## Database environments

| Environment | Neon DB | Config location |
|-------------|---------|-----------------|
| Local dev | `ThreadNote_Dev` | `.env` file |
| Production | `ThreadNote_Prod` | Render environment tab |

Migrations run separately per environment:
- Local: `npm run db:migrate` (targets `ThreadNote_Dev` via `.env`)
- Render: `npm run db:deploy` in build command (targets `ThreadNote_Prod` via Render env vars)

---

## Deploy on Render

ThreadNote runs two servers in one process: Bolt (Socket Mode WebSocket) and Express (HTTP on port 3000). The Express server must be publicly accessible for the OAuth redirect. Use **Web Service**, not Background Worker.

### 1. Push your code to GitHub

Make sure the repo is up to date on your GitHub remote.

### 2. Create a Web Service on Render

1. Go to [dashboard.render.com](https://dashboard.render.com) → **New** → **Web Service**
2. Connect your GitHub repo and select the `main` branch
3. Set the following:

| Field | Value |
|---|---|
| **Runtime** | Node |
| **Build Command** | `npm install && npm run db:deploy && npm run db:generate` |
| **Start Command** | `node --import tsx/esm src/index.ts` |

> **Why override the start command?** The `npm run start` script uses `--env-file=.env`. On Render there is no `.env` file — env vars are injected directly by Render. The override skips the file entirely.

> **Why `db:deploy` in build, not `db:migrate`?** `prisma migrate dev` is for local development only (interactive, creates new migration files). `prisma migrate deploy` applies existing migrations to the production database with no prompts — safe to run in CI/CD.

### 3. Set environment variables

In the Render service dashboard → **Environment** tab, add all variables:

| Key | Value |
|---|---|
| `SLACK_BOT_TOKEN` | `xoxb-...` |
| `SLACK_APP_TOKEN` | `xapp-...` |
| `OPENAI_API_KEY` | `sk-...` |
| `OPENAI_MODEL` | `gpt-5.4` |
| `DATABASE_URL` | Neon pooled connection string |
| `DIRECT_URL` | Neon direct connection string |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-large` |
| `SLACK_CLIENT_ID` | From Slack app → Basic Information → App Credentials |
| `SLACK_CLIENT_SECRET` | From Slack app → Basic Information → App Credentials |
| `SLACK_STATE_SECRET` | Any long random string |
| `APP_URL` | Your Render service URL, e.g. `https://threadnote.onrender.com` |
| `PORT` | `3000` |

### 4. Enable pgvector on ThreadNote_Prod

In Neon dashboard → select `ThreadNote_Prod` → SQL Editor:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### 5. Update Slack app redirect URL

After Render assigns your service URL, update the Slack app manifest's `redirect_urls` to:
```
https://your-app.onrender.com/slack/oauth_redirect
```
Also add it in **Features → OAuth & Permissions → Redirect URLs**.

### 6. Deploy

Click **Save and Deploy**. The build log should show:

```
Applying migration '20260513190343_initial_schema'...
All migrations have been applied.
Prisma Client generated → generated/prisma/
```

And the runtime log should show:

```
⚡ ThreadNote is running (Socket Mode)
🌐 ThreadNote OAuth server running on port 3000
[Scheduler] Started — hourly digest check active
```

### 7. Seed your personal workspace (one-time, after first deploy)

Visit `https://your-app.onrender.com` → click **Add to Slack** → install in your personal workspace. This creates the required row in the `installations` table. Without it, the bot won't respond to events from your workspace.

### Render deployment troubleshooting

| Error | Fix |
|---|---|
| `P2021: The table 'public.users' does not exist` | Build command did not include `npm run db:deploy` — update it and redeploy |
| `Cannot find module '../generated/prisma/index.js'` | Build command did not include `npm run db:generate` — update it and redeploy |
| `prisma: command not found` during build | `prisma` must be in `dependencies`, not only `devDependencies` — Render skips devDeps when `NODE_ENV=production` |
| Service exits immediately after start | Check runtime logs for auth errors — verify all env vars are set correctly |
| `missing_scope` errors in Slack | Reinstall the Slack app to the workspace after any manifest change |
| OAuth redirect mismatch | `APP_URL` in env must exactly match the redirect URL registered in Slack app |
| Landing page 404 | Confirm `public/index.html` exists in the repo (not gitignored) |

---

## Commands

```bash
npm run dev          # start with hot reload
npm run start        # start once
npm run build        # compile TypeScript to dist/
npm run typecheck    # type-check without emitting

npm run db:migrate   # run pending Prisma migrations (local dev only)
npm run db:deploy    # apply migrations to production database (Render / CI)
npm run db:generate  # regenerate Prisma client after schema changes
npm run db:studio    # open Prisma Studio (visual DB browser)
npm run db:push      # push schema changes without a migration file

npm run eval         # run eval harness across all sample threads
npm run capture -- "<slack-thread-url>" <name>   # save a thread to JSON for eval
```

---

## Troubleshooting

| Error | Fix |
|---|---|
| `not_in_channel` | Run `/invite @ThreadNote` in the channel |
| `missing_scope` | Reinstall the app after any manifest change |
| Bot doesn't respond to @mention | Check the bot is invited to the channel and the app is running |
| AI panel not visible in Slack | Enable Agents & AI Apps at **both** app level and workspace admin level |
| `PrismaClientConstructorValidationError` | Run `npm run db:generate` to regenerate the Prisma client |
| `P2021: table does not exist` (local) | Run `npm run db:migrate` then `npm run db:generate` |
| `DATABASE_URL` connection error | Confirm `.env` is correctly filled and pgvector extension is enabled in Neon |
| Home tab is blank | Confirm `app_home_opened` event is in the manifest AND `interactivity.is_enabled: true` |
| No digest DM received | Confirm `im:write` scope is active (reinstall app); digest sends at 10 AM in user's timezone |
| Duplicate digests after restart | Check `last_daily_digest_at` / `last_weekly_digest_at` in the `users` table — should be set after each send |
| Wrong timezone in digest | Open the Home tab in Slack and update the timezone; or check the `timezone` column in Neon directly |
| `invalid_team_for_non_distributed_app` | Activate Public Distribution in Slack app → Settings → Manage Distribution |
| `invalid_state` on OAuth redirect | Must go through your own landing page → `/slack/install`, not Slack's shareable URL |
| OAuth redirect mismatch | `APP_URL` in env + redirect URL in Slack app OAuth & Permissions must match exactly |
| Bot doesn't respond in newly installed workspace | Check `installations` table — row must exist with `is_active = true` |
| Welcome DM not received | Only sent on first install — check if a row already existed before the install |

---

## Project structure

```
threadnote/
├── public/
│   └── index.html        — Landing page with Add to Slack button
├── src/
│   ├── index.ts          — Bolt app init, event/action handlers, OAuth server start, scheduler start
│   ├── processor.ts      — @mention pipeline: fetch (paginated) → LLM → post → KB save
│   ├── assistant.ts      — AI Assistant panel handlers (threadStarted, userMessage)
│   ├── kb.ts             — KB save (upsert), vector search, conversation history
│   ├── embeddings.ts     — OpenAI text-embedding-3-large wrapper
│   ├── db.ts             — Prisma client singleton + pg pool
│   ├── llm.ts            — OpenAI Responses API (callLLM, callLLMWithContext)
│   ├── slack-utils.ts    — Thread fetching (paginated + onProgress), user resolution, mrkdwn
│   ├── digest.ts         — Digest message builder and DM sender
│   ├── scheduler.ts      — Hourly cron, timezone logic, digest due-checks
│   ├── home.ts           — App Home Tab Block Kit view and action handlers
│   ├── installation-store.ts — Prisma-backed InstallationStore for multi-workspace OAuth
│   ├── welcome.ts        — Welcome DM content and sender
│   ├── oauth-server.ts   — Express server: GET /, /slack/install, /slack/oauth_redirect
│   └── types.ts          — SlackMessage, SlackReaction interfaces
├── prisma/
│   ├── schema.prisma     — users, thread_notes, conversations, installations tables
│   └── migrations/       — auto-generated migration SQL
├── tests/
│   ├── capture-thread.ts — CLI: save a Slack thread to JSON
│   ├── eval.ts           — Eval harness
│   └── sample_threads/   — Captured thread JSON files
├── threadnote_system_prompt.md   — System prompt for @mention thread extraction
├── ai_assistant_system_prompt.md — System prompt for AI chatbot (separate)
├── prisma.config.ts      — Prisma 7 datasource config (DATABASE_URL/DIRECT_URL)
├── .env                  — gitignored — create manually (see Setup § 4)
└── CLAUDE.md             — Full engineering spec
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `SLACK_BOT_TOKEN` | ✅ | `xoxb-...` dev workspace bot token (reference only — not passed to Bolt) |
| `SLACK_APP_TOKEN` | ✅ | `xapp-...` app-level token for Socket Mode WebSocket |
| `OPENAI_API_KEY` | ✅ | OpenAI API key |
| `OPENAI_MODEL` | — | LLM model name — defaults to `gpt-5.4` |
| `DATABASE_URL` | ✅ | Neon Postgres pooled connection string |
| `DIRECT_URL` | ✅ | Neon Postgres direct connection string (used by Prisma Migrate) |
| `OPENAI_EMBEDDING_MODEL` | — | Embedding model — defaults to `text-embedding-3-large` |
| `SLACK_CLIENT_ID` | ✅ | OAuth app client ID — from Slack app Basic Information |
| `SLACK_CLIENT_SECRET` | ✅ | OAuth app client secret — from Slack app Basic Information |
| `SLACK_STATE_SECRET` | ✅ | Random string for CSRF protection in OAuth flow |
| `APP_URL` | ✅ | Public base URL of the server, no trailing slash |
| `PORT` | — | HTTP port for Express server — defaults to `3000` |

---

## Tech stack

| Concern | Choice |
|---|---|
| Language | TypeScript (strict) |
| Runtime | Node.js v24+ |
| Slack SDK | `@slack/bolt` v4 — Socket Mode |
| LLM | OpenAI Responses API (`gpt-5.4`, reasoning: low) |
| Embeddings | OpenAI `text-embedding-3-large` (3072 dimensions) |
| Database | Neon Postgres + pgvector |
| ORM | Prisma 7 with `@prisma/adapter-pg` |
| KB isolation | Per-user — composite key `(slack_workspace_id, slack_user_id)` |

---

## Architecture notes

**3-second ACK pattern** — Slack requires acknowledgement within 3 seconds. The `app_mention` handler ACKs immediately and calls `processMention` fire-and-forget. Processing happens async; users see a placeholder spinner.

**Ephemeral responses** — Thread summaries are posted with `chat.postEphemeral` so only the invoking user sees them. The initial placeholder is a regular message (so it can be updated with progress for long threads) and is deleted after the summary is delivered.

**Multi-workspace OAuth** — Bolt is initialised with `installationStore` and no hardcoded `token`. For each incoming event, Bolt calls `fetchInstallation({ teamId })` to retrieve the correct workspace bot token from the `installations` table. The dev workspace must also have a row in `installations` (install it once via the landing page).

**KB save** — After every successful LLM call, `upsertUser` and `saveThreadNote` run fire-and-forget. The embedding is inserted via a raw SQL `UPDATE` because Prisma does not natively support the pgvector `vector` type.

**Vector search** — `searchKB` uses the pgvector `<=>` cosine distance operator via `prisma.$queryRaw`. Results are filtered by `(workspace_id, user_id)` — each user's KB is fully isolated.

**Conversation memory** — The assistant stores every turn in the `conversations` table. `getConversationHistory` fetches the last 15 messages per session, ordered chronologically, and passes them to the LLM as context.

**Env loading** — All scripts use `node --env-file=.env`. Never use `import "dotenv/config"` in app source files — ESM module evaluation order would cause credentials to load too late.

**Long responses** — Slack caps messages at ~3 000 characters. Responses are split into 2 900-character chunks posted as sequential ephemeral messages.

**Graceful shutdown** — `SIGINT`/`SIGTERM` handlers call `app.stop()` (closes the Socket Mode WebSocket) then `closeDb()` (disconnects Prisma and drains the pg pool) before exiting.

**Re-summarise on update** — `saveThreadNote` uses a Prisma `upsert` on the unique constraint `(workspace_id, user_id, channel_id, thread_ts)`. Invoking `@ThreadNote` on an already-saved thread overwrites the summary, decisions, action items, tags, and embedding — no duplicate rows.

**Digest scheduler** — `startScheduler` registers a `node-cron` job that runs every hour on the hour. On each tick (and immediately at startup), `checkAndSendAllDigests` fetches all users and checks `isDailyDigestDue` / `isWeeklyDigestDue`. Both functions use `Intl.DateTimeFormat` for timezone arithmetic — no date library. Digest state (`lastDailyDigestAt`, `lastWeeklyDigestAt`) is stored in Postgres so the scheduler survives restarts without resending.

**App Home Tab** — `handleHomeOpened` fires on `app_home_opened`. It upserts the user if not yet in the DB, auto-detects timezone from `client.users.info`, and publishes a Block Kit view via `client.views.publish`. The three action handlers (`toggle_daily_digest`, `toggle_weekly_digest`, `select_timezone`) save to Postgres immediately on change and republish the view — no Save button needed.
