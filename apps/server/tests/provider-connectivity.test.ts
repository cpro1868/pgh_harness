import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { HarnessServer } from '../src/index.ts';

/** 最小 OpenAI 兼容 stub：对非流式 /chat/completions 返回固定补全。 */
function startPingLlm(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/chat/completions') {
        req.on('data', () => {});
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'pong' } }] }));
        });
        return;
      }
      res.writeHead(404);
      res.end('{}');
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port }));
  });
}

describe('TC-01-04: Provider 模型连通性测试端点 (POST /api/providers/test)', () => {
  let tmpDir: string;
  let server: HarnessServer;
  let stub: { server: http.Server; port: number };
  const testPort = 3327;
  const base = `http://127.0.0.1:${testPort}`;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-provider-conn-'));
    stub = await startPingLlm();
    server = new HarnessServer({ port: testPort, dataDir: path.join(tmpDir, 'data') });
    await server.start();
  });

  after(async () => {
    await server.stop();
    stub.server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('连通成功：返回 ok=true、延迟与模型回复片段', async () => {
    const res = await fetch(`${base}/api/providers/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelId: 'ping-model',
        baseUrl: `http://127.0.0.1:${stub.port}`,
        apiKey: 'sk-live-key-for-connectivity',
        protocol: 'openai-compatible',
      }),
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { code: number; data: { ok: boolean; latencyMs: number; reply?: string; modelId: string } };
    assert.equal(json.code, 0);
    assert.equal(json.data.ok, true);
    assert.equal(json.data.modelId, 'ping-model');
    assert.ok(typeof json.data.latencyMs === 'number' && json.data.latencyMs >= 0);
    assert.equal(json.data.reply, 'pong');
  });

  it('连通失败：不可达端点返回 ok=false 且附带真实原因（HTTP 仍为 200，不抛出）', async () => {
    const res = await fetch(`${base}/api/providers/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelId: 'ghost-model',
        baseUrl: 'http://127.0.0.1:1',
        apiKey: 'sk-live-key-but-unreachable',
        protocol: 'openai-compatible',
      }),
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { code: number; data: { ok: boolean; message?: string } };
    assert.equal(json.code, 0);
    assert.equal(json.data.ok, false);
    assert.ok((json.data.message || '').length > 0, '失败必须附带可读原因');
  });

  it('缺少 modelId 一律 400 拒绝', async () => {
    const res = await fetch(`${base}/api/providers/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: 'http://127.0.0.1:1' }),
    });
    assert.equal(res.status, 400);
  });

  it('留空 apiKey 时回落已保存凭据（编辑态无需重填 Key 即可测试）', async () => {
    // 保存一个 Provider（存密钥 + 指向 stub）
    const saveRes = await fetch(`${base}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'conn-provider',
        name: 'Connectivity Provider',
        protocol: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${stub.port}`,
        apiKey: 'sk-live-key-for-connectivity',
        models: [{ id: 'ping-model', name: 'ping-model', contextWindow: 65536 }],
      }),
    });
    assert.equal(saveRes.status, 200);

    const res = await fetch(`${base}/api/providers/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'conn-provider', modelId: 'ping-model' }),
    });
    const json = (await res.json()) as { code: number; data: { ok: boolean } };
    assert.equal(json.code, 0);
    assert.equal(json.data.ok, true, '未显式传 Key 时必须回落到已保存凭据并测试成功');
  });
});
