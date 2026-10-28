/**
 * LLM 网络层自动重试（TC-00-98）。
 * 只重试瞬态网络错误与上游网关错误（Cloudflare 520/断流等）；
 * 业务错误（401/403/400/404）绝不重试，立即上抛。
 */
export declare function isRetryableLLMError(err: unknown): boolean;
export interface RetryOptions {
    /** 重试次数（不含首次调用），默认 3 */
    retries?: number;
    /** 首次退避毫秒，默认 500 */
    initialDelayMs?: number;
    /** 退避上限毫秒，默认 8000 */
    maxDelayMs?: number;
    /** 每次重试前回调（attempt 从 1 开始） */
    onRetry?: (attempt: number, err: unknown) => void;
    /** 中止信号：abort 后立即上抛，不再重试/等待（回合被用户或断连中止时使用） */
    signal?: AbortSignal;
}
export declare function retryWithBackoff<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T>;
