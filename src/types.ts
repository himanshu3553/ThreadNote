export interface SlackReaction {
  name: string;
  count: number;
  users?: string[];
}

export interface SlackMessage {
  type: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  parent_user_id?: string;
  reply_count?: number;
  subtype?: string;
  reactions?: SlackReaction[];
  edited?: { user: string; ts: string };
}