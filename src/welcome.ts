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
