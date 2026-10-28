import type { BaseEvent, EventType } from '@harness/protocol';
import type { SqliteDatabase } from './database.js';
export interface AppendEventInput<T = unknown> {
    sessionId: string;
    turnId: string;
    stepIndex: number;
    type: EventType;
    payload: T;
}
export declare class EventStore {
    private readonly db;
    constructor(db: SqliteDatabase);
    appendEvent<T = unknown>(input: AppendEventInput<T>): BaseEvent<T>;
    getEventsAfter(sessionId: string, afterSeq: number): BaseEvent[];
    /**
     * 截断会话尾部事件（含 fromSeq 本身），用于「重做本轮」在重跑前清除上一轮产物。
     */
    deleteEventsFrom(sessionId: string, fromSeq: number): number;
}
