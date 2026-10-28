export class SettingsStore {
    db;
    constructor(db) {
        this.db = db;
    }
    get(key, defaultValue) {
        const stmt = this.db.raw.prepare('SELECT value_json FROM settings WHERE key = ?;');
        const row = stmt.get(key);
        if (!row)
            return defaultValue;
        try {
            return JSON.parse(row.value_json);
        }
        catch {
            return defaultValue;
        }
    }
    set(key, value, isSecret = false) {
        const now = Date.now();
        const valueJson = JSON.stringify(value);
        const stmt = this.db.raw.prepare(`
      INSERT INTO settings (key, value_json, is_secret, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        is_secret = excluded.is_secret,
        updated_at = excluded.updated_at;
    `);
        stmt.run(key, valueJson, isSecret ? 1 : 0, now);
    }
    getAll() {
        const stmt = this.db.raw.prepare('SELECT key, value_json FROM settings WHERE is_secret = 0;');
        const rows = stmt.all();
        const result = {};
        for (const r of rows) {
            try {
                result[r.key] = JSON.parse(r.value_json);
            }
            catch { }
        }
        return result;
    }
}
