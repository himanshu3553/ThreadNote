-- CreateIndex
CREATE INDEX "conversations_slack_workspace_id_slack_user_id_session_thre_idx" ON "conversations"("slack_workspace_id", "slack_user_id", "session_thread_ts", "created_at");
