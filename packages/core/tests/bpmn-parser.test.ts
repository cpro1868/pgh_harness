import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BpmnParser } from '../src/workflow/bpmn-parser.ts';

const SAMPLE_CAMUNDA_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
                  id="Definitions_1"
                  targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_OrderReview" name="订单审定流程" isExecutable="true">
    <bpmn:startEvent id="Start_1" name="开始">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:serviceTask id="Task_Analyze" name="需求分析 Agent">
      <bpmn:extensionElements>
        <camunda:inputOutput>
          <camunda:inputParameter name="roleName">需求分析师</camunda:inputParameter>
          <camunda:inputParameter name="modelId">glm-5.3</camunda:inputParameter>
          <camunda:inputParameter name="promptTemplate">请分析 \${input.requirement}</camunda:inputParameter>
        </camunda:inputOutput>
      </bpmn:extensionElements>
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:exclusiveGateway id="Gateway_Pass" name="是否达标" default="Flow_Fail">
      <bpmn:incoming>Flow_2</bpmn:incoming>
      <bpmn:outgoing>Flow_Pass</bpmn:outgoing>
      <bpmn:outgoing>Flow_Fail</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:userTask id="Task_Approval" name="主管人工审定">
      <bpmn:incoming>Flow_Pass</bpmn:incoming>
      <bpmn:outgoing>Flow_3</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_Analyze" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_Analyze" targetRef="Gateway_Pass" />
    <bpmn:sequenceFlow id="Flow_Pass" name="通过" sourceRef="Gateway_Pass" targetRef="Task_Approval">
      <bpmn:conditionExpression>\${coverage &gt;= 85.0}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="Flow_Fail" name="未达标打回" sourceRef="Gateway_Pass" targetRef="Task_Analyze" />
    <bpmn:sequenceFlow id="Flow_3" sourceRef="Task_Approval" targetRef="End_1" />
    <bpmn:endEvent id="End_1" name="结束">
      <bpmn:incoming>Flow_3</bpmn:incoming>
    </bpmn:endEvent>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_OrderReview">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1">
        <dc:Bounds x="160" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Analyze_di" bpmnElement="Task_Analyze">
        <dc:Bounds x="260" y="78" width="120" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gateway_Pass_di" bpmnElement="Gateway_Pass" isMarkerVisible="true">
        <dc:Bounds x="440" y="93" width="50" height="50" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Approval_di" bpmnElement="Task_Approval">
        <dc:Bounds x="550" y="78" width="120" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1">
        <dc:Bounds x="730" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="196" y="118" />
        <di:waypoint x="260" y="118" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">
        <di:waypoint x="380" y="118" />
        <di:waypoint x="440" y="118" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

describe('TC-03-01-001: Camunda 标准 BPMN 2.0 XML 纯 TS 解析与校验 (WBS-03-01-01)', () => {
  it('正确解析进程元数据、节点集合与序列流', () => {
    const model = BpmnParser.parseXml(SAMPLE_CAMUNDA_BPMN);
    assert.equal(model.id, 'Process_OrderReview');
    assert.equal(model.name, '订单审定流程');
    assert.equal(model.isExecutable, true);

    // 节点类型收敛与数量断言
    assert.equal(model.nodes.length, 5);
    const start = model.nodes.find((n) => n.id === 'Start_1');
    assert.ok(start);
    assert.equal(start.type, 'startEvent');
    assert.deepEqual(start.outgoing, ['Flow_1']);

    const service = model.nodes.find((n) => n.id === 'Task_Analyze');
    assert.ok(service);
    assert.equal(service.type, 'serviceTask');
    assert.equal(service.name, '需求分析 Agent');
    assert.deepEqual(service.incoming, ['Flow_1', 'Flow_Fail']);
    assert.deepEqual(service.outgoing, ['Flow_2']);

    const gateway = model.nodes.find((n) => n.id === 'Gateway_Pass');
    assert.ok(gateway);
    assert.equal(gateway.type, 'exclusiveGateway');
    assert.equal(gateway.defaultFlow, 'Flow_Fail');
    assert.deepEqual(gateway.outgoing, ['Flow_Pass', 'Flow_Fail']);

    const user = model.nodes.find((n) => n.id === 'Task_Approval');
    assert.ok(user);
    assert.equal(user.type, 'userTask');

    const end = model.nodes.find((n) => n.id === 'End_1');
    assert.ok(end);
    assert.equal(end.type, 'endEvent');
  });

  it('提取 sequenceFlow 条件表达式、sourceRef、targetRef 与转义还原', () => {
    const model = BpmnParser.parseXml(SAMPLE_CAMUNDA_BPMN);
    assert.equal(model.flows.length, 5);

    const passFlow = model.flows.find((f) => f.id === 'Flow_Pass');
    assert.ok(passFlow);
    assert.equal(passFlow.sourceRef, 'Gateway_Pass');
    assert.equal(passFlow.targetRef, 'Task_Approval');
    assert.equal(passFlow.name, '通过');
    // XML 中的 &gt; 必须解码为 >
    assert.equal(passFlow.conditionExpression, '${coverage >= 85.0}');

    const failFlow = model.flows.find((f) => f.id === 'Flow_Fail');
    assert.ok(failFlow);
    assert.equal(failFlow.sourceRef, 'Gateway_Pass');
    assert.equal(failFlow.targetRef, 'Task_Analyze');
    assert.equal(failFlow.conditionExpression, undefined);
  });

  it('提取 camunda:inputOutput 扩展参数（Agent 角色、模型与提示词）', () => {
    const model = BpmnParser.parseXml(SAMPLE_CAMUNDA_BPMN);
    const service = model.nodes.find((n) => n.id === 'Task_Analyze');
    assert.ok(service);
    assert.deepEqual(service.parameters, {
      roleName: '需求分析师',
      modelId: 'glm-5.3',
      promptTemplate: '请分析 ${input.requirement}',
    });
  });

  it('提取 BPMNDiagram / BPMNShape / BPMNEdge 布局坐标信息', () => {
    const model = BpmnParser.parseXml(SAMPLE_CAMUNDA_BPMN);
    const bounds = model.layout?.shapes['Task_Analyze'];
    assert.ok(bounds);
    assert.equal(bounds.x, 260);
    assert.equal(bounds.y, 78);
    assert.equal(bounds.width, 120);
    assert.equal(bounds.height, 80);

    const edge = model.layout?.edges['Flow_1'];
    assert.ok(edge);
    assert.equal(edge.waypoints.length, 2);
    assert.deepEqual(edge.waypoints[0], { x: 196, y: 118 });
  });

  it('异常与边界防护：空 XML、非法根标签、悬空 flow 校验', () => {
    assert.throws(() => BpmnParser.parseXml(''), /XML/);
    assert.throws(() => BpmnParser.parseXml('<not-bpmn />'), /definitions/i);

    // 缺少 sourceRef 或 targetRef 的非法流必须抛错拦截
    const brokenXml = `<?xml version="1.0"?>
      <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">
        <process id="p1">
          <sequenceFlow id="f1" sourceRef="none" />
        </process>
      </definitions>`;
    assert.throws(() => BpmnParser.parseXml(brokenXml), /sourceRef|targetRef/);
  });
});
