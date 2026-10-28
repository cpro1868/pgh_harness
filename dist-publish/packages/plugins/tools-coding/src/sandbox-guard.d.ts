export declare class PathEscapeError extends Error {
    readonly attemptedPath: string;
    constructor(attemptedPath: string);
}
export declare class SandboxGuard {
    readonly canonicalWorkspace: string;
    constructor(workspacePath: string);
    assertSafePath(relOrAbsPath: string): string;
}
