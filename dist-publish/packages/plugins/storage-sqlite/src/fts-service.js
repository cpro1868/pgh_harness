export class FtsSearchService {
    db;
    constructor(db) {
        this.db = db;
    }
    initializeVirtualTable() {
        this.db.raw.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
        session_id UNINDEXED,
        event_type UNINDEXED,
        content,
        tokenize = 'unicode61 remove_diacritics 2'
      );
    `);
    }
    indexEvent(input) {
        const stmt = this.db.raw.prepare(`
      INSERT INTO events_fts (session_id, event_type, content)
      VALUES (?, ?, ?);
    `);
        stmt.run(input.sessionId, input.eventType, input.content);
    }
    search(query, sessionId) {
        // 处理特殊字符并做前缀/精确匹配
        const sanitizedQuery = query.replace(/"/g, '""');
        let sql = `
      SELECT session_id, event_type, content, rank
      FROM events_fts
      WHERE events_fts MATCH ?
    `;
        const params = [`"${sanitizedQuery}"`];
        if (sessionId) {
            sql += ` AND session_id = ?`;
            params.push(sessionId);
        }
        sql += ` ORDER BY rank LIMIT 50;`;
        const stmt = this.db.raw.prepare(sql);
        const rows = stmt.all(...params);
        return rows.map((r) => ({
            sessionId: r.session_id,
            eventType: r.event_type,
            content: r.content,
            rank: r.rank,
        }));
    }
}
