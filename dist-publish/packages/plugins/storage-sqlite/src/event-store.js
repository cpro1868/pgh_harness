export class EventStore {
    db;
    constructor(db) {
        this.db = db;
    }
    appendEvent(input) {
        const raw = this.db.raw;
        // 获取当前会话最大 seq 并自增
        const maxSeqStmt = raw.prepare(`
      SELECT coalesce(max(seq), 0) AS max_seq FROM events WHERE session_id = ?;
    `);
        const row = maxSeqStmt.get(input.sessionId);
        const nextSeq = (row?.max_seq ?? 0) + 1;
        const now = Date.now();
        const payloadJson = JSON.stringify(input.payload);
        const insertStmt = raw.prepare(`
      INSERT INTO events (session_id, seq, turn_id, step_index, type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?);
    `);
        insertStmt.run(input.sessionId, nextSeq, input.turnId, input.stepIndex, input.type, payloadJson, now);
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
    getEventsAfter(sessionId, afterSeq) {
        const stmt = this.db.raw.prepare(`
      SELECT session_id, seq, turn_id, step_index, type, payload_json, created_at
      FROM events
      WHERE session_id = ? AND seq > ?
      ORDER BY seq ASC;
    `);
        const rows = stmt.all(sessionId, afterSeq);
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
    deleteEventsFrom(sessionId, fromSeq) {
        const stmt = this.db.raw.prepare('DELETE FROM events WHERE session_id = ? AND seq >= ?;');
        const info = stmt.run(sessionId, fromSeq);
        return Number(info.changes ?? 0);
    }
}
