import type { SqliteDatabase } from './database.ts';
import type { SessionModel } from '@harness/protocol';

export class SessionStore {
  private readonly db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  public create(session: Omit<SessionModel, 'createdAt' | 'updatedAt'>): SessionModel {
    const now = Date.now();
    const stmt = this.db.raw.prepare(`
      INSERT INTO sessions (id, title, workspace_path, preset, active_model_id, created_at, updated_at, is_archived)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0);
    `);
    stmt.run(
      session.id,
      session.title,
      session.workspacePath,
      session.preset,
      session.activeModelId,
      now,
      now,
    );
    return { ...session, createdAt: now, updatedAt: now };
  }

  public get(id: string): SessionModel | undefined {
    const stmt = this.db.raw.prepare('SELECT * FROM sessions WHERE id = ?;');
    const r = stmt.get(id) as any;
    if (!r) return undefined;
    return {
      id: r.id,
      title: r.title,
      workspacePath: r.workspace_path,
      preset: r.preset,
      activeModelId: r.active_model_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      isArchived: r.is_archived === 1,
    };
  }

  public list(): SessionModel[] {
    const stmt = this.db.raw.prepare('SELECT * FROM sessions ORDER BY updated_at DESC;');
    const rows = stmt.all() as any[];
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      workspacePath: r.workspace_path,
      preset: r.preset,
      activeModelId: r.active_model_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      isArchived: r.is_archived === 1,
    }));
  }

  public touch(id: string): void {
    const stmt = this.db.raw.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?;');
    stmt.run(Date.now(), id);
  }

  /**
   * 更新会话的权限预设（只读 / 编辑 / 完全授权）。
   * @param id - 会话标识。
   * @param preset - 目标预设，由调用方完成取值校验。
   * @returns 是否命中了会话。
   */
  public setPreset(id: string, preset: SessionModel['preset']): boolean {
    const stmt = this.db.raw.prepare('UPDATE sessions SET preset = ?, updated_at = ? WHERE id = ?;');
    const info = stmt.run(preset, Date.now(), id);
    return Number(info.changes ?? 0) > 0;
  }

  public delete(id: string): boolean {
    const raw = this.db.raw;
    raw.exec('BEGIN IMMEDIATE;');
    try {
      raw.prepare('DELETE FROM events WHERE session_id = ?;').run(id);
      raw.prepare('DELETE FROM sessions WHERE id = ?;').run(id);
      raw.exec('COMMIT;');
      return true;
    } catch (err) {
      raw.exec('ROLLBACK;');
      throw err;
    }
  }
}
