import OpenAI from "openai";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODEL = process.env.OPENAI_MODEL ?? "gpt-5.4";

// Loaded once at startup; paths are relative to this file so they work regardless of cwd.
const SYSTEM_PROMPT = await readFile(
  join(import.meta.dirname, "../threadnote_system_prompt.md"),
  "utf-8"
);

const ASSISTANT_SYSTEM_PROMPT = await readFile(
  join(import.meta.dirname, "../ai_assistant_system_prompt.md"),
  "utf-8"
);

/**
 * Sends a formatted thread transcript + user instruction to OpenAI and returns
 * the model's plain-text response.
 */
export async function callLLM(
  threadTranscript: string,
  userInstruction: string
): Promise<string> {
  const input =
    `${threadTranscript}\n\n` +
    `=== User Instruction ===\n` +
    `${userInstruction}`;

  const response = await openai.responses.create({
    model: MODEL,
    instructions: SYSTEM_PROMPT,
    input,
    reasoning: { effort: "low" },
  });

  return response.output_text;
}

/**
 * Sends KB context + conversation history + new user message to OpenAI.
 * Used by the assistant panel for RAG-backed replies.
 */
export async function callLLMWithContext(
  kbContext: string,
  history: Array<{ role: string; content: string }>,
  userMessage: string
): Promise<string> {
  const historyText = history
    .map((m) => `${m.role.charAt(0).toUpperCase() + m.role.slice(1)}: ${m.content}`)
    .join("\n");

  const input =
    `=== Your Knowledge Base (relevant threads) ===\n${kbContext}\n\n` +
    `=== Conversation so far ===\n${historyText}\n\n` +
    `=== New question ===\n${userMessage}`;

  const response = await openai.responses.create({
    model: MODEL,
    instructions: ASSISTANT_SYSTEM_PROMPT,
    input,
    reasoning: { effort: "low" },
  });

  return response.output_text;
}
