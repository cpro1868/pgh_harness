import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HarnessServer } from '../src/index.ts';

describe('TC-01-05-006: 生产网络与边界安全加固 (BL-11 / BL-12 / BL-09)', () => {
  let tmpDir: string;
  let server: HarnessServer;
  const testPort = 3350;
  const base = `http://127.0.0.1:${testPort}`;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-sec-net-test-'));
    server = new HarnessServer({
      port: testPort,
      dataDir: path.join(tmpDir, 'data'),
    });
    await server.start();
  });

  after(async () => {
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('BL-12: CORS 跨域白名单收紧：非回环/非法 Origin 来源请求不得返回通配 * 放行头', async () => {
    // 1. 合法回环 Origin (127.0.0.1 或 localhost)
    const localRes = await fetch(`${base}/api/health`, {
      headers: { Origin: 'http://127.0.0.1:3210' },
    });
    assert.equal(localRes.headers.get('Access-Control-Allow-Origin'), 'http://127.0.0.1:3210');

    // 2. 恶意第三方外部 Origin (如 http://evil.com) 绝不放行通配 *，应当返回 null 或无此头
    const evilRes = await fetch(`${base}/api/health`, {
      headers: { Origin: 'http://evil-attacker.com' },
    });
    const allowOrigin = evilRes.headers.get('Access-Control-Allow-Origin');
    assert.notEqual(allowOrigin, '*', '绝不允许通配 * 放行');
    assert.notEqual(allowOrigin, 'http://evil-attacker.com', '绝不允许给恶意域名跨域头');
  });

  it('BL-11: 非回环绑定强制 Token 鉴权：未携带合法 Token 时直接 401 拦截 (fail-closed)', async () => {
    // 模拟服务端启动时配置了 access token 的安全场景
    const authTestPort = 3352;
    const authTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-auth-test-'));
    const authServer = new HarnessServer({
      port: authTestPort,
      dataDir: path.join(authTmpDir, 'data'),
    });
    await authServer.start();

    // 写入安全 General 配置：绑定 0.0.0.0 且设 accessToken
    await fetch(`http://127.0.0.1:${authTestPort}/api/settings/section`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        section: 'general',
        data: {
          port: authTestPort,
          hostBinding: '0.0.0.0',
          accessToken: 'secret-token-123456',
        },
      }),
    });

    // 1. 模拟非回环/公网暴露请求（Header 带 x-forwarded-for: 192.168.1.100）且无 Token -> 必须 401
    const deniedRes = await fetch(`http://127.0.0.1:${authTestPort}/api/providers`, {
      headers: {
        'x-forwarded-for': '192.168.1.100',
      },
    });
    assert.equal(deniedRes.status, 401, '缺失 Token 必须 401 拦截');

    // 2. 携带合法 x-pgh-token -> 正常 200 放行
    const allowedRes = await fetch(`http://127.0.0.1:${authTestPort}/api/providers`, {
      headers: {
        'x-forwarded-for': '192.168.1.100',
        'x-pgh-token': 'secret-token-123456',
      },
    });
    assert.equal(allowedRes.status, 200, '携带正确 Token 允许访问');

    await authServer.stop();
    fs.rmSync(authTmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
});
