export declare class WorkspaceWriteLock {
    private readonly holders;
    tryAcquire(workspacePath: string, sessionId: string): boolean;
    release(workspacePath: string, sessionId: string): void;
    holder(workspacePath: string): string | undefined;
}
