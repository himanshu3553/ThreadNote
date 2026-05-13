# ThreadNote

A Slack bot that turns any thread into a structured, knowledge-base-ready note — on demand, in seconds.

Mention `@ThreadNote` in any thread and it will reply with a clean summary: title, TL;DR, context, and key decisions. You can also ask for specific outputs like action items, a follow-up draft, or a risk analysis.

---

## How it works

1. A user mentions `@ThreadNote` in a Slack thread with an optional instruction.
2. The bot immediately posts a placeholder reply (`:hourglass_flowing_sand:`) so the user gets feedback within 3 seconds.
3. The bot fetches the full thread via `conversations.replies`, resolves all user IDs to real names, and formats it as a clean transcript.
4. The transcript is sent to OpenAI (`gpt-5.4`) using the Responses API.
5. The model's output is converted from Markdown to Slack mrkdwn and posted back — updating the placeholder and appending overflow chunks as additional replies.
6. A **View original thread** link is appended to every response so readers can jump back to the source.

---

## Usage

Mention `@ThreadNote` in any Slack thread. The instruction after the mention determines the output mode:

| Instruction | Output |
|---|---|
| `@ThreadNote go ahead` *(or no instruction)* | Full note: title, TL;DR, context, key decisions |
| `@ThreadNote tldr` | 2–3 sentence digest |
| `@ThreadNote summarise` | Summary + key points |
| `@ThreadNote action items` | Action item table with owners and deadlines |
| `@ThreadNote decisions only` | Decision log |
| `@ThreadNote status` | Status tracker |
| `@ThreadNote draft followup` | Ready-to-send Slack follow-up message |
| `@ThreadNote email this` | Email-ready summary for stakeholders |
| `@ThreadNote save to KB` | Full note optimised for search and retrieval |
| `@ThreadNote analyze` | Risk, blocker, and ambiguity analysis |

---

## Setup

### 1. Create a Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app **from scratch**.
2. Under **Socket Mode**, enable it and generate an **App-Level Token** with the `connections:write` scope. This is your `SLACK_APP_TOKEN`.
3. Under **OAuth & Permissions**, add these **Bot Token Scopes**:
   - `app_mentions:read`
   - `channels:history`
   - `groups:history`
   - `im:history`
   - `mpim:history`
   - `chat:write`
   - `users:read`
   - `channels:read`
   - `groups:read`
   - `reactions:read`
4. Install the app to your workspace. Copy the **Bot User OAuth Token** — this is your `SLACK_BOT_TOKEN`.
5. Under **Event Subscriptions → Subscribe to bot events**, add `app_mention`.

### 2. Clone and install

```bash
git clone <repo-url>
cd threadnote
npm install
```

### 3. Configure environment variables

Copy the example file and fill in your keys:

```bash
cp .env.example .env
```

```env
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.4        # optional — defaults to gpt-5.4
```

### 4. Invite the bot to a channel

In Slack, run `/invite @ThreadNote` in any channel you want the bot to operate in.

### 5. Start the bot

```bash
npm run dev     # development — restarts on file changes
npm run start   # production — run once
```

---

## Commands

```bash
npm run dev          # start with hot reload (Node --watch)
npm run start        # start once
npm run build        # compile TypeScript to dist/
npm run typecheck    # type-check without emitting
npm run eval         # run eval harness across all sample threads
npm run capture -- "<slack-thread-url>" <name>   # save a thread to JSON
```

### Capture a thread for eval

```bash
npm run capture -- "https://yourworkspace.slack.com/archives/C0123456/p1715600000001000" my-thread
# → saves to tests/sample_threads/my-thread.json
```

### Run the eval harness

```bash
npm run eval
# → reads all JSON files in tests/sample_threads/
# → runs each through 5 intent modes: go ahead, tldr, action items, decisions only, draft followup
# → writes results to tests/eval_runs/<timestamp>/
```

---

## Project structure

```
threadnote/
├── src/
│   ├── index.ts          — Bolt app init, app_mention event handler
│   ├── processor.ts      — Core pipeline: fetch → format → LLM → post
│   ├── slack-utils.ts    — Thread fetching, user resolution, mrkdwn converter
│   ├── llm.ts            — OpenAI Responses API call
│   └── types.ts          — SlackMessage, SlackReaction interfaces
├── tests/
│   ├── capture-thread.ts — CLI: save a Slack thread to JSON
│   ├── eval.ts           — Eval harness
│   └── sample_threads/   — Captured thread JSON files (gitignored except .gitkeep)
├── threadnote_system_prompt.md   — System prompt (primary quality lever)
├── .env.example          — Environment variable template
└── CLAUDE.md             — Full engineering spec and architecture notes
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `SLACK_BOT_TOKEN` | ✅ | `xoxb-...` bot OAuth token |
| `SLACK_APP_TOKEN` | ✅ | `xapp-...` app-level token for Socket Mode |
| `OPENAI_API_KEY` | ✅ | OpenAI API key |
| `OPENAI_MODEL` | — | Model name — defaults to `gpt-5.4` |

---

## Tech stack

| Concern | Choice |
|---|---|
| Language | TypeScript (strict) |
| Runtime | Node.js v24+ |
| Slack SDK | `@slack/bolt` v4 — Socket Mode |
| LLM | OpenAI Responses API (`gpt-5.4`, reasoning: low) |
| Persistence | None — fully stateless |

---

## Architecture notes

**3-second ACK pattern** — Slack requires an HTTP acknowledgement within 3 seconds. The event handler ACKs immediately and calls `processMention` fire-and-forget. The LLM call happens asynchronously; users see the placeholder spinner while they wait.

**Env loading** — All scripts use `node --env-file=.env` so secrets are available before any module initialises. Never use `import "dotenv/config"` — ESM module evaluation order would cause credentials to load too late.

**Long responses** — Slack hard-caps messages at ~3 000 characters. Responses are split into 2 900-character chunks; the first replaces the placeholder and subsequent chunks are posted as follow-up replies.

**Markdown → mrkdwn** — The LLM outputs standard Markdown. A post-processing step in `slack-utils.ts` converts it to Slack mrkdwn (`**bold**` → `*bold*`, headings → bold lines, links, pipe tables → bullet rows).
