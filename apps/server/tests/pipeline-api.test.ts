import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HarnessServer } from '../src/index.ts';

describe('TC-02-01-003: 流水线服务端 REST 与运行调度 API 集成 (WBS-02-01 ~ WBS-02-04)', () => {
  let tmpDir: string;
  let server: HarnessServer;
  const testPort = 3325;
  const base = `http://127.0.0.1:${testPort}`;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-pipeline-api-'));
    server = new HarnessServer({ port: testPort, dataDir: path.join(tmpDir, 'data') });
    await server.start();
  });

  after(async () => {
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('1. GET /api/pipelines：自动初始化并返回内置标准研发泳道模板', async () => {
    const res = await fetch(`${base}/api/pipelines`);
    assert.equal(res.status, 200);
    const json = (await res.json()) as { code: number; data: Array<{ id: string; name: string; stages: Array<{ roleName: string }> }> };
    assert.equal(json.code, 0);
    assert.ok(json.data.length >= 1);
    const std = json.data.find((p) => p.id === 'pipeline_std_rd');
    assert.ok(std, '必须包含内置标准研发流水线模板');
    assert.equal(std!.stages.length, 4, '标准流水线必须具备 4 个阶段');
  });

  it('2. POST /api/pipelines：创建自定义流水线模板', async () => {
    const res = await fetch(`${base}/api/pipelines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'pl_custom_test',
        name: '轻量修复流水线',
        description: '复现定位 -> 修复与验证',
        stages: [
          {
            id: 'st_repro',
            roleName: '复现工程师',
            promptTemplate: '编写最小复现测试',
            toolsAllowed: ['read_file', 'write_file', 'bash'],
            artifactPaths: ['tests/**'],
            gatekeeperRequired: true,
          },
          {
            id: 'st_fix',
            roleName: '修复工程师',
            promptTemplate: '修复缺陷使其绿灯',
            toolsAllowed: ['read_file', 'edit_file', 'bash'],
            artifactPaths: [],
            gatekeeperRequired: false,
          },
        ],
      }),
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { code: number; data: { id: string; stages: Array<{ order: number }> } };
    assert.equal(json.code, 0);
    assert.equal(json.data.id, 'pl_custom_test');
    assert.deepEqual(json.data.stages.map((s) => s.order), [1, 2]);
  });

  it('3. POST /api/pipelines/:id/stages/insert：双向插入定制阶段（步骤在指定位置后插入）', async () => {
    const res = await fetch(`${base}/api/pipelines/pl_custom_test/stages/insert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        afterStageId: 'st_repro',
        stage: {
          id: 'st_review',
          roleName: '复现审阅员',
          promptTemplate: '人工核查复现用例真实性',
          toolsAllowed: ['read_file'],
          artifactPaths: [],
          gatekeeperRequired: true,
        },
      }),
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { code: number; data: { stages: Array<{ id: string; order: number }> } };
    assert.equal(json.code, 0);
    assert.equal(json.data.stages.length, 3);
    assert.deepEqual(json.data.stages.map((s) => s.id), ['st_repro', 'st_review', 'st_fix']);
    assert.deepEqual(json.data.stages.map((s) => s.order), [1, 2, 3]);
  });

  it('4. POST /api/pipeline-instances/start：启动流水线任务实例并进入初始阶段', async () => {
    // 登记物理工作区
    const ws = path.join(tmpDir, 'ws_pipe');
    fs.mkdirSync(ws, { recursive: true });
    fs.writeFileSync(path.join(ws, 'app.ts'), 'export const a = 1;\n');

    const startRes = await fetch(`${base}/api/pipeline-instances/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pipelineId: 'pipeline_std_rd',
        workspacePath: ws,
        taskPrompt: '重构认证模块并编写测试用例',
      }),
    });
    assert.equal(startRes.status, 200);
    const startJson = (await startRes.json()) as { code: number; data: { instanceId: string; status: string; currentStageId: string } };
    assert.equal(startJson.code, 0);
    assert.ok(startJson.data.instanceId.startsWith('inst_'));
    const instId = startJson.data.instanceId;

    // 实例列表可查
    const listRes = await fetch(`${base}/api/pipeline-instances`);
    const listJson = (await listRes.json()) as { code: number; data: Array<{ instanceId: string; currentStageId: string }> };
    assert.ok(listJson.data.some((inst) => inst.instanceId === instId));

    // Gatekeeper 决策接口：可查询或裁决
    const gateRes = await fetch(`${base}/api/pipeline-instances/${instId}/gate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    });
    assert.equal(gateRes.status, 200);
    const gateJson = (await gateRes.json()) as { code: number };
    assert.equal(gateJson.code, 0);
  });
});
