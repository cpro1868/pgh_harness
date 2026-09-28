import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import * as sqliteModule from 'node:sqlite';

/** 一条记忆条目（全局或项目级） */
export interface MemoryEntry {
  /** 记忆唯一 ID（SHA-256 前 12 位） */
  id: string;
  /** 记忆内容正文 */
  content: string;
  /** 来源标签（如会话、工作区） */
  source?: string;
  /** 创建时间（ISO 8601） */
  createdAt: string;
  /** 记忆作用域 */
  scope: 'project' | 'global';
}

/** 记忆存储适配器接口 */
export interface MemoryAdapter {
  /** 追加一条记忆（幂等，SHA-256 去重） */
  append(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<MemoryEntry>;
  /** 列出全部记忆 */
  list(): Promise<MemoryEntry[]>;
  /** 按关键词检索（FTS5 或文本匹配） */
  search(query: string, topK?: number): Promise<MemoryEntry[]>;
  /** 介质描述 */
  describe(): string;
}

/** Markdown 适配器：以 `.harness/memory.md` 为真相源 */
export class MarkdownMemoryAdapter implements MemoryAdapter {
  private filePath: string;

  constructor(baseDir: string) {
    this.filePath = path.join(baseDir, '.harness', 'memory.md');
  }

  private ensureDir(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  private loadAll(): MemoryEntry[] {
    if (!fs.existsSync(this.filePath)) return [];
    return this.parseFile(fs.readFileSync(this.filePath, 'utf8'));
  }

  private parseFile(content: string): MemoryEntry[] {
    const entries: MemoryEntry[] = [];
    const parts = content.split(/^## /m);
    for (let i = 1; i < parts.length; i++) {
      const section = parts[i];
      const lines = section.split('\n').map((l) => l.trimEnd());
      const header = lines[0].trim();
      const m = header.match(/^\[([a-f0-9]{12})\]\s*(.*)$/);
      if (!m) continue;

      let scope: 'project' | 'global' = 'project';
      let source: string | undefined;
      let bodyStartIndex = 1;

      // 提取 metadata 行
      for (let j = 1; j < lines.length; j++) {
        const line = lines[j].trim();
        if (line.startsWith('- scope:')) {
          scope = (line.slice(8).trim() as 'project' | 'global') || 'project';
          bodyStartIndex = j + 1;
        } else if (line.startsWith('- source:')) {
          source = line.slice(9).trim() || undefined;
          bodyStartIndex = j + 1;
        } else if (line.startsWith('- created:')) {
          bodyStartIndex = j + 1;
        } else if (line === '') {
          bodyStartIndex = j + 1;
        } else {
          break;
        }
      }

      entries.push({
        id: m[1],
        content: lines.slice(bodyStartIndex).join('\n').trim(),
        scope,
        source,
        createdAt: '',
      });
    }
    return entries;
  }

  async append(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<MemoryEntry> {
    const id = crypto.createHash('sha256').update(entry.content).digest('hex').slice(0, 12);
    const existing = this.loadAll();
    if (existing.some((e) => e.id === id)) return { ...entry, id, createdAt: new Date().toISOString() };

    this.ensureDir();
    const now = new Date().toISOString();
    const block = `\n## [${id}] ${entry.content.split('\n')[0].slice(0, 60)}\n\n- scope: ${entry.scope}\n- source: ${entry.source ?? 'manual'}\n- created: ${now}\n\n${entry.content}\n`;
    fs.appendFileSync(this.filePath, block, 'utf8');
    return { ...entry, id, createdAt: now };
  }

  async list(): Promise<MemoryEntry[]> {
    return this.loadAll();
  }

  async search(query: string, topK = 5): Promise<MemoryEntry[]> {
    const entries = this.loadAll();
    const terms = query.toLowerCase().split(/\s+/);
    const scored = entries.map((e) => ({
      entry: e,
      score: terms.reduce((acc, t) => acc + (e.content.toLowerCase().includes(t) ? 1 : 0), 0),
    })).filter((s) => s.score > 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map((s) => s.entry);
  }

  describe(): string {
    return `MarkdownMemoryAdapter(${this.filePath})`;
  }
}

/** SQLite 适配器：基于 node:sqlite 的原生存储（零 Native） */
export class SqliteMemoryAdapter implements MemoryAdapter {
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = path.resolve(dbPath);
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.initTable();
  }

  private initTable(): void {
    const db = this.openDb() as { exec: (s: string) => void; close: () => void };
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        source TEXT,
        scope TEXT NOT NULL DEFAULT 'project',
        created_at TEXT NOT NULL,
        content_hash TEXT NOT NULL
      )`);
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_hash ON memory_entries(content_hash)`);
    } finally {
      db.close();
    }
  }

  private openDb(): unknown {
    const { DatabaseSync } = sqliteModule as unknown as { DatabaseSync: new (p: string) => unknown };
    return new DatabaseSync(this.dbPath);
  }

  async append(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<MemoryEntry> {
    const hash = crypto.createHash('sha256').update(entry.content).digest('hex');
    const id = hash.slice(0, 12);
    const now = new Date().toISOString();
    const db = this.openDb() as { prepare: (s: string) => { run: (...a: unknown[]) => void; get: (...a: unknown[]) => unknown } };
    try {
      const existing = db.prepare('SELECT id FROM memory_entries WHERE content_hash = ?').get(hash);
      if (existing) return { ...entry, id, createdAt: now };
      db.prepare('INSERT INTO memory_entries (id, content, source, scope, created_at, content_hash) VALUES (?,?,?,?,?,?)')
        .run(id, entry.content, entry.source ?? 'manual', entry.scope, now, hash);
      return { ...entry, id, createdAt: now };
    } finally {
      (db as { close: () => void }).close();
    }
  }

  async list(): Promise<MemoryEntry[]> {
    const db = this.openDb() as { prepare: (s: string) => { all: (...a: unknown[]) => unknown[] } };
    try {
      const rows = db.prepare('SELECT id, content, source, scope, created_at FROM memory_entries ORDER BY created_at DESC').all() as {
        id: string; content: string; source: string; scope: string; created_at: string;
      }[];
      return rows.map((r) => ({ id: r.id, content: r.content, source: r.source, scope: r.scope as 'project' | 'global', createdAt: r.created_at }));
    } finally {
      (db as { close: () => void }).close();
    }
  }

  async search(query: string, topK = 5): Promise<MemoryEntry[]> {
    const entries = await this.list();
    const terms = query.toLowerCase().split(/\s+/);
    const scored = entries.map((e) => ({
      entry: e,
      score: terms.reduce((acc, t) => acc + (e.content.toLowerCase().includes(t) ? 1 : 0), 0),
    })).filter((s) => s.score > 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map((s) => s.entry);
  }

  describe(): string {
    return `SqliteMemoryAdapter(${this.dbPath})`;
  }
}

/**
 * 双层记忆级联装配器（WBS-01-07-03 / D67）
 * 规则：项目级 > 全局级；同 ID 去重合并（项目级优先）
 */
export class MemoryCascade {
  private projectAdapter: MemoryAdapter;
  private globalAdapter: MemoryAdapter;

  constructor(workspacePath: string, globalDir?: string) {
    this.projectAdapter = new MarkdownMemoryAdapter(workspacePath);
    this.globalAdapter = new MarkdownMemoryAdapter(globalDir ?? os.homedir());
  }

  /** 装配：合并全局与项目记忆，项目级覆盖同 ID */
  public async assemble(query?: string, topK = 10): Promise<MemoryEntry[]> {
    const project = await this.projectAdapter.list();
    const global = await this.globalAdapter.list();
    // 项目级优先，全局补充
    const seen = new Set<string>();
    const merged: MemoryEntry[] = [];
    for (const e of [...project, ...global]) {
      if (!seen.has(e.id)) { seen.add(e.id); merged.push(e); }
    }
    if (query) {
      const terms = query.toLowerCase().split(/\s+/);
      return merged
        .map((e) => ({ entry: e, score: terms.reduce((acc, t) => acc + (e.content.toLowerCase().includes(t) ? 1 : 0), 0) }))
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .map((s) => s.entry);
    }
    return merged.slice(0, topK);
  }

  /** 项目级记忆写入 */
  public async appendProject(content: string, source?: string): Promise<MemoryEntry> {
    return this.projectAdapter.append({ content, source, scope: 'project' });
  }

  /** 全局记忆写入 */
  public async appendGlobal(content: string, source?: string): Promise<MemoryEntry> {
    return this.globalAdapter.append({ content, source, scope: 'global' });
  }

  /** 以 System Prompt 片段注入：格式化当前装配结果 */
  public async toPromptFragment(query?: string): Promise<string> {
    const entries = await this.assemble(query);
    if (entries.length === 0) return '';
    const lines = entries.map((e) => `- [${e.scope.toUpperCase()}] ${e.content.split('\n')[0].slice(0, 80)}`).join('\n');
    return `\n\n[Memory Context]:\n${lines}`;
  }

  /** 迁移工具：将 Markdown 记忆迁移到 SQLite，带 .bak 备份与 SHA-256 去重 */
  public async migrateToSqlite(targetDbPath: string): Promise<{ migrated: number; skipped: number; backupPath?: string }> {
    return migrateMemory({
      workspacePath: path.dirname((this.projectAdapter as MarkdownMemoryAdapter)['filePath']),
      targetDbPath,
      mode: 'lossless-migrate',
    });
  }
}

export interface MigrateMemoryOptions {
  workspacePath: string;
  targetDbPath?: string;
  /** 'lossless-migrate' 平滑无损迁移 | 'fresh-start' 全新起步，丢弃测试数据 */
  mode: 'lossless-migrate' | 'fresh-start';
}

export interface MigrateMemoryResult {
  migrated: number;
  skipped: number;
  backupPath?: string;
}

/**
 * 记忆受控迁移向导（WBS-01-07-04 / D39）
 * 支持两极诉求分流：
 * 1. lossless-migrate：将 Markdown 逐条提取导入 SQLite，基于 SHA-256 幂等去重，原文件备份为 .bak；
 * 2. fresh-start：原文件备份为 .bak 后清空，全新起步。
 */
export async function migrateMemory(options: MigrateMemoryOptions): Promise<MigrateMemoryResult> {
  const mdPath = path.join(options.workspacePath, '.harness', 'memory.md');
  const backupPath = fs.existsSync(mdPath) ? `${mdPath}.bak` : undefined;

  // 1. 自动生成 .bak 备份（满足安全留痕）
  if (backupPath && fs.existsSync(mdPath)) {
    fs.copyFileSync(mdPath, backupPath);
  }

  // 2. 分流处理
  if (options.mode === 'fresh-start') {
    if (fs.existsSync(mdPath)) {
      fs.writeFileSync(mdPath, '', 'utf8');
    }
    return { migrated: 0, skipped: 0, backupPath };
  }

  // lossless-migrate
  if (!options.targetDbPath) throw new Error('平滑迁移需要提供 targetDbPath 参数');
  const mdAdapter = new MarkdownMemoryAdapter(options.workspacePath);
  const sqliteAdapter = new SqliteMemoryAdapter(options.targetDbPath);

  const entries = await mdAdapter.list();
  let migrated = 0;
  let skipped = 0;

  for (const e of entries) {
    const beforeCount = (await sqliteAdapter.list()).length;
    await sqliteAdapter.append({ content: e.content, source: e.source, scope: e.scope });
    const afterCount = (await sqliteAdapter.list()).length;
    if (afterCount > beforeCount) migrated++;
    else skipped++;
  }

  return { migrated, skipped, backupPath };
}
