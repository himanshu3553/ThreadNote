import OpenAI from "openai";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODEL = process.env.OPENAI_MODEL ?? "gpt-5.4";

// Loaded once at startup; path is relative to this file so it works regardless of cwd.
const SYSTEM_PROMPT = await readFile(
  join(import.meta.dirname, "../threadnote_system_prompt.md"),
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
