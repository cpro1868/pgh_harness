export interface ExecOptions {
    timeoutMs?: number;
    workdir?: string;
    env?: Record<string, string>;
}
export interface ExecResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
}
export declare class ShellExecutor {
    readonly defaultWorkdir: string;
    constructor(defaultWorkdir: string);
    exec(command: string, options?: ExecOptions): Promise<ExecResult>;
    /**
     * 跨平台进程树硬杀实现 (D18, D62)
     */
    killProcessTree(pid?: number): void;
}
