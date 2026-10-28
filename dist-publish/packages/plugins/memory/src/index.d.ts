/** 记忆存储模式定义（D39） */
export type MemoryStorageMode = 'file' | 'sqlite' | 'hybrid' | 'disabled';
export interface MemoryConfig {
    mode: MemoryStorageMode;
    filePath?: string;
    sqlitePath?: string;
    sqliteTable?: string;
    sqliteFts?: boolean;
    gitAutoAdd?: boolean;
    embeddingModel?: string;
    similarityThreshold?: number;
}
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
export declare class MarkdownMemoryAdapter implements MemoryAdapter {
    private filePath;
    constructor(baseDir: string);
    private ensureDir;
    private loadAll;
    private parseFile;
    append(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<MemoryEntry>;
    list(): Promise<MemoryEntry[]>;
    search(query: string, topK?: number): Promise<MemoryEntry[]>;
    describe(): string;
}
/** SQLite 适配器：基于 node:sqlite 的原生存储（零 Native） */
export declare class SqliteMemoryAdapter implements MemoryAdapter {
    private dbPath;
    constructor(dbPath: string);
    private initTable;
    private openDb;
    append(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<MemoryEntry>;
    list(): Promise<MemoryEntry[]>;
    search(query: string, topK?: number): Promise<MemoryEntry[]>;
    describe(): string;
}
/**
 * 双层记忆级联装配器（WBS-01-07-03 / D67）
 * 规则：项目级 > 全局级；同 ID 去重合并（项目级优先）
 */
export declare class MemoryCascade {
    private projectAdapter;
    private globalAdapter;
    private config;
    constructor(workspacePath: string, globalDir?: string, config?: Partial<MemoryConfig>);
    /** 装配：合并全局与项目记忆，项目级覆盖同 ID */
    assemble(query?: string, topK?: number): Promise<MemoryEntry[]>;
    /** 项目级记忆写入 */
    appendProject(content: string, source?: string): Promise<MemoryEntry>;
    /** 全局记忆写入 */
    appendGlobal(content: string, source?: string): Promise<MemoryEntry>;
    /** 以 System Prompt 片段注入：格式化当前装配结果 */
    toPromptFragment(query?: string): Promise<string>;
    /** 迁移工具：将 Markdown 记忆迁移到 SQLite，带 .bak 备份与 SHA-256 去重 */
    migrateToSqlite(targetDbPath: string): Promise<{
        migrated: number;
        skipped: number;
        backupPath?: string;
    }>;
}
export interface MigrateMemoryOptions {
    workspacePath: string;
    targetDbPath?: string;
    /** 'lossless-migrate' 平滑无损迁移 | 'fresh-start' 全新起步，丢弃测试数据 */
    mode: 'lossless-migrate' | 'fresh-start';
    /** 迁移源格式（缺省 file） */
    sourceMode?: MemoryStorageMode;
}
export interface MigrateMemoryResult {
    migrated: number;
    skipped: number;
    backupPath?: string;
    targetMode: MemoryStorageMode;
    targetPath: string;
}
/**
 * 记忆受控迁移向导（WBS-01-07-04 / D39）
 * 支持两极诉求分流：
 * 1. lossless-migrate：将 Markdown 逐条提取导入 SQLite，基于 SHA-256 幂等去重，原文件备份为 .bak；
 * 2. fresh-start：原文件备份为 .bak 后清空，全新起步。
 */
export declare function migrateMemory(options: MigrateMemoryOptions): Promise<MigrateMemoryResult>;
