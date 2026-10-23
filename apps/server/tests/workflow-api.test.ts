import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HarnessServer } from '../src/index.ts';

describe('TC-03-01-003: 工作流定义 REST API 测试 (WBS-03-01-02)', () => {
  let tmpDir: string;
  let server: HarnessServer;
  const testPort = 3336;
  const base = `http://127.0.0.1:${testPort}`;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-wf-api-test-'));
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

  it('GET /api/workflows 应返回工作流列表（至少包含预置模板）', async () => {
    const res = await fetch(`${base}/api/workflows`);
    assert.equal(res.status, 200);
    const json = (await res.json()) as { code: number; data: unknown[] };
    assert.equal(json.code, 0);
    assert.ok(Array.isArray(json.data));
    assert.ok(json.data.length >= 1);
  });

  it('POST /api/workflows 应校验必要字段并成功创建工作流', async () => {
    // 缺失名称
    const badRes = await fetch(`${base}/api/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bpmnXml: '<bpmn/>' }),
    });
    assert.equal(badRes.status, 400);

    // 成功创建
    const goodRes = await fetch(`${base}/api/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '测试自定义协作流',
        description: '描述信息',
        bpmnXml: `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Def_Custom">
  <bpmn:process id="Proc_1">
    <bpmn:startEvent id="S1" />
    <bpmn:task id="T1" name="编码任务" />
    <bpmn:endEvent id="E1" />
  </bpmn:process>
</bpmn:definitions>`,
      }),
    });

    assert.equal(goodRes.status, 200);
    const goodJson = (await goodRes.json()) as { code: number; data: { id: string; name: string; nodeCount: number } };
    assert.equal(goodJson.code, 0);
    assert.ok(goodJson.data.id);
    assert.equal(goodJson.data.name, '测试自定义协作流');
    assert.equal(goodJson.data.nodeCount, 3);

    const wfId = goodJson.data.id;
    // 单条读取
    const getRes = await fetch(`${base}/api/workflows/${wfId}`);
    assert.equal(getRes.status, 200);
    const getJson = (await getRes.json()) as { code: number; data: { name: string } };
    assert.equal(getJson.data.name, '测试自定义协作流');

    // 更新
    const updateRes = await fetch(`${base}/api/workflows/${wfId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '更新后协作流',
        description: '新描述',
      }),
    });
    assert.equal(updateRes.status, 200);
    const updateJson = (await updateRes.json()) as { code: number; data: { name: string; version: number } };
    assert.equal(updateJson.data.name, '更新后协作流');
    assert.equal(updateJson.data.version, 2);

    // 删除
    const delRes = await fetch(`${base}/api/workflows/${wfId}`, {
      method: 'DELETE',
    });
    assert.equal(delRes.status, 200);

    const getAfterDel = await fetch(`${base}/api/workflows/${wfId}`);
    assert.equal(getAfterDel.status, 404);
  });
});
