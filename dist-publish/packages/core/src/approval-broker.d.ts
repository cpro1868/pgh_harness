export declare class ApprovalDeniedError extends Error {
    constructor(reason?: string);
}
export declare class ApprovalTimeoutError extends Error {
    constructor(timeoutMs: number);
}
/**
 * 破坏性操作的人工审批注册表（设计 §6.3）。
 * 与提问分离（§6.4）：审批用于授权，提问用于澄清。
 * 审批请求以 `approval/requested` 事件持久化，因此客户端重连后可重新下发待批项。
 */
export declare class ApprovalBroker {
    readonly timeoutMs: number;
    private readonly pending;
    /** @param timeoutMs - 挂起上限，默认 5 分钟；超时与拒绝同义（fail-closed）。 */
    constructor(timeoutMs?: number);
    /** @returns 形如 `apr_<uuid>` 的审批标识。 */
    newRequestId(): string;
    /**
     * 挂起等待人工裁决。
     * @param requestId - 审批标识。
     * @returns 获批时以 `'allow'` 兑现；被拒或超时则以错误结束。
     */
    register(requestId: string): Promise<'allow'>;
    /**
     * 批准并唤醒等待方。
     * @param requestId - 审批标识。
     * @returns 是否命中了等待中的审批。
     */
    approve(requestId: string): boolean;
    /**
     * 拒绝并唤醒等待方（fail-closed）。
     * @param requestId - 审批标识。
     * @param reason - 可选的拒绝原因。
     * @returns 是否命中了等待中的审批。
     */
    deny(requestId: string, reason?: string): boolean;
    hasPending(requestId: string): boolean;
    pendingRequestIds(): string[];
    /** 审批通道不可达（回合结束/中止）时全部按拒绝处理。 */
    denyAll(reason?: string): number;
}
