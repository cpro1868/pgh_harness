export interface PendingBrokerOptions {
    timeoutMs: number;
    /** 超时错误工厂（不同语义的等待需要不同错误类型）。 */
    makeTimeoutError: (timeoutMs: number) => Error;
    /** 失败/拒绝错误工厂。 */
    makeFailureError: (reason?: string) => Error;
}
/**
 * 「注册等待 → 外部唤醒」的通用挂起注册表骨架。
 * 人机提问（QuestionBroker）与操作审批（ApprovalBroker）共用它，避免两套超时与清理逻辑漂移。
 */
export declare class PendingBroker<T> {
    readonly timeoutMs: number;
    private readonly entries;
    private readonly makeTimeoutError;
    private readonly makeFailureError;
    constructor(options: PendingBrokerOptions);
    /** @returns 形如 `<prefix>_<uuid>` 的唯一标识。 */
    newId(prefix: string): string;
    register(id: string): Promise<T>;
    settle(id: string, value: T): boolean;
    fail(id: string, reason?: string): boolean;
    has(id: string): boolean;
    ids(): string[];
    failAll(reason?: string): number;
}
