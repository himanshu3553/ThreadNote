import { prisma } from "./db.js";
import { generateEmbedding } from "./embeddings.js";

export async function upsertUser(
  workspaceId: string,
  userId: string,
  displayName?: string
): Promise<void> {
  await prisma.user.upsert({
    where: { slackWorkspaceId_slackUserId: { slackWorkspaceId: workspaceId, slackUserId: userId } },
    create: { slackWorkspaceId: workspaceId, slackUserId: userId, displayName },
    update: { displayName },
  });
}

export interface SaveThreadNoteParams {
  workspaceId: string;
  userId: string;
  channelId: string;
  channelName?: string;
  threadTs: string;
  summaryMarkdown: string;
}

export async function saveThreadNote(params: SaveThreadNoteParams): Promise<void> {
  const { workspaceId, userId, channelId, channelName, threadTs, summaryMarkdown } = params;

  const note = await prisma.threadNote.upsert({
    where: {
      slackWorkspaceId_slackUserId_channelId_threadTs: {
        slackWorkspaceId: workspaceId,
        slackUserId: userId,
        channelId,
        threadTs,
      },
    },
    create: {
      slackWorkspaceId: workspaceId,
      slackUserId: userId,
      channelId,
      channelName,
      threadTs,
      summaryMarkdown,
    },
    update: {
      summaryMarkdown,
      channelName,
    },
  });

  const embedding = await generateEmbedding(summaryMarkdown);

  await prisma.$executeRaw`
    UPDATE thread_notes
    SET embedding = ${`[${embedding.join(",")}]`}::vector
    WHERE id = ${note.id}
  `;
}

export interface KBSearchResult {
  id: string;
  channel_name: string | null;
  thread_ts: string;
  summary_markdown: string;
  decisions: unknown;
  action_items: unknown;
  tags: string[];
  similarity: number;
}

export async function searchKB(
  workspaceId: string,
  userId: string,
  query: string,
  limit = 5
): Promise<KBSearchResult[]> {
  const queryEmbedding = await generateEmbedding(query);
  const results = await prisma.$queryRaw<KBSearchResult[]>`
    SELECT id, channel_name, thread_ts, summary_markdown, decisions, action_items, tags,
           1 - (embedding <=> ${`[${queryEmbedding.join(",")}]`}::vector) AS similarity
    FROM thread_notes
    WHERE slack_workspace_id = ${workspaceId}
      AND slack_user_id = ${userId}
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${`[${queryEmbedding.join(",")}]`}::vector
    LIMIT ${limit}
  `;
  return results;
}

export async function getConversationHistory(
  workspaceId: string,
  userId: string,
  sessionThreadTs: string,
  limit = 15
): Promise<Array<{ role: string; content: string }>> {
  const messages = await prisma.conversation.findMany({
    where: { slackWorkspaceId: workspaceId, slackUserId: userId, sessionThreadTs },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { role: true, content: true },
  });
  messages.reverse();
  return messages;
}

export async function saveConversationMessage(
  workspaceId: string,
  userId: string,
  sessionThreadTs: string,
  role: string,
  content: string
): Promise<void> {
  await prisma.conversation.create({
    data: {
      slackWorkspaceId: workspaceId,
      slackUserId: userId,
      sessionThreadTs,
      role,
      content,
    },
  });
}
