import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HarnessServer } from '../src/index.ts';

describe('TC-11-01: 当前会话手动记忆沉淀与重复去重 (WBS-Mem-01)', () => {
  let tmpDir: string;
  let server: HarnessServer;
  const testPort = 3342;
  const base = `http://127.0.0.1:${testPort}`;
  const wsPath = 'G:\\Projects\\Agent\\MemTestWorkspace';

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-mem-snap-test-'));
    server = new HarnessServer({
      port: testPort,
      dataDir: path.join(tmpDir, 'data'),
    });
    await server.start();

    // 注册一个工作区作为记忆归档根
    const wsRegRes = await fetch(`${base}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'ws_mem_test',
        name: 'MemTestWorkspace',
        path: wsPath,
        description: '记忆沉淀测试工作区',
        rules: {},
        ignorePatterns: [],
      }),
    });
    if (wsRegRes.status !== 200) {
      const txt = await wsRegRes.text();
      throw new Error('注册工作区失败: ' + wsRegRes.status + ' -> ' + txt);
    }
    fs.mkdirSync(wsPath, { recursive: true });
  });

  after(async () => {
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('POST /api/memory/snapshot 接收一段会话摘要并成功写入项目记忆', async () => {
    const res = await fetch(`${base}/api/memory/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspacePath: wsPath,
        sessionId: 'sess_snapshot_001',
        title: '端到端架构梳理会话',
        summary: '本次会话确认了微内核插件拆分方案，并修复了双轨协议适配的鉴权时序问题。[' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + ']',
      }),
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { code: number; message?: string; data: { saved: boolean; entryId: string } };
    if (!json.data || !json.data.saved) {
      throw new Error('保存失败: ' + JSON.stringify(json));
    }
    assert.equal(json.code, 0);
    assert.equal(json.data.saved, true);
    assert.ok(json.data.entryId !== undefined);
  });

  it('POST /api/memory/snapshot 重复写入相同摘要内容时自动去重，不产生重复记忆', async () => {
    const payload = {
      workspacePath: wsPath,
      sessionId: 'sess_snapshot_002',
      title: '端到端架构梳理会话-' + Date.now(),
      summary: '本次会话确认了微内核插件拆分方案，并修复了双轨协议适配的鉴权时序问题。',
    };
    // 确保与第一个测试用例的内容不一致，防止跨用例去重影响断言
    payload.title = payload.title + '-' + Math.random().toString(36).slice(2, 7);

    // 第一次写入
    const first = await fetch(`${base}/api/memory/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const firstJson = (await first.json()) as { data: { saved: boolean; entryId: string } };
    assert.equal(firstJson.data.saved, true);

    // 第二次写入相同内容
    const second = await fetch(`${base}/api/memory/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const secondJson = (await second.json()) as { data: { saved: boolean; entryId: string; isDuplicate: boolean } };
    assert.equal(secondJson.data.saved, false);
    assert.equal(secondJson.data.isDuplicate, true);

    // 查询记忆列表，确保该会话仅生成 1 条记忆，没有重复堆积
    const listRes = await fetch(`${base}/api/memory?workspace=${encodeURIComponent(wsPath)}`);
    const listJson = (await listRes.json()) as { data: { entries: Array<{ content: string }> } };
    const matched = listJson.data.entries.filter(e => e.content.includes(payload.title));
    assert.equal(matched.length, 1, '同一段摘要重复沉淀必须被 SHA-256 指纹拦截去重');
  });
});
