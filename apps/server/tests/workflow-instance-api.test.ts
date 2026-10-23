import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HarnessServer } from '../src/index.ts';

describe('TC-03-03-003: BPMN 工作流运行实例持久化与监控大屏 (WBS-03-03-03 / WBS-03-03-04)', () => {
  let tmpDir: string;
  let server: HarnessServer;
  const testPort = 3346;
  const base = `http://127.0.0.1:${testPort}`;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-wf-inst-test-'));
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

  it('POST /api/workflows/:id/run 执行后自动持久化生成 workflow_instance，并可通过列表与详情查询', async () => {
    const runRes = await fetch(`${base}/api/workflows/wf_std_feature_dev/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variables: { env: 'staging' } }),
    });
    assert.equal(runRes.status, 200);
    const runJson = (await runRes.json()) as {
      code: number;
      data: { instanceId: string; status: string; completedNodes: string[] };
    };
    assert.equal(runJson.code, 0);
    assert.ok(runJson.data.instanceId, '必须返回持久化后的 instanceId');
    const instanceId = runJson.data.instanceId;

    // 1. 查询工作流实例列表 GET /api/workflow-instances
    const listRes = await fetch(`${base}/api/workflow-instances`);
    assert.equal(listRes.status, 200);
    const listJson = (await listRes.json()) as {
      code: number;
      data: Array<{ instanceId: string; workflowId: string; status: string }>;
    };
    assert.equal(listJson.code, 0);
    assert.ok(listJson.data.some((i) => i.instanceId === instanceId), '实例列表必须包含刚运行的实例');

    // 2. 查询单个实例详情 GET /api/workflow-instances/:id
    const detailRes = await fetch(`${base}/api/workflow-instances/${encodeURIComponent(instanceId)}`);
    assert.equal(detailRes.status, 200);
    const detailJson = (await detailRes.json()) as {
      code: number;
      data: { instanceId: string; workflowName: string; variables: Record<string, unknown>; executionLog: unknown[] };
    };
    assert.equal(detailJson.code, 0);
    assert.equal(detailJson.data.instanceId, instanceId);
    assert.equal(detailJson.data.variables.env, 'staging');
    assert.ok(detailJson.data.executionLog.length >= 3);

    // 3. 删除实例 DELETE /api/workflow-instances/:id
    const delRes = await fetch(`${base}/api/workflow-instances/${encodeURIComponent(instanceId)}`, {
      method: 'DELETE',
    });
    assert.equal(delRes.status, 200);

    const afterDelRes = await fetch(`${base}/api/workflow-instances/${encodeURIComponent(instanceId)}`);
    assert.equal(afterDelRes.status, 404);
  });

  it('GET /run-workflow.html 与 /run-workflow-detail.html 正常静态托管并包含核心容器', async () => {
    const listRes = await fetch(`${base}/run-workflow.html`);
    assert.equal(listRes.status, 200);
    const listHtml = await listRes.text();
    assert.ok(listHtml.includes('BPMN 业务工作流实例列表'), '必须包含实例大屏标题');
    assert.ok(listHtml.includes('id="instances-tbody"'), '必须包含实例表格容器');

    const detailRes = await fetch(`${base}/run-workflow-detail.html`);
    assert.equal(detailRes.status, 200);
    const detailHtml = await detailRes.text();
    assert.ok(detailHtml.includes('BPMN 工作流运行实例监控'), '必须包含监控大屏标题');
    assert.ok(detailHtml.includes('id="monitor-svg"'), '必须包含拓扑SVG视窗');
    assert.ok(detailHtml.includes('id="execution-logs-list"'), '必须包含执行日志容器');
  });
});
