export class WorkspaceStore {
    db;
    constructor(db) {
        this.db = db;
    }
    list() {
        const stmt = this.db.raw.prepare('SELECT * FROM workspaces ORDER BY updated_at DESC;');
        const rows = stmt.all();
        return rows.map((r) => ({
            id: r.id,
            name: r.name,
            path: r.path,
            description: r.description || '',
            rules: JSON.parse(r.rules_json || '{}'),
            ignorePatterns: JSON.parse(r.ignore_patterns || '[]'),
            createdAt: r.created_at,
            updatedAt: r.updated_at,
        }));
    }
    getByPath(wsPath) {
        const stmt = this.db.raw.prepare('SELECT * FROM workspaces WHERE path = ?;');
        const r = stmt.get(wsPath);
        if (!r)
            return undefined;
        return {
            id: r.id,
            name: r.name,
            path: r.path,
            description: r.description || '',
            rules: JSON.parse(r.rules_json || '{}'),
            ignorePatterns: JSON.parse(r.ignore_patterns || '[]'),
            createdAt: r.created_at,
            updatedAt: r.updated_at,
        };
    }
    upsert(ws) {
        const now = Date.now();
        const existing = this.getByPath(ws.path);
        const createdAt = existing ? existing.createdAt : now;
        const rulesJson = JSON.stringify(ws.rules || {});
        const ignoreJson = JSON.stringify(ws.ignorePatterns || ['node_modules', '.git', 'dist']);
        const stmt = this.db.raw.prepare(`
      INSERT INTO workspaces (id, name, path, description, rules_json, ignore_patterns, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        rules_json = excluded.rules_json,
        ignore_patterns = excluded.ignore_patterns,
        updated_at = excluded.updated_at;
    `);
        stmt.run(ws.id, ws.name, ws.path, ws.description || '', rulesJson, ignoreJson, createdAt, now);
        return {
            ...ws,
            createdAt,
            updatedAt: now,
        };
    }
    delete(id) {
        const stmt = this.db.raw.prepare('DELETE FROM workspaces WHERE id = ?;');
        stmt.run(id);
        return true;
    }
}
