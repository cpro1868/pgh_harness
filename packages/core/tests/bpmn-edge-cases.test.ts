import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseBpmnXml } from '../src/workflow/bpmn-parser.ts';
import { BpmnWorkflowEngine } from '../src/workflow/bpmn-engine.ts';

describe('TC-03-03-004: BPMN 工作流深度边界与异常防御测试矩阵 (Robustness & Edge Cases)', () => {
  // 1. 测试死循环步数熔断保护
  const infiniteLoopXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Def_Infinite">
  <bpmn:process id="Proc_Infinite" isExecutable="true">
    <bpmn:startEvent id="S1"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="T_LoopA" name="死循环A"><bpmn:incoming>F1</bpmn:incoming><bpmn:incoming>F3</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing></bpmn:task>
    <bpmn:task id="T_LoopB" name="死循环B"><bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing></bpmn:task>
    <bpmn:sequenceFlow id="F1" sourceRef="S1" targetRef="T_LoopA" />
    <bpmn:sequenceFlow id="F2" sourceRef="T_LoopA" targetRef="T_LoopB" />
    <bpmn:sequenceFlow id="F3" sourceRef="T_LoopB" targetRef="T_LoopA" />
  </bpmn:process>
</bpmn:definitions>`;

  it('1. 死循环防护：当流程进入无尽环路时，必须在达到 maxSteps 时主动抛错熔断 (fail-closed)', async () => {
    const model = parseBpmnXml(infiniteLoopXml);
    const engine = new BpmnWorkflowEngine(model);

    let executedCount = 0;
    const state = await engine.execute({
      maxSteps: 20,
      onNodeExecute: async () => {
        executedCount++;
        return { ok: true };
      },
    });

    assert.equal(state.status, 'failed', '死循环必须被判定为 failed');
    assert.ok(state.error?.includes('超出步数上限'), '错误信息必须指出步数超限熔断');
    assert.ok(executedCount <= 25, '执行次数必须在限额内立即截断');
  });

  // 2. 测试复杂排他网关多重嵌套与变量类型比较
  const nestedXorXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Def_MultiTypes">
  <bpmn:process id="Proc_MultiTypes" isExecutable="true">
    <bpmn:startEvent id="S1"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:exclusiveGateway id="GW_Boolean">
      <bpmn:incoming>F1</bpmn:incoming>
      <bpmn:outgoing>F_BoolTrue</bpmn:outgoing>
      <bpmn:outgoing>F_BoolFalse</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:task id="T_TrueBranch" name="布尔真分支"><bpmn:incoming>F_BoolTrue</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing></bpmn:task>
    <bpmn:task id="T_FalseBranch" name="布尔假分支"><bpmn:incoming>F_BoolFalse</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="E1"><bpmn:incoming>F2</bpmn:incoming></bpmn:endEvent>
    <bpmn:endEvent id="E2"><bpmn:incoming>F3</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="S1" targetRef="GW_Boolean" />
    <bpmn:sequenceFlow id="F_BoolTrue" sourceRef="GW_Boolean" targetRef="T_TrueBranch">
      <bpmn:conditionExpression>\${isVip === true}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="F_BoolFalse" sourceRef="GW_Boolean" targetRef="T_FalseBranch">
      <bpmn:conditionExpression>\${isVip === false}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
  </bpmn:process>
</bpmn:definitions>`;

  it('2. 条件求值边界：布尔全等 (=== true / false) 与字符串精确匹配支持', async () => {
    const model = parseBpmnXml(nestedXorXml);

    // 测试布尔真
    const engineTrue = new BpmnWorkflowEngine(model);
    const stateTrue = await engineTrue.execute({
      initialVariables: { isVip: true },
      onNodeExecute: async () => ({ ok: true }),
    });
    assert.equal(stateTrue.status, 'completed');
    assert.ok(stateTrue.completedNodes.includes('T_TrueBranch'));
    assert.ok(!stateTrue.completedNodes.includes('T_FalseBranch'));

    // 测试布尔假
    const engineFalse = new BpmnWorkflowEngine(model);
    const stateFalse = await engineFalse.execute({
      initialVariables: { isVip: false },
      onNodeExecute: async () => ({ ok: true }),
    });
    assert.equal(stateFalse.status, 'completed');
    assert.ok(stateFalse.completedNodes.includes('T_FalseBranch'));
    assert.ok(!stateFalse.completedNodes.includes('T_TrueBranch'));
  });

  // 3. 多分支非对称汇聚测试 (多于 2 个并行的 AND Join)
  const tripleForkJoinXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Def_Triple">
  <bpmn:process id="Proc_Triple" isExecutable="true">
    <bpmn:startEvent id="S1"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:parallelGateway id="GW_Fork">
      <bpmn:incoming>F1</bpmn:incoming>
      <bpmn:outgoing>F_A</bpmn:outgoing>
      <bpmn:outgoing>F_B</bpmn:outgoing>
      <bpmn:outgoing>F_C</bpmn:outgoing>
    </bpmn:parallelGateway>
    <bpmn:task id="T_A" name="任务A"><bpmn:incoming>F_A</bpmn:incoming><bpmn:outgoing>F_A_Out</bpmn:outgoing></bpmn:task>
    <bpmn:task id="T_B" name="任务B"><bpmn:incoming>F_B</bpmn:incoming><bpmn:outgoing>F_B_Out</bpmn:outgoing></bpmn:task>
    <bpmn:task id="T_C" name="任务C"><bpmn:incoming>F_C</bpmn:incoming><bpmn:outgoing>F_C_Out</bpmn:outgoing></bpmn:task>
    <bpmn:parallelGateway id="GW_Join">
      <bpmn:incoming>F_A_Out</bpmn:incoming>
      <bpmn:incoming>F_B_Out</bpmn:incoming>
      <bpmn:incoming>F_C_Out</bpmn:incoming>
      <bpmn:outgoing>F_End</bpmn:outgoing>
    </bpmn:parallelGateway>
    <bpmn:endEvent id="E1"><bpmn:incoming>F_End</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="S1" targetRef="GW_Fork" />
    <bpmn:sequenceFlow id="F_A" sourceRef="GW_Fork" targetRef="T_A" />
    <bpmn:sequenceFlow id="F_B" sourceRef="GW_Fork" targetRef="T_B" />
    <bpmn:sequenceFlow id="F_C" sourceRef="GW_Fork" targetRef="T_C" />
    <bpmn:sequenceFlow id="F_A_Out" sourceRef="T_A" targetRef="GW_Join" />
    <bpmn:sequenceFlow id="F_B_Out" sourceRef="T_B" targetRef="GW_Join" />
    <bpmn:sequenceFlow id="F_C_Out" sourceRef="T_C" targetRef="GW_Join" />
    <bpmn:sequenceFlow id="F_End" sourceRef="GW_Join" targetRef="E1" />
  </bpmn:process>
</bpmn:definitions>`;

  it('3. 三路并发并行分支：GW_Join 必须等待 3 个 Token 完整汇聚后才放行', async () => {
    const model = parseBpmnXml(tripleForkJoinXml);
    const engine = new BpmnWorkflowEngine(model);

    const executed: string[] = [];
    const state = await engine.execute({
      onNodeExecute: async (node) => {
        executed.push(node.id);
        return { ok: true };
      },
    });

    assert.equal(state.status, 'completed');
    assert.equal(executed.length, 3);
    assert.ok(executed.includes('T_A'));
    assert.ok(executed.includes('T_B'));
    assert.ok(executed.includes('T_C'));
    assert.ok(state.completedNodes.includes('GW_Join'));
  });

  // 4. 节点执行动态注入变量流转至下游网关
  const variableFlowXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Def_VarFlow">
  <bpmn:process id="Proc_VarFlow" isExecutable="true">
    <bpmn:startEvent id="S1"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="T_Calc" name="动态计算覆盖率"><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing></bpmn:task>
    <bpmn:exclusiveGateway id="GW_Judge">
      <bpmn:incoming>F2</bpmn:incoming>
      <bpmn:outgoing>F_High</bpmn:outgoing>
      <bpmn:outgoing>F_Low</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:task id="T_High" name="高分分支"><bpmn:incoming>F_High</bpmn:incoming><bpmn:outgoing>F_End1</bpmn:outgoing></bpmn:task>
    <bpmn:task id="T_Low" name="低分分支"><bpmn:incoming>F_Low</bpmn:incoming><bpmn:outgoing>F_End2</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="E1"><bpmn:incoming>F_End1</bpmn:incoming></bpmn:endEvent>
    <bpmn:endEvent id="E2"><bpmn:incoming>F_End2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="S1" targetRef="T_Calc" />
    <bpmn:sequenceFlow id="F2" sourceRef="T_Calc" targetRef="GW_Judge" />
    <bpmn:sequenceFlow id="F_High" sourceRef="GW_Judge" targetRef="T_High">
      <bpmn:conditionExpression>\${calcCoverage &gt;= 90}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="F_Low" sourceRef="GW_Judge" targetRef="T_Low">
      <bpmn:conditionExpression>\${calcCoverage &lt; 90}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
  </bpmn:process>
</bpmn:definitions>`;

  it('4. 运行时变量总线动态传递：上游节点 onNodeExecute 产出的变量精准驱动下游网关判定', async () => {
    const model = parseBpmnXml(variableFlowXml);
    const engine = new BpmnWorkflowEngine(model);

    const executed: string[] = [];
    const state = await engine.execute({
      initialVariables: {},
      onNodeExecute: async (node) => {
        executed.push(node.id);
        if (node.id === 'T_Calc') {
          // 上游节点模拟运算产出变量写入总线
          return { ok: true, variables: { calcCoverage: 92 } };
        }
        return { ok: true };
      },
    });

    assert.equal(state.status, 'completed');
    assert.equal(state.variables.calcCoverage, 92);
    assert.deepEqual(executed, ['T_Calc', 'T_High'], '下游网关必须读取上游节点动态注入的变量并正确流转至高分分支');
    assert.ok(!executed.includes('T_Low'));
  });
});
