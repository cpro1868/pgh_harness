import test from 'node:test';
import assert from 'node:assert/strict';
import { retryWithBackoff, isRetryableLLMError } from '../src/security/retry.ts';

test('TC-00-98: LLM 网络层自动重试（fail-safe 只重试瞬态错误）', async (t) => {
  await t.test('可重试错误分类：520 / terminated / fetch failed / 超时类', () => {
    assert.equal(isRetryableLLMError(new Error('远程模型返回 HTTP 520: <!DOCTYPE html>')), true, '520 必须可重试');
    assert.equal(isRetryableLLMError(new Error('远程模型返回 HTTP 502: bad gateway')), true, '502 必须可重试');
    assert.equal(isRetryableLLMError(new Error('远程模型返回 HTTP 503: unavailable')), true, '503 必须可重试');
    assert.equal(isRetryableLLMError(new Error('远程模型返回 HTTP 504: timeout')), true, '504 必须可重试');
    assert.equal(isRetryableLLMError(new Error('远程模型返回 HTTP 429: rate limited')), true, '429 必须可重试');
    assert.equal(isRetryableLLMError(new Error('terminated')), true, '流中断 terminated 必须可重试');
    assert.equal(isRetryableLLMError(new Error('fetch failed')), true, '连接失败 fetch failed 必须可重试');
    assert.equal(isRetryableLLMError(new Error('other side closed')), true, '对端断开必须可重试');
    assert.equal(isRetryableLLMError(new Error('UND_ERR_SOCKET')), true, 'undici socket 错误必须可重试');
    assert.equal(isRetryableLLMError(new Error('UND_ERR_CONNECT_TIMEOUT')), true, '连接超时必须可重试');
  });

  await t.test('不可重试错误分类：401/403/400 业务错误绝不重试', () => {
    assert.equal(isRetryableLLMError(new Error('远程模型返回 HTTP 401: unauthorized')), false, '401 绝不重试');
    assert.equal(isRetryableLLMError(new Error('远程模型返回 HTTP 403: forbidden')), false, '403 绝不重试');
    assert.equal(isRetryableLLMError(new Error('远程模型返回 HTTP 400: tier_limit_exceeded')), false, '400 绝不重试');
    assert.equal(isRetryableLLMError(new Error('远程模型返回 HTTP 404: not found')), false, '404 绝不重试');
  });

  await t.test('成功路径：首次成功不重试', async () => {
    let calls = 0;
    const result = await retryWithBackoff(async () => {
      calls += 1;
      return 'ok';
    });
    assert.equal(result, 'ok');
    assert.equal(calls, 1);
  });

  await t.test('瞬态失败后重试成功：2 次失败 + 1 次成功 = 共 3 次调用', async () => {
    let calls = 0;
    const result = await retryWithBackoff(async () => {
      calls += 1;
      if (calls < 3) throw new Error('远程模型返回 HTTP 520: upstream error');
      return 'recovered';
    }, { initialDelayMs: 10, maxDelayMs: 20 });
    assert.equal(result, 'recovered');
    assert.equal(calls, 3);
  });

  await t.test('重试耗尽：3 次重试全部失败后上抛最后一次错误', async () => {
    let calls = 0;
    await assert.rejects(
      retryWithBackoff(async () => {
        calls += 1;
        throw new Error(`远程模型返回 HTTP 520: attempt ${calls}`);
      }, { initialDelayMs: 5, maxDelayMs: 10 }),
      (err: Error) => {
        assert.ok(err.message.includes('attempt 4'), `最终上抛的应是最后一次错误，实际: ${err.message}`);
        return true;
      },
    );
    assert.equal(calls, 4, '首次 + 3 次重试 = 4 次调用');
  });

  await t.test('不可重试错误立即上抛：一次都不重试', async () => {
    let calls = 0;
    await assert.rejects(
      retryWithBackoff(async () => {
        calls += 1;
        throw new Error('远程模型返回 HTTP 401: bad key');
      }, { initialDelayMs: 5 }),
      /401/,
    );
    assert.equal(calls, 1, '401 必须立即失败，绝不重试');
  });

  await t.test('onRetry 钩子记录每次重试事件', async () => {
    const retries: Array<{ attempt: number; err: string }> = [];
    let calls = 0;
    await retryWithBackoff(async () => {
      calls += 1;
      if (calls === 1) throw new Error('terminated');
      return 'ok';
    }, { initialDelayMs: 5, onRetry: (attempt, err) => retries.push({ attempt, err: err instanceof Error ? err.message : String(err) }) });
    assert.equal(retries.length, 1);
    assert.equal(retries[0]?.attempt, 1);
    assert.equal(retries[0]?.err, 'terminated');
  });
});
