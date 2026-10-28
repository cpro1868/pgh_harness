import type { SqliteDatabase } from './database.ts';
export declare class SettingsStore {
    private readonly db;
    constructor(db: SqliteDatabase);
    get<T>(key: string, defaultValue?: T): T | undefined;
    set(key: string, value: unknown, isSecret?: boolean): void;
    getAll(): Record<string, unknown>;
}
