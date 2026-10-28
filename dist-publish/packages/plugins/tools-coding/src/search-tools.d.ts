export interface SearchHit {
    file: string;
    line?: number;
    text?: string;
}
export declare class SearchTools {
    readonly workspacePath: string;
    private static readonly SKIP_DIRS;
    constructor(workspacePath: string);
    glob(pattern: string, limit?: number): string[];
    grep(regex: string, limit?: number): SearchHit[];
}
