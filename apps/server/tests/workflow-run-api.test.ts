import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HarnessServer } from '../src/index.ts';

describe('TC-03-03-002: BPMN 工作流试运行接口与端到端链路 (WBS-03-03-02)', () => {
  let tmpDir: string;
  let server: HarnessServer;
  const testPort = 3340;
  const base = `http://127.0.0.1:${testPort}`;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-wf-run-test-'));
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

  it('POST /api/workflows/:id/run 执行内置默认推荐流程，返回执行轨迹与 completed 状态', async () => {
    const res = await fetch(`${base}/api/workflows/wf_std_feature_dev/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        variables: {},
      }),
    });

    assert.equal(res.status, 200);
    const json = (await res.json()) as {
      code: number;
      data: {
        status: string;
        completedNodes: string[];
        executionLog: Array<{ nodeId: string; name: string }>;
      };
    };
    assert.equal(json.code, 0);
    assert.equal(json.data.status, 'completed');
    assert.ok(Array.isArray(json.data.completedNodes));
    assert.ok(json.data.completedNodes.length >= 3, '至少执行了开始、分析、结束等节点');
  });

  it('POST /api/workflows/:id/run 在传入自定义变量时，走条件分支正确分流', async () => {
    // 1. 创建带有 XOR 分支的工作流
    const createRes = await fetch(`${base}/api/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '分支测试工作流',
        description: '测试分流判定',
        bpmnXml: `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Def_Branch">
  <bpmn:process id="Proc_Branch" isExecutable="true">
    <bpmn:startEvent id="S1"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:exclusiveGateway id="GW1">
      <bpmn:incoming>F1</bpmn:incoming>
      <bpmn:outgoing>F_Pass</bpmn:outgoing>
      <bpmn:outgoing>F_Fail</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:task id="T_Pass" name="通过任务"><bpmn:incoming>F_Pass</bpmn:incoming><bpmn:outgoing>F_End1</bpmn:outgoing></bpmn:task>
    <bpmn:task id="T_Fail" name="未通过任务"><bpmn:incoming>F_Fail</bpmn:incoming><bpmn:outgoing>F_End2</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="E1"><bpmn:incoming>F_End1</bpmn:incoming></bpmn:endEvent>
    <bpmn:endEvent id="E2"><bpmn:incoming>F_End2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="S1" targetRef="GW1" />
    <bpmn:sequenceFlow id="F_Pass" sourceRef="GW1" targetRef="T_Pass">
      <bpmn:conditionExpression>\${score &gt;= 80}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="F_Fail" sourceRef="GW1" targetRef="T_Fail">
      <bpmn:conditionExpression>\${score &lt; 80}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="F_End1" sourceRef="T_Pass" targetRef="E1" />
    <bpmn:sequenceFlow id="F_End2" sourceRef="T_Fail" targetRef="E2" />
  </bpmn:process>
</bpmn:definitions>`,
      }),
    });
    assert.equal(createRes.status, 200);
    const created = (await createRes.json()) as { data: { id: string } };
    const wfId = created.data.id;

    // 2. 运行并注入 score = 95
    const runRes = await fetch(`${base}/api/workflows/${wfId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variables: { score: 95 } }),
    });
    assert.equal(runRes.status, 200);
    const runJson = (await runRes.json()) as { data: { status: string; completedNodes: string[] } };
    assert.equal(runJson.data.status, 'completed');
    assert.ok(runJson.data.completedNodes.includes('T_Pass'));
    assert.ok(!runJson.data.completedNodes.includes('T_Fail'));
  });

  it('POST /api/workflows/:id/run 对不存在的 workflow 返回 404', async () => {
    const res = await fetch(`${base}/api/workflows/wf_non_exist/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variables: {} }),
    });
    assert.equal(res.status, 404);
  });

  it('BPMN 流程遇到 UserTask 时挂起为 waiting，经 POST /decide 放行后推进至 completed', async () => {
    // 1. 创建包含 UserTask 人工审查节点的 BPMN 流程
    const createRes = await fetch(`${base}/api/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '人工审批流程测试',
        description: '测试 UserTask 审查门',
        bpmnXml: `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Def_ApprovalTest">
  <bpmn:process id="Proc_ApprovalTest" isExecutable="true">
    <bpmn:startEvent id="S1"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="T_Dev" name="开发任务"><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing></bpmn:task>
    <bpmn:userTask id="UT_Gate" name="人工审查门"><bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing></bpmn:userTask>
    <bpmn:task id="T_Deploy" name="发布任务"><bpmn:incoming>F3</bpmn:incoming><bpmn:outgoing>F4</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="E1"><bpmn:incoming>F4</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="S1" targetRef="T_Dev" />
    <bpmn:sequenceFlow id="F2" sourceRef="T_Dev" targetRef="UT_Gate" />
    <bpmn:sequenceFlow id="F3" sourceRef="UT_Gate" targetRef="T_Deploy" />
    <bpmn:sequenceFlow id="F4" sourceRef="T_Deploy" targetRef="E1" />
  </bpmn:process>
</bpmn:definitions>`,
      }),
    });
    assert.equal(createRes.status, 200);
    const created = (await createRes.json()) as { data: { id: string } };
    const wfId = created.data.id;

    // 2. 启动该流程，预期遇到 UserTask 立即挂起为 waiting
    const runRes = await fetch(`${base}/api/workflows/${wfId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variables: {} }),
    });
    assert.equal(runRes.status, 200);
    const runJson = (await runRes.json()) as {
      data: { instanceId: string; status: string; activeNodes: string[]; completedNodes: string[] };
    };
    assert.equal(runJson.data.status, 'waiting', '必须挂起为 waiting 状态');
    assert.deepEqual(runJson.data.activeNodes, ['UT_Gate'], '当前活跃节点必须停留在人工审批门');
    assert.ok(runJson.data.completedNodes.includes('T_Dev'));
    assert.ok(!runJson.data.completedNodes.includes('T_Deploy'), '严禁在人工放行前越权执行下游发布');

    const instId = runJson.data.instanceId;

    // 3. 模拟人类操作者进行驳回 (reject) 尝试
    const rejectRes = await fetch(`${base}/api/workflow-instances/${instId}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decision: 'reject',
        reason: '代码质量不合格，打回重写',
      }),
    });
    assert.equal(rejectRes.status, 200);
    const rejectJson = (await rejectRes.json()) as { data: { status: string } };
    assert.equal(rejectJson.data.status, 'waiting', '驳回后流程仍保持挂起');

    // 4. 模拟人类操作者审查满意并确认放行 (approve)
    const approveRes = await fetch(`${base}/api/workflow-instances/${instId}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decision: 'approve',
        variables: { reviewerApproved: true },
      }),
    });
    assert.equal(approveRes.status, 200);
    const approveJson = (await approveRes.json()) as {
      data: { status: string; completedNodes: string[]; variables: Record<string, unknown> };
    };
    assert.equal(approveJson.data.status, 'completed', '放行后流程必须顺畅推进至完成');
    assert.ok(approveJson.data.completedNodes.includes('T_Deploy'), '下游发布任务已顺利执行');
    assert.equal(approveJson.data.variables.reviewerApproved, true, '审查注入的上下文变量已成功同步');
  });
});
