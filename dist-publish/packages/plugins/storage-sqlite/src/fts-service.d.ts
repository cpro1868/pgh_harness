import type { SqliteDatabase } from './database.js';
export interface IndexEventInput {
    sessionId: string;
    eventType: string;
    content: string;
}
export interface FtsSearchResult {
    sessionId: string;
    eventType: string;
    content: string;
    rank?: number;
}
export declare class FtsSearchService {
    private readonly db;
    constructor(db: SqliteDatabase);
    initializeVirtualTable(): void;
    indexEvent(input: IndexEventInput): void;
    search(query: string, sessionId?: string): FtsSearchResult[];
}
