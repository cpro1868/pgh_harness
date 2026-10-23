import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { HarnessServer } from '../src/index.ts';

function startWorkflowLlm(): Promise<{ server: http.Server; port: number; calls: { count: number; systems: string[] } }> {
  return new Promise((resolve) => {
    const calls = { count: 0, systems: [] as string[] };
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/chat/completions') {
        res.writeHead(404);
        res.end('{}');
        return;
      }
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        calls.count += 1;
        const parsed = JSON.parse(raw) as { messages?: Array<{ role?: string; content?: string }> };
        const messages = parsed.messages ?? [];
        const system = messages.find((m) => m.role === 'system')?.content ?? '';
        calls.systems.push(system);
        const hasToolResult = messages.some((m) => m.role === 'tool');

        const role = ['重试审计', '需求分析', '设计实现', '质量审计', '发布上线', '退回整改'].find((r) => system.includes(r)) ?? 'unknown';
        const fileByRole: Record<string, string> = {
          '重试审计': 'docs/retry.md',
          '需求分析': 'docs/analysis.md',
          '设计实现': 'docs/design.md',
          '质量审计': 'docs/audit.md',
          '发布上线': 'docs/release.md',
          '退回整改': 'docs/rework.md',
        };
        const toolCalls = hasToolResult ? [] : [{ name: 'write_file', args: { path: fileByRole[role] ?? 'docs/unknown.md', content: `# ${role}\n` } }];

        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        if (toolCalls.length > 0) {
          const deltaCalls = toolCalls.map((tc, i) => ({
            index: i,
            id: `call_${calls.count}_${i}`,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          }));
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', tool_calls: deltaCalls } }] })}\n\n`);
          res.write('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n');
        } else {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: `${role} 已完成。` } }] })}\n\n`);
          res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as AddressInfo).port, calls });
    });
  });
}

const workflowXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="Def_RealAcceptance">
  <bpmn:process id="Proc_RealAcceptance" isExecutable="true">
    <bpmn:startEvent id="S1"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="T_Retry" name="重试审计">
      <bpmn:incoming>F1</bpmn:incoming>
      <bpmn:incoming>F_Loop</bpmn:incoming>
      <bpmn:outgoing>F2</bpmn:outgoing>
      <bpmn:extensionElements><camunda:inputOutput><camunda:inputParameter name="model">wf-stub-model</camunda:inputParameter><camunda:inputParameter name="roleName">重试审计</camunda:inputParameter></camunda:inputOutput></bpmn:extensionElements>
    </bpmn:task>
    <bpmn:exclusiveGateway id="GW_Loop">
      <bpmn:incoming>F2</bpmn:incoming>
      <bpmn:outgoing>F_Loop</bpmn:outgoing>
      <bpmn:outgoing>F3</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:parallelGateway id="GW_Fork">
      <bpmn:incoming>F3</bpmn:incoming>
      <bpmn:outgoing>F_Design</bpmn:outgoing>
      <bpmn:outgoing>F_Audit</bpmn:outgoing>
    </bpmn:parallelGateway>
    <bpmn:task id="T_Design" name="设计实现">
      <bpmn:incoming>F_Design</bpmn:incoming>
      <bpmn:outgoing>F_DesignDone</bpmn:outgoing>
      <bpmn:extensionElements><camunda:inputOutput><camunda:inputParameter name="model">wf-stub-model</camunda:inputParameter><camunda:inputParameter name="roleName">设计实现</camunda:inputParameter></camunda:inputOutput></bpmn:extensionElements>
    </bpmn:task>
    <bpmn:task id="T_Audit" name="质量审计">
      <bpmn:incoming>F_Audit</bpmn:incoming>
      <bpmn:outgoing>F_AuditDone</bpmn:outgoing>
      <bpmn:extensionElements><camunda:inputOutput><camunda:inputParameter name="model">wf-stub-model</camunda:inputParameter><camunda:inputParameter name="roleName">质量审计</camunda:inputParameter></camunda:inputOutput></bpmn:extensionElements>
    </bpmn:task>
    <bpmn:parallelGateway id="GW_Join">
      <bpmn:incoming>F_DesignDone</bpmn:incoming>
      <bpmn:incoming>F_AuditDone</bpmn:incoming>
      <bpmn:outgoing>F4</bpmn:outgoing>
    </bpmn:parallelGateway>
    <bpmn:userTask id="UT_Gate" name="人工审查门">
      <bpmn:incoming>F4</bpmn:incoming>
      <bpmn:outgoing>F5</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:exclusiveGateway id="GW_Result">
      <bpmn:incoming>F5</bpmn:incoming>
      <bpmn:outgoing>F_Ship</bpmn:outgoing>
      <bpmn:outgoing>F_Reject</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:task id="T_Ship" name="发布上线">
      <bpmn:incoming>F_Ship</bpmn:incoming>
      <bpmn:outgoing>F_ShipEnd</bpmn:outgoing>
      <bpmn:extensionElements><camunda:inputOutput><camunda:inputParameter name="model">wf-stub-model</camunda:inputParameter><camunda:inputParameter name="roleName">发布上线</camunda:inputParameter></camunda:inputOutput></bpmn:extensionElements>
    </bpmn:task>
    <bpmn:task id="T_Reject" name="退回整改">
      <bpmn:incoming>F_Reject</bpmn:incoming>
      <bpmn:outgoing>F_RejectEnd</bpmn:outgoing>
      <bpmn:extensionElements><camunda:inputOutput><camunda:inputParameter name="model">wf-stub-model</camunda:inputParameter><camunda:inputParameter name="roleName">退回整改</camunda:inputParameter></camunda:inputOutput></bpmn:extensionElements>
    </bpmn:task>
    <bpmn:endEvent id="E1"><bpmn:incoming>F_ShipEnd</bpmn:incoming></bpmn:endEvent>
    <bpmn:endEvent id="E2"><bpmn:incoming>F_RejectEnd</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="S1" targetRef="T_Retry" />
    <bpmn:sequenceFlow id="F2" sourceRef="T_Retry" targetRef="GW_Loop" />
    <bpmn:sequenceFlow id="F_Loop" sourceRef="GW_Loop" targetRef="T_Retry">
      <bpmn:conditionExpression>\${T_Retry_runs &lt; 2}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="F3" sourceRef="GW_Loop" targetRef="GW_Fork">
      <bpmn:conditionExpression>\${T_Retry_runs &gt;= 2}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="F_Design" sourceRef="GW_Fork" targetRef="T_Design" />
    <bpmn:sequenceFlow id="F_Audit" sourceRef="GW_Fork" targetRef="T_Audit" />
    <bpmn:sequenceFlow id="F_DesignDone" sourceRef="T_Design" targetRef="GW_Join" />
    <bpmn:sequenceFlow id="F_AuditDone" sourceRef="T_Audit" targetRef="GW_Join" />
    <bpmn:sequenceFlow id="F4" sourceRef="GW_Join" targetRef="UT_Gate" />
    <bpmn:sequenceFlow id="F5" sourceRef="UT_Gate" targetRef="GW_Result" />
    <bpmn:sequenceFlow id="F_Ship" sourceRef="GW_Result" targetRef="T_Ship">
      <bpmn:conditionExpression>\${approved == true}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="F_Reject" sourceRef="GW_Result" targetRef="T_Reject">
      <bpmn:conditionExpression>\${approved == false}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="F_ShipEnd" sourceRef="T_Ship" targetRef="E1" />
    <bpmn:sequenceFlow id="F_RejectEnd" sourceRef="T_Reject" targetRef="E2" />
  </bpmn:process>
</bpmn:definitions>`;

describe('TC-03-03-006: BPMN 执行日志审计字段与 XOR/AND/循环/人工审查全链路', () => {
  let tmpDir: string;
  let ws: string;
  let server: HarnessServer;
  let stub: { server: http.Server; port: number; calls: { count: number; systems: string[] } };
  const testPort = 3354;
  const base = `http://127.0.0.1:${testPort}`;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-wf-audit-'));
    ws = path.join(tmpDir, 'acceptance-proj');
    fs.mkdirSync(ws, { recursive: true });
    stub = await startWorkflowLlm();
    server = new HarnessServer({ port: testPort, dataDir: path.join(tmpDir, 'data') });
    await server.start();

    const provRes = await fetch(`${base}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'wf-stub-provider',
        name: 'Workflow Stub',
        protocol: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${stub.port}`,
        apiKey: 'sk-live-key-for-wf-audit',
        models: [{ id: 'wf-stub-model', name: 'wf-stub-model', contextWindow: 65536 }],
      }),
    });
    assert.equal(provRes.status, 200);
  });

  after(async () => {
    await server.stop();
    stub.server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('run → waiting：循环恰好两次、AND 双分支均执行、日志携带 model/stepsUsed/toolCalls/stoppedReason', async () => {
    const createRes = await fetch(`${base}/api/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '真实验收BPMN', description: 'XOR/AND/循环/人工审查', bpmnXml: workflowXml }),
    });
    assert.equal(createRes.status, 200);
    const created = (await createRes.json()) as { data: { id: string } };

    const runRes = await fetch(`${base}/api/workflows/${created.data.id}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspacePath: ws, variables: { score: 95 } }),
    });
    assert.equal(runRes.status, 200);
    const runJson = (await runRes.json()) as {
      data: {
        instanceId: string;
        status: string;
        activeNodes: string[];
        completedNodes: string[];
        variables: Record<string, unknown>;
        executionLog: Array<{
          nodeId: string;
          output?: string;
          model?: string;
          stepsUsed?: number;
          stoppedReason?: string;
          toolCalls?: Array<{ name: string; ok: boolean; output?: string; args?: Record<string, unknown> }>;
        }>;
      };
    };
    const inst = runJson.data;
    assert.equal(inst.status, 'waiting', '必须挂起在人工审查门');
    assert.deepEqual(inst.activeNodes, ['UT_Gate']);
    assert.equal(inst.variables.T_Retry_runs, 2, '循环必须真实执行两次后退出');

    const logIds = inst.executionLog.map((l) => l.nodeId);
    assert.deepEqual(logIds.filter((id) => id === 'T_Retry'), ['T_Retry', 'T_Retry'], '重试任务必须记录两次真实执行');
    assert.ok(logIds.includes('T_Design') && logIds.includes('T_Audit'), 'AND 并行双分支都必须执行');
    assert.ok(!inst.executionLog.some((l) => l.nodeId === 'T_Ship'), '放行前不得越权执行发布');

    const designLog = inst.executionLog.find((l) => l.nodeId === 'T_Design');
    assert.ok(designLog, '设计任务必须有执行日志');
    assert.equal(designLog.model, 'wf-stub-model', '执行日志必须记录真实模型 ID');
    assert.ok((designLog.stepsUsed ?? 0) >= 2, '两步 ReAct（工具调用 + 收尾）必须计入 stepsUsed');
    assert.equal(designLog.stoppedReason, 'completed');
    assert.ok(designLog.toolCalls && designLog.toolCalls.length === 1, '必须记录真实工具调用');
    assert.equal(designLog.toolCalls[0].name, 'write_file');
    assert.equal(designLog.toolCalls[0].ok, true);
    assert.equal(designLog.toolCalls[0].args?.path, 'docs/design.md');
    assert.ok(designLog.output?.includes('设计实现 已完成'), '必须记录节点最终产出内容');

    assert.ok(fs.existsSync(path.join(ws, 'docs', 'design.md')), 'AND 分支产物必须真实落盘');
    assert.ok(fs.existsSync(path.join(ws, 'docs', 'audit.md')), 'AND 分支产物必须真实落盘');
    assert.ok(fs.existsSync(path.join(ws, 'docs', 'retry.md')), '循环任务产物必须真实落盘');

    const detail = (await (await fetch(`${base}/api/workflow-instances/${inst.instanceId}`)).json()) as {
      data: { executionLog: typeof inst.executionLog };
    };
    assert.deepEqual(detail.data.executionLog, inst.executionLog, '持久化日志必须与运行返回一致');
  });

  it('审批放行 approved=true：XOR 走上线分支，跨 resume 日志仍保留审计字段', async () => {
    const createRes = await fetch(`${base}/api/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '真实验收BPMN-放行', bpmnXml: workflowXml }),
    });
    const created = (await createRes.json()) as { data: { id: string } };
    const runJson = (await (await fetch(`${base}/api/workflows/${created.data.id}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspacePath: ws, variables: { score: 95 } }),
    })).json()) as { data: { instanceId: string; status: string } };
    assert.equal(runJson.data.status, 'waiting');

    const approveRes = await fetch(`${base}/api/workflow-instances/${runJson.data.instanceId}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approve', variables: { approved: true } }),
    });
    assert.equal(approveRes.status, 200);
    const done = (await approveRes.json()) as {
      data: {
        status: string;
        variables: Record<string, unknown>;
        executionLog: Array<{ nodeId: string; name: string; model?: string; stoppedReason?: string; toolCalls?: unknown[] }>;
      };
    };
    assert.equal(done.data.status, 'completed');
    assert.ok(done.data.executionLog.some((l) => l.nodeId === 'T_Ship'), 'approved=true 必须走上线分支');
    assert.ok(!done.data.executionLog.some((l) => l.nodeId === 'T_Reject'), '严禁同时执行退回分支');
    const decisionLog = done.data.executionLog.find((l) => l.name.startsWith('人工裁决'));
    assert.equal(decisionLog?.nodeId, 'UT_Gate', '裁决日志必须锚定真实审查节点，不得退化为占位 UserTask');
    const shipLog = done.data.executionLog.find((l) => l.nodeId === 'T_Ship');
    assert.equal(shipLog?.model, 'wf-stub-model');
    assert.equal(shipLog?.stoppedReason, 'completed');
    assert.ok(Array.isArray(shipLog?.toolCalls) && shipLog.toolCalls.length === 1);
    assert.ok(fs.existsSync(path.join(ws, 'docs', 'release.md')));
  });

  it('审批放行 approved=false：XOR 走退回分支，另一分支绝不执行', async () => {
    const createRes = await fetch(`${base}/api/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '真实验收BPMN-退回', bpmnXml: workflowXml }),
    });
    const created = (await createRes.json()) as { data: { id: string } };
    const runJson = (await (await fetch(`${base}/api/workflows/${created.data.id}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspacePath: ws, variables: { score: 95 } }),
    })).json()) as { data: { instanceId: string; status: string } };

    const approveRes = await fetch(`${base}/api/workflow-instances/${runJson.data.instanceId}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approve', variables: { approved: false } }),
    });
    const done = (await approveRes.json()) as { data: { status: string; executionLog: Array<{ nodeId: string }> } };
    assert.equal(done.data.status, 'completed');
    assert.ok(done.data.executionLog.some((l) => l.nodeId === 'T_Reject'), 'approved=false 必须走退回分支');
    assert.ok(!done.data.executionLog.some((l) => l.nodeId === 'T_Ship'), 'approved=false 不得上线');
    assert.ok(fs.existsSync(path.join(ws, 'docs', 'rework.md')));
  });

  it('人工驳回 decision=reject：必须真实走退回分支并落盘返工产物（D86 真机验收缺陷回归）', async () => {
    const createRes = await fetch(`${base}/api/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '真实验收BPMN-人工驳回', bpmnXml: workflowXml }),
    });
    const created = (await createRes.json()) as { data: { id: string } };
    const runJson = (await (await fetch(`${base}/api/workflows/${created.data.id}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspacePath: ws, variables: { score: 95 } }),
    })).json()) as { data: { instanceId: string; status: string } };
    assert.equal(runJson.data.status, 'waiting');

    const rejectRes = await fetch(`${base}/api/workflow-instances/${runJson.data.instanceId}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'reject', reason: '审查未通过：边界处理缺失', variables: { approved: false } }),
    });
    assert.equal(rejectRes.status, 200);
    const done = (await rejectRes.json()) as {
      data: {
        status: string;
        error?: string;
        variables: Record<string, unknown>;
        executionLog: Array<{ nodeId: string; name: string; model?: string }>;
      };
    };
    assert.equal(done.data.status, 'completed', `驳回后必须推进至返工分支直至完成，实际 status=${done.data.status} error=${done.data.error ?? ''}`);
    assert.ok(done.data.executionLog.some((l) => l.nodeId === 'T_Reject'), '人工驳回必须真实执行退回整改节点');
    assert.ok(!done.data.executionLog.some((l) => l.nodeId === 'T_Ship'), '人工驳回严禁进入放行分支');
    assert.ok(String(done.data.variables.__rejectionReason ?? '').includes('审查未通过'), '驳回原因必须写入变量总线');
    assert.ok(fs.existsSync(path.join(ws, 'docs', 'rework.md')), '退回分支产物必须真实落盘');
    const rejectLog = done.data.executionLog.find((l) => l.nodeId === 'T_Reject');
    assert.equal(rejectLog?.model, 'wf-stub-model', '退回分支执行日志必须带模型审计字段');
  });
});
