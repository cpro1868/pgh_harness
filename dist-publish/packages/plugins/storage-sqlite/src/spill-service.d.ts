export interface SpillOptions {
    dataDir: string;
    thresholdBytes?: number;
}
export interface SpillResult {
    isSpilled: boolean;
    payload: string;
    sha256?: string;
    sizeBytes?: number;
}
export declare class SpillBlobService {
    private dataDir;
    private thresholdBytes;
    constructor(options: SpillOptions);
    spillIfNeeded(sessionId: string, content: string): SpillResult;
    cleanSessionBlobs(sessionId: string): void;
}
