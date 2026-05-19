# ThreadNote

A Slack bot that turns any thread into a structured summary and saves it to a personal, searchable knowledge base. Chat with your saved threads through Slack's AI Assistant panel.

---

## Features

**Thread summarisation** — Mention `@ThreadNote` in any thread. It replies with a clean summary: title, TL;DR, key decisions, and action items. Only you see the response (ephemeral).

**Auto-save to knowledge base** — Every `@ThreadNote` invocation automatically saves the summary and a vector embedding to your personal knowledge base in Neon Postgres. Invoking it again on the same thread overwrites the old summary with the latest one (no duplicates).

**AI Assistant chat** — Open the ThreadNote AI panel in Slack and ask questions in plain English. ThreadNote does a semantic search over your saved threads and replies with context from your own history. Responses use proper Slack formatting and include inline source links to the original threads.

**Daily & weekly digest** — ThreadNote DMs you a digest of saved threads every day at 10 AM and every Monday at 10 AM (in your local timezone). Toggle each digest on/off from the Home tab.

**App Home Tab settings** — Click ThreadNote in the Slack sidebar to open a settings panel. Toggle daily/weekly digests and change your timezone. Settings save instantly.

---

## How it works

### @mention flow

1. User mentions `@ThreadNote` in a Slack thread with an optional instruction.
2. Bot ACKs Slack immediately (within 3 seconds) and processes async.
3. Full thread is fetched via `conversations.replies`, user IDs resolved to real names.
4. Transcript sent to OpenAI (`gpt-5.4`, Responses API).
5. Response converted from Markdown to Slack mrkdwn and posted as an ephemeral message (only visible to you).
6. Summary + embedding saved to Neon Postgres automatically.

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

### 3. Clone and install

```bash
git clone <repo-url>
cd threadnote
npm install
```

### 4. Configure environment variables

Create a `.env` file in the project root (`.env.example` is intentionally gitignored — create this from scratch):

```env
# Slack
SLACK_BOT_TOKEN=xoxb-...        # from step 2.5 — Bot User OAuth Token
SLACK_APP_TOKEN=xapp-...        # from step 2.4 — App-Level Token

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.4

# Neon Postgres — from step 1.3
DATABASE_URL=postgresql://user:password@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require
DIRECT_URL=postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require

# Embeddings
OPENAI_EMBEDDING_MODEL=text-embedding-3-large
```

Where to find each value:
- `SLACK_BOT_TOKEN` — Slack app dashboard → **Install App** → Bot User OAuth Token
- `SLACK_APP_TOKEN` — Slack app dashboard → **Basic Information → App-Level Tokens** → generate with `connections:write` scope
- `OPENAI_API_KEY` — [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- `DATABASE_URL` — Neon dashboard → **Connection Details** → Pooled connection string (hostname contains `-pooler`)
- `DIRECT_URL` — Neon dashboard → **Connection Details** → Direct connection string (hostname without `-pooler`). For local dev both can be the same string.

> **Important:** `.env` must be fully configured before running the migration in the next step.

### 5. Run the database migration and generate the Prisma client

```bash
npm run db:migrate    # applies all pending migrations to Neon; enter a name only if prompted
npm run db:generate   # generates the local TypeScript Prisma client
```

> **Important:** `generated/prisma/` is gitignored — it must be created on every new machine by running `npm run db:generate`. The app will crash at startup if this step is skipped.

You should see all three tables (`users`, `thread_notes`, `conversations`) in the Neon dashboard under **Tables**, with all columns including `timezone`, `daily_digest_enabled`, `weekly_digest_enabled`, and `thread_url`.

### 6. Invite the bot to channels

In any Slack channel you want ThreadNote to read, run:

```
/invite @ThreadNote
```

The bot must be a member of a channel to fetch thread messages from it.

### 7. Start the bot

```bash
npm run dev     # development — restarts automatically on file changes
npm run start   # production — run once
```

You should see:

```
⚡ ThreadNote is running (Socket Mode)
[Scheduler] Started — hourly digest check active
```

If any users already exist in the database and a digest is due (past 10 AM), you will also see `[Scheduler] Daily digest sent to ...` immediately on startup.

The bot is now live. Mention `@ThreadNote` in any thread it has access to, open the **✦ AI** section in the Slack sidebar to chat with your knowledge base, or click ThreadNote in the sidebar to open the Home tab settings.

---

## Commands

```bash
npm run dev          # start with hot reload
npm run start        # start once
npm run build        # compile TypeScript to dist/
npm run typecheck    # type-check without emitting

npm run db:migrate   # run pending Prisma migrations
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
| `DATABASE_URL` connection error | Confirm `.env` is correctly filled and pgvector extension is enabled in Neon |
| Home tab is blank | Confirm `app_home_opened` event is in the manifest AND `interactivity.is_enabled: true` |
| No digest DM received | Confirm `im:write` scope is active (reinstall app); digest sends at 10 AM in user's timezone |
| Duplicate digests after restart | Check `last_daily_digest_at` / `last_weekly_digest_at` in the `users` table — should be set after each send |
| Wrong timezone in digest | Open the Home tab in Slack and update the timezone; or check the `timezone` column in Neon directly |

---

## Project structure

```
threadnote/
├── src/
│   ├── index.ts          — Bolt app init, event/action handlers, shutdown, scheduler start
│   ├── processor.ts      — @mention pipeline: fetch → LLM → post → KB save
│   ├── assistant.ts      — AI Assistant panel handlers (threadStarted, userMessage)
│   ├── kb.ts             — KB save (upsert), vector search, conversation history
│   ├── embeddings.ts     — OpenAI text-embedding-3-large wrapper
│   ├── db.ts             — Prisma client singleton + pg pool
│   ├── llm.ts            — OpenAI Responses API (callLLM, callLLMWithContext)
│   ├── slack-utils.ts    — Thread fetching, user resolution, permalink, mrkdwn converter
│   ├── digest.ts         — Digest message builder and DM sender
│   ├── scheduler.ts      — Hourly cron, timezone logic, digest due-checks
│   ├── home.ts           — App Home Tab Block Kit view and action handlers
│   └── types.ts          — SlackMessage, SlackReaction interfaces
├── prisma/
│   ├── schema.prisma     — users, thread_notes, conversations tables + digest columns
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
| `SLACK_BOT_TOKEN` | ✅ | `xoxb-...` bot OAuth token |
| `SLACK_APP_TOKEN` | ✅ | `xapp-...` app-level token for Socket Mode |
| `OPENAI_API_KEY` | ✅ | OpenAI API key |
| `OPENAI_MODEL` | — | LLM model name — defaults to `gpt-5.4` |
| `DATABASE_URL` | ✅ | Neon Postgres pooled connection string |
| `DIRECT_URL` | ✅ | Neon Postgres direct connection string (used by Prisma Migrate) |
| `OPENAI_EMBEDDING_MODEL` | — | Embedding model — defaults to `text-embedding-3-large` |

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

**Ephemeral responses** — Thread summaries are posted with `chat.postEphemeral` so only the invoking user sees them. Ephemeral messages cannot be updated, so each chunk is a separate call.

**KB save** — After every successful LLM call, `upsertUser` and `saveThreadNote` run fire-and-forget. The embedding is inserted via a raw SQL `UPDATE` because Prisma does not natively support the pgvector `vector` type.

**Vector search** — `searchKB` uses the pgvector `<=>` cosine distance operator via `prisma.$queryRaw`. Results are filtered by `(workspace_id, user_id)` — each user's KB is fully isolated.

**Conversation memory** — The assistant stores every turn in the `conversations` table. `getConversationHistory` fetches the last 15 messages per session, ordered chronologically, and passes them to the LLM as context.

**Env loading** — All scripts use `node --env-file=.env`. Never use `import "dotenv/config"` in app source files — ESM module evaluation order would cause credentials to load too late.

**Long responses** — Slack caps messages at ~3 000 characters. Responses are split into 2 900-character chunks posted as sequential ephemeral messages.

**Graceful shutdown** — `SIGINT`/`SIGTERM` handlers call `app.stop()` (closes the Socket Mode WebSocket) then `closeDb()` (disconnects Prisma and drains the pg pool) before exiting.

**Re-summarise on update** — `saveThreadNote` uses a Prisma `upsert` on the unique constraint `(workspace_id, user_id, channel_id, thread_ts)`. Invoking `@ThreadNote` on an already-saved thread overwrites the summary, decisions, action items, tags, and embedding — no duplicate rows.

**Digest scheduler** — `startScheduler` registers a `node-cron` job that runs every hour on the hour. On each tick (and immediately at startup), `checkAndSendAllDigests` fetches all users and checks `isDailyDigestDue` / `isWeeklyDigestDue`. Both functions use `Intl.DateTimeFormat` for timezone arithmetic — no date library. Digest state (`lastDailyDigestAt`, `lastWeeklyDigestAt`) is stored in Postgres so the scheduler survives restarts without resending.

**App Home Tab** — `handleHomeOpened` fires on `app_home_opened`. It upserts the user if not yet in the DB, auto-detects timezone from `client.users.info`, and publishes a Block Kit view via `client.views.publish`. The three action handlers (`toggle_daily_digest`, `toggle_weekly_digest`, `select_timezone`) save to Postgres immediately on change and republish the view — no Save button needed.
