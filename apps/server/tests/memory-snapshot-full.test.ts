import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HarnessServer } from '../src/index.ts';

describe('TC-11-02: 会话全量记忆沉淀与去重 (WBS-Mem-01)', () => {
  let tmpDir: string;
  let server: HarnessServer;
  const testPort = 3344;
  const base = `http://127.0.0.1:${testPort}`;
  const wsPath = 'G:\\Projects\\Agent\\MemFullTestWorkspace';
  let sessionId = '';

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-mem-full-test-'));
    server = new HarnessServer({
      port: testPort,
      dataDir: path.join(tmpDir, 'data'),
    });
    await server.start();

    // 注册工作区
    const wsRegRes = await fetch(`${base}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'ws_mem_full',
        name: 'MemFullTestWorkspace',
        path: wsPath,
        description: '会话全量记忆沉淀测试工作区',
        rules: {},
        ignorePatterns: [],
      }),
    });
    assert.equal(wsRegRes.status, 200);
    fs.mkdirSync(wsPath, { recursive: true });

    // 新建会话
    const sessRes = await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '端到端架构梳理全量沉淀会话',
        workspacePath: wsPath,
        preset: 'readonly',
        activeModelId: 'stub-model',
      }),
    });
    assert.equal(sessRes.status, 200);
    const sessJson = (await sessRes.json()) as { data: { id: string } };
    sessionId = sessJson.data.id;
    assert.ok(sessionId);
  });

  after(async () => {
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('POST /api/memory/snapshot-full 提取会话全量历史并成功合并沉淀', async () => {
    const res = await fetch(`${base}/api/memory/snapshot-full`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { code: number; data: { saved: boolean; entryId?: string; messageCount: number } };
    assert.equal(json.code, 0);
    // 空会话或事件不足亦应正确反馈，不抛异常；此处因会话刚建为 0 条事件
    assert.equal(typeof json.data.saved, 'boolean');
    assert.ok(typeof json.data.messageCount === 'number');
  });

  it('POST /api/memory/snapshot-full 重复调用相同空会话不会产生重复沉淀条目', async () => {
    // 连续两次调用
    await fetch(`${base}/api/memory/snapshot-full`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    const second = await fetch(`${base}/api/memory/snapshot-full`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    const secondJson = (await second.json()) as { code: number; data: { saved: boolean; isDuplicate: boolean; messageCount: number } };
    assert.equal(secondJson.code, 0);
    // 空会话或无新增内容时必须 saved=false，且不得报错
    assert.equal(secondJson.data.saved, false);
    if (secondJson.data.messageCount > 0) {
      assert.equal(secondJson.data.isDuplicate, true);
    }

    // 检查记忆列表中该会话全量沉淀的条目数
    const listRes = await fetch(`${base}/api/memory?workspace=${encodeURIComponent(wsPath)}`);
    const listJson = (await listRes.json()) as { data: { entries: Array<{ content: string }> } };
    const matched = listJson.data.entries.filter(e => e.content.includes('会话全量沉淀'));
    assert.ok(matched.length <= 1, '全量会话沉淀重复调用不允许产生堆积条目');
  });
});
