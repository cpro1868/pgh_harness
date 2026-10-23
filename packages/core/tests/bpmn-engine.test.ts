import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseBpmnXml } from '../src/workflow/bpmn-parser.ts';
import { BpmnWorkflowEngine } from '../src/workflow/bpmn-engine.ts';

describe('TC-03-03-001: BPMN 分支路由状态机引擎 (WBS-03-03-01)', () => {
  const linearXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Def_Linear">
  <bpmn:process id="Proc_Linear" isExecutable="true">
    <bpmn:startEvent id="Start_1">
      <bpmn:outgoing>F1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:task id="Task_A" name="阶段A">
      <bpmn:incoming>F1</bpmn:incoming>
      <bpmn:outgoing>F2</bpmn:outgoing>
    </bpmn:task>
    <bpmn:endEvent id="End_1">
      <bpmn:incoming>F2</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start_1" targetRef="Task_A" />
    <bpmn:sequenceFlow id="F2" sourceRef="Task_A" targetRef="End_1" />
  </bpmn:process>
</bpmn:definitions>`;

  const xorXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Def_XOR">
  <bpmn:process id="Proc_XOR" isExecutable="true">
    <bpmn:startEvent id="Start_1">
      <bpmn:outgoing>F1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:task id="Task_Check" name="质量检测">
      <bpmn:incoming>F1</bpmn:incoming>
      <bpmn:outgoing>F2</bpmn:outgoing>
    </bpmn:task>
    <bpmn:exclusiveGateway id="GW_Review" name="审查结果">
      <bpmn:incoming>F2</bpmn:incoming>
      <bpmn:outgoing>Flow_Pass</bpmn:outgoing>
      <bpmn:outgoing>Flow_Reject</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:task id="Task_Ship" name="发布投产">
      <bpmn:incoming>Flow_Pass</bpmn:incoming>
      <bpmn:outgoing>F_End</bpmn:outgoing>
    </bpmn:task>
    <bpmn:task id="Task_Fix" name="修复缺陷">
      <bpmn:incoming>Flow_Reject</bpmn:incoming>
      <bpmn:outgoing>F_Fix_End</bpmn:outgoing>
    </bpmn:task>
    <bpmn:endEvent id="End_Ship">
      <bpmn:incoming>F_End</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:endEvent id="End_Fix">
      <bpmn:incoming>F_Fix_End</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start_1" targetRef="Task_Check" />
    <bpmn:sequenceFlow id="F2" sourceRef="Task_Check" targetRef="GW_Review" />
    <bpmn:sequenceFlow id="Flow_Pass" sourceRef="GW_Review" targetRef="Task_Ship">
      <bpmn:conditionExpression>\${score &gt;= 80}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="Flow_Reject" sourceRef="GW_Review" targetRef="Task_Fix">
      <bpmn:conditionExpression>\${score &lt; 80}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="F_End" sourceRef="Task_Ship" targetRef="End_Ship" />
    <bpmn:sequenceFlow id="F_Fix_End" sourceRef="Task_Fix" targetRef="End_Fix" />
  </bpmn:process>
</bpmn:definitions>`;

  const parallelXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Def_Parallel">
  <bpmn:process id="Proc_Parallel" isExecutable="true">
    <bpmn:startEvent id="Start_1">
      <bpmn:outgoing>F1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:parallelGateway id="GW_Fork">
      <bpmn:incoming>F1</bpmn:incoming>
      <bpmn:outgoing>F_BranchA</bpmn:outgoing>
      <bpmn:outgoing>F_BranchB</bpmn:outgoing>
    </bpmn:parallelGateway>
    <bpmn:task id="Task_A" name="分支任务A">
      <bpmn:incoming>F_BranchA</bpmn:incoming>
      <bpmn:outgoing>F_A_Done</bpmn:outgoing>
    </bpmn:task>
    <bpmn:task id="Task_B" name="分支任务B">
      <bpmn:incoming>F_BranchB</bpmn:incoming>
      <bpmn:outgoing>F_B_Done</bpmn:outgoing>
    </bpmn:task>
    <bpmn:parallelGateway id="GW_Join">
      <bpmn:incoming>F_A_Done</bpmn:incoming>
      <bpmn:incoming>F_B_Done</bpmn:incoming>
      <bpmn:outgoing>F_Joined</bpmn:outgoing>
    </bpmn:parallelGateway>
    <bpmn:endEvent id="End_1">
      <bpmn:incoming>F_Joined</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start_1" targetRef="GW_Fork" />
    <bpmn:sequenceFlow id="F_BranchA" sourceRef="GW_Fork" targetRef="Task_A" />
    <bpmn:sequenceFlow id="F_BranchB" sourceRef="GW_Fork" targetRef="Task_B" />
    <bpmn:sequenceFlow id="F_A_Done" sourceRef="Task_A" targetRef="GW_Join" />
    <bpmn:sequenceFlow id="F_B_Done" sourceRef="Task_B" targetRef="GW_Join" />
    <bpmn:sequenceFlow id="F_Joined" sourceRef="GW_Join" targetRef="End_1" />
  </bpmn:process>
</bpmn:definitions>`;

  it('1. 线性流程流转：Start -> Task -> End 正常推进并结束', async () => {
    const model = parseBpmnXml(linearXml);
    const engine = new BpmnWorkflowEngine(model);

    const executed: string[] = [];
    const state = await engine.execute({
      onNodeExecute: async (node) => {
        executed.push(node.id);
        return { ok: true };
      },
    });

    assert.equal(state.status, 'completed');
    assert.deepEqual(executed, ['Task_A']);
    assert.equal(state.activeNodes.length, 0);
  });

  it('2. 排他网关 (XOR)：根据上下文条件表达式正确分流', async () => {
    const model = parseBpmnXml(xorXml);

    // 分支一：score = 90 -> 命中 Flow_Pass 进入 Task_Ship
    const engine1 = new BpmnWorkflowEngine(model);
    const executed1: string[] = [];
    const state1 = await engine1.execute({
      initialVariables: { score: 90 },
      onNodeExecute: async (node) => {
        executed1.push(node.id);
        return { ok: true };
      },
    });
    assert.equal(state1.status, 'completed');
    assert.deepEqual(executed1, ['Task_Check', 'Task_Ship']);

    // 分支二：score = 60 -> 命中 Flow_Reject 进入 Task_Fix
    const engine2 = new BpmnWorkflowEngine(model);
    const executed2: string[] = [];
    const state2 = await engine2.execute({
      initialVariables: { score: 60 },
      onNodeExecute: async (node) => {
        executed2.push(node.id);
        return { ok: true };
      },
    });
    assert.equal(state2.status, 'completed');
    assert.deepEqual(executed2, ['Task_Check', 'Task_Fix']);
  });

  it('3. 并行网关 (AND)：Fork 分支启动双任务，Join 屏障全部到达后才放行', async () => {
    const model = parseBpmnXml(parallelXml);
    const engine = new BpmnWorkflowEngine(model);

    const executed: string[] = [];
    const state = await engine.execute({
      onNodeExecute: async (node) => {
        executed.push(node.id);
        return { ok: true };
      },
    });

    assert.equal(state.status, 'completed');
    assert.ok(executed.includes('Task_A'));
    assert.ok(executed.includes('Task_B'));
    assert.equal(executed.length, 2);
  });

  it('4. 节点执行失败或阻断：状态机 fail-closed 标记 failed', async () => {
    const model = parseBpmnXml(linearXml);
    const engine = new BpmnWorkflowEngine(model);

    const state = await engine.execute({
      onNodeExecute: async () => {
        throw new Error('执行异常阻断');
      },
    });

    assert.equal(state.status, 'failed');
    assert.ok(state.error?.includes('执行异常阻断'));
  });

  const userTaskXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Def_UT">
  <bpmn:process id="Proc_UT" isExecutable="true">
    <bpmn:startEvent id="Start_1">
      <bpmn:outgoing>F1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:task id="Task_Code" name="AI 编码任务">
      <bpmn:incoming>F1</bpmn:incoming>
      <bpmn:outgoing>F2</bpmn:outgoing>
    </bpmn:task>
    <bpmn:userTask id="UserTask_Review" name="人工审查放行">
      <bpmn:incoming>F2</bpmn:incoming>
      <bpmn:outgoing>F3</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:task id="Task_Ship" name="发布投产">
      <bpmn:incoming>F3</bpmn:incoming>
      <bpmn:outgoing>F4</bpmn:outgoing>
    </bpmn:task>
    <bpmn:endEvent id="End_1">
      <bpmn:incoming>F4</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start_1" targetRef="Task_Code" />
    <bpmn:sequenceFlow id="F2" sourceRef="Task_Code" targetRef="UserTask_Review" />
    <bpmn:sequenceFlow id="F3" sourceRef="UserTask_Review" targetRef="Task_Ship" />
    <bpmn:sequenceFlow id="F4" sourceRef="Task_Ship" targetRef="End_1" />
  </bpmn:process>
</bpmn:definitions>`;

  it('5. UserTask 人工审查节点：引擎必须挂起为 waiting 状态，绝不自动放行通过', async () => {
    const model = parseBpmnXml(userTaskXml);
    const engine = new BpmnWorkflowEngine(model);

    const executed: string[] = [];
    const state = await engine.execute({
      onNodeExecute: async (node) => {
        executed.push(node.id);
        return { ok: true };
      },
    });

    // 必须停在人工审查节点上，等待人类放行
    assert.equal(state.status, 'waiting', '流转到 UserTask 时必须进入 waiting 挂起状态');
    assert.deepEqual(executed, ['Task_Code'], '不应继续执行后续的自动任务');
    assert.deepEqual(state.activeNodes, ['UserTask_Review'], '当前活跃节点必须是待审查的人工节点');
    assert.ok(!executed.includes('Task_Ship'), '在人工放行前严禁推进下游节点');
  });

  it('6. 人工放行 (approve) 恢复：状态机继续推进并最终流转至 completed', async () => {
    const model = parseBpmnXml(userTaskXml);
    const engine = new BpmnWorkflowEngine(model);

    const firstState = await engine.execute({
      onNodeExecute: async (node) => {
        if (node.type === 'userTask') return { ok: true };
        return { ok: true };
      },
    });
    assert.equal(firstState.status, 'waiting');

    const secondState = await engine.resume({
      decision: 'approve',
      variables: { reviewScore: 95 },
    });

    assert.equal(secondState.status, 'completed', '人工放行后必须推进至最终完成状态');
    assert.ok(secondState.completedNodes.includes('UserTask_Review'), '人工审查节点必须标记完成');
    assert.ok(secondState.completedNodes.includes('Task_Ship'), '放行后下游自动任务必须真实推进');
    assert.equal(secondState.variables.reviewScore, 95, '放行时注入的变量必须合并进全局变量总线');
  });

  it('7. 人工驳回 (reject)：状态机维持挂起等待重新提交或跳过，严禁自行吞并放行', async () => {
    const model = parseBpmnXml(userTaskXml);
    const engine = new BpmnWorkflowEngine(model);

    const firstState = await engine.execute({
      onNodeExecute: async () => ({ ok: true }),
    });
    assert.equal(firstState.status, 'waiting');

    const rejectedState = await engine.resume({
      decision: 'reject',
      reason: '代码覆盖率不达标，请返工',
    });

    // 驳回后必须继续保持 waiting，绝不静默通过
    assert.equal(rejectedState.status, 'waiting', '驳回后必须保持挂起状态等待重新审查');
    assert.ok(rejectedState.variables.__rejectionReason, '驳回原因必须写入变量总线供上游查看');
    assert.ok(!rejectedState.completedNodes.includes('Task_Ship'), '严禁在驳回状态下推进下游任务');
  });

  // 13. 驳回分支路由：UserTask 驳回必须真实走 XOR 退回分支（返工节点），
  // 严禁让退回分支成为死路（真机验收发现的引擎级缺陷，D86）
  const rejectBranchXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Def_RejectBranch">
  <bpmn:process id="Proc_RejectBranch" isExecutable="true">
    <bpmn:startEvent id="Start_1">
      <bpmn:outgoing>F1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:task id="Task_Code" name="AI 编码任务">
      <bpmn:incoming>F1</bpmn:incoming>
      <bpmn:outgoing>F2</bpmn:outgoing>
    </bpmn:task>
    <bpmn:userTask id="UserTask_Gate" name="人工审查门">
      <bpmn:incoming>F2</bpmn:incoming>
      <bpmn:outgoing>F3</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:exclusiveGateway id="GW_Decision" name="裁决网关">
      <bpmn:incoming>F3</bpmn:incoming>
      <bpmn:outgoing>Flow_Approve</bpmn:outgoing>
      <bpmn:outgoing>Flow_Reject</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:task id="Task_Ship" name="发布投产">
      <bpmn:incoming>Flow_Approve</bpmn:incoming>
      <bpmn:outgoing>F_Ship_End</bpmn:outgoing>
    </bpmn:task>
    <bpmn:task id="Task_Rewrite" name="返工重做">
      <bpmn:incoming>Flow_Reject</bpmn:incoming>
      <bpmn:outgoing>F_Rewrite_End</bpmn:outgoing>
    </bpmn:task>
    <bpmn:endEvent id="End_Ship">
      <bpmn:incoming>F_Ship_End</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:endEvent id="End_Rewrite">
      <bpmn:incoming>F_Rewrite_End</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start_1" targetRef="Task_Code" />
    <bpmn:sequenceFlow id="F2" sourceRef="Task_Code" targetRef="UserTask_Gate" />
    <bpmn:sequenceFlow id="F3" sourceRef="UserTask_Gate" targetRef="GW_Decision" />
    <bpmn:sequenceFlow id="Flow_Approve" sourceRef="GW_Decision" targetRef="Task_Ship">
      <bpmn:conditionExpression>\${reviewDecision === "approved"}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="Flow_Reject" sourceRef="GW_Decision" targetRef="Task_Rewrite" />
    <bpmn:sequenceFlow id="F_Ship_End" sourceRef="Task_Ship" targetRef="End_Ship" />
    <bpmn:sequenceFlow id="F_Rewrite_End" sourceRef="Task_Rewrite" targetRef="End_Rewrite" />
  </bpmn:process>
</bpmn:definitions>`;

  it('13. 驳回分支必须真实可达：人工驳回后走返工节点，绝不进入放行分支', async () => {
    const model = parseBpmnXml(rejectBranchXml);
    const engine = new BpmnWorkflowEngine(model);

    const executed: string[] = [];
    const firstState = await engine.execute({
      onNodeExecute: async (node) => {
        executed.push(node.id);
        return { ok: true };
      },
    });
    assert.equal(firstState.status, 'waiting');
    assert.deepEqual(executed, ['Task_Code']);

    const rejectedState = await engine.resume({
      decision: 'reject',
      reason: '审查未通过，需返工',
    });

    assert.equal(rejectedState.status, 'completed', '驳回后必须继续推进至返工分支直至结束');
    assert.ok(executed.includes('Task_Rewrite'), '驳回必须真实执行返工节点，严禁让退回分支成为死路');
    assert.ok(!executed.includes('Task_Ship'), '驳回严禁进入放行分支');
    assert.ok(rejectedState.completedNodes.includes('Task_Rewrite'), '返工节点必须标记完成');
    assert.ok(rejectedState.variables.__rejectionReason, '驳回原因必须写入变量总线供上游查看');
  });

  it('14. 驳回且注入驳回变量时必须走 XOR 条件分支（严禁误入放行分支）', async () => {
    const model = parseBpmnXml(rejectBranchXml);
    const engine = new BpmnWorkflowEngine(model);

    const executed: string[] = [];
    await engine.execute({
      onNodeExecute: async (node) => {
        executed.push(node.id);
        return { ok: true };
      },
    });

    const rejectedState = await engine.resume({
      decision: 'reject',
      reason: '审查未通过',
      variables: { reviewDecision: 'rejected' },
    });

    assert.equal(rejectedState.status, 'completed');
    assert.ok(executed.includes('Task_Rewrite'), '注入 rejected 变量后必须走退回分支');
    assert.ok(!executed.includes('Task_Ship'), '注入 rejected 变量后严禁进入放行分支');
  });

  // 8. 人工审查环路 + 跨 resume 累计步数熔断
  const reviewLoopXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Def_ReviewLoop">
  <bpmn:process id="Proc_ReviewLoop" isExecutable="true">
    <bpmn:startEvent id="S1"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="UT_Review" name="人工审查门">
      <bpmn:incoming>F1</bpmn:incoming>
      <bpmn:incoming>F3</bpmn:incoming>
      <bpmn:outgoing>F2</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:task id="Task_Work" name="返工修订">
      <bpmn:incoming>F2</bpmn:incoming>
      <bpmn:outgoing>F3</bpmn:outgoing>
    </bpmn:task>
    <bpmn:sequenceFlow id="F1" sourceRef="S1" targetRef="UT_Review" />
    <bpmn:sequenceFlow id="F2" sourceRef="UT_Review" targetRef="Task_Work" />
    <bpmn:sequenceFlow id="F3" sourceRef="Task_Work" targetRef="UT_Review" />
  </bpmn:process>
</bpmn:definitions>`;

  it('8. 跨 resume 累计熔断：人工放行绝不重置步数预算，反复放行环路必须在有限次内 fail-closed', async () => {
    const model = parseBpmnXml(reviewLoopXml);
    const engine = new BpmnWorkflowEngine(model);

    const firstState = await engine.execute({
      onNodeExecute: async () => ({ ok: true }),
    });
    assert.equal(firstState.status, 'waiting', '初始必须挂起在人工审查门');

    let state = firstState;
    let approvals = 0;
    while (state.status === 'waiting' && approvals < 20) {
      state = await engine.resume({ decision: 'approve', maxSteps: 10 });
      approvals++;
    }

    assert.equal(state.status, 'failed', '环路反复人工放行必须最终触发步数熔断为 failed');
    assert.ok(state.error?.includes('超出步数上限'), '错误信息必须指出步数超限熔断');
    assert.ok(approvals < 20, `必须在有限次放行内熔断，实际耗了 ${approvals} 次`);
  });

  it('9. hydrate 断点续接：从持久化快照重建挂起态后 approve 必须续跑下游且绝不重放已完成节点', async () => {
    const model = parseBpmnXml(userTaskXml);
    const executedBefore = ['Start_1', 'Task_Code'];

    const engine = new BpmnWorkflowEngine(model);
    const replayed: string[] = [];
    engine.hydrate({
      completedNodes: executedBefore,
      activeNodes: ['UserTask_Review'],
      variables: { reviewScore: 88 },
      onNodeExecute: async (node) => {
        replayed.push(node.id);
        return { ok: true };
      },
    });

    const state = await engine.resume({ decision: 'approve', variables: { reviewerApproved: true } });

    assert.equal(state.status, 'completed', 'hydrate 后放行必须推进至完成');
    assert.deepEqual(replayed, ['Task_Ship'], '严禁重放 Start/Task_Code，只允许执行挂起之后的下游节点');
    assert.equal(state.variables.reviewScore, 88, '快照变量必须恢复进变量总线');
    assert.equal(state.variables.reviewerApproved, true, '放行注入变量必须合并');
    assert.ok(state.completedNodes.includes('Task_Code'), '已完成节点必须保留');
    assert.ok(state.completedNodes.includes('UserTask_Review'), '审查节点必须标记完成');
    assert.ok(state.completedNodes.includes('Task_Ship'), '下游节点必须推进完成');
  });

  // 11. 有限次循环：Task 节点自动注入 <节点ID>_runs 计数供网关条件判定退出
  const retryLoopXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Def_RetryLoop">
  <bpmn:process id="Proc_RetryLoop" isExecutable="true">
    <bpmn:startEvent id="S1"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="T-Retry" name="重试任务">
      <bpmn:incoming>F1</bpmn:incoming>
      <bpmn:incoming>F_Loop</bpmn:incoming>
      <bpmn:outgoing>F2</bpmn:outgoing>
    </bpmn:task>
    <bpmn:exclusiveGateway id="GW_Check">
      <bpmn:incoming>F2</bpmn:incoming>
      <bpmn:outgoing>F_Loop</bpmn:outgoing>
      <bpmn:outgoing>F_End</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:endEvent id="E1"><bpmn:incoming>F_End</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="S1" targetRef="T-Retry" />
    <bpmn:sequenceFlow id="F2" sourceRef="T-Retry" targetRef="GW_Check" />
    <bpmn:sequenceFlow id="F_Loop" sourceRef="GW_Check" targetRef="T-Retry">
      <bpmn:conditionExpression>\${T_Retry_runs &lt; 2}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="F_End" sourceRef="GW_Check" targetRef="E1">
      <bpmn:conditionExpression>\${T_Retry_runs &gt;= 2}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
  </bpmn:process>
</bpmn:definitions>`;

  it('11. 有限次循环：Task 自动注入 <节点ID>_runs 计数，网关据此退出环路而非死循环', async () => {
    const model = parseBpmnXml(retryLoopXml);
    const engine = new BpmnWorkflowEngine(model);
    let executed = 0;
    const state = await engine.execute({
      onNodeExecute: async () => {
        executed += 1;
        return { ok: true };
      },
    });

    assert.equal(state.status, 'completed', '循环必须在条件满足后正常退出为 completed');
    assert.equal(executed, 2, '重试任务必须恰好执行两次');
    assert.equal(state.variables.T_Retry_runs, 2, '非字母数字节点 ID 必须归一化为 T_Retry_runs 计数');
    assert.ok(state.completedNodes.includes('T-Retry'), '重试任务必须记录为已完成');
    assert.ok(state.completedNodes.includes('GW_Check'), '退出网关必须记录为已完成');
  });

  it('12. 节点计数与外部入参不冲突：外部伪造同名变量不得跳过循环，计数必须由真实执行驱动', async () => {
    const model = parseBpmnXml(retryLoopXml);
    const engine = new BpmnWorkflowEngine(model);
    let executed = 0;
    const state = await engine.execute({
      initialVariables: { T_Retry_runs: 99 },
      onNodeExecute: async () => {
        executed += 1;
        return { ok: true };
      },
    });

    assert.equal(state.status, 'completed');
    assert.equal(executed, 2, '外部伪造计数不得让循环被执行 0 次');
    assert.equal(state.variables.T_Retry_runs, 2, '计数必须以真实执行次数为准');
  });

  it('10. hydrate fail-closed：快照中无人工审查锚点时 resume 必须拒绝，绝不自行放行', async () => {
    const model = parseBpmnXml(userTaskXml);
    const engine = new BpmnWorkflowEngine(model);
    engine.hydrate({
      completedNodes: ['Start_1', 'Task_Code'],
      activeNodes: ['Task_Code'],
      variables: {},
    });

    const state = await engine.resume({ decision: 'approve' });
    assert.equal(state.status, 'failed', '缺少人工审查锚点必须判定失败');
    assert.ok(state.error?.includes('人工审查挂起状态'), '错误必须说明未处于挂起状态');
    assert.ok(!state.completedNodes.includes('Task_Ship'), '严禁在无锚点状态下推进下游');
  });
});
