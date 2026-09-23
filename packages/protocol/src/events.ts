export type EventType =
  | 'message/user'
  | 'message/assistant'
  | 'message/attachment'
  | 'message/feedback'
  | 'todo/update'
  | 'stream/chunk'
  | 'tool/call'
  | 'tool/result'
  | 'request/context'
  | 'compaction'
  | 'approval/requested'
  | 'approval/resolved'
  | 'session/aborted'
  | 'turn/completed'
  | 'question_asked'
  | 'question_answered';

export interface AttachmentPayload {
  filename: string;
  bytes: number;
  content: string;
}

export interface FeedbackPayload {
  turnId: string;
  rating: 'up' | 'down';
}

export interface BaseEvent<T = unknown> {
  id?: number;
  sessionId: string;
  seq: number;
  turnId: string;
  stepIndex: number;
  type: EventType;
  payload: T;
  createdAt: number;
}

export interface StreamChunkPayload {
  turnId: string;
  type: 'reasoning' | 'content';
  chunk: string;
}

export interface ToolCallPayload {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface ToolResultPayload {
  callId: string;
  output: string;
  isError?: boolean;
}

export interface CompactionPayload {
  previousSeq: number;
  summary: string;
  compactedEventsCount: number;
}
