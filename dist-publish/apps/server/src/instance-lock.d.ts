export interface LockOptions {
    dataDir: string;
    port: number;
    pid?: number;
}
export interface LockResult {
    acquired: boolean;
    lockPath: string;
    existingPid?: number;
    existingPort?: number;
}
export declare function acquireInstanceLock(options: LockOptions): LockResult;
export declare function releaseInstanceLock(dataDir: string): void;
