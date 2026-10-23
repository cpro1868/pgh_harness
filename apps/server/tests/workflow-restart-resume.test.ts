import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HarnessServer } from '../src/index.ts';

describe('TC-03-03-005: BPMN 人工审查重启断点续接 (hydrate + decide 兜底)', () => {
  let tmpDir: string;
  let dataDir: string;
  let server: HarnessServer;
  const testPort = 3352;
  const base = `http://127.0.0.1:${testPort}`;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-wf-restart-'));
    dataDir = path.join(tmpDir, 'data');
    server = new HarnessServer({ port: testPort, dataDir });
    await server.start();
  });

  after(async () => {
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  async function restartServer(): Promise<void> {
    await server.stop();
    server = new HarnessServer({ port: testPort, dataDir });
    await server.start();
    // 连接池中残留的旧 socket 已随进程重建失效，轮询健康探针直到新连接建立
    let lastErr: unknown;
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch(`${base}/api/health`);
        if (res.ok) return;
      } catch (err) {
        lastErr = err;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw lastErr instanceof Error ? lastErr : new Error('重启后健康探测失败');
  }

  it('服务重启后 POST /decide approve 必须从持久化快照续接，绝不重放已完成节点', async () => {
    const createRes = await fetch(`${base}/api/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '重启续接审查流',
        description: '测试重启后断点续接',
        bpmnXml: `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Def_Restart">
  <bpmn:process id="Proc_Restart" isExecutable="true">
    <bpmn:startEvent id="Start_1"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_Build" name="上游构建任务"><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing></bpmn:task>
    <bpmn:userTask id="UT_Gate" name="人工审查门"><bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing></bpmn:userTask>
    <bpmn:task id="Task_Deploy" name="下游发布任务"><bpmn:incoming>F3</bpmn:incoming><bpmn:outgoing>F4</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="End_1"><bpmn:incoming>F4</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start_1" targetRef="Task_Build" />
    <bpmn:sequenceFlow id="F2" sourceRef="Task_Build" targetRef="UT_Gate" />
    <bpmn:sequenceFlow id="F3" sourceRef="UT_Gate" targetRef="Task_Deploy" />
    <bpmn:sequenceFlow id="F4" sourceRef="Task_Deploy" targetRef="End_1" />
  </bpmn:process>
</bpmn:definitions>`,
      }),
    });
    assert.equal(createRes.status, 200);
    const created = (await createRes.json()) as { data: { id: string } };
    const wfId = created.data.id;

    const runRes = await fetch(`${base}/api/workflows/${wfId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variables: { buildVersion: 'v1.2.3' } }),
    });
    assert.equal(runRes.status, 200);
    const runJson = (await runRes.json()) as {
      data: { instanceId: string; status: string; executionLog: Array<{ nodeId: string }> };
    };
    assert.equal(runJson.data.status, 'waiting');
    const instId = runJson.data.instanceId;
    const buildEntriesBefore = runJson.data.executionLog.filter((e) => e.nodeId === 'Task_Build').length;
    assert.equal(buildEntriesBefore, 1, '重启前上游构建任务只应执行一次');

    // 模拟服务进程重启：释放实例锁并重建全新进程内运行时
    await restartServer();

    const detailAfterRestart = await fetch(`${base}/api/workflow-instances/${encodeURIComponent(instId)}`);
    assert.equal(detailAfterRestart.status, 200);
    const detailJson = (await detailAfterRestart.json()) as {
      data: { status: string; activeNodes: string[]; completedNodes: string[]; variables: Record<string, unknown> };
    };
    assert.equal(detailJson.data.status, 'waiting', '重启后实例必须仍处于人工审查挂起态');
    assert.deepEqual(detailJson.data.activeNodes, ['UT_Gate'], '重启后人工审查锚点必须保留');
    assert.ok(detailJson.data.completedNodes.includes('Task_Build'), '重启后已完成节点必须保留');
    assert.equal(detailJson.data.variables.buildVersion, 'v1.2.3', '重启后变量总线必须持久化恢复');

    const approveRes = await fetch(`${base}/api/workflow-instances/${encodeURIComponent(instId)}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approve', variables: { reviewer: '张三' } }),
    });
    assert.equal(approveRes.status, 200);
    const approveJson = (await approveRes.json()) as {
      code: number;
      message: string;
      data: { status: string; completedNodes: string[]; variables: Record<string, unknown>; executionLog: Array<{ nodeId: string }> };
    };
    assert.equal(approveJson.code, 0);
    assert.equal(approveJson.data.status, 'completed', '重启后放行必须从断点续接推进至完成，而非重新挂起');
    assert.ok(approveJson.data.completedNodes.includes('Task_Deploy'), '下游发布任务必须真实推进');
    assert.equal(approveJson.data.variables.reviewer, '张三', '放行注入变量必须合并');

    const buildEntriesAfter = approveJson.data.executionLog.filter((e) => e.nodeId === 'Task_Build').length;
    assert.equal(buildEntriesAfter, 1, '重启后放行严禁重放已完成的上游构建节点');
    const deployEntries = approveJson.data.executionLog.filter((e) => e.nodeId === 'Task_Deploy').length;
    assert.equal(deployEntries, 1, '下游发布节点必须且只应执行一次');

    const detailFinal = await fetch(`${base}/api/workflow-instances/${encodeURIComponent(instId)}`);
    const finalJson = (await detailFinal.json()) as { data: { status: string } };
    assert.equal(finalJson.data.status, 'completed', '持久化状态必须与内存裁决一致');
  });

  it('重启后 POST /decide reject 必须维持挂起且写入驳回原因，绝不静默放行', async () => {
    const createRes = await fetch(`${base}/api/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '重启驳回审查流',
        description: '测试重启后驳回',
        bpmnXml: `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Def_RestartRej">
  <bpmn:process id="Proc_RestartRej" isExecutable="true">
    <bpmn:startEvent id="Start_1"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="UT_Gate" name="人工审查门"><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing></bpmn:userTask>
    <bpmn:task id="Task_Down" name="下游任务"><bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="End_1"><bpmn:incoming>F3</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start_1" targetRef="UT_Gate" />
    <bpmn:sequenceFlow id="F2" sourceRef="UT_Gate" targetRef="Task_Down" />
    <bpmn:sequenceFlow id="F3" sourceRef="Task_Down" targetRef="End_1" />
  </bpmn:process>
</bpmn:definitions>`,
      }),
    });
    const created = (await createRes.json()) as { data: { id: string } };
    const wfId = created.data.id;

    const runRes = await fetch(`${base}/api/workflows/${wfId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variables: {} }),
    });
    const runJson = (await runRes.json()) as { data: { instanceId: string; status: string } };
    assert.equal(runJson.data.status, 'waiting');
    const instId = runJson.data.instanceId;

    await restartServer();

    const rejectRes = await fetch(`${base}/api/workflow-instances/${encodeURIComponent(instId)}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'reject', reason: '需求不完整，打回补全' }),
    });
    assert.equal(rejectRes.status, 200);
    const rejectJson = (await rejectRes.json()) as {
      data: { status: string; variables: Record<string, unknown>; completedNodes: string[] };
    };
    assert.equal(rejectJson.data.status, 'waiting', '重启后驳回必须维持挂起');
    assert.ok(rejectJson.data.variables.__rejectionReason, '驳回原因必须写入变量总线');
    assert.ok(!rejectJson.data.completedNodes.includes('Task_Down'), '严禁在驳回后推进下游');

    // 驳回后再次放行（同进程内存路径）必须仍然有效
    const approveRes = await fetch(`${base}/api/workflow-instances/${encodeURIComponent(instId)}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    });
    assert.equal(approveRes.status, 200);
    const approveJson = (await approveRes.json()) as { data: { status: string } };
    assert.equal(approveJson.data.status, 'completed', '驳回后重新放行必须推进至完成');
  });
});
