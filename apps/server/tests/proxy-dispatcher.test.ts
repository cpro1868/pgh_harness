import test from 'node:test';
import assert from 'node:assert/strict';
import { ProxyDispatcher, SilentZombieTimeoutError } from '../src/network/proxy-dispatcher.ts';


test('TC-01-01-004 & TC-01-01-005: 两级代理分流、白名单直连与静默僵死熔断测试', async (t) => {
  await t.test('白名单地址强制直连判定', () => {
    const dispatcher = new ProxyDispatcher({
      globalProxy: {
        enabled: true,
        protocol: 'HTTP',
        host: '127.0.0.1',
        port: 7890,
        bypassList: 'localhost, 127.0.0.1, ::1, *.local',
      },
    });

    assert.equal(dispatcher.shouldBypass('http://localhost:3000/api'), true);
    assert.equal(dispatcher.shouldBypass('http://127.0.0.1:11434/v1/models'), true);
    assert.equal(dispatcher.shouldBypass('https://api.deepseek.com/v1/chat'), false);
  });

  await t.test('Provider 专属代理优先级高于全局代理', () => {
    const dispatcher = new ProxyDispatcher({
      globalProxy: {
        enabled: true,
        protocol: 'HTTP',
        host: '127.0.0.1',
        port: 7890,
        bypassList: 'localhost',
      },
    });

    // Case 1: Provider 显式强制直连 (direct)
    const route1 = dispatcher.resolveRoute('https://api.deepseek.com/v1', {
      enabled: false,
      mode: 'direct',
    });
    assert.equal(route1.useProxy, false);

    // Case 2: Provider 继承全局 (inherit)
    const route2 = dispatcher.resolveRoute('https://api.deepseek.com/v1', {
      enabled: true,
      mode: 'inherit',
    });
    assert.equal(route2.useProxy, true);
    assert.equal(route2.port, 7890);

    // Case 3: Provider 自定义专属代理 (custom)
    const route3 = dispatcher.resolveRoute('https://api.anthropic.com/v1', {
      enabled: true,
      mode: 'custom',
      customConfig: {
        protocol: 'SOCKS5',
        host: '127.0.0.1',
        port: 10808,
      },
    });
    assert.equal(route3.useProxy, true);
    assert.equal(route3.protocol, 'SOCKS5');
    assert.equal(route3.port, 10808);
  });

  await t.test('流式静默僵死超时熔断拦截器', async () => {
    const dispatcher = new ProxyDispatcher({
      globalProxy: {
        enabled: true,
        protocol: 'HTTP',
        host: '127.0.0.1',
        port: 7890,
        bypassList: '',
      },
      silentTimeoutMs: 100, // 测试加速为 100ms
    });

    const mockStream = async function* () {
      yield 'chunk-1';
      // 故意沉睡 250ms 模拟代理网络静默卡死
      await new Promise((r) => setTimeout(r, 250));
      yield 'chunk-2';
    };

    await assert.rejects(
      async () => {
        for await (const _ of dispatcher.wrapStreamWithTimeout(mockStream())) {
          // 消费中
        }
      },
      (err: unknown) => {
        assert.ok(err instanceof SilentZombieTimeoutError);
        assert.equal((err as SilentZombieTimeoutError).timeoutMs, 100);
        return true;
      }
    );
  });
});
