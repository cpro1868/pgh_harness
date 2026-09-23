import { PendingBroker } from './pending-broker.ts';

export class ApprovalDeniedError extends Error {
  constructor(reason?: string) {
    super(`[Approval] ${reason && reason.trim() !== '' ? reason : '操作未获批准，已按 fail-closed 原则拒绝执行'}`);
    this.name = 'ApprovalDeniedError';
  }
}

export class ApprovalTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`[Approval] 审批超过 ${Math.round(timeoutMs / 60000)} 分钟未响应，已按 fail-closed 原则拒绝执行`);
    this.name = 'ApprovalTimeoutError';
  }
}

/**
 * 破坏性操作的人工审批注册表（设计 §6.3）。
 * 与提问分离（§6.4）：审批用于授权，提问用于澄清。
 * 审批请求以 `approval/requested` 事件持久化，因此客户端重连后可重新下发待批项。
 */
export class ApprovalBroker {
  public readonly timeoutMs: number;
  private readonly pending: PendingBroker<'allow'>;

  /** @param timeoutMs - 挂起上限，默认 5 分钟；超时与拒绝同义（fail-closed）。 */
  constructor(timeoutMs = 5 * 60 * 1000) {
    this.timeoutMs = timeoutMs;
    this.pending = new PendingBroker<'allow'>({
      timeoutMs,
      makeTimeoutError: (ms) => new ApprovalTimeoutError(ms),
      makeFailureError: (reason) => new ApprovalDeniedError(reason),
    });
  }

  /** @returns 形如 `apr_<uuid>` 的审批标识。 */
  public newRequestId(): string {
    return this.pending.newId('apr');
  }

  /**
   * 挂起等待人工裁决。
   * @param requestId - 审批标识。
   * @returns 获批时以 `'allow'` 兑现；被拒或超时则以错误结束。
   */
  public register(requestId: string): Promise<'allow'> {
    return this.pending.register(requestId);
  }

  /**
   * 批准并唤醒等待方。
   * @param requestId - 审批标识。
   * @returns 是否命中了等待中的审批。
   */
  public approve(requestId: string): boolean {
    return this.pending.settle(requestId, 'allow');
  }

  /**
   * 拒绝并唤醒等待方（fail-closed）。
   * @param requestId - 审批标识。
   * @param reason - 可选的拒绝原因。
   * @returns 是否命中了等待中的审批。
   */
  public deny(requestId: string, reason?: string): boolean {
    return this.pending.fail(requestId, reason);
  }

  public hasPending(requestId: string): boolean {
    return this.pending.has(requestId);
  }

  public pendingRequestIds(): string[] {
    return this.pending.ids();
  }

  /** 审批通道不可达（回合结束/中止）时全部按拒绝处理。 */
  public denyAll(reason?: string): number {
    return this.pending.failAll(reason);
  }
}
