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
export declare class WorkspaceStore {
    private readonly db;
    constructor(db: SqliteDatabase);
    list(): WorkspaceRecord[];
    getByPath(wsPath: string): WorkspaceRecord | undefined;
    upsert(ws: Omit<WorkspaceRecord, 'createdAt' | 'updatedAt'>): WorkspaceRecord;
    delete(id: string): boolean;
}
