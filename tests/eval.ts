/**
 * Eval harness: npm run eval
 *
 * For every JSON file in tests/sample_threads/, runs the thread through callLLM
 * with each of the standard intent modes. Writes per-mode output files plus a
 * summary report to tests/eval_runs/<timestamp>/.
 *
 * Uses stub Slack clients backed by the pre-resolved nameMap in the captured
 * JSON, so no live Slack API calls are needed at eval time.
 */

import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import type { WebClient } from "@slack/web-api";
import { formatThreadForLLM } from "../src/slack-utils.js";
import { callLLM } from "../src/llm.js";
import type { SlackMessage } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Intent modes ─────────────────────────────────────────────────────────────

const INTENT_MODES = [
  "go ahead",
  "tldr",
  "action items",
  "decisions only",
  "draft followup",
] as const;

// ─── Captured thread format ───────────────────────────────────────────────────

interface CapturedThread {
  channel: string;
  channelName: string;
  threadTs: string;
  capturedAt: string;
  nameMap: Record<string, string>;
  messages: SlackMessage[];
}

// ─── Stub Slack client ────────────────────────────────────────────────────────

/**
 * Returns a minimal WebClient stub that serves pre-resolved names from the
 * captured JSON. This lets formatThreadForLLM run without live API calls.
 */
function makeStubClient(nameMap: Record<string, string>, channelName: string): WebClient {
  return {
    users: {
      info: async ({ user }: { user: string }) => ({
        ok: true,
        user: { real_name: nameMap[user] ?? user, name: nameMap[user] ?? user },
      }),
    },
    conversations: {
      info: async () => ({ ok: true, channel: { name: channelName } }),
    },
  } as unknown as WebClient;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const threadsDir = join(__dirname, "sample_threads");
  const allFiles = await readdir(threadsDir).catch(() => [] as string[]);
  const threadFiles = allFiles.filter((f) => f.endsWith(".json"));

  if (threadFiles.length === 0) {
    console.log("No sample threads found in tests/sample_threads/.");
    console.log('Run `npm run capture -- "<url>" <name>` to add one.');
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(__dirname, "eval_runs", timestamp);
  await mkdir(outDir, { recursive: true });

  const reportLines: string[] = [
    `# ThreadNote Eval Report`,
    ``,
    `**Generated:** ${new Date().toISOString()}`,
    `**Threads:** ${threadFiles.length}  |  **Modes:** ${INTENT_MODES.length}`,
    ``,
    `---`,
    ``,
  ];

  for (const file of threadFiles) {
    const threadName = basename(file, ".json");
    console.log(`\n📋 ${threadName}`);
    reportLines.push(`## ${threadName}`, ``);

    const raw = await readFile(join(threadsDir, file), "utf-8");
    const captured: CapturedThread = JSON.parse(raw);
    const client = makeStubClient(captured.nameMap, captured.channelName);
    const transcript = await formatThreadForLLM(
      captured.messages,
      client,
      captured.channelName
    );

    for (const mode of INTENT_MODES) {
      process.stdout.write(`  → ${mode} … `);
      try {
        const output = await callLLM(transcript, mode);
        const slug = mode.replace(/\s+/g, "-");
        const outFile = join(outDir, `${threadName}__${slug}.md`);
        await writeFile(outFile, output, "utf-8");
        console.log("✅");
        reportLines.push(`### \`${mode}\``, `✅ OK — \`${basename(outFile)}\``, ``);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`❌  ${msg}`);
        reportLines.push(`### \`${mode}\``, `❌ Error: ${msg}`, ``);
      }
    }
  }

  const reportPath = join(outDir, "report.md");
  await writeFile(reportPath, reportLines.join("\n"), "utf-8");
  console.log(`\n✅ Report → ${reportPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
