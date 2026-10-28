import type { SqliteDatabase } from './database.ts';
export interface ProviderRecord {
    id: string;
    name: string;
    protocol: string;
    baseUrl: string;
    apiKeyCipher: string;
    proxy: {
        enabled: boolean;
        mode: 'direct' | 'inherit' | 'custom';
        customConfig?: {
            protocol: string;
            host: string;
            port: number;
            username?: string;
            password?: string;
        };
    };
    models: Array<{
        id: string;
        name: string;
        contextWindow: number;
        supportsTools?: boolean;
        supportsReasoning?: boolean;
    }>;
    createdAt: number;
    updatedAt: number;
}
export declare class ProviderStore {
    private readonly db;
    constructor(db: SqliteDatabase);
    list(): ProviderRecord[];
    get(id: string): ProviderRecord | undefined;
    upsert(provider: Omit<ProviderRecord, 'createdAt' | 'updatedAt'>): ProviderRecord;
    updateProxyToggle(id: string, enabled: boolean): boolean;
    delete(id: string): boolean;
}
