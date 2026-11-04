import type { SqliteDatabase } from './database.ts';

// ═══════════════ 类型定义（MOD-17 详细设计 §2） ═══════════════

export type SessionStatus = 'draft' | 'discussing' | 'prd_ready' | 'transitioned';
export type ChunkStatus = 'draft' | 'discussed' | 'analyzed' | 'approved';
export type TaskStatus = 'todo' | 'doing' | 'done' | 'deferred';
export type ProposalState = 'pending' | 'accepted' | 'dismissed';
export type SuggestionSource = 'coverage' | 'conflict' | 'status' | 'readiness';
export type ChunkPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type ContextSource = 'session_meta' | 'messages' | 'chunks' | 'tasks' | 'suggestions';
export type PrdGenerateMode = 'section' | 'fast';

export interface ReqSession {
  id: string;
  title: string;
  initialPrompt: string;
  status: SessionStatus;
  workspaceId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ReqAgent {
  id: string;
  sessionId: string;
  name: string;
  roleTitle: string;
  modelId: string;
  providerId: string;
  systemPrompt: string;
  isEnabled: boolean;
  sortOrder: number;
}

export interface TaskItem {
  id: string;
  sessionId: string;
  chunkId: string;
  title: string;
  acceptanceCriteria: string;
  status: TaskStatus;
  priority: ChunkPriority;
  sortOrder: number;
}

export interface ChunkNode {
  id: string;
  sessionId: string;
  parentId: string | null;
  title: string;
  description: string;
  status: ChunkStatus;
  priority: ChunkPriority;
  tags: string[];
  children: ChunkNode[];
  tasks: TaskItem[];
  discussionRounds: number;
}

export interface DetectedChunkProposal {
  kind: 'chunk';
  title: string;
  parentId: string | null;
  description: string;
  priority: ChunkPriority;
  tags: string[];
}

export interface DetectedTaskProposal {
  kind: 'task';
  chunkTitle: string;
  title: string;
  acceptanceCriteria: string;
  priority: ChunkPriority;
}

export type DetectedProposal = DetectedChunkProposal | DetectedTaskProposal;

export interface SuggestionItem {
  id: string;
  sessionId: string;
  content: string;
  sourceType: SuggestionSource;
  sourceReason: string;
  isDismissed: boolean;
}

export interface PrdSectionInput {
  title: string;
  guidance: string;
  promptTemplate: string;
  contextSources: ContextSource[];
  minWords: number | null;
  enabled: boolean;
}

export interface PrdSectionModel extends PrdSectionInput {
  id: string;
  templateId: string;
  sortOrder: number;
}

export interface PrdTemplateModel {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  isBuiltin: boolean;
  sections: PrdSectionModel[];
  updatedAt: number;
}

export interface PrdExportPayload {
  name: string;
  description: string;
  sections: PrdSectionInput[];
}

export interface PrdVersionModel {
  id: string;
  sessionId: string;
  version: number;
  markdownContent: string;
  templateId: string | null;
  exportedAt: number;
}

// ═══════════════ 校验常量 ═══════════════

const PRIORITIES: ReadonlySet<string> = new Set(['P0', 'P1', 'P2', 'P3']);
const CONTEXT_SOURCES: ReadonlySet<string> = new Set(['session_meta', 'messages', 'chunks', 'tasks', 'suggestions']);
const MAX_TITLE_LEN = 60;

export const VALID_PROPOSAL_STATES: ReadonlySet<string> = new Set(['pending', 'accepted', 'dismissed']);
const PROPOSAL_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  pending: new Set(['accepted', 'dismissed']),
  accepted: new Set<string>(),
  dismissed: new Set(['pending']),
};

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 提议 schema 校验（S3：模型输出皆数据），非法返回 null */
export function validateProposal(raw: unknown): DetectedProposal | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const p = raw as Record<string, unknown>;
  if (p.kind !== 'chunk' && p.kind !== 'task') return null;
  if (typeof p.title !== 'string' || p.title.length === 0 || p.title.length > MAX_TITLE_LEN) return null;
  if (typeof p.priority !== 'string' || !PRIORITIES.has(p.priority)) return null;
  if (p.kind === 'chunk') {
    if (p.parentId !== null && typeof p.parentId !== 'string') return null;
    if (typeof p.description !== 'string') return null;
    const tags = Array.isArray(p.tags) ? p.tags.filter((t): t is string => typeof t === 'string') : [];
    return { kind: 'chunk', title: p.title, parentId: p.parentId, description: p.description, priority: p.priority as ChunkPriority, tags };
  }
  if (typeof p.chunkTitle !== 'string' || typeof p.acceptanceCriteria !== 'string') return null;
  return { kind: 'task', chunkTitle: p.chunkTitle, title: p.title, acceptanceCriteria: p.acceptanceCriteria, priority: p.priority as ChunkPriority };
}

/** 不变量守护：任务仅允许挂在叶子分块（实现与测试共用） */
export function assertOnlyLeafHasTasks(db: SqliteDatabase, sessionId: string): void {
  const rows = db.raw
    .prepare(
      `SELECT t.id AS task_id, t.title AS task_title, t.chunk_id
       FROM req_tasks t
       WHERE t.session_id = ?
         AND EXISTS (SELECT 1 FROM req_chunks child WHERE child.parent_id = t.chunk_id)`
    )
    .all(sessionId) as Array<{ task_id: string; task_title: string; chunk_id: string }>;
  if (rows.length > 0) {
    throw new Error(
      `INVARIANT_VIOLATION: 任务挂在非叶子分块 (chunk=${rows[0].chunk_id}, task=${rows[0].task_title})`
    );
  }
}

// ═══════════════ 内置参考模板种子（12 章节，基准 docs/templates/智能研究助手_完整PRD.md） ═══════════════

interface SeedSection {
  title: string;
  guidance: string;
  promptTemplate: string;
  contextSources: ContextSource[];
  minWords: number | null;
}

const BUILTIN_SECTIONS: SeedSection[] = [
  {
    title: '1. 文档信息与交付完整性检查',
    guidance: '汇总产品定位、形态、版本状态与核心概念定义',
    promptTemplate:
      '基于 {{project.title}} 与 {{project.initial_prompt}}，撰写文档信息表：产品名称、产品形态、文档版本、核心定位。以 Markdown 表格输出，并附「必需模块清单」说明本 PRD 包含哪些章节。',
    contextSources: ['session_meta'],
    minWords: 150,
  },
  {
    title: '2. 背景与问题定义',
    guidance: '提炼讨论中的痛点、机会与本期需要回答的核心问题',
    promptTemplate:
      '阅读讨论记录与分块树，提炼：2.1 背景（现状痛点，3~5 条）；2.2 产品机会；2.3 核心问题（编号列表）。仅使用讨论中出现过的信息，禁止编造。',
    contextSources: ['messages', 'chunks'],
    minWords: 300,
  },
  {
    title: '3. 产品目标、范围与非目标',
    guidance: '明确本期目标、范围表与非目标排除项',
    promptTemplate:
      '基于分块树与讨论记录输出：3.1 本期目标（编号列表，可验证）；3.2 范围表（范围/本期方案两列）；3.3 非目标（明确排除项，每条附排除理由）。范围边界必须与分块树一致。',
    contextSources: ['chunks', 'messages'],
    minWords: 300,
  },
  {
    title: '4. 用户、场景与用户故事',
    guidance: '由分块场景推演目标用户与核心用户故事',
    promptTemplate:
      '基于分块树推演：4.1 目标用户；4.2 核心用户故事（作为…我希望…以便…，编号，覆盖每个核心分块）；4.3 典型使用场景表（场景/用户输入/系统行为/最终结果）。',
    contextSources: ['chunks', 'tasks'],
    minWords: 350,
  },
  {
    title: '5. 核心概念与统一规则',
    guidance: '定义关键业务概念与全局业务规则',
    promptTemplate:
      '从讨论记录中提炼核心概念表（概念/定义）与统一业务规则（编号列表）。概念必须是讨论中实际出现过的术语；规则必须可执行、无歧义。',
    contextSources: ['messages', 'chunks'],
    minWords: 250,
  },
  {
    title: '6. 产品流程与状态',
    guidance: '主流程、用户确认点与对象状态表',
    promptTemplate:
      '输出：6.1 主流程（text 流程图，从用户输入到最终产出）；6.2 用户确认点（编号列表）；6.3 核心对象状态表（状态/说明/允许操作）。状态与分块状态机保持一致。',
    contextSources: ['chunks', 'messages'],
    minWords: 250,
  },
  {
    title: '7. 功能需求',
    guidance: '按分块逐个展开功能说明',
    promptTemplate:
      '按分块树逐个分块撰写功能需求：功能目标 / 页面与输入 / 系统规则。每个分块一个小节，验收准则来自任务清单的 acceptance_criteria。',
    contextSources: ['chunks', 'tasks'],
    minWords: 500,
  },
  {
    title: '8. 异常流程',
    guidance: '由叶子任务边界用例归纳异常处理表',
    promptTemplate:
      '基于各叶子分块的任务验收准则与讨论中的边界场景，产出异常流程表。必须以 Markdown 表格输出，列固定为：类别 / 场景 / 系统处理 / 用户反馈 / 是否 P0。覆盖输入异常、权限异常、状态异常三类。',
    contextSources: ['tasks', 'messages'],
    minWords: 400,
  },
  {
    title: '9. 非功能需求与风险控制',
    guidance: '性能、安全与主要风险',
    promptTemplate:
      '输出：9.1 性能与稳定性要求（讨论中出现的量化指标，无则标注待定）；9.2 安全与隐私要求；9.3 主要风险与应对表（风险/影响/应对）。',
    contextSources: ['messages', 'chunks'],
    minWords: 250,
  },
  {
    title: '10. 验收标准',
    guidance: '由任务验收准则转化为可测试 AC 列表',
    promptTemplate:
      '将任务清单的验收准则转化为编号化验收标准表（编号/验收项/通过标准）。每条必须可直接转化为测试用例，覆盖正常、异常与边界。',
    contextSources: ['tasks', 'chunks'],
    minWords: 350,
  },
  {
    title: '11. 依赖与决策项',
    guidance: '外部依赖与待确认决策',
    promptTemplate:
      '输出：11.1 外部依赖清单；11.2 待确认决策表（编号/问题/影响范围/建议）。仅列讨论中遗留的未决问题。',
    contextSources: ['messages', 'suggestions'],
    minWords: 200,
  },
  {
    title: '12. 评审通过标准',
    guidance: 'PRD 通过评审的判定条件',
    promptTemplate:
      '列出本 PRD 通过评审需满足的条件（编号列表，5~8 条），覆盖范围确认、状态无歧义、异常可测试、验收可执行。',
    contextSources: ['session_meta'],
    minWords: 150,
  },
];

export const BUILTIN_PRD_TEMPLATE = {
  id: 'tpl_builtin_full_prd',
  name: '完整 PRD 标准模板',
  description: '以企业级 16 章 PRD 结构为基准的 12 核心章节模板',
} as const;

// ═══════════════ Store ═══════════════

export class RequirementsStore {
  private readonly db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
    this.ensureSchema();
    this.seedBuiltinTemplate();
  }

  private ensureSchema(): void {
    this.db.raw.exec(`
      CREATE TABLE IF NOT EXISTS req_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        initial_prompt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'discussing',
        workspace_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_req_sessions_status ON req_sessions(status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS req_agents (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES req_sessions(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        role_title TEXT NOT NULL,
        model_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        system_prompt TEXT NOT NULL,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_req_agents_session ON req_agents(session_id, sort_order);

      CREATE TABLE IF NOT EXISTS req_chunks (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES req_sessions(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES req_chunks(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        priority TEXT NOT NULL DEFAULT 'P1',
        tags TEXT NOT NULL DEFAULT '',
        discussion_rounds INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_req_chunks_session ON req_chunks(session_id);

      CREATE TABLE IF NOT EXISTS req_tasks (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES req_sessions(id) ON DELETE CASCADE,
        chunk_id TEXT NOT NULL REFERENCES req_chunks(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        acceptance_criteria TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'todo',
        priority TEXT NOT NULL DEFAULT 'P1',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_req_tasks_chunk ON req_tasks(chunk_id, sort_order);

      CREATE TABLE IF NOT EXISTS req_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES req_sessions(id) ON DELETE CASCADE,
        agent_id TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        reasoning_content TEXT,
        proposal_json TEXT,
        proposal_state TEXT,
        is_edited INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_req_messages_session ON req_messages(session_id, created_at);

      CREATE TABLE IF NOT EXISTS req_suggestions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES req_sessions(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_reason TEXT NOT NULL,
        is_dismissed INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_req_suggestions_session ON req_suggestions(session_id);

      CREATE TABLE IF NOT EXISTS req_prds (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES req_sessions(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        markdown_content TEXT NOT NULL,
        template_id TEXT,
        exported_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_req_prds_session ON req_prds(session_id, version DESC);

      CREATE TABLE IF NOT EXISTS prd_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        is_default INTEGER NOT NULL DEFAULT 0,
        is_builtin INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS prd_template_sections (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL REFERENCES prd_templates(id) ON DELETE CASCADE,
        sort_order INTEGER NOT NULL,
        title TEXT NOT NULL,
        guidance TEXT NOT NULL DEFAULT '',
        prompt_template TEXT NOT NULL,
        context_sources TEXT NOT NULL DEFAULT '[]',
        min_words INTEGER,
        enabled INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_prd_sections_tpl ON prd_template_sections(template_id, sort_order);
    `);
  }

  private seedBuiltinTemplate(): void {
    const exists = this.db.raw.prepare('SELECT id FROM prd_templates WHERE id = ?').get(BUILTIN_PRD_TEMPLATE.id);
    if (exists) return;
    const now = Date.now();
    const raw = this.db.raw;
    raw.exec('BEGIN IMMEDIATE;');
    try {
      raw
        .prepare('INSERT INTO prd_templates (id, name, description, is_default, is_builtin, created_at, updated_at) VALUES (?,?,?,1,1,?,?)')
        .run(BUILTIN_PRD_TEMPLATE.id, BUILTIN_PRD_TEMPLATE.name, BUILTIN_PRD_TEMPLATE.description, now, now);
      const ins = raw.prepare(
        'INSERT INTO prd_template_sections (id, template_id, sort_order, title, guidance, prompt_template, context_sources, min_words, enabled) VALUES (?,?,?,?,?,?,?,?,1)'
      );
      BUILTIN_SECTIONS.forEach((sec, i) => {
        ins.run(genId('sec'), BUILTIN_PRD_TEMPLATE.id, i + 1, sec.title, sec.guidance, sec.promptTemplate, JSON.stringify(sec.contextSources), sec.minWords);
      });
      raw.exec('COMMIT;');
    } catch (e) {
      raw.exec('ROLLBACK;');
      throw e;
    }
  }

  // ═══ sessions ═══

  private rowToSession(r: Record<string, unknown>): ReqSession {
    return {
      id: r.id as string,
      title: r.title as string,
      initialPrompt: r.initial_prompt as string,
      status: r.status as SessionStatus,
      workspaceId: (r.workspace_id as string) ?? null,
      createdAt: r.created_at as number,
      updatedAt: r.updated_at as number,
    };
  }

  public createSession(input: { title: string; initialPrompt: string; workspaceId?: string }): ReqSession {
    const now = Date.now();
    const session: ReqSession = {
      id: genId('req'),
      title: input.title,
      initialPrompt: input.initialPrompt,
      status: 'discussing',
      workspaceId: input.workspaceId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.db.raw
      .prepare('INSERT INTO req_sessions (id, title, initial_prompt, status, workspace_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(session.id, session.title, session.initialPrompt, session.status, session.workspaceId, session.createdAt, session.updatedAt);
    return session;
  }

  public getSession(id: string): ReqSession | undefined {
    const r = this.db.raw.prepare('SELECT * FROM req_sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? this.rowToSession(r) : undefined;
  }

  public listSessions(): ReqSession[] {
    const rows = this.db.raw.prepare('SELECT * FROM req_sessions ORDER BY updated_at DESC').all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToSession(r));
  }

  public updateSessionStatus(id: string, status: SessionStatus): void {
    const res = this.db.raw
      .prepare('UPDATE req_sessions SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, Date.now(), id);
    if (res.changes === 0) throw new Error(`SESSION_NOT_FOUND: ${id}`);
  }

  public deleteSession(id: string): void {
    this.db.raw.prepare('DELETE FROM req_sessions WHERE id = ?').run(id);
  }

  // ═══ agents ═══

  public insertAgent(input: { sessionId: string; name: string; roleTitle: string; modelId: string; providerId: string; systemPrompt: string; sortOrder?: number }): ReqAgent {
    const agent: ReqAgent = {
      id: genId('ag'),
      sessionId: input.sessionId,
      name: input.name,
      roleTitle: input.roleTitle,
      modelId: input.modelId,
      providerId: input.providerId,
      systemPrompt: input.systemPrompt,
      isEnabled: true,
      sortOrder: input.sortOrder ?? 0,
    };
    this.db.raw
      .prepare('INSERT INTO req_agents (id, session_id, name, role_title, model_id, provider_id, system_prompt, is_enabled, sort_order, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(agent.id, agent.sessionId, agent.name, agent.roleTitle, agent.modelId, agent.providerId, agent.systemPrompt, 1, agent.sortOrder, Date.now());
    return agent;
  }

  public listAgents(sessionId: string): ReqAgent[] {
    const rows = this.db.raw.prepare('SELECT * FROM req_agents WHERE session_id = ? ORDER BY sort_order').all(sessionId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as string,
      sessionId: r.session_id as string,
      name: r.name as string,
      roleTitle: r.role_title as string,
      modelId: r.model_id as string,
      providerId: r.provider_id as string,
      systemPrompt: r.system_prompt as string,
      isEnabled: r.is_enabled === 1,
      sortOrder: r.sort_order as number,
    }));
  }

  public deleteAgent(id: string): void {
    this.db.raw.prepare('DELETE FROM req_agents WHERE id = ?').run(id);
  }

  // ═══ chunks ═══

  private rowToChunk(r: Record<string, unknown>): ChunkNode {
    return {
      id: r.id as string,
      sessionId: r.session_id as string,
      parentId: (r.parent_id as string) ?? null,
      title: r.title as string,
      description: r.description as string,
      status: r.status as ChunkStatus,
      priority: r.priority as ChunkPriority,
      tags: (r.tags as string) ? (r.tags as string).split(',').filter(Boolean) : [],
      children: [],
      tasks: [],
      discussionRounds: r.discussion_rounds as number,
    };
  }

  public insertChunk(input: { sessionId: string; parentId: string | null; title: string; description?: string; priority?: ChunkPriority; tags?: string[] }): ChunkNode {
    if (input.parentId !== null) {
      const parent = this.db.raw.prepare('SELECT id FROM req_chunks WHERE id = ? AND session_id = ?').get(input.parentId, input.sessionId);
      if (!parent) throw new Error(`PARENT_CHUNK_NOT_FOUND: ${input.parentId}`);
    }
    const now = Date.now();
    const chunk: ChunkNode = {
      id: genId('ch'),
      sessionId: input.sessionId,
      parentId: input.parentId,
      title: input.title,
      description: input.description ?? '',
      status: 'draft',
      priority: input.priority ?? 'P1',
      tags: input.tags ?? [],
      children: [],
      tasks: [],
      discussionRounds: 0,
    };
    this.db.raw
      .prepare('INSERT INTO req_chunks (id, session_id, parent_id, title, description, status, priority, tags, discussion_rounds, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(chunk.id, chunk.sessionId, chunk.parentId, chunk.title, chunk.description, chunk.status, chunk.priority, chunk.tags.join(','), 0, now, now);
    return chunk;
  }

  public listChunksTree(sessionId: string): ChunkNode[] {
    const rows = this.db.raw.prepare('SELECT * FROM req_chunks WHERE session_id = ? ORDER BY created_at').all(sessionId) as Array<Record<string, unknown>>;
    const taskRows = this.db.raw.prepare('SELECT * FROM req_tasks WHERE session_id = ? ORDER BY sort_order, created_at').all(sessionId) as Array<Record<string, unknown>>;
    const tasksByChunk = new Map<string, TaskItem[]>();
    for (const t of taskRows) {
      const item: TaskItem = {
        id: t.id as string,
        sessionId: t.session_id as string,
        chunkId: t.chunk_id as string,
        title: t.title as string,
        acceptanceCriteria: t.acceptance_criteria as string,
        status: t.status as TaskStatus,
        priority: t.priority as ChunkPriority,
        sortOrder: t.sort_order as number,
      };
      const arr = tasksByChunk.get(item.chunkId) ?? [];
      arr.push(item);
      tasksByChunk.set(item.chunkId, arr);
    }
    const nodes = new Map<string, ChunkNode>();
    const roots: ChunkNode[] = [];
    for (const r of rows) {
      const node = this.rowToChunk(r);
      node.tasks = tasksByChunk.get(node.id) ?? [];
      nodes.set(node.id, node);
    }
    for (const node of nodes.values()) {
      if (node.parentId !== null && nodes.has(node.parentId)) {
        nodes.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  public updateChunk(id: string, patch: { title?: string; description?: string; status?: ChunkStatus; priority?: ChunkPriority; tags?: string[]; discussionRounds?: number }): void {
    const cur = this.db.raw.prepare('SELECT * FROM req_chunks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!cur) throw new Error(`CHUNK_NOT_FOUND: ${id}`);
    this.db.raw
      .prepare('UPDATE req_chunks SET title=?, description=?, status=?, priority=?, tags=?, discussion_rounds=?, updated_at=? WHERE id=?')
      .run(
        patch.title ?? (cur.title as string),
        patch.description ?? (cur.description as string),
        patch.status ?? (cur.status as string),
        patch.priority ?? (cur.priority as string),
        patch.tags ? patch.tags.join(',') : (cur.tags as string),
        patch.discussionRounds ?? (cur.discussion_rounds as number),
        Date.now(),
        id
      );
  }

  public deleteChunk(id: string): void {
    this.db.raw.prepare('DELETE FROM req_chunks WHERE id = ?').run(id);
  }

  // ═══ tasks ═══

  public insertTask(input: { sessionId: string; chunkId: string; title: string; acceptanceCriteria?: string; priority?: ChunkPriority; sortOrder?: number }): TaskItem {
    const chunk = this.db.raw.prepare('SELECT id FROM req_chunks WHERE id = ? AND session_id = ?').get(input.chunkId, input.sessionId);
    if (!chunk) throw new Error(`CHUNK_NOT_FOUND: ${input.chunkId}`);
    const now = Date.now();
    const task: TaskItem = {
      id: genId('tk'),
      sessionId: input.sessionId,
      chunkId: input.chunkId,
      title: input.title,
      acceptanceCriteria: input.acceptanceCriteria ?? '',
      status: 'todo',
      priority: input.priority ?? 'P1',
      sortOrder: input.sortOrder ?? 0,
    };
    this.db.raw
      .prepare('INSERT INTO req_tasks (id, session_id, chunk_id, title, acceptance_criteria, status, priority, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(task.id, task.sessionId, task.chunkId, task.title, task.acceptanceCriteria, task.status, task.priority, task.sortOrder, now, now);
    return task;
  }

  public updateTask(id: string, patch: { title?: string; acceptanceCriteria?: string; status?: TaskStatus; priority?: ChunkPriority }): void {
    const cur = this.db.raw.prepare('SELECT * FROM req_tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!cur) throw new Error(`TASK_NOT_FOUND: ${id}`);
    this.db.raw
      .prepare('UPDATE req_tasks SET title=?, acceptance_criteria=?, status=?, priority=?, updated_at=? WHERE id=?')
      .run(
        patch.title ?? (cur.title as string),
        patch.acceptanceCriteria ?? (cur.acceptance_criteria as string),
        patch.status ?? (cur.status as string),
        patch.priority ?? (cur.priority as string),
        Date.now(),
        id
      );
  }

  public deleteTask(id: string): void {
    this.db.raw.prepare('DELETE FROM req_tasks WHERE id = ?').run(id);
  }

  // ═══ messages ═══

  public insertMessage(input: { sessionId: string; agentId?: string | null; role: 'user' | 'assistant' | 'system'; content: string; reasoningContent?: string | null; proposalJson?: DetectedProposal | null }): { id: string } {
    const id = genId('msg');
    this.db.raw
      .prepare('INSERT INTO req_messages (id, session_id, agent_id, role, content, reasoning_content, proposal_json, proposal_state, is_edited, created_at) VALUES (?,?,?,?,?,?,?,?,0,?)')
      .run(id, input.sessionId, input.agentId ?? null, input.role, input.content, input.reasoningContent ?? null, input.proposalJson ? JSON.stringify(input.proposalJson) : null, input.proposalJson ? 'pending' : null, Date.now());
    return { id };
  }

  public listMessages(sessionId: string): Array<Record<string, unknown>> {
    return this.db.raw.prepare('SELECT * FROM req_messages WHERE session_id = ? ORDER BY created_at').all(sessionId) as Array<Record<string, unknown>>;
  }

  public updateProposalState(messageId: string, state: ProposalState): void {
    const cur = this.db.raw.prepare('SELECT proposal_state FROM req_messages WHERE id = ?').get(messageId) as { proposal_state: string | null } | undefined;
    if (!cur) throw new Error(`MESSAGE_NOT_FOUND: ${messageId}`);
    if (cur.proposal_state === null) throw new Error('NO_PROPOSAL_ON_MESSAGE');
    const allowed = PROPOSAL_TRANSITIONS[cur.proposal_state];
    if (!allowed || !allowed.has(state)) {
      throw new Error(`INVALID_PROPOSAL_TRANSITION: ${cur.proposal_state} -> ${state}`);
    }
    this.db.raw.prepare('UPDATE req_messages SET proposal_state = ? WHERE id = ?').run(state, messageId);
  }

  // ═══ suggestions ═══

  public replaceSuggestions(sessionId: string, items: Array<{ content: string; sourceType: SuggestionSource; sourceReason: string }>): void {
    const raw = this.db.raw;
    raw.exec('BEGIN IMMEDIATE;');
    try {
      // 保留 dismissed 状态（按 content+sourceType 哈希匹配）
      const prev = raw.prepare('SELECT content, source_type, is_dismissed FROM req_suggestions WHERE session_id = ?').all(sessionId) as Array<{ content: string; source_type: string; is_dismissed: number }>;
      const dismissedSet = new Set(prev.filter((p) => p.is_dismissed === 1).map((p) => `${p.source_type}::${p.content}`));
      raw.prepare('DELETE FROM req_suggestions WHERE session_id = ?').run(sessionId);
      const ins = raw.prepare('INSERT INTO req_suggestions (id, session_id, content, source_type, source_reason, is_dismissed, created_at) VALUES (?,?,?,?,?,?,?)');
      const now = Date.now();
      for (const item of items) {
        const wasDismissed = dismissedSet.has(`${item.sourceType}::${item.content}`) ? 1 : 0;
        ins.run(genId('sg'), sessionId, item.content, item.sourceType, item.sourceReason, wasDismissed, now);
      }
      raw.exec('COMMIT;');
    } catch (e) {
      raw.exec('ROLLBACK;');
      throw e;
    }
  }

  public listSuggestions(sessionId: string): SuggestionItem[] {
    const rows = this.db.raw.prepare('SELECT * FROM req_suggestions WHERE session_id = ? ORDER BY created_at').all(sessionId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as string,
      sessionId: r.session_id as string,
      content: r.content as string,
      sourceType: r.source_type as SuggestionSource,
      sourceReason: r.source_reason as string,
      isDismissed: r.is_dismissed === 1,
    }));
  }

  // ═══ PRD 版本 ═══

  public insertPrd(sessionId: string, markdown: string, templateId: string | null): PrdVersionModel {
    const maxRow = this.db.raw.prepare('SELECT MAX(version) AS v FROM req_prds WHERE session_id = ?').get(sessionId) as { v: number | null };
    const version = (maxRow.v ?? 0) + 1;
    const id = genId('prd');
    this.db.raw
      .prepare('INSERT INTO req_prds (id, session_id, version, markdown_content, template_id, exported_at) VALUES (?,?,?,?,?,?)')
      .run(id, sessionId, version, markdown, templateId, Date.now());
    return { id, sessionId, version, markdownContent: markdown, templateId, exportedAt: Date.now() };
  }

  public latestPrd(sessionId: string): PrdVersionModel | undefined {
    const r = this.db.raw.prepare('SELECT * FROM req_prds WHERE session_id = ? ORDER BY version DESC LIMIT 1').get(sessionId) as Record<string, unknown> | undefined;
    return r
      ? { id: r.id as string, sessionId: r.session_id as string, version: r.version as number, markdownContent: r.markdown_content as string, templateId: (r.template_id as string) ?? null, exportedAt: r.exported_at as number }
      : undefined;
  }

  public getPrdVersion(sessionId: string, version: number): PrdVersionModel | undefined {
    const r = this.db.raw.prepare('SELECT * FROM req_prds WHERE session_id = ? AND version = ?').get(sessionId, version) as Record<string, unknown> | undefined;
    return r
      ? { id: r.id as string, sessionId: r.session_id as string, version: r.version as number, markdownContent: r.markdown_content as string, templateId: (r.template_id as string) ?? null, exportedAt: r.exported_at as number }
      : undefined;
  }

  // ═══ PRD 模板 ═══

  private rowToTemplate(r: Record<string, unknown>, sections: PrdSectionModel[]): PrdTemplateModel {
    return {
      id: r.id as string,
      name: r.name as string,
      description: r.description as string,
      isDefault: r.is_default === 1,
      isBuiltin: r.is_builtin === 1,
      sections,
      updatedAt: r.updated_at as number,
    };
  }

  private loadSections(templateId: string): PrdSectionModel[] {
    const rows = this.db.raw.prepare('SELECT * FROM prd_template_sections WHERE template_id = ? ORDER BY sort_order').all(templateId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as string,
      templateId: r.template_id as string,
      sortOrder: r.sort_order as number,
      title: r.title as string,
      guidance: r.guidance as string,
      promptTemplate: r.prompt_template as string,
      contextSources: this.parseContextSources(r.context_sources as string),
      minWords: (r.min_words as number | null) ?? null,
      enabled: r.enabled === 1,
    }));
  }

  private parseContextSources(json: string): ContextSource[] {
    try {
      const arr = JSON.parse(json) as unknown;
      if (!Array.isArray(arr)) return [];
      return arr.filter((x): x is ContextSource => typeof x === 'string' && CONTEXT_SOURCES.has(x));
    } catch {
      return [];
    }
  }

  public listPrdTemplates(): PrdTemplateModel[] {
    const rows = this.db.raw.prepare('SELECT * FROM prd_templates ORDER BY updated_at DESC').all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToTemplate(r, this.loadSections(r.id as string)));
  }

  public getPrdTemplate(id: string): PrdTemplateModel | undefined {
    const r = this.db.raw.prepare('SELECT * FROM prd_templates WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? this.rowToTemplate(r, this.loadSections(id)) : undefined;
  }

  public createPrdTemplate(input: { name: string; description: string; sections?: PrdSectionInput[] }): PrdTemplateModel {
    const now = Date.now();
    const id = genId('tpl');
    const raw = this.db.raw;
    raw.exec('BEGIN IMMEDIATE;');
    try {
      raw.prepare('INSERT INTO prd_templates (id, name, description, is_default, is_builtin, created_at, updated_at) VALUES (?,?,?,0,0,?,?)').run(id, input.name, input.description, now, now);
      this.writeSections(id, input.sections ?? []);
      raw.exec('COMMIT;');
    } catch (e) {
      raw.exec('ROLLBACK;');
      throw e;
    }
    return this.getPrdTemplate(id)!;
  }

  private writeSections(templateId: string, sections: PrdSectionInput[]): void {
    this.db.raw.prepare('DELETE FROM prd_template_sections WHERE template_id = ?').run(templateId);
    const ins = this.db.raw.prepare('INSERT INTO prd_template_sections (id, template_id, sort_order, title, guidance, prompt_template, context_sources, min_words, enabled) VALUES (?,?,?,?,?,?,?,?,?)');
    sections.forEach((sec, i) => {
      if (typeof sec.promptTemplate !== 'string' || sec.promptTemplate.length === 0) {
        throw new Error('INVALID_SECTION_SCHEMA: promptTemplate 必填');
      }
      if (typeof sec.title !== 'string' || sec.title.length === 0) {
        throw new Error('INVALID_SECTION_SCHEMA: title 必填');
      }
      for (const src of sec.contextSources) {
        if (!CONTEXT_SOURCES.has(src)) throw new Error(`INVALID_SECTION_SCHEMA: 未知上下文源 ${src}`);
      }
      ins.run(genId('sec'), templateId, i + 1, sec.title, sec.guidance ?? '', sec.promptTemplate, JSON.stringify(sec.contextSources ?? []), sec.minWords ?? null, sec.enabled === false ? 0 : 1);
    });
  }

  public updatePrdTemplate(id: string, patch: { name?: string; description?: string; sections?: PrdSectionInput[] }): void {
    const cur = this.db.raw.prepare('SELECT * FROM prd_templates WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!cur) throw new Error(`TEMPLATE_NOT_FOUND: ${id}`);
    const raw = this.db.raw;
    raw.exec('BEGIN IMMEDIATE;');
    try {
      raw.prepare('UPDATE prd_templates SET name=?, description=?, updated_at=? WHERE id=?').run(patch.name ?? (cur.name as string), patch.description ?? (cur.description as string), Date.now(), id);
      if (patch.sections) this.writeSections(id, patch.sections);
      raw.exec('COMMIT;');
    } catch (e) {
      raw.exec('ROLLBACK;');
      throw e;
    }
  }

  public deletePrdTemplate(id: string): void {
    const cur = this.db.raw.prepare('SELECT is_builtin FROM prd_templates WHERE id = ?').get(id) as { is_builtin: number } | undefined;
    if (!cur) throw new Error(`TEMPLATE_NOT_FOUND: ${id}`);
    if (cur.is_builtin === 1) throw new Error('BUILTIN_TEMPLATE_DELETE_FORBIDDEN');
    this.db.raw.prepare('DELETE FROM prd_templates WHERE id = ?').run(id);
  }

  public setDefaultPrdTemplate(id: string): void {
    const cur = this.db.raw.prepare('SELECT id FROM prd_templates WHERE id = ?').get(id);
    if (!cur) throw new Error(`TEMPLATE_NOT_FOUND: ${id}`);
    const raw = this.db.raw;
    raw.exec('BEGIN IMMEDIATE;');
    try {
      raw.prepare('UPDATE prd_templates SET is_default = 0 WHERE is_default = 1').run();
      raw.prepare('UPDATE prd_templates SET is_default = 1 WHERE id = ?').run(id);
      raw.exec('COMMIT;');
    } catch (e) {
      raw.exec('ROLLBACK;');
      throw e;
    }
  }

  public exportPrdTemplate(id: string): PrdExportPayload {
    const tpl = this.getPrdTemplate(id);
    if (!tpl) throw new Error(`TEMPLATE_NOT_FOUND: ${id}`);
    return {
      name: tpl.name,
      description: tpl.description,
      sections: tpl.sections.map((s) => ({ title: s.title, guidance: s.guidance, promptTemplate: s.promptTemplate, contextSources: s.contextSources, minWords: s.minWords, enabled: s.enabled })),
    };
  }

  public importPrdTemplate(payload: PrdExportPayload): PrdTemplateModel {
    if (typeof payload.name !== 'string' || payload.name.length === 0) throw new Error('INVALID_IMPORT_SCHEMA: name 必填');
    if (!Array.isArray(payload.sections)) throw new Error('INVALID_IMPORT_SCHEMA: sections 必须为数组');
    return this.createPrdTemplate({ name: payload.name, description: payload.description ?? '', sections: payload.sections });
  }
}
