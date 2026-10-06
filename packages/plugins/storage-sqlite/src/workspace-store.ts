import type { SqliteDatabase } from './database.ts';

export interface WorkspaceRecord {
  id: string;
  name: string;
  path: string;
  description?: string;
  rules: {
    hasAgentsMd: boolean;
    tsStrict: boolean;
    conventionalCommits: boolean;
  };
  ignorePatterns: string[];
  createdAt: number;
  updatedAt: number;
}

type WorkspaceRow = {
  id: string;
  name: string;
  path: string;
  description: string | null;
  rules_json: string;
  ignore_patterns: string;
  created_at: number;
  updated_at: number;
};

export class WorkspaceStore {
  private readonly db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  public list(): WorkspaceRecord[] {
    const stmt = this.db.raw.prepare('SELECT * FROM workspaces ORDER BY updated_at DESC;');
    const rows = stmt.all() as WorkspaceRow[];
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

  public getByPath(wsPath: string): WorkspaceRecord | undefined {
    const stmt = this.db.raw.prepare('SELECT * FROM workspaces WHERE path = ?;');
    const r = stmt.get(wsPath) as WorkspaceRow | undefined;
    if (!r) return undefined;
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

  public upsert(ws: Omit<WorkspaceRecord, 'createdAt' | 'updatedAt'>): WorkspaceRecord {
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

    stmt.run(
      ws.id,
      ws.name,
      ws.path,
      ws.description || '',
      rulesJson,
      ignoreJson,
      createdAt,
      now
    );

    return {
      ...ws,
      createdAt,
      updatedAt: now,
    };
  }

  public delete(id: string): boolean {
    const stmt = this.db.raw.prepare('DELETE FROM workspaces WHERE id = ?;');
    stmt.run(id);
    return true;
  }
}
