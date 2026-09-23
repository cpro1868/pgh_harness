import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HarnessServer } from '../src/index.ts';


test('TC-01-08-003: 最小可运行服务集成验证 (健康检查、代理设置、模型探测与静态页面)', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-server-test-'));
  const testPort = 3199; // 避开常用 3000

  const server = new HarnessServer({
    port: testPort,
    dataDir: tmpDir,
  });

  t.after(async () => {
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test('服务正常启动并监听端口', async () => {
    await server.start();
    assert.equal(server.port, testPort);
  });

  await t.test('API: GET /api/health 返回健康状态与版本', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json() as { code: number; status: string; version: string };
    assert.equal(body.code, 0);
    assert.equal(body.status, 'ok');
    assert.equal(body.version, '0.1.0');
  });

  await t.test('API: PUT /api/settings/proxy 成功保存代理配置', async () => {
    const newProxy = {
      enabled: true,
      protocol: 'SOCKS5',
      host: '127.0.0.1',
      port: 10808,
      bypassList: 'localhost, 127.0.0.1',
    };

    const res = await fetch(`http://127.0.0.1:${testPort}/api/settings/section`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: 'proxy', data: newProxy }),
    });


    assert.equal(res.status, 200);
    const body = await res.json() as { code: number };
    assert.equal(body.code, 0);
  });

  await t.test('API: POST /api/providers 成功创建并持久化 Provider', async () => {
    const newProv = {
      id: 'custom-provider-test',
      name: '自定义测试 Provider',
      protocol: 'openai-compatible',
      baseUrl: 'https://custom.ai/v1',
      apiKey: 'sk-custom-secret',
      proxy: { enabled: true, mode: 'inherit' },
      models: [{ id: 'custom-model', name: 'custom-model', contextWindow: 32768 }],
    };

    const res = await fetch(`http://127.0.0.1:${testPort}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newProv),
    });

    assert.equal(res.status, 200);
    const body = await res.json() as { code: number; data: { id: string; name: string } };
    assert.equal(body.code, 0);
    assert.equal(body.data.id, 'custom-provider-test');

    // 再次从数据库查验持久化存在
    const listRes = await fetch(`http://127.0.0.1:${testPort}/api/providers`);
    const listBody = await listRes.json() as { code: number; data: Array<{ id: string }> };
    assert.ok(listBody.data.some((p) => p.id === 'custom-provider-test'));
  });

  await t.test('API: PATCH /api/providers/:id/proxy-toggle 成功持久化切换代理状态', async () => {
    const patchRes = await fetch(`http://127.0.0.1:${testPort}/api/providers/custom-provider-test/proxy-toggle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });

    assert.equal(patchRes.status, 200);

    // 验证状态改变真实生效
    const checkRes = await fetch(`http://127.0.0.1:${testPort}/api/providers`);
    const checkBody = await checkRes.json() as { data: Array<{ id: string; proxy: { enabled: boolean } }> };
    const target = checkBody.data.find((p) => p.id === 'custom-provider-test');
    assert.equal(target?.proxy.enabled, false);
  });


  await t.test('静态资源托管: GET /config-settings.html 成功返回独立纯净前端应用', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/config-settings.html`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('Purple Grapes Harness'));
    assert.ok(html.includes('系统全局网络代理'));
  });


});
