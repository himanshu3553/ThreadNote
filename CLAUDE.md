# CLAUDE.md — ThreadNote Phase 1

This file gives Claude Code everything it needs to understand and work on the ThreadNote codebase. Read this fully before making any changes.

---

## What this project is

**ThreadNote** is a Slack bot that processes threads into structured summaries, decision logs, action items, and knowledge-base entries. Users invoke it by mentioning `@ThreadNote` in any thread with an optional instruction (e.g. `@ThreadNote summarise this`, `@ThreadNote action items`, `@ThreadNote go ahead`).

The bot:
1. Receives an `app_mention` Slack event
2. Immediately posts a placeholder message (so the user gets feedback within 3 seconds)
3. Fetches the entire thread via `conversations.replies`
4. Resolves all user IDs to real names
5. Formats the thread into a clean transcript
6. Calls the OpenAI Responses API with the ThreadNote system prompt
7. Converts the markdown output to Slack mrkdwn format
8. Updates the placeholder with the final summary

---

## Tech stack

| Concern | Choice | Reason |
|---------|--------|--------|
| Language | TypeScript (strict) | Type safety with Slack's complex API payloads |
| Runtime | Node.js v24+ | Project is on v24.15.0 |
| Module system | ESM (`"type": "module"`) | Modern Node standard |
| Dev runner | `tsx` with `--env-file=.env` flag | Handles ESM + env loading before any module code runs |
| Slack SDK | `@slack/bolt` v4 | Official Bolt SDK; handles Socket Mode, event routing, ACK |
| Slack connection | Socket Mode | No public HTTPS endpoint needed for Phase 1 |
| LLM provider | OpenAI | Confirmed choice |
| OpenAI model | `gpt-5.4` | Confirmed: standard, not mini |
| OpenAI endpoint | Responses API (`client.responses.create`) | OpenAI's current recommended endpoint; NOT Chat Completions |
| Reasoning effort | `{ effort: "low" }` | Confirmed setting passed in responses call |
| Slack output format | Plain text mrkdwn | Post-process converter applied after LLM output; no Block Kit, no Canvas |
| Persistence | None | Phase 1 is fully stateless; no DB of any kind |
| Conversation memory | None | Each `@ThreadNote` invocation is independent |

---

## Confirmed decisions — do not revisit without explicit user instruction

1. **Model**: `gpt-5.4` — do not swap to mini, nano, or any other variant
2. **mrkdwn**: use the post-process converter (`markdownToSlackMrkdwn` in `slack-utils.ts`) — do not instruct the LLM to emit Slack mrkdwn format directly
3. **Conversation memory**: off — if someone mentions `@ThreadNote` twice in the same thread, each invocation is fully independent; the second does not see the first response
4. **Reasoning effort**: pass `reasoning: { effort: "low" }` in `client.responses.create`
5. **No Block Kit** in Phase 1 — plain text mrkdwn only
6. **No Canvas** in Phase 1 — `canvases:write` scope is intentionally absent from the manifest
7. **No database** in Phase 1 — nothing is persisted anywhere

---

## Project structure

```
threadnote/
├── CLAUDE.md                       ← this file
├── .env                            ← secrets (gitignored)
├── .env.example                    ← committed template
├── .gitignore
├── package.json
├── tsconfig.json
├── threadnote_system_prompt.md     ← ThreadNote system prompt (do not edit without instruction)
├── src/
│   ├── index.ts                    ← entry point; Bolt app init, app_mention handler
│   ├── slack-utils.ts              ← thread fetching, user/channel resolution, mrkdwn converter
│   ├── llm.ts                      ← OpenAI Responses API call, system prompt loading
│   └── types.ts                    ← shared interfaces: SlackMessage, SlackReaction
└── tests/
    ├── sample_threads/             ← captured thread JSON files (gitignore private ones)
    ├── capture-thread.ts           ← CLI to save a Slack thread URL → JSON
    └── eval.ts                     ← eval harness: all sample threads × all intent modes
```

---

## Environment variables

All loaded via `--env-file=.env` in npm scripts. Do NOT use `import "dotenv/config"` anywhere — see the critical note below.

| Variable | Description |
|----------|-------------|
| `SLACK_BOT_TOKEN` | `xoxb-...` bot OAuth token for Slack API calls |
| `SLACK_APP_TOKEN` | `xapp-...` app-level token for Socket Mode |
| `OPENAI_API_KEY` | OpenAI API key |
| `OPENAI_MODEL` | Model string — defaults to `gpt-5.4` if not set |

**Critical — env loading order**: In ESM, all imported modules are evaluated before the importing module's body runs. This means if `llm.ts` calls `new OpenAI()` at module level, it runs *before* `import "dotenv/config"` in `index.ts` has loaded the `.env` file. The fix is `--env-file=.env` in the npm scripts, which makes Node load the file before any module code runs. Never revert this to `import "dotenv/config"`.

---

## Commands

```bash
npm run dev         # tsx watch with hot reload
npm run start       # tsx, run once
npm run build       # tsc compile to dist/
npm run typecheck   # type check only, no emit
npm run eval        # run eval harness across all sample threads
npm run capture -- "<slack-thread-url>" <name>   # capture a thread to JSON
```

### Capture example
```bash
npm run capture -- "https://workspace.slack.com/archives/C0123456/p1715600000001000" rabbitmq-migration
# → saves to tests/sample_threads/rabbitmq-migration.json
```

---

## Architecture: the 3-second ACK pattern

Slack requires an ACK within **3 seconds** of an event. The OpenAI call takes longer. The solution is fire-and-forget:

```typescript
app.event("app_mention", async ({ event, client, ack }) => {
  if (typeof ack === "function") await ack(); // ACK Slack immediately
  if ((event as { bot_id?: string }).bot_id) return; // ignore bots — prevents loops

  // intentionally NOT awaited
  processMention(event, client).catch(console.error);
});
```

**Never `await processMention`** inside the event handler. Awaiting it means Bolt doesn't return to Slack within 3 seconds, causing Slack to retry, which causes duplicate responses.

---

## Key implementation patterns

### OpenAI Responses API call
```typescript
const response = await client.responses.create({
  model: MODEL,                    // "gpt-5.4"
  instructions: SYSTEM_PROMPT,    // system prompt equivalent
  input: userContent,             // thread transcript + user instruction
  reasoning: { effort: "low" },
});
return response.output_text;      // convenience accessor for full text output
```

Never use `client.chat.completions.create` — that is the legacy Chat Completions API.

### mrkdwn conversion
The LLM returns standard markdown. Slack does not render it. Always post-process:
```typescript
const summary = await callLLM(transcript, instruction);
const slackText = markdownToSlackMrkdwn(summary); // in slack-utils.ts
```

Key conversions:

| Standard markdown | Slack mrkdwn |
|-------------------|--------------|
| `**bold**` | `*bold*` |
| `# Heading` | `*Heading*` (bolded line) |
| `[label](url)` | `<url\|label>` |
| Pipe tables | Bullet-formatted lines |

### Thread transcript format
```
=== Thread Metadata ===
Channel: #devops-uat
Participants: Fauzan, Mishika, Praveen Tripathi
Total messages: 9
Date range: 2026-05-13 14:30 UTC to 2026-05-13 18:15 UTC

=== Conversation ===

[2026-05-13 14:30 UTC] Fauzan:
Hi all, we plan to remove loadbalancer...
[reactions: :+1: x2]

[2026-05-13 17:31 UTC] Praveen Tripathi:
URL can be updated now also @Fauzan?
```

Slack-style mentions (`<@U123>`) are resolved to real names before sending. The trigger message (the `@ThreadNote` mention itself) is excluded by filtering `m.ts !== event.ts`.

### Long response chunking
Slack hard-limits messages to ~3000 chars. Chunk if longer:
```typescript
const chunks = [...chunkString(slackText)]; // 2900 char safety margin
await client.chat.update({ channel, ts: placeholder.ts, text: chunks[0] });
for (const chunk of chunks.slice(1)) {
  await client.chat.postMessage({ channel, thread_ts: threadTs, text: chunk });
}
```

---

## Slack API specifics

### Scopes in the manifest
`app_mentions:read`, `channels:history`, `groups:history`, `im:history`, `mpim:history`, `chat:write`, `users:read`, `channels:read`, `groups:read`, `reactions:read`

`canvases:write` is intentionally absent.

### Subtypes filtered before LLM
`tombstone`, `channel_join`, `channel_leave`, `channel_topic`, `channel_purpose`

### Caching
`getUserName` and `getChannelName` use module-level `Map` caches. These reset on process restart. No TTL is needed for Phase 1 since user/channel names don't change mid-session.

### Rate limits
This is an internal app (not Marketplace-distributed), so `conversations.replies` operates at full Tier 3 rate limits. No throttling logic needed for Phase 1.

---

## System prompt

File: `threadnote_system_prompt.md` at project root.

Loaded once at startup by `llm.ts` using `readFile`. Contains intent detection logic (FULL, TLDR, SUMMARY, DECISIONS, ACTIONS, STATUS, FOLLOWUP, EMAIL, KB, ANALYSIS), output templates per mode, extraction rules, and edge case handling.

**Do not modify this file** without explicit instruction. It is the primary quality lever. Any change requires running the eval harness before and after.

---

## Testing

### Eval harness
```bash
npm run eval
```
- Reads all `.json` files in `tests/sample_threads/`
- Runs each through `callLLM` with 5 intent modes: `go ahead`, `tldr`, `action items`, `decisions only`, `draft followup`
- Outputs `tests/eval_runs/<timestamp>/report.md`

**Run eval after any change to**: system prompt, `llm.ts` (model/prompt shape), or `formatThreadForLLM`.

### Capturing threads
```bash
npm run capture -- "<url>" <name>
```
Resolves user IDs to names at capture time and saves a self-contained JSON. This lets eval run without Slack API calls.

---

## Do NOT do these things

- **Do not change the model** from `gpt-5.4` without instruction
- **Do not switch to Chat Completions API** (`client.chat.completions.create`)
- **Do not add `import "dotenv/config"`** anywhere in the codebase
- **Do not add a database or any persistence**
- **Do not implement Block Kit responses**
- **Do not implement Canvas creation**
- **Do not add streaming** to the OpenAI call
- **Do not `await processMention`** inside the Bolt event handler
- **Do not remove the `bot_id` guard** in the event handler
- **Do not modify `threadnote_system_prompt.md`** without instruction

---

## Current implementation status

### Done
- [x] TypeScript + ESM + tsx project setup
- [x] Socket Mode Bolt app (`SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN`)
- [x] `app_mention` handler — ACK + fire-and-forget + bot-loop guard
- [x] `fetchFullThread` with cursor-based pagination
- [x] `getUserName` with in-memory cache
- [x] `getChannelName` with in-memory cache
- [x] `resolveMentions` — handles `<@U>`, `<#C|name>`, `<url|label>`, `<url>`
- [x] `formatThreadForLLM` — metadata header + chronological transcript
- [x] Subtype filtering and trigger message exclusion
- [x] `callLLM` — OpenAI Responses API with `instructions`, `input`, `reasoning`
- [x] Placeholder post → update pattern
- [x] Long response chunking (2900 char limit)
- [x] `markdownToSlackMrkdwn` post-process converter
- [x] `capture-thread.ts` CLI
- [x] `eval.ts` eval harness
- [x] `--env-file=.env` env loading in all npm scripts

### Phase 1 backlog (not yet built)
- [ ] `response.usage` logging — track input/output token counts and cost per invocation
- [ ] Per-day invocation cap per user — prevent cost runaway
- [ ] Channel blocklist — prevent ThreadNote operating in sensitive channels (e.g. `#hr`, `#legal`)
- [ ] Startup connectivity check — verify Slack + OpenAI reachable before accepting events
- [ ] Unit tests for `markdownToSlackMrkdwn`
- [ ] Unit tests for `resolveMentions`

### Out of scope for Phase 1 — do not implement
- Postgres / any database
- Block Kit
- Canvas creation
- Streaming responses
- Multi-workspace OAuth
- Slack HTTP Events API (moving off Socket Mode)
- Web dashboard
- Billing / Stripe

---

## Common errors

| Error | Cause | Fix |
|-------|-------|-----|
| `OpenAIError: Missing credentials` | `new OpenAI()` ran before `.env` was loaded (ESM init order) | Confirm `--env-file=.env` is in all npm scripts; remove any `import "dotenv/config"` |
| `not_in_channel` from Slack | Bot is not a member of the channel | `/invite @ThreadNote` in Slack |
| `missing_scope` from Slack | Token predates a scope addition | Reinstall the app from the Slack app config page |
| Two responses per mention | `processMention` is being awaited | Remove the `await` — fire-and-forget is intentional |
| `**bold**` shows literal asterisks in Slack | mrkdwn converter not applied | Wrap LLM output through `markdownToSlackMrkdwn` before posting |
| `output_text` is empty | Unexpected output block type from OpenAI | Walk `response.output` array and collect all `type === "text"` blocks manually |
| Eval script crashes on missing key | `.env` not loaded for eval | Confirm `npm run eval` script includes `--env-file=.env` |

---

## What comes after Phase 1

Phase 2 moves this to the TabSquare Slack workspace. New concerns at that point:
- Postgres database with `thread_notes` table + pgvector embeddings
- Slack Canvas creation for KB mode
- Channel allowlist/blocklist from config
- Per-workspace usage cap and cost tracking
- Move from Socket Mode → HTTP Events API
- Structured JSON logging with request IDs
- Sentry error tracking

Do not pre-build any of this during Phase 1.
