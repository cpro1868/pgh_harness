export class WorkspaceWriteLock {
    holders = new Map();
    tryAcquire(workspacePath, sessionId) {
        const holder = this.holders.get(workspacePath);
        if (!holder) {
            this.holders.set(workspacePath, sessionId);
            return true;
        }
        return holder === sessionId;
    }
    release(workspacePath, sessionId) {
        if (this.holders.get(workspacePath) === sessionId) {
            this.holders.delete(workspacePath);
        }
    }
    holder(workspacePath) {
        return this.holders.get(workspacePath);
    }
}
