import type { SqliteDatabase } from './database.ts';

export class SettingsStore {
  private readonly db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
  }


  public get<T>(key: string, defaultValue?: T): T | undefined {
    const stmt = this.db.raw.prepare('SELECT value_json FROM settings WHERE key = ?;');
    const row = stmt.get(key) as { value_json: string } | undefined;
    if (!row) return defaultValue;
    try {
      return JSON.parse(row.value_json) as T;
    } catch {
      return defaultValue;
    }
  }

  public set(key: string, value: unknown, isSecret = false): void {
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

  public getAll(): Record<string, unknown> {
    const stmt = this.db.raw.prepare('SELECT key, value_json FROM settings WHERE is_secret = 0;');
    const rows = stmt.all() as Array<{ key: string; value_json: string }>;
    const result: Record<string, unknown> = {};
    for (const r of rows) {
      try {
        result[r.key] = JSON.parse(r.value_json);
      } catch {}
    }
    return result;
  }
}
