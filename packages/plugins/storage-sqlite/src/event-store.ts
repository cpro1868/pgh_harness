import type { BaseEvent, EventType } from '@harness/protocol';
import type { SqliteDatabase } from './database.js';

export interface AppendEventInput<T = unknown> {
  sessionId: string;
  turnId: string;
  stepIndex: number;
  type: EventType;
  payload: T;
}

export class EventStore {
  private readonly db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
  }


  public appendEvent<T = unknown>(input: AppendEventInput<T>): BaseEvent<T> {
    const raw = this.db.raw;

    // 获取当前会话最大 seq 并自增
    const maxSeqStmt = raw.prepare(`
      SELECT coalesce(max(seq), 0) AS max_seq FROM events WHERE session_id = ?;
    `);
    const row = maxSeqStmt.get(input.sessionId) as { max_seq: number };
    const nextSeq = (row?.max_seq ?? 0) + 1;
    const now = Date.now();
    const payloadJson = JSON.stringify(input.payload);

    const insertStmt = raw.prepare(`
      INSERT INTO events (session_id, seq, turn_id, step_index, type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?);
    `);

    insertStmt.run(
      input.sessionId,
      nextSeq,
      input.turnId,
      input.stepIndex,
      input.type,
      payloadJson,
      now
    );

    return {
      sessionId: input.sessionId,
      seq: nextSeq,
      turnId: input.turnId,
      stepIndex: input.stepIndex,
      type: input.type,
      payload: input.payload,
      createdAt: now,
    };
  }

  public getEventsAfter(sessionId: string, afterSeq: number): BaseEvent[] {
    const stmt = this.db.raw.prepare(`
      SELECT session_id, seq, turn_id, step_index, type, payload_json, created_at
      FROM events
      WHERE session_id = ? AND seq > ?
      ORDER BY seq ASC;
    `);

    const rows = stmt.all(sessionId, afterSeq) as Array<{
      session_id: string;
      seq: number;
      turn_id: string;
      step_index: number;
      type: EventType;
      payload_json: string;
      created_at: number;
    }>;

    return rows.map((r) => ({
      sessionId: r.session_id,
      seq: r.seq,
      turnId: r.turn_id,
      stepIndex: r.step_index,
      type: r.type,
      payload: JSON.parse(r.payload_json),
      createdAt: r.created_at,
    }));
  }

  /**
   * 截断会话尾部事件（含 fromSeq 本身），用于「重做本轮」在重跑前清除上一轮产物。
   */
  public deleteEventsFrom(sessionId: string, fromSeq: number): number {
    const stmt = this.db.raw.prepare('DELETE FROM events WHERE session_id = ? AND seq >= ?;');
    const info = stmt.run(sessionId, fromSeq);
    return Number(info.changes ?? 0);
  }
}
