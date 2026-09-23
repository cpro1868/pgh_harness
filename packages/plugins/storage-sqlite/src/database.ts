import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export class SqliteDatabase {
  private db: DatabaseSync | null = null;
  public readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }


  public initialize(): void {
    if (this.filePath !== ':memory:') {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(this.filePath);

    // D9 决策：Node 22 原生 WAL 模式 + NORMAL 同步
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
    `);

    this.createTables();
  }

  public get raw(): DatabaseSync {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db;
  }

  public pragma(name: string): unknown {
    const stmt = this.raw.prepare(`PRAGMA ${name};`);
    const result = stmt.get() as Record<string, unknown>;
    if (!result) return undefined;
    return Object.values(result)[0];
  }

  private createTables(): void {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '新对话',
        workspace_path TEXT NOT NULL,
        preset TEXT NOT NULL DEFAULT 'edit',
        active_model_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        is_archived INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        turn_id TEXT NOT NULL,
        step_index INTEGER NOT NULL DEFAULT 0,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(session_id, seq)
      );

      CREATE INDEX IF NOT EXISTS idx_events_session_seq ON events(session_id, seq);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        is_secret INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        protocol TEXT NOT NULL,
        base_url TEXT NOT NULL,
        api_key_cipher TEXT NOT NULL,
        proxy_json TEXT NOT NULL,
        models_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        description TEXT,
        rules_json TEXT NOT NULL,
        ignore_patterns TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  public close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
