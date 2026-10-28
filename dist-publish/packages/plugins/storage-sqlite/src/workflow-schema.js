export const WORKFLOW_DEFAULT_TEMPLATE = {
    id: 'wf_std_feature_dev',
    name: '标准特性交付协作流 (BPMN 2.0)',
    description: '需求梳理 -> 架构评审网关 -> 双角色并行编码 -> 集成复核',
    version: 1,
    bpmnXml: `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  id="Definitions_FeatureDev"
                  targetNamespace="http://pgh.local/bpmn">
  <bpmn:process id="Process_FeatureDev" name="标准特性交付协作流" isExecutable="true">
    <bpmn:startEvent id="Start_1" name="收到特性研发需求">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:task id="Task_Analyze" name="需求分析与规格提炼">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:task>
    <bpmn:exclusiveGateway id="Gateway_Review" name="架构设计审核通过?">
      <bpmn:incoming>Flow_2</bpmn:incoming>
      <bpmn:outgoing>Flow_Pass</bpmn:outgoing>
      <bpmn:outgoing>Flow_Reject</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:task id="Task_Refine" name="需求与方案重构修订">
      <bpmn:incoming>Flow_Reject</bpmn:incoming>
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:task>
    <bpmn:parallelGateway id="Gateway_Fork" name="并行启动开发">
      <bpmn:incoming>Flow_Pass</bpmn:incoming>
      <bpmn:outgoing>Flow_Back</bpmn:outgoing>
      <bpmn:outgoing>Flow_Front</bpmn:outgoing>
    </bpmn:parallelGateway>
    <bpmn:task id="Task_Backend" name="后端数据模型与接口研发">
      <bpmn:incoming>Flow_Back</bpmn:incoming>
      <bpmn:outgoing>Flow_Back_Done</bpmn:outgoing>
    </bpmn:task>
    <bpmn:task id="Task_Frontend" name="前端交互界面开发">
      <bpmn:incoming>Flow_Front</bpmn:incoming>
      <bpmn:outgoing>Flow_Front_Done</bpmn:outgoing>
    </bpmn:task>
    <bpmn:parallelGateway id="Gateway_Join" name="汇聚合并分支">
      <bpmn:incoming>Flow_Back_Done</bpmn:incoming>
      <bpmn:incoming>Flow_Front_Done</bpmn:incoming>
      <bpmn:outgoing>Flow_To_Verify</bpmn:outgoing>
    </bpmn:parallelGateway>
    <bpmn:task id="Task_Verify" name="集成测试与代码复审">
      <bpmn:incoming>Flow_To_Verify</bpmn:incoming>
      <bpmn:outgoing>Flow_End</bpmn:outgoing>
    </bpmn:task>
    <bpmn:endEvent id="End_1" name="特性交付就绪">
      <bpmn:incoming>Flow_End</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_Analyze" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_Analyze" targetRef="Gateway_Review" />
    <bpmn:sequenceFlow id="Flow_Pass" sourceRef="Gateway_Review" targetRef="Gateway_Fork" />
    <bpmn:sequenceFlow id="Flow_Reject" sourceRef="Gateway_Review" targetRef="Task_Refine" />
    <bpmn:sequenceFlow id="Flow_Back" sourceRef="Gateway_Fork" targetRef="Task_Backend" />
    <bpmn:sequenceFlow id="Flow_Front" sourceRef="Gateway_Fork" targetRef="Task_Frontend" />
    <bpmn:sequenceFlow id="Flow_Back_Done" sourceRef="Task_Backend" targetRef="Gateway_Join" />
    <bpmn:sequenceFlow id="Flow_Front_Done" sourceRef="Task_Frontend" targetRef="Gateway_Join" />
    <bpmn:sequenceFlow id="Flow_To_Verify" sourceRef="Gateway_Join" targetRef="Task_Verify" />
    <bpmn:sequenceFlow id="Flow_End" sourceRef="Task_Verify" targetRef="End_1" />
  </bpmn:process>
</bpmn:definitions>`,
    nodeCount: 5,
    gatewayCount: 3,
    createdAt: 1790294400000,
    updatedAt: 1790294400000,
};
export class WorkflowStore {
    db;
    constructor(db) {
        this.db = db;
        this.ensureSchema();
    }
    ensureSchema() {
        this.db.raw.exec(`
      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        bpmn_xml TEXT NOT NULL,
        node_count INTEGER NOT NULL DEFAULT 0,
        gateway_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_workflows_updated ON workflows(updated_at DESC);

      CREATE TABLE IF NOT EXISTS workflow_instances (
        instance_id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        workflow_name TEXT NOT NULL,
        workspace_path TEXT,
        instruction TEXT,
        status TEXT NOT NULL DEFAULT 'idle',
        active_nodes_json TEXT NOT NULL DEFAULT '[]',
        completed_nodes_json TEXT NOT NULL DEFAULT '[]',
        variables_json TEXT NOT NULL DEFAULT '{}',
        execution_log_json TEXT NOT NULL DEFAULT '[]',
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_instances_updated ON workflow_instances(updated_at DESC);
    `);
        // 增量补齐列
        try {
            this.db.raw.exec(`
        ALTER TABLE workflow_instances ADD COLUMN workspace_path TEXT;
      `);
        }
        catch { }
        try {
            this.db.raw.exec(`
        ALTER TABLE workflow_instances ADD COLUMN instruction TEXT;
      `);
        }
        catch { }
        this.ensureDefaultTemplate();
    }
    ensureDefaultTemplate() {
        const existing = this.get(WORKFLOW_DEFAULT_TEMPLATE.id);
        if (!existing) {
            this.create(WORKFLOW_DEFAULT_TEMPLATE);
        }
    }
    list() {
        const stmt = this.db.raw.prepare(`
      SELECT id, name, description, version, bpmn_xml, node_count, gateway_count, created_at, updated_at
      FROM workflows
      ORDER BY updated_at DESC
    `);
        const rows = stmt.all();
        return rows.map((r) => this.mapRow(r));
    }
    get(id) {
        const stmt = this.db.raw.prepare(`
      SELECT id, name, description, version, bpmn_xml, node_count, gateway_count, created_at, updated_at
      FROM workflows
      WHERE id = ?
    `);
        const row = stmt.get(id);
        if (!row)
            return null;
        return this.mapRow(row);
    }
    create(workflow) {
        let nodeCount = workflow.nodeCount ?? 0;
        let gatewayCount = workflow.gatewayCount ?? 0;
        if (workflow.bpmnXml && (!workflow.nodeCount || !workflow.gatewayCount)) {
            try {
                const matchesNode = workflow.bpmnXml.match(/<(?:[a-zA-Z0-9_]+:)?(?:task|serviceTask|userTask|scriptTask|startEvent|endEvent)\b/gi);
                nodeCount = matchesNode ? matchesNode.length : 0;
                const matchesGw = workflow.bpmnXml.match(/<(?:[a-zA-Z0-9_]+:)?(?:exclusiveGateway|parallelGateway|inclusiveGateway|complexGateway)\b/gi);
                gatewayCount = matchesGw ? matchesGw.length : 0;
            }
            catch {
                // ignore
            }
        }
        const stmt = this.db.raw.prepare(`
      INSERT INTO workflows (id, name, description, version, bpmn_xml, node_count, gateway_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(workflow.id, workflow.name, workflow.description ?? '', workflow.version ?? 1, workflow.bpmnXml, nodeCount, gatewayCount, workflow.createdAt || Date.now(), workflow.updatedAt || Date.now());
        return {
            ...workflow,
            nodeCount,
            gatewayCount,
        };
    }
    update(id, patch) {
        const existing = this.get(id);
        if (!existing)
            return null;
        const updated = {
            ...existing,
            ...patch,
            updatedAt: Date.now(),
        };
        const stmt = this.db.raw.prepare(`
      UPDATE workflows
      SET name = ?, description = ?, version = ?, bpmn_xml = ?, node_count = ?, gateway_count = ?, updated_at = ?
      WHERE id = ?
    `);
        stmt.run(updated.name, updated.description ?? '', updated.version, updated.bpmnXml, updated.nodeCount, updated.gatewayCount, updated.updatedAt, id);
        return updated;
    }
    delete(id) {
        const stmt = this.db.raw.prepare('DELETE FROM workflows WHERE id = ?');
        const result = stmt.run(id);
        return Number(result.changes) > 0;
    }
    saveInstance(inst) {
        const stmt = this.db.raw.prepare(`
      INSERT INTO workflow_instances (
        instance_id, workflow_id, workflow_name, workspace_path, instruction, status,
        active_nodes_json, completed_nodes_json, variables_json, execution_log_json,
        error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(instance_id) DO UPDATE SET
        workspace_path = excluded.workspace_path,
        instruction = excluded.instruction,
        status = excluded.status,
        active_nodes_json = excluded.active_nodes_json,
        completed_nodes_json = excluded.completed_nodes_json,
        variables_json = excluded.variables_json,
        execution_log_json = excluded.execution_log_json,
        error = excluded.error,
        updated_at = excluded.updated_at
    `);
        stmt.run(inst.instanceId, inst.workflowId, inst.workflowName, inst.workspacePath ?? null, inst.instruction ?? null, inst.status, JSON.stringify(inst.activeNodes || []), JSON.stringify(inst.completedNodes || []), JSON.stringify(inst.variables || {}), JSON.stringify(inst.executionLog || []), inst.error ?? null, inst.createdAt || Date.now(), inst.updatedAt || Date.now());
        return inst;
    }
    listInstances() {
        const stmt = this.db.raw.prepare(`
      SELECT * FROM workflow_instances ORDER BY updated_at DESC
    `);
        const rows = stmt.all();
        return rows.map((r) => this.mapInstanceRow(r));
    }
    getInstance(instanceId) {
        const stmt = this.db.raw.prepare(`
      SELECT * FROM workflow_instances WHERE instance_id = ?
    `);
        const row = stmt.get(instanceId);
        if (!row)
            return null;
        return this.mapInstanceRow(row);
    }
    deleteInstance(instanceId) {
        const stmt = this.db.raw.prepare('DELETE FROM workflow_instances WHERE instance_id = ?');
        const res = stmt.run(instanceId);
        return Number(res.changes) > 0;
    }
    mapInstanceRow(row) {
        return {
            instanceId: row.instance_id,
            workflowId: row.workflow_id,
            workflowName: row.workflow_name,
            workspacePath: row.workspace_path || undefined,
            instruction: row.instruction || undefined,
            status: row.status,
            activeNodes: JSON.parse(row.active_nodes_json || '[]'),
            completedNodes: JSON.parse(row.completed_nodes_json || '[]'),
            variables: JSON.parse(row.variables_json || '{}'),
            executionLog: JSON.parse(row.execution_log_json || '[]'),
            error: row.error || undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
    mapRow(row) {
        return {
            id: row.id,
            name: row.name,
            description: row.description || undefined,
            version: row.version,
            bpmnXml: row.bpmn_xml,
            nodeCount: row.node_count,
            gatewayCount: row.gateway_count,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}
