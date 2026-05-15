import { Assistant } from "@slack/bolt";
import { callLLMWithContext } from "./llm.js";
import {
  upsertUser,
  searchKB,
  getConversationHistory,
  saveConversationMessage,
} from "./kb.js";

const SUGGESTED_PROMPTS = [
  {
    title: "What was decided recently?",
    message: "What were the key decisions from my recently saved threads?",
  },
  {
    title: "Show my open action items",
    message: "What are my open action items from saved threads?",
  },
  {
    title: "Summarise my knowledge base",
    message: "Give me a summary of everything I have saved so far.",
  },
];

export const threadNoteAssistant = new Assistant({
  threadStarted: async ({ saveThreadContext, say, setSuggestedPrompts }) => {
    await saveThreadContext();
    await say(
      "Hi! I'm ThreadNote. Ask me anything about your saved threads — decisions, action items, or a summary of what you've captured."
    );
    await setSuggestedPrompts({ prompts: SUGGESTED_PROMPTS });
  },

  threadContextChanged: async ({ saveThreadContext }) => {
    await saveThreadContext();
  },

  userMessage: async ({ message, context, setStatus, setTitle, say }) => {
    const workspaceId = context.teamId;
    const userId = context.userId;
    const sessionThreadTs: string =
      (message as { thread_ts?: string }).thread_ts ?? message.ts;
    const userText: string =
      (message as { text?: string }).text?.trim() ?? "";

    if (!workspaceId || !userId) {
      console.error("ThreadNote assistant: missing teamId or userId in context", context);
      await say("Sorry, I couldn't identify your workspace. Please try again.");
      return;
    }

    await setStatus("searching your knowledge base...");
    await setTitle(userText.slice(0, 50));

    await upsertUser(workspaceId, userId).catch((err) =>
      console.error("ThreadNote assistant: failed to upsert user:", err)
    );

    try {
      await saveConversationMessage(workspaceId, userId, sessionThreadTs, "user", userText);

      const [kbResults, history] = await Promise.all([
        searchKB(workspaceId, userId, userText, 5),
        getConversationHistory(workspaceId, userId, sessionThreadTs, 15),
      ]);

      const kbContext =
        kbResults.length === 0
          ? "No saved threads found yet."
          : kbResults
              .map(
                (r, i) =>
                  `[Thread ${i + 1}] ${r.channel_name ? `#${r.channel_name}` : ""}\n${r.summary_markdown}`
              )
              .join("\n\n---\n\n");

      const response = await callLLMWithContext(kbContext, history, userText);

      await saveConversationMessage(workspaceId, userId, sessionThreadTs, "assistant", response);

      await say(response);
    } catch (err) {
      console.error("ThreadNote assistant: error handling user message:", err);
      await say("Sorry, something went wrong. Please try again.");
    } finally {
      await setStatus("");
    }
  },
});
