import type { SqliteDatabase } from './database.ts';
import type {
  PipelineStage,
  PipelineTemplate,
  PipelineInstanceModel,
  PipelineInstanceStatus,
  PipelineRoleActivityLog,
  PipelineArtifactItem,
} from '@harness/protocol';

// 类型实体统一定义于 @harness/protocol（core 引擎与 storage 持久化共享同一契约，避免反向依赖）
export type {
  PipelineStage,
  PipelineTemplate,
  PipelineInstanceModel,
  PipelineInstanceStatus,
  PipelineRoleActivityLog,
  PipelineArtifactItem,
};

/** 内置标准研发 4 阶段流水线模板（WBS-02-01-01 / D36） */
export const PIPELINE_DEFAULT_TEMPLATE: PipelineTemplate = {
  id: 'pipeline_std_rd',
  name: '标准软件工程四阶段研发泳道',
  description: '需求梳理 (PRD) → 架构设计与契约 → TDD 驱动编码 → QA 自动化验收闭环',
  createdAt: 1790294400000,
  updatedAt: 1790294400000,
  stages: [
    {
      id: 'stg_prd',
      pipelineId: 'pipeline_std_rd',
      order: 1,
      name: '需求规格提炼',
      roleName: '需求分析师 (Product Manager)',
      promptTemplate: '根据用户任务需求，梳理出结构化 PRD、关键用例与验收边界。产出 docs/ 目录下的规格文档。',
      toolsAllowed: ['read_file', 'write_file', 'glob', 'grep'],
      artifactPaths: ['docs/**'],
      gatekeeperRequired: true,
    },
    {
      id: 'stg_arch',
      pipelineId: 'pipeline_std_rd',
      order: 2,
      name: '架构设计与契约',
      roleName: '系统架构师 (System Architect)',
      promptTemplate: '基于上游已审定的需求规格，设计系统组件划分、接口契约（DTO）、状态机与核心数据流图。',
      toolsAllowed: ['read_file', 'write_file', 'glob', 'grep'],
      artifactPaths: ['docs/**', 'packages/protocol/**'],
      gatekeeperRequired: true,
    },
    {
      id: 'stg_code',
      pipelineId: 'pipeline_std_rd',
      order: 3,
      name: 'TDD 编码实现',
      roleName: 'TDD 编码工程师 (Senior Developer)',
      promptTemplate: '遵循 TDD 铁律，先编写处于红灯状态的自动化测试用例，再实现业务逻辑使其通过绿灯，并实施最小代码重构。',
      toolsAllowed: ['read_file', 'edit_file', 'write_file', 'glob', 'grep', 'bash'],
      artifactPaths: [],
      gatekeeperRequired: false,
    },
    {
      id: 'stg_qa',
      pipelineId: 'pipeline_std_rd',
      order: 4,
      name: '质量验收与审计',
      roleName: 'QA 验收工程师 (QA Engineer)',
      promptTemplate: '全量运行项目静态自检与自动化测试套件，排查回归漏洞并产出验收测试报告。',
      toolsAllowed: ['read_file', 'glob', 'grep', 'bash'],
      artifactPaths: ['docs/test-report.md'],
      gatekeeperRequired: true,
    },
  ],
};

export class PipelineStore {
  private readonly db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.raw.exec(`
      CREATE TABLE IF NOT EXISTS pipelines (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pipeline_stages (
        id TEXT PRIMARY KEY,
        pipeline_id TEXT NOT NULL,
        stage_order INTEGER NOT NULL,
        stage_name TEXT NOT NULL DEFAULT '',
        role_name TEXT NOT NULL,
        prompt_template TEXT NOT NULL,
        model_id TEXT,
        tools_allowed_json TEXT NOT NULL DEFAULT '[]',
        artifact_paths_json TEXT NOT NULL DEFAULT '[]',
        gatekeeper_required INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY(pipeline_id) REFERENCES pipelines(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_pipeline_stages_order ON pipeline_stages(pipeline_id, stage_order);

      CREATE TABLE IF NOT EXISTS pipeline_instances (
        instance_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        pipeline_id TEXT NOT NULL,
        pipeline_name TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        task_prompt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        current_stage_id TEXT,
        current_stage_order INTEGER NOT NULL DEFAULT 1,
        stages_json TEXT NOT NULL DEFAULT '[]',
        logs_json TEXT NOT NULL DEFAULT '[]',
        artifacts_json TEXT NOT NULL DEFAULT '[]',
        gate_records_json TEXT NOT NULL DEFAULT '[]',
        tokens_used INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_pipeline_instances_updated ON pipeline_instances(updated_at DESC);
    `);

    // 向后兼容迁移：为旧版 pipeline_stages 表补充 stage_name 列
    const stageCols = this.db.raw.prepare('PRAGMA table_info(pipeline_stages)').all() as Array<{ name: string }>;
    if (!stageCols.some((c) => c.name === 'stage_name')) {
      this.db.raw.exec("ALTER TABLE pipeline_stages ADD COLUMN stage_name TEXT NOT NULL DEFAULT ''");
    }
  }

  public create(template: PipelineTemplate): PipelineTemplate {
    const raw = this.db.raw;
    raw.exec('BEGIN IMMEDIATE;');
    try {
      const now = Date.now();
      raw.prepare(`
        INSERT INTO pipelines (id, name, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?);
      `).run(template.id, template.name, template.description || '', template.createdAt || now, template.updatedAt || now);

      const stageStmt = raw.prepare(`
        INSERT INTO pipeline_stages (id, pipeline_id, stage_order, stage_name, role_name, prompt_template, model_id, tools_allowed_json, artifact_paths_json, gatekeeper_required)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `);

      template.stages.forEach((s, idx) => {
        stageStmt.run(
          s.id,
          template.id,
          typeof s.order === 'number' ? s.order : idx + 1,
          s.name ?? '',
          s.roleName,
          s.promptTemplate || '',
          s.modelId ?? null,
          JSON.stringify(s.toolsAllowed || []),
          JSON.stringify(s.artifactPaths || []),
          s.gatekeeperRequired ? 1 : 0,
        );
      });

      raw.exec('COMMIT;');
      return this.get(template.id)!;
    } catch (err) {
      raw.exec('ROLLBACK;');
      throw err;
    }
  }

  public get(id: string): PipelineTemplate | undefined {
    const p = this.db.raw.prepare('SELECT * FROM pipelines WHERE id = ?;').get(id) as {
      id: string;
      name: string;
      description: string;
      created_at: number;
      updated_at: number;
    } | undefined;
    if (!p) return undefined;

    const stagesRaw = this.db.raw.prepare(
      'SELECT * FROM pipeline_stages WHERE pipeline_id = ? ORDER BY stage_order ASC;',
    ).all(id) as Array<{
      id: string;
      pipeline_id: string;
      stage_order: number;
      stage_name: string;
      role_name: string;
      prompt_template: string;
      model_id: string | null;
      tools_allowed_json: string;
      artifact_paths_json: string;
      gatekeeper_required: number;
    }>;

    const stages: PipelineStage[] = stagesRaw.map((r) => ({
      id: r.id,
      pipelineId: r.pipeline_id,
      order: r.stage_order,
      name: r.stage_name || undefined,
      roleName: r.role_name,
      promptTemplate: r.prompt_template,
      modelId: r.model_id ?? undefined,
      toolsAllowed: JSON.parse(r.tools_allowed_json || '[]'),
      artifactPaths: JSON.parse(r.artifact_paths_json || '[]'),
      gatekeeperRequired: r.gatekeeper_required === 1,
    }));

    return {
      id: p.id,
      name: p.name,
      description: p.description,
      stages,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    };
  }

  public list(): PipelineTemplate[] {
    const rows = this.db.raw.prepare('SELECT id FROM pipelines ORDER BY updated_at DESC;').all() as Array<{ id: string }>;
    return rows.map((r) => this.get(r.id)!).filter(Boolean);
  }

  public update(id: string, patch: Partial<Omit<PipelineTemplate, 'id' | 'createdAt'>>): boolean {
    const raw = this.db.raw;
    raw.exec('BEGIN IMMEDIATE;');
    try {
      const now = Date.now();
      if (patch.name !== undefined || patch.description !== undefined) {
        raw.prepare(`
          UPDATE pipelines
          SET name = coalesce(?, name), description = coalesce(?, description), updated_at = ?
          WHERE id = ?;
        `).run(patch.name ?? null, patch.description ?? null, now, id);
      }

      if (Array.isArray(patch.stages)) {
        raw.prepare('DELETE FROM pipeline_stages WHERE pipeline_id = ?;').run(id);
        const stageStmt = raw.prepare(`
          INSERT INTO pipeline_stages (id, pipeline_id, stage_order, stage_name, role_name, prompt_template, model_id, tools_allowed_json, artifact_paths_json, gatekeeper_required)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        `);
        patch.stages.forEach((s, idx) => {
          stageStmt.run(
            s.id,
            id,
            idx + 1,
            s.name ?? '',
            s.roleName,
            s.promptTemplate || '',
            s.modelId ?? null,
            JSON.stringify(s.toolsAllowed || []),
            JSON.stringify(s.artifactPaths || []),
            s.gatekeeperRequired ? 1 : 0,
          );
        });
      }

      raw.exec('COMMIT;');
      return true;
    } catch (err) {
      raw.exec('ROLLBACK;');
      throw err;
    }
  }

  public delete(id: string): boolean {
    const raw = this.db.raw;
    raw.exec('BEGIN IMMEDIATE;');
    try {
      raw.prepare('DELETE FROM pipeline_stages WHERE pipeline_id = ?;').run(id);
      const info = raw.prepare('DELETE FROM pipelines WHERE id = ?;').run(id);
      raw.exec('COMMIT;');
      return Number(info.changes ?? 0) > 0;
    } catch (err) {
      raw.exec('ROLLBACK;');
      throw err;
    }
  }

  /**
   * 在指定阶段后插入新阶段，并自动维护 1..N 连续单调顺序（步骤双向插入定制工作台基座，WBS-02-01-03）。
   */
  public insertStageAfter(pipelineId: string, afterStageId: string | null, stage: Omit<PipelineStage, 'pipelineId' | 'order'>): boolean {
    const t = this.get(pipelineId);
    if (!t) return false;

    const stages = [...t.stages];
    const fullStage: PipelineStage = {
      ...stage,
      pipelineId,
      order: 0,
    };

    if (afterStageId === null) {
      stages.unshift(fullStage);
    } else {
      const idx = stages.findIndex((s) => s.id === afterStageId);
      if (idx < 0) {
        stages.push(fullStage);
      } else {
        stages.splice(idx + 1, 0, fullStage);
      }
    }

    stages.forEach((s, i) => { s.order = i + 1; });
    return this.update(pipelineId, { stages });
  }

  // ==================== 流水线实例 (Pipeline Instance) CRUD ====================

  public saveInstance(inst: PipelineInstanceModel): void {
    const raw = this.db.raw;
    raw.prepare(`
      INSERT OR REPLACE INTO pipeline_instances (
        instance_id, name, pipeline_id, pipeline_name, workspace_path, task_prompt, status,
        current_stage_id, current_stage_order, stages_json, logs_json, artifacts_json, gate_records_json,
        tokens_used, error, created_at, started_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      inst.instanceId,
      inst.name,
      inst.pipelineId,
      inst.pipelineName,
      inst.workspacePath,
      inst.taskPrompt,
      inst.status,
      inst.currentStageId ?? null,
      inst.currentStageOrder,
      JSON.stringify(inst.stages || []),
      JSON.stringify(inst.logs || []),
      JSON.stringify(inst.artifacts || []),
      JSON.stringify(inst.gateRecords || []),
      inst.tokensUsed || 0,
      inst.error ?? null,
      inst.createdAt,
      inst.startedAt ?? null,
      inst.updatedAt || Date.now(),
    );
  }

  public getInstance(instanceId: string): PipelineInstanceModel | undefined {
    const r = this.db.raw.prepare('SELECT * FROM pipeline_instances WHERE instance_id = ?;').get(instanceId) as any;
    if (!r) return undefined;
    return {
      instanceId: r.instance_id,
      name: r.name,
      pipelineId: r.pipeline_id,
      pipelineName: r.pipeline_name,
      workspacePath: r.workspace_path,
      taskPrompt: r.task_prompt,
      status: r.status as PipelineInstanceStatus,
      currentStageId: r.current_stage_id ?? undefined,
      currentStageOrder: r.current_stage_order,
      stages: JSON.parse(r.stages_json || '[]'),
      logs: JSON.parse(r.logs_json || '[]'),
      artifacts: JSON.parse(r.artifacts_json || '[]'),
      gateRecords: JSON.parse(r.gate_records_json || '[]'),
      tokensUsed: r.tokens_used,
      error: r.error ?? undefined,
      createdAt: r.created_at,
      startedAt: r.started_at ?? undefined,
      updatedAt: r.updated_at,
    };
  }

  public listInstances(): PipelineInstanceModel[] {
    const rows = this.db.raw.prepare('SELECT instance_id FROM pipeline_instances ORDER BY updated_at DESC;').all() as any[];
    return rows.map((r) => this.getInstance(r.instance_id)!).filter(Boolean);
  }

  public deleteInstance(instanceId: string): boolean {
    const info = this.db.raw.prepare('DELETE FROM pipeline_instances WHERE instance_id = ?;').run(instanceId);
    return Number(info.changes ?? 0) > 0;
  }
}
