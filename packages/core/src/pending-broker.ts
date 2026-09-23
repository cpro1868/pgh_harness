import { randomUUID } from 'node:crypto';

interface PendingEntry<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

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
export class PendingBroker<T> {
  public readonly timeoutMs: number;
  private readonly entries = new Map<string, PendingEntry<T>>();
  private readonly makeTimeoutError: (timeoutMs: number) => Error;
  private readonly makeFailureError: (reason?: string) => Error;

  constructor(options: PendingBrokerOptions) {
    this.timeoutMs = options.timeoutMs;
    this.makeTimeoutError = options.makeTimeoutError;
    this.makeFailureError = options.makeFailureError;
  }

  /** @returns 形如 `<prefix>_<uuid>` 的唯一标识。 */
  public newId(prefix: string): string {
    return `${prefix}_${randomUUID()}`;
  }

  public register(id: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.entries.delete(id);
        reject(this.makeTimeoutError(this.timeoutMs));
      }, this.timeoutMs);
      // ponytail: 定时器保持 ref，超时必须真实触发（unref 会让事件循环提前排空、超时永不结算）。
      // 代价是一次挂起会持有引用最长 timeoutMs；由 failAll() 在回合结束/中止时主动清理。
      this.entries.set(id, { resolve, reject, timer });
    });
  }

  public settle(id: string, value: T): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.entries.delete(id);
    entry.resolve(value);
    return true;
  }

  public fail(id: string, reason?: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.entries.delete(id);
    entry.reject(this.makeFailureError(reason));
    return true;
  }

  public has(id: string): boolean {
    return this.entries.has(id);
  }

  public ids(): string[] {
    return [...this.entries.keys()];
  }

  public failAll(reason?: string): number {
    const ids = this.ids();
    for (const id of ids) this.fail(id, reason);
    return ids.length;
  }
}
