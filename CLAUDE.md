# CLAUDE.md — ThreadNote

This is the single source of truth for Claude Code. Read the entire file before making any changes. Phase 1 is fully completed. Phase 2 is the current work.

---

## Project Overview

**ThreadNote** is a Slack bot that processes threads into structured summaries, decision logs, action items, and a searchable personal knowledge base. Users invoke it by mentioning `@ThreadNote` in any thread with an optional instruction.

**Phase 1** (completed): Thread processing, LLM summarisation, ephemeral responses.
**Phase 2** (current): Persist every summary to Neon Postgres, generate embeddings, and enable a conversational AI assistant panel where users can chat with ThreadNote using their saved threads as the knowledge base.

---

## Phase 1 — COMPLETED

Do not modify anything in this section without explicit instruction. All Phase 1 code is working and in production on the dev sandbox.

### What was built

- Socket Mode Bolt app with `app_mention` event handler
- 3-second ACK + fire-and-forget pattern
- Full thread fetch via `conversations.replies` with pagination
- User ID to real name resolution with in-memory cache
- Channel name resolution with in-memory cache
- Mention resolution (`<@U>`, `<#C|name>`, `<url|label>`)
- Thread transcript formatter for LLM input
- OpenAI Responses API call with `reasoning: { effort: "low" }`
- Placeholder post then update pattern
- Markdown to Slack mrkdwn post-process converter
- Long response chunking (2900 char limit)
- Ephemeral responses — summary visible only to the invoking user
- Bot-loop guard
- `capture-thread.ts` CLI
- `eval.ts` eval harness

### Phase 1 confirmed decisions — do not change

| Decision | Choice |
|----------|--------|
| Language | TypeScript (strict) |
| Runtime | Node.js v24+ |
| Module system | ESM ("type": "module") |
| Dev runner | tsx with --env-file=.env |
| Slack SDK | @slack/bolt v4 |
| Slack connection | Socket Mode |
| LLM provider | OpenAI |
| OpenAI model | gpt-5.4 |
| OpenAI endpoint | Responses API only — never Chat Completions |
| Reasoning effort | { effort: "low" } |
| Slack output | Plain text mrkdwn — no Block Kit, no Canvas |
| Conversation memory | None in Phase 1 — each invocation independent |
| Persistence | None in Phase 1 |

### Phase 1 file structure

```
threadnote/
├── CLAUDE.md
├── .env
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── threadnote_system_prompt.md
├── src/
│   ├── index.ts                <- entry point, app_mention handler
│   ├── slack-utils.ts          <- thread fetch, user/channel resolution, mrkdwn converter
│   ├── llm.ts                  <- OpenAI Responses API call
│   └── types.ts                <- SlackMessage, SlackReaction interfaces
└── tests/
    ├── sample_threads/
    ├── capture-thread.ts
    └── eval.ts
```

### Phase 1 environment variables

```
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.4
```

### Phase 1 commands (all still valid)

```bash
npm run dev        # tsx watch --env-file=.env src/index.ts
npm run start      # tsx --env-file=.env src/index.ts
npm run build      # tsc
npm run typecheck  # tsc --noEmit
npm run eval       # tsx --env-file=.env tests/eval.ts
npm run capture -- "<url>" <name>
```

### Critical Phase 1 patterns — do not break

**Never await processMention** inside the Bolt event handler. Bolt must return within 3 seconds.

**Never add import "dotenv/config"** anywhere. Env is loaded via --env-file=.env in npm scripts.

**Never use Chat Completions API.** Only client.responses.create.

**Always apply markdownToSlackMrkdwn** before posting any LLM output to Slack.

**Always filter m.ts !== event.ts** to exclude the trigger message from the thread transcript.

---

## Phase 2 — CURRENT WORK

Build Phase 2 features in the order specified in the Build Order section. Do not skip steps or build out of sequence.

### Phase 2 feature list

**Core infrastructure**
- Neon Postgres + pgvector database
- Prisma ORM with Prisma Migrate for schema management
- users, thread_notes, conversations tables with composite primary key

**Knowledge Base**
- Generate OpenAI embedding for every thread summary
- Persist every @ThreadNote invocation automatically to thread_notes
- Per-user KB isolation — all queries filtered by (slack_workspace_id, slack_user_id)

**Chat with ThreadNote (AI Assistant)**
- Enable Agents & AI Apps on Slack app (updated manifest below)
- assistant_thread_started handler — greeting + suggested prompts
- assistant_thread_context_changed handler — save context
- userMessage handler — RAG search + conversation memory + LLM response
- Semantic search over user's saved threads (pgvector cosine similarity)
- Conversation memory — rolling window of last 15 messages per session

### Phase 2 confirmed decisions — do not change

| Decision | Choice |
|----------|--------|
| Database | Neon Postgres with pgvector extension |
| ORM | Prisma (@prisma/client) |
| Migrations | Prisma Migrate (prisma migrate dev) |
| Embeddings model | text-embedding-3-large (3072 dimensions) |
| KB save trigger | Every @ThreadNote invocation — automatic |
| KB isolation | Option A — fully personal per user |
| Composite key | (slack_workspace_id, slack_user_id) on all user-scoped tables |
| Conversation memory | Rolling window — last 15 messages per assistant session |
| Hosting | Local machine, Socket Mode, dev sandbox only |
| Workspace | Dev sandbox — NOT TabSquare |

### New packages to install

```bash
npm install @prisma/client
npm install -D prisma
npx prisma init
```

### Updated environment variables

Add these to .env and .env.example. Keep all Phase 1 variables.

```
# Phase 1 (unchanged)
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.4

# Phase 2 — Neon Postgres
DATABASE_URL=postgresql://user:password@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
DIRECT_URL=postgresql://user:password@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require

# Phase 2 — Embeddings
OPENAI_EMBEDDING_MODEL=text-embedding-3-large
```

DATABASE_URL is the pooled connection used by Prisma client at runtime.
DIRECT_URL is the direct non-pooled connection used exclusively by Prisma Migrate.
Neon provides both from their dashboard. For local dev both can be the same string.

### Updated Slack app manifest

Replace the existing manifest in Slack app config with this:

```yaml
display_information:
  name: ThreadNote
  description: AI thread summarizer and personal knowledge base
  background_color: "#2c3e50"
features:
  bot_user:
    display_name: ThreadNote
    always_online: true
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
      - assistant_thread_started
      - assistant_thread_context_changed
      - message.im
  interactivity:
    is_enabled: false
  org_deploy_enabled: false
  socket_mode_enabled: true
  token_rotation_enabled: false
```

After updating the manifest, reinstall the app to the workspace so the new assistant:write scope takes effect.

### Prisma schema

Create this at prisma/schema.prisma:

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  directUrl  = env("DIRECT_URL")
  extensions = [pgvector(map: "vector")]
}

model User {
  slackWorkspaceId String   @map("slack_workspace_id")
  slackUserId      String   @map("slack_user_id")
  displayName      String?  @map("display_name")
  firstSeenAt      DateTime @default(now()) @map("first_seen_at")

  threadNotes   ThreadNote[]
  conversations Conversation[]

  @@id([slackWorkspaceId, slackUserId])
  @@map("users")
}

model ThreadNote {
  id               String   @id @default(cuid())
  slackWorkspaceId String   @map("slack_workspace_id")
  slackUserId      String   @map("slack_user_id")
  channelId        String   @map("channel_id")
  channelName      String?  @map("channel_name")
  threadTs         String   @map("thread_ts")
  summaryMarkdown  String   @map("summary_markdown")
  decisions        Json?
  actionItems      Json?    @map("action_items")
  tags             String[]
  embedding        Unsupported("vector(3072)")?
  savedAt          DateTime @default(now()) @map("saved_at")

  user User @relation(fields: [slackWorkspaceId, slackUserId], references: [slackWorkspaceId, slackUserId])

  @@unique([slackWorkspaceId, slackUserId, channelId, threadTs])
  @@map("thread_notes")
}

model Conversation {
  id               String   @id @default(cuid())
  slackWorkspaceId String   @map("slack_workspace_id")
  slackUserId      String   @map("slack_user_id")
  sessionThreadTs  String   @map("session_thread_ts")
  role             String
  content          String
  createdAt        DateTime @default(now()) @map("created_at")

  user User @relation(fields: [slackWorkspaceId, slackUserId], references: [slackWorkspaceId, slackUserId])

  @@map("conversations")
}
```

IMPORTANT: The embedding field uses Unsupported("vector(3072)") because Prisma does not natively support pgvector operations. This means:
- You CANNOT use prisma.threadNote.create with an embedding value
- Inserting and updating embeddings requires prisma.$executeRaw
- Searching by vector similarity requires prisma.$queryRaw
- All other fields on all models work normally with the standard Prisma client

### Phase 2 npm scripts to add to package.json

```json
"db:migrate": "prisma migrate dev",
"db:generate": "prisma generate",
"db:studio": "prisma studio",
"db:push": "prisma db push"
```

Run db:migrate whenever prisma/schema.prisma changes.
Always run db:generate after db:migrate to regenerate the Prisma client.

### Phase 2 updated file structure

```
threadnote/
├── CLAUDE.md
├── .env
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── threadnote_system_prompt.md
├── prisma/
│   ├── schema.prisma               <- Prisma schema (above)
│   └── migrations/                 <- auto-generated by Prisma Migrate
├── src/
│   ├── index.ts                    <- UPDATED: register assistant + kb save on mention
│   ├── slack-utils.ts              <- UNCHANGED from Phase 1
│   ├── llm.ts                      <- UPDATED: add callLLMWithContext export
│   ├── types.ts                    <- UPDATED: add Phase 2 types
│   ├── db.ts                       <- NEW: Prisma client singleton
│   ├── embeddings.ts               <- NEW: OpenAI embeddings generation
│   ├── kb.ts                       <- NEW: save to KB, search KB, conversation history
│   └── assistant.ts                <- NEW: Bolt Assistant handlers
└── tests/
    ├── sample_threads/
    ├── capture-thread.ts
    └── eval.ts
```

---

## Phase 2 Build Order

Build exactly in this sequence. Do not skip steps or build out of order.

**Step 1 — Install and initialise Prisma**

```bash
npm install @prisma/client
npm install -D prisma
npx prisma init
```

Replace the generated prisma/schema.prisma with the schema above.

**Step 2 — Enable pgvector on Neon and run first migration**

In Neon SQL editor run:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Then:
```bash
npm run db:migrate
# migration name when prompted: initial_schema
npm run db:generate
```

Verify all three tables exist in Neon dashboard before continuing.

**Step 3 — Create src/db.ts**

Prisma client singleton. Never instantiate PrismaClient more than once in the process.

```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: ["error", "warn"] });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

**Step 4 — Create src/embeddings.ts**

```typescript
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-large";

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  return response.data[0].embedding; // 3072 dimensions
}
```

**Step 5 — Create src/kb.ts**

Four exports:
- upsertUser — create user if not exists, update display name
- saveThreadNote — insert summary then update embedding via $executeRaw
- searchKB — embed query then $queryRaw with cosine operator filtered by user
- getConversationHistory — fetch last N messages for a session, returned in chronological order
- saveConversationMessage — insert a single message into conversations table

Embedding insert pattern (use this exact approach):
```typescript
// Step A: create record without embedding using standard Prisma
const note = await prisma.threadNote.create({ data: { ...fieldsWithoutEmbedding } });

// Step B: update embedding column via raw SQL
await prisma.$executeRaw`
  UPDATE thread_notes
  SET embedding = ${`[${embedding.join(",")}]`}::vector
  WHERE id = ${note.id}
`;
```

Vector search pattern:
```typescript
const results = await prisma.$queryRaw`
  SELECT id, channel_name, thread_ts, summary_markdown, decisions, action_items, tags,
         1 - (embedding <=> ${`[${queryEmbedding.join(",")}]`}::vector) AS similarity
  FROM thread_notes
  WHERE slack_workspace_id = ${workspaceId}
    AND slack_user_id = ${userId}
    AND embedding IS NOT NULL
  ORDER BY embedding <=> ${`[${queryEmbedding.join(",")}]`}::vector
  LIMIT ${limit}
`;
```

**Step 6 — Update src/index.ts to save on every mention**

In processMention, after the LLM call succeeds:
1. Call upsertUser with workspaceId, userId, display name
2. Call saveThreadNote with all fields including the summary
3. Get workspaceId from context.teamId — add context to the handler parameters

**Step 7 — Update Slack manifest**

Paste the updated manifest YAML into Slack app config.
Reinstall the app to the workspace to apply the new assistant:write scope.

**Step 8 — Update src/llm.ts**

Add a second export callLLMWithContext alongside the existing callLLM. This takes:
- kbContext: string — the retrieved thread summaries formatted as text
- history: Array of { role: string, content: string } — conversation messages
- userMessage: string — the new user message

Build the input as:
```
=== Your Knowledge Base (relevant threads) ===
{kbContext}

=== Conversation so far ===
{history formatted as "Role: content" lines}

=== New question ===
{userMessage}
```

Pass instructions (system prompt) unchanged. Pass this assembled string as input.

**Step 9 — Create src/assistant.ts**

Use Bolt's Assistant class with three handlers:

threadStarted:
- Call saveThreadContext()
- Send greeting message
- Call setSuggestedPrompts with three prompts from manifest

threadContextChanged:
- Call saveThreadContext() only

userMessage:
- Call setStatus("searching your knowledge base...")
- Call setTitle with first 50 chars of user message
- Save user message to conversations table
- Generate embedding for user message
- Call searchKB to get top 5 relevant threads
- Load last 15 conversation messages for this session
- Call callLLMWithContext with KB results + history + user message
- Call setStatus("") to clear the status
- Save assistant response to conversations table
- Call say() with the response

**Step 10 — Register assistant in src/index.ts**

```typescript
import { threadNoteAssistant } from "./assistant.js";
app.assistant(threadNoteAssistant);
```

Add this after the app_mention event registration.

---

## Phase 2 Key Patterns

**User identity — always composite key**

Never query with userId alone. Always pass both:
```typescript
WHERE slack_workspace_id = ${workspaceId} AND slack_user_id = ${userId}
```

Get workspaceId from context.teamId in Bolt handlers.

**Conversation history — rolling window**

```typescript
const history = await prisma.conversation.findMany({
  where: { slackWorkspaceId, slackUserId, sessionThreadTs },
  orderBy: { createdAt: "desc" },
  take: 15,
});
history.reverse(); // LLM needs chronological order, not reverse
```

**LLM prompt structure for assistant chat**

```
System prompt (threadnote_system_prompt.md)
  + Retrieved KB context (top 5 matching thread summaries)
  + Conversation history (last 15 messages)
  + New user message
```

---

## Phase 2 Do NOT Do

- Do not modify Phase 1 files except src/index.ts (KB save + assistant registration) and src/llm.ts (new export) and src/types.ts (new types)
- Do not use prisma.threadNote.create with an embedding value — raw SQL only for that column
- Do not store conversation history in memory — always Postgres via conversations table
- Do not build Canvas creation — out of scope for Phase 2
- Do not add channel blocklist — out of scope, decided for later
- Do not move to TabSquare workspace — stay on dev sandbox
- Do not switch to HTTP Events API — Socket Mode continues
- Do not add Stripe or billing — Phase 3 only
- Do not add a web dashboard — Phase 3 only

---

## Phase 2 Current Status — COMPLETED

- [x] Install Prisma, initialise
- [x] Write prisma/schema.prisma
- [x] Enable pgvector on Neon, run first migration
- [x] Create src/db.ts
- [x] Create src/embeddings.ts
- [x] Create src/kb.ts
- [x] Update src/index.ts — add KB save after LLM call
- [x] Update Slack manifest — Agents and AI Apps
- [x] Update src/llm.ts — add callLLMWithContext
- [x] Create src/assistant.ts
- [x] Register assistant in src/index.ts
- [x] End-to-end test: mention saves to DB, chat retrieves it

---

## Global Gotchas (All Phases)

| Gotcha | Fix |
|--------|-----|
| OpenAIError: Missing credentials | ESM init order — confirm --env-file=.env is in all npm scripts, no import "dotenv/config" anywhere |
| not_in_channel from Slack | /invite @ThreadNote in the channel first |
| missing_scope from Slack | Reinstall the app after manifest changes |
| Two responses per mention | Do not await processMention inside the event handler |
| bold shows as literal asterisks | Apply markdownToSlackMrkdwn before posting |
| Prisma client not found | Run npm run db:generate after any schema change |
| Migration fails on vector type | Run CREATE EXTENSION IF NOT EXISTS vector in Neon SQL editor first |
| output_text empty from OpenAI | Walk response.output array and collect type === "text" blocks manually |
| Assistant events not firing | Confirm assistant:write scope is active — reinstall app after manifest update |
| context.teamId is undefined | Ensure Bolt app is installed to workspace correctly |
