import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HarnessServer } from '../src/index.ts';

describe('TC-11-03: 记忆中心手动条目录入与自检接口 (WBS-Mem-01)', () => {
  let tmpDir: string;
  let server: HarnessServer;
  const testPort = 3348;
  const base = `http://127.0.0.1:${testPort}`;
  const wsPath = 'G:\\Projects\\Agent\\MemSelfCheckWs';

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-mem-chk-test-'));
    server = new HarnessServer({
      port: testPort,
      dataDir: path.join(tmpDir, 'data'),
    });
    await server.start();

    // 注册工作区
    await fetch(`${base}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'ws_mem_check',
        name: 'MemSelfCheckWs',
        path: wsPath,
        description: '记忆自检测试工作区',
        rules: {},
        ignorePatterns: [],
      }),
    });
    fs.mkdirSync(wsPath, { recursive: true });
  });

  after(async () => {
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('POST /api/memory/entry 手动录入一条经验记忆，成功写入且可通过列表读取', async () => {
    const uniqueContent = '本项目构建时必须使用 pnpm，切勿使用 npm 或 yarn。[' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + ']';
    const res = await fetch(`${base}/api/memory/entry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspacePath: wsPath,
        content: uniqueContent,
        source: 'manual',
      }),
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { code: number; data: { saved: boolean; entryId: string } };
    assert.equal(json.code, 0);
    assert.equal(json.data.saved, true);
    assert.ok(json.data.entryId);

    // 查询列表验证
    const listRes = await fetch(`${base}/api/memory?workspace=${encodeURIComponent(wsPath)}`);
    const listJson = (await listRes.json()) as { data: { entries: Array<{ id: string; content: string }> } };
    assert.ok(listJson.data.entries.some((e) => e.content.includes(uniqueContent)));
  });

  it('POST /api/memory/entry 重复录入相同内容时自动去重', async () => {
    const payload = {
      workspacePath: wsPath,
      content: '本项目构建时必须使用 pnpm，切勿使用 npm 或 yarn，防止 lockfile 冲突。',
    };
    const res = await fetch(`${base}/api/memory/entry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { code: number; data: { saved: boolean; isDuplicate: boolean } };
    assert.equal(json.code, 0);
    assert.equal(json.data.saved, false);
    assert.equal(json.data.isDuplicate, true);
  });

  it('POST /api/memory/entry 参数校验缺失时返回 400', async () => {
    const res = await fetch(`${base}/api/memory/entry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspacePath: wsPath }),
    });
    assert.equal(res.status, 400);
  });
});
