export declare class FileNotObservedError extends Error {
    constructor(filePath: string);
}
export declare class EditMismatchError extends Error {
    readonly isDoomLoop: boolean;
    constructor(filePath: string, message: string, isDoomLoop?: boolean);
}
export interface EditFileResult {
    filePath: string;
    replacements: number;
}
export declare class FileTools {
    readonly workspacePath: string;
    private observedFiles;
    private failureCounts;
    constructor(workspacePath: string);
    private resolveSafePath;
    readFile(relPath: string): string;
    writeFile(relPath: string, content: string): void;
    /**
     * 吸收 OpenCode 的 CRLF/LF 换行符精确容错替换算法：
     * reference/opencode/packages/core/src/tool/edit.ts:42-65
     */
    editFile(relPath: string, oldString: string, newString: string, replaceAll?: boolean): EditFileResult;
}
