import { DatabaseSync } from 'node:sqlite';
export declare class SqliteDatabase {
    private db;
    readonly filePath: string;
    constructor(filePath: string);
    initialize(): void;
    get raw(): DatabaseSync;
    pragma(name: string): unknown;
    private createTables;
    close(): void;
}
