/**
 * LLM 网络层自动重试（TC-00-98）。
 * 只重试瞬态网络错误与上游网关错误（Cloudflare 520/断流等）；
 * 业务错误（401/403/400/404）绝不重试，立即上抛。
 */

const RETRYABLE_PATTERNS: RegExp[] = [
  /HTTP 429/, // 速率限制
  /HTTP 5\d\d/, // 500/502/503/504/520 等所有上游网关错误
  /\bterminated\b/i, // 流式响应中途断开
  /fetch failed/i, // 连接建立失败
  /other side closed/i, // 对端关闭连接
  /UND_ERR_SOCKET/i, // undici socket 错误
  /UND_ERR_CONNECT_TIMEOUT/i, // undici 连接超时
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /socket hang up/i,
];

export function isRetryableLLMError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return RETRYABLE_PATTERNS.some((re) => re.test(msg));
}

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

export async function retryWithBackoff<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = options.retries ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 8000;
  const throwIfAborted = (): void => {
    if (options.signal?.aborted) {
      throw new Error('[Abort] 回合已被中止（客户端断开或用户 Abort），停止重试');
    }
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    throwIfAborted();
    if (attempt > 0) {
      const delay = Math.min(initialDelayMs * 2 ** (attempt - 1), maxDelayMs);
      await new Promise((r) => setTimeout(r, delay));
      throwIfAborted();
      options.onRetry?.(attempt, lastErr);
    }
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      throwIfAborted();
      if (!isRetryableLLMError(err)) throw err;
    }
  }
  throw lastErr;
}
