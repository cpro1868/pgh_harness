import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SqliteDatabase } from '../src/database.ts';
import { WorkflowStore, WORKFLOW_DEFAULT_TEMPLATE } from '../src/workflow-schema.ts';
import type { WorkflowDefinition } from '../src/workflow-schema.ts';

describe('TC-03-01-002: BPMN 流程定义资产存储与模型 (WBS-03-01-02)', () => {
  let tmpDir: string;
  let db: SqliteDatabase;
  let store: WorkflowStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-workflow-test-'));
    db = new SqliteDatabase(path.join(tmpDir, 'test.db'));
    db.initialize();
    store = new WorkflowStore(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('DDL 建表：workflows 表与索引正确创建', () => {
    const tables = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'workflows'")
      .all() as Array<{ name: string }>;
    assert.equal(tables.length, 1, '必须创建 workflows 流程定义表');

    const indexes = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_workflows_updated'")
      .all() as Array<{ name: string }>;
    assert.equal(indexes.length, 1, '必须创建 idx_workflows_updated 索引');
  });

  it('预置模板加载：默认流程定义成功初始化', () => {
    const list = store.list();
    assert.ok(list.length >= 1, '应当能获取到预置的 BPMN 流程定义');
    const defaultWf = store.get(WORKFLOW_DEFAULT_TEMPLATE.id);
    assert.ok(defaultWf, '默认流程必须存在');
    assert.equal(defaultWf?.name, WORKFLOW_DEFAULT_TEMPLATE.name);
    assert.ok(defaultWf?.bpmnXml.includes('definitions'), 'XML 必须包含 definitions');
  });

  it('创建流程定义：保存流程元数据与 BPMN XML 并能精确读取', () => {
    const custom: WorkflowDefinition = {
      id: 'wf_feature_dev',
      name: '敏捷功能闭环工作流',
      description: '需求评审 -> 测试先行 -> 编码实现 -> 门禁验收',
      version: 1,
      bpmnXml: `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" />
  </bpmn:process>
</bpmn:definitions>`,
      nodeCount: 1,
      gatewayCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const created = store.create(custom);
    assert.equal(created.id, 'wf_feature_dev');
    assert.equal(created.name, '敏捷功能闭环工作流');

    const fetched = store.get('wf_feature_dev');
    assert.ok(fetched);
    assert.equal(fetched?.id, 'wf_feature_dev');
    assert.equal(fetched?.nodeCount, 1);
    assert.equal(fetched?.gatewayCount, 0);
  });

  it('更新与删除流程定义：版本与字段变更测试', () => {
    const custom: WorkflowDefinition = {
      id: 'wf_temp',
      name: '临时流程',
      description: '测试删除',
      version: 1,
      bpmnXml: '<bpmn:definitions id="Def_Temp"/>',
      nodeCount: 2,
      gatewayCount: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    store.create(custom);
    const updated = store.update('wf_temp', {
      name: '更新后名称',
      version: 2,
    });
    assert.equal(updated?.name, '更新后名称');
    assert.equal(updated?.version, 2);

    const deleted = store.delete('wf_temp');
    assert.equal(deleted, true);
    assert.equal(store.get('wf_temp'), null);
  });
});
