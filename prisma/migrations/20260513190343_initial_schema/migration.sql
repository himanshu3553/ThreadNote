-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "users" (
    "slack_workspace_id" TEXT NOT NULL,
    "slack_user_id" TEXT NOT NULL,
    "display_name" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("slack_workspace_id","slack_user_id")
);

-- CreateTable
CREATE TABLE "thread_notes" (
    "id" TEXT NOT NULL,
    "slack_workspace_id" TEXT NOT NULL,
    "slack_user_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "channel_name" TEXT,
    "thread_ts" TEXT NOT NULL,
    "summary_markdown" TEXT NOT NULL,
    "decisions" JSONB,
    "action_items" JSONB,
    "tags" TEXT[],
    "embedding" vector(3072),
    "saved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thread_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "slack_workspace_id" TEXT NOT NULL,
    "slack_user_id" TEXT NOT NULL,
    "session_thread_ts" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "thread_notes_slack_workspace_id_slack_user_id_channel_id_th_key" ON "thread_notes"("slack_workspace_id", "slack_user_id", "channel_id", "thread_ts");

-- AddForeignKey
ALTER TABLE "thread_notes" ADD CONSTRAINT "thread_notes_slack_workspace_id_slack_user_id_fkey" FOREIGN KEY ("slack_workspace_id", "slack_user_id") REFERENCES "users"("slack_workspace_id", "slack_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_slack_workspace_id_slack_user_id_fkey" FOREIGN KEY ("slack_workspace_id", "slack_user_id") REFERENCES "users"("slack_workspace_id", "slack_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
