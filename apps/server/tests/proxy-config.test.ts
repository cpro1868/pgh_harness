import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeProxyConfig } from '../src/security/proxy-config.ts';

const DEFAULT = { enabled: false, mode: 'inherit' } as const;

test('sanitizeProxyConfig: 合法输入原样放行', () => {
  assert.deepEqual(
    sanitizeProxyConfig({ enabled: true, mode: 'custom', customConfig: { protocol: 'HTTP', host: '127.0.0.1', port: 8964 } }),
    { enabled: true, mode: 'custom', customConfig: { protocol: 'HTTP', host: '127.0.0.1', port: 8964 } },
  );
  assert.deepEqual(sanitizeProxyConfig({ enabled: false, mode: 'direct' }), { enabled: false, mode: 'direct' });
  assert.deepEqual(sanitizeProxyConfig({ enabled: true, mode: 'inherit' }), { enabled: true, mode: 'inherit' });
});

test('sanitizeProxyConfig: 非对象输入一律 fail-closed 回落默认', () => {
  assert.deepEqual(sanitizeProxyConfig(undefined), DEFAULT);
  assert.deepEqual(sanitizeProxyConfig(null), DEFAULT);
  assert.deepEqual(sanitizeProxyConfig('enabled=true'), DEFAULT);
  assert.deepEqual(sanitizeProxyConfig(123), DEFAULT);
  assert.deepEqual(sanitizeProxyConfig(true), DEFAULT);
  assert.deepEqual(sanitizeProxyConfig(['enabled']), DEFAULT);
  assert.deepEqual(sanitizeProxyConfig({}), DEFAULT);
});

test('sanitizeProxyConfig: enabled 非布尔值时拒绝（回落 false）', () => {
  assert.deepEqual(sanitizeProxyConfig({ enabled: 'true', mode: 'custom' }), { enabled: false, mode: 'custom' });
  assert.deepEqual(sanitizeProxyConfig({ enabled: 1, mode: 'custom' }), { enabled: false, mode: 'custom' });
  assert.deepEqual(sanitizeProxyConfig({ enabled: null, mode: 'custom' }), { enabled: false, mode: 'custom' });
});

test('sanitizeProxyConfig: mode 不在白名单时拒绝（回落 inherit）', () => {
  assert.deepEqual(sanitizeProxyConfig({ enabled: true, mode: 'DIRECT' }), { enabled: true, mode: 'inherit' });
  assert.deepEqual(sanitizeProxyConfig({ enabled: true, mode: 'proxy' }), { enabled: true, mode: 'inherit' });
  assert.deepEqual(sanitizeProxyConfig({ enabled: true, mode: 42 }), { enabled: true, mode: 'inherit' });
  assert.deepEqual(sanitizeProxyConfig({ enabled: true }), { enabled: true, mode: 'inherit' });
  assert.deepEqual(sanitizeProxyConfig({ enabled: true, mode: null }), { enabled: true, mode: 'inherit' });
});

test('sanitizeProxyConfig: customConfig 非法时整段剔除，不残留半截结构', () => {
  assert.deepEqual(sanitizeProxyConfig({ enabled: true, mode: 'custom', customConfig: 'host' }), {
    enabled: true,
    mode: 'custom',
  });
  assert.deepEqual(sanitizeProxyConfig({ enabled: true, mode: 'custom', customConfig: null }), {
    enabled: true,
    mode: 'custom',
  });
  assert.deepEqual(sanitizeProxyConfig({ enabled: true, mode: 'custom', customConfig: [] }), {
    enabled: true,
    mode: 'custom',
  });
});

test('sanitizeProxyConfig: customConfig 字段级校验，非法字段剔除且不越权', () => {
  const kept = sanitizeProxyConfig({
    enabled: true,
    mode: 'custom',
    customConfig: { protocol: 'HTTP', host: '127.0.0.1', port: 8964, username: 'u', password: 'p', injection: 'DROP TABLE' },
  });
  assert.deepEqual(kept, {
    enabled: true,
    mode: 'custom',
    customConfig: { protocol: 'HTTP', host: '127.0.0.1', port: 8964, username: 'u', password: 'p' },
  });

  const badPort = sanitizeProxyConfig({
    enabled: true,
    mode: 'custom',
    customConfig: { protocol: 'HTTP', host: '127.0.0.1', port: '8964' },
  });
  assert.deepEqual(badPort, { enabled: true, mode: 'custom' });

  const badHost = sanitizeProxyConfig({
    enabled: true,
    mode: 'custom',
    customConfig: { protocol: 'HTTP', host: { evil: true }, port: 8964 },
  });
  assert.deepEqual(badHost, { enabled: true, mode: 'custom' });

  const badProto = sanitizeProxyConfig({
    enabled: true,
    mode: 'custom',
    customConfig: { protocol: 'gopher', host: '127.0.0.1', port: 8964 },
  });
  assert.deepEqual(badProto, { enabled: true, mode: 'custom' });

  const badRange = sanitizeProxyConfig({
    enabled: true,
    mode: 'custom',
    customConfig: { protocol: 'HTTP', host: '127.0.0.1', port: 70000 },
  });
  assert.deepEqual(badRange, { enabled: true, mode: 'custom' });
});
