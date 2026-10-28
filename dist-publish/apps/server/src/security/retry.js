/**
 * LLM 网络层自动重试（TC-00-98）。
 * 只重试瞬态网络错误与上游网关错误（Cloudflare 520/断流等）；
 * 业务错误（401/403/400/404）绝不重试，立即上抛。
 */
const RETRYABLE_PATTERNS = [
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
export function isRetryableLLMError(err) {
    const msg = err instanceof Error ? err.message : String(err);
    return RETRYABLE_PATTERNS.some((re) => re.test(msg));
}
export async function retryWithBackoff(fn, options = {}) {
    const retries = options.retries ?? 3;
    const initialDelayMs = options.initialDelayMs ?? 500;
    const maxDelayMs = options.maxDelayMs ?? 8000;
    const throwIfAborted = () => {
        if (options.signal?.aborted) {
            throw new Error('[Abort] 回合已被中止（客户端断开或用户 Abort），停止重试');
        }
    };
    let lastErr;
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
        }
        catch (err) {
            lastErr = err;
            throwIfAborted();
            if (!isRetryableLLMError(err))
                throw err;
        }
    }
    throw lastErr;
}
