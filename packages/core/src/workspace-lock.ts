export class WorkspaceWriteLock {
  private readonly holders = new Map<string, string>();

  public tryAcquire(workspacePath: string, sessionId: string): boolean {
    const holder = this.holders.get(workspacePath);
    if (!holder) {
      this.holders.set(workspacePath, sessionId);
      return true;
    }
    return holder === sessionId;
  }

  public release(workspacePath: string, sessionId: string): void {
    if (this.holders.get(workspacePath) === sessionId) {
      this.holders.delete(workspacePath);
    }
  }

  public holder(workspacePath: string): string | undefined {
    return this.holders.get(workspacePath);
  }
}
