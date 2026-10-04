import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SqliteDatabase } from '../src/database.ts';
import { PipelineStore, PIPELINE_DEFAULT_TEMPLATE } from '../src/pipeline-schema.ts';
import type { PipelineTemplate, PipelineStage } from '../src/pipeline-schema.ts';

describe('TC-02-01-001: 流水线模板与阶段数据模型 (WBS-02-01-01)', () => {
  let tmpDir: string;
  let db: SqliteDatabase;
  let store: PipelineStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-pipeline-test-'));
    db = new SqliteDatabase(path.join(tmpDir, 'test.db'));
    db.initialize();
    store = new PipelineStore(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('DDL 建表：pipelines 与 pipeline_stages 表存在', () => {
    const names = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('pipelines', 'pipeline_stages')")
      .all() as Array<{ name: string }>;
    assert.equal(names.length, 2, '必须同时创建 pipelines 与 pipeline_stages 两张表');
  });

  it('创建模板：持久化模板元信息与阶段顺序', () => {
    const template: PipelineTemplate = {
      id: 'pl_default',
      name: '软件研发标准泳道',
      description: 'PRD -> 架构设计 -> TDD 编码 -> QA 验收',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      stages: [
        {
          id: 'st_1',
          pipelineId: 'pl_default',
          order: 1,
          roleName: '产品需求分析师',
          promptTemplate: '产出 PRD 文档',
          modelId: 'deepseek-chat',
          toolsAllowed: ['read_file', 'write_file'],
          artifactPaths: ['docs/PRD.md'],
          gatekeeperRequired: true,
        },
        {
          id: 'st_2',
          pipelineId: 'pl_default',
          order: 2,
          roleName: '系统架构师',
          promptTemplate: '产出架构设计文档',
          modelId: 'deepseek-chat',
          toolsAllowed: ['read_file', 'glob'],
          artifactPaths: [],
          gatekeeperRequired: false,
        },
      ],
    };
    store.create(template);

    const loaded = store.get('pl_default');
    assert.ok(loaded, '模板必须可查询');
    assert.equal(loaded!.name, '软件研发标准泳道');
    assert.equal(loaded!.stages.length, 2, '必须携带两个阶段');
    // 阶段顺序按 order 升序返回
    assert.deepEqual(loaded!.stages.map((s) => s.order), [1, 2]);
    assert.equal(loaded!.stages[0].roleName, '产品需求分析师');
    assert.equal(loaded!.stages[0].gatekeeperRequired, true);
    assert.deepEqual(loaded!.stages[0].toolsAllowed, ['read_file', 'write_file']);
    assert.deepEqual(loaded!.stages[0].artifactPaths, ['docs/PRD.md']);
  });

  it('支持标准 CRUD：列表、更新、删除', () => {
    const t = {
      ...PIPELINE_DEFAULT_TEMPLATE,
      id: 'pl_crud',
      name: '可增删改流水线',
    };
    store.create(t);
    assert.equal(store.list().length, 1);

    store.update('pl_crud', { name: '改名后的流水线' });
    const updated = store.get('pl_crud');
    assert.equal(updated!.name, '改名后的流水线');
    assert.equal(updated!.stages.length, PIPELINE_DEFAULT_TEMPLATE.stages.length, '更新不得丢失阶段');

    store.delete('pl_crud');
    assert.equal(store.list().length, 0);
    assert.equal(store.get('pl_crud'), undefined, '模板删除后阶段必须级联清理');
  });

  it('工件输出目录支持选填（留空表示按 Git 增量追踪）', () => {
    const t = {
      ...PIPELINE_DEFAULT_TEMPLATE,
      id: 'pl_artifact',
      stages: [
        { ...PIPELINE_DEFAULT_TEMPLATE.stages[0], id: 'st_a', pipelineId: 'pl_artifact', artifactPaths: [] },
        {
          ...PIPELINE_DEFAULT_TEMPLATE.stages[1],
          id: 'st_b',
          pipelineId: 'pl_artifact',
          artifactPaths: ['docs/design.md', 'src/arch/**'],
        },
      ],
    };
    store.create(t);
    const loaded = store.get('pl_artifact');
    assert.deepEqual(loaded!.stages[0].artifactPaths, [], '留空即表示由 Git 增量追踪');
    assert.deepEqual(loaded!.stages[1].artifactPaths, ['docs/design.md', 'src/arch/**']);
  });

  it('在指定阶段后插入阶段（双向插入定制工作台基座）', () => {
    const t = {
      ...PIPELINE_DEFAULT_TEMPLATE,
      id: 'pl_insert',
      stages: [
        { ...PIPELINE_DEFAULT_TEMPLATE.stages[0], id: 'st_1', pipelineId: 'pl_insert', order: 1 },
        { ...PIPELINE_DEFAULT_TEMPLATE.stages[1], id: 'st_2', pipelineId: 'pl_insert', order: 2 },
      ],
    };
    store.create(t);

    store.insertStageAfter('pl_insert', 'st_1', {
      id: 'st_mid',
      roleName: '技术文档工程师',
      promptTemplate: '产出接口契约文档',
      modelId: 'deepseek-chat',
      toolsAllowed: ['read_file'],
      artifactPaths: ['docs/api.md'],
      gatekeeperRequired: true,
    });

    const loaded = store.get('pl_insert');
    assert.equal(loaded!.stages.length, 3);
    // order 被重新编号为 1,2,3 且新阶段位于原第一阶段之后
    assert.deepEqual(loaded!.stages.map((s) => s.id), ['st_1', 'st_mid', 'st_2']);
    assert.deepEqual(loaded!.stages.map((s) => s.order), [1, 2, 3]);
  });

  it('内置默认模板：PRD -> 架构设计 -> TDD 编码 -> QA 验收 四阶段', () => {
    assert.equal(PIPELINE_DEFAULT_TEMPLATE.stages.length, 4);
    const roles = PIPELINE_DEFAULT_TEMPLATE.stages.map((s) => s.roleName);
    assert.ok(roles.some((r) => r.includes('需求')), '应包含需求阶段');
    assert.ok(roles.some((r) => r.includes('架构')), '应包含架构阶段');
    assert.ok(roles.some((r) => r.includes('编码')), '应包含编码阶段');
    assert.ok(roles.some((r) => r.includes('验收')), '应包含验收阶段');
    assert.ok(PIPELINE_DEFAULT_TEMPLATE.stages.every((s, i) => s.order === i + 1), '阶段顺序必须连续递增');
    assert.ok(
      PIPELINE_DEFAULT_TEMPLATE.stages.every((s) => s.modelId === undefined),
      '内置模板不得硬编码模型（模型由用户在 Provider 资产中真实配置，UI 动态绑定）',
    );
  });

  // ---------- 实例持久化与全生命周期 (WBS-02-04-01 / WBS-02-04-02) ----------

  it('流水线实例 CRUD：保存草稿、查询、更新状态与详细活动日志、删除', () => {
    const inst = {
      instanceId: 'inst_test_01',
      name: '实现支付网关签名防重放',
      pipelineId: 'pipeline_std_rd',
      pipelineName: '标准软件工程四阶段研发泳道',
      workspacePath: '/workspace/demo',
      taskPrompt: '完善防重放签名校验与单测',
      status: 'draft' as const,
      currentStageOrder: 1,
      stages: PIPELINE_DEFAULT_TEMPLATE.stages,
      logs: [
        {
          id: 'log_1',
          stageId: 'stg_prd',
          stageOrder: 1,
          roleName: '需求分析师',
          actor: 'agent' as const,
          type: 'thought' as const,
          content: '正在查阅代码...',
          timestamp: Date.now(),
        },
      ],
      artifacts: [
        {
          stageId: 'stg_prd',
          roleName: '需求分析师',
          path: 'docs/PRD.md',
          sizeBytes: 1024,
          timestamp: Date.now(),
        },
      ],
      gateRecords: [],
      tokensUsed: 1200,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    store.saveInstance(inst);
    const loaded = store.getInstance('inst_test_01');
    assert.ok(loaded);
    assert.equal(loaded!.status, 'draft');
    assert.equal(loaded!.logs.length, 1);
    assert.equal(loaded!.artifacts.length, 1);
    assert.equal(loaded!.tokensUsed, 1200);

    // 列表倒序
    const list = store.listInstances();
    assert.equal(list.length, 1);
    assert.equal(list[0].instanceId, 'inst_test_01');

    // 删除
    assert.equal(store.deleteInstance('inst_test_01'), true);
    assert.equal(store.getInstance('inst_test_01'), undefined);
  });
});
