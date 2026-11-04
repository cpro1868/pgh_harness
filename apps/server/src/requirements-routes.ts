import type http from 'node:http';
import { RequirementsStore, BUILTIN_PRD_TEMPLATE } from '../../../packages/plugins/storage-sqlite/src/requirements-schema.ts';
import type { SqliteDatabase } from '../../../packages/plugins/storage-sqlite/src/database.ts';
import type { DetectedProposal } from '../../../packages/plugins/storage-sqlite/src/requirements-schema.ts';
import { runTurn, acceptProposal, detectEditDivergence } from '../../../packages/core/src/requirements/engine.ts';
import type { StreamEvent } from '../../../packages/core/src/requirements/engine.ts';
import { generatePrd } from '../../../packages/core/src/requirements/prd-engine.ts';
import { buildSectionPrompt } from '../../../packages/core/src/requirements/prd-engine.ts';
import type { PrdStreamEvent } from '../../../packages/core/src/requirements/prd-engine.ts';
import { recomputeSuggestions } from '../../../packages/core/src/requirements/diagnostics.ts';

/** 服务端注入的 LLM 通道（由 HarnessServer 提供真实凭据与流式通道） */
export interface RequirementsLlmBridge {
  /** 研讨回合对话（非工具、流式可选） */
  chat: (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) => Promise<string>;
  /** PRD 章节撰写 */
  chatPrd: (messages: Array<{ role: 'system' | 'user'; content: string }>) => Promise<string>;
  /** Agent 绑定的模型信息（用于 UI 展示） */
  resolveAgentModel: (agent: { modelId: string; providerId: string }) => { ok: boolean };
}

export interface RequirementsRouteDeps {
  db: SqliteDatabase;
  llm: RequirementsLlmBridge;
  json?: (res: http.ServerResponse, data: unknown) => void;
  readJsonBody?: <T>(req: http.IncomingMessage) => Promise<T>;
}

const DEFAULT_AGENTS: Array<{ name: string; roleTitle: string; systemPrompt: string }> = [
  {
    name: '产品分析师',
    roleTitle: '产品分析师 (PM)',
    systemPrompt: '你是资深产品分析师。负责梳理用户痛点、业务流程、功能边界、排除项与交互预期。主动提问澄清模糊点，严禁臆造需求。',
  },
  {
    name: '技术架构师',
    roleTitle: '技术架构师 (Architect)',
    systemPrompt: '你是系统架构师。负责评估技术选型、存储模型、接口契约、并发性能与依赖包。对不可行方案直接指出并给出替代。',
  },
  {
    name: '质检与安全专家',
    roleTitle: '质检与安全专家 (QA/Security)',
    systemPrompt: '你是 QA 与安全专家。负责挖掘异常分支、边界用例、幂等重试、权限防越权与安全审计要求。',
  },
];

export class RequirementsRoutes {
  public readonly store: RequirementsStore;
  private deps: RequirementsRouteDeps;
  /** 由 HarnessServer 在构造后注入（json/readJsonBody 为原型方法） */
  public setHttpHelpers(helpers: { json: NonNullable<RequirementsRouteDeps['json']>; readJsonBody: NonNullable<RequirementsRouteDeps['readJsonBody']> }): void {
    this.deps.json = helpers.json;
    this.deps.readJsonBody = helpers.readJsonBody;
  }
  /** SSE 订阅通道（回合事件广播） */
  private sseClients = new Map<string, Set<http.ServerResponse>>();

  constructor(deps: RequirementsRouteDeps) {
    this.deps = deps;
    this.store = new RequirementsStore(deps.db);
  }

  private sseWrite(res: http.ServerResponse, evt: StreamEvent | PrdStreamEvent | { type: string; [k: string]: unknown }): void {
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
  }

  private broadcast(sessionId: string, evt: StreamEvent | PrdStreamEvent): void {
    const clients = this.sseClients.get(sessionId);
    if (!clients) return;
    for (const res of clients) this.sseWrite(res, evt);
  }

  /** 路由入口：返回 true 表示已处理 */
  public async handle(req: http.IncomingMessage, res: http.ServerResponse, pathname: string, method: string): Promise<boolean> {
    const { json, readJsonBody } = this.deps;
    if (!json || !readJsonBody) throw new Error('HTTP_HELPERS_NOT_BOUND: 需在 start() 调用 setHttpHelpers');
    const jsonFn = json;
    const readBody = readJsonBody;

    // ═══ 会话集合 ═══
    if (pathname === '/api/requirements') {
      if (method === 'GET') {
        const sessions = this.store.listSessions();
        jsonFn(res, {
          code: 0,
          data: {
            sessions,
            stats: {
              total: sessions.length,
              discussing: sessions.filter((s: (typeof sessions)[number]) => s.status === 'discussing').length,
              prdReady: sessions.filter((s: (typeof sessions)[number]) => s.status === 'prd_ready').length,
              draft: sessions.filter((s: (typeof sessions)[number]) => s.status === 'draft').length,
            },
          },
        });
        return true;
      }
      if (method === 'POST') {
        const body = await readBody<{ title?: string; initialPrompt?: string; workspaceId?: string }>(req);
        if (!body.initialPrompt || typeof body.initialPrompt !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 400, message: 'initialPrompt 必填' }));
          return true;
        }
        const session = this.store.createSession({
          title: (body.title ?? body.initialPrompt.slice(0, 20)).trim() || '未命名探索',
          initialPrompt: body.initialPrompt,
          workspaceId: body.workspaceId,
        });
        const agents = DEFAULT_AGENTS.map((a, i) => this.store.insertAgent({ sessionId: session.id, name: a.name, roleTitle: a.roleTitle, systemPrompt: a.systemPrompt, modelId: 'default', providerId: 'default', sortOrder: i }));
        jsonFn(res, { code: 0, data: { session, agents } });
        return true;
      }
    }

    // ═══ PRD 模板库（置于 :id 路由之前） ═══
    if (pathname === '/api/prd-templates') {
      if (method === 'GET') {
        jsonFn(res, { code: 0, data: { templates: this.store.listPrdTemplates() } });
        return true;
      }
      if (method === 'POST') {
        const body = await readBody<{ name?: string; description?: string; copyFrom?: string; sections?: unknown[] }>(req);
        try {
          if (body.copyFrom) {
            const payload = this.store.exportPrdTemplate(body.copyFrom);
            const tpl = this.store.importPrdTemplate({ ...payload, name: body.name ?? `${payload.name} 副本` });
            jsonFn(res, { code: 0, data: { template: tpl } });
          } else {
            if (!body.name) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ code: 400, message: 'name 必填' }));
              return true;
            }
            const tpl = this.store.createPrdTemplate({ name: body.name, description: body.description ?? '', sections: (body.sections ?? []) as never });
            jsonFn(res, { code: 0, data: { template: tpl } });
          }
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 400, message: err instanceof Error ? err.message : String(err) }));
        }
        return true;
      }
    }

    const tplIdMatch = pathname.match(/^\/api\/prd-templates\/([^/]+)(\/(default|preview|export|import))?$/);
    if (tplIdMatch) {
      const tplId = decodeURIComponent(tplIdMatch[1] as string);
      const action = tplIdMatch[3];
      if (!action && method === 'GET') {
        const tpl = this.store.getPrdTemplate(tplId);
        if (!tpl) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code: 404, message: '模板不存在' })); return true; }
        jsonFn(res, { code: 0, data: { template: tpl } });
        return true;
      }
      if (!action && method === 'PUT') {
        const body = await readBody<{ name?: string; description?: string; sections?: unknown[] }>(req);
        try {
          this.store.updatePrdTemplate(tplId, { name: body.name, description: body.description, sections: body.sections as never });
          jsonFn(res, { code: 0, data: { template: this.store.getPrdTemplate(tplId) } });
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 400, message: err instanceof Error ? err.message : String(err) }));
        }
        return true;
      }
      if (!action && method === 'DELETE') {
        try {
          this.store.deletePrdTemplate(tplId);
          jsonFn(res, { code: 0, data: { ok: true } });
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 400, message: err instanceof Error ? err.message : String(err) }));
        }
        return true;
      }
      if (action === 'default' && method === 'POST') {
        try {
          this.store.setDefaultPrdTemplate(tplId);
          jsonFn(res, { code: 0, data: { ok: true } });
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 400, message: err instanceof Error ? err.message : String(err) }));
        }
        return true;
      }
      if (action === 'preview' && method === 'POST') {
        const body = await readBody<{ sessionId?: string }>(req);
        try {
          const tpl = this.store.getPrdTemplate(tplId);
          if (!tpl) throw new Error('TEMPLATE_NOT_FOUND');
          const sid = body.sessionId ?? this.store.listSessions()[0]?.id;
          if (!sid) throw new Error('NO_SESSION: 暂无探索会话可供 dry-run');
          const session = this.store.getSession(sid)!;
          const snapshot = {
            session: { title: session.title, initialPrompt: session.initialPrompt },
            chunkTree: this.store.listChunksTree(sid),
            messages: this.store.listMessages(sid).map((m: Record<string, unknown>) => ({ role: m.role as string, content: m.content as string })),
            suggestions: this.store.listSuggestions(sid).map((s) => ({ content: s.content, isDismissed: s.isDismissed })),
          };
          const first = tpl.sections.find((s) => s.enabled) ?? tpl.sections[0];
          const rendered = buildSectionPrompt(first.guidance, first, snapshot);
          jsonFn(res, { code: 0, data: { rendered } });
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 400, message: err instanceof Error ? err.message : String(err) }));
        }
        return true;
      }
      if (action === 'export' && method === 'GET') {
        try {
          jsonFn(res, { code: 0, data: this.store.exportPrdTemplate(tplId) });
        } catch (err) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 404, message: err instanceof Error ? err.message : String(err) }));
        }
        return true;
      }
    }

    // ═══ 单会话 :id ═══
    const idMatch = pathname.match(/^\/api\/requirements\/([^/]+)$/);
    if (idMatch) {
      const sessionId = decodeURIComponent(idMatch[1] as string);
      if (method === 'GET') {
        const session = this.store.getSession(sessionId);
        if (!session) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code: 404, message: '会话不存在' })); return true; }
        jsonFn(res, {
          code: 0,
          data: {
            session,
            agents: this.store.listAgents(sessionId),
            messages: this.store.listMessages(sessionId),
            chunkTree: this.store.listChunksTree(sessionId),
            suggestions: this.store.listSuggestions(sessionId),
          },
        });
        return true;
      }
      if (method === 'PATCH') {
        const body = await readBody<{ status?: string; title?: string; workspaceId?: string }>(req);
        const session = this.store.getSession(sessionId);
        if (!session) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code: 404, message: '会话不存在' })); return true; }
        if (body.status) {
          const valid = ['draft', 'discussing', 'prd_ready', 'transitioned'];
          if (!valid.includes(body.status)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code: 400, message: '非法状态' })); return true; }
          this.store.updateSessionStatus(sessionId, body.status as never);
        }
        jsonFn(res, { code: 0, data: { session: this.store.getSession(sessionId) } });
        return true;
      }
      if (method === 'DELETE') {
        this.store.deleteSession(sessionId);
        jsonFn(res, { code: 0, data: { ok: true } });
        return true;
      }
    }

    // ═══ 子资源 ═══
      const subMatch = pathname.match(/^\/api\/requirements\/([^/]+)\/(messages|stream|chunks|tasks|agents|proposals|prd|transition)(\/.*)?$/);
    if (subMatch) {
      const sessionId = decodeURIComponent(subMatch[1] as string);
      const sub = subMatch[2] as string;
      const session = this.store.getSession(sessionId);
      if (!session && sub !== 'stream') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 404, message: '会话不存在' }));
        return true;
      }

      // 研讨回合（SSE 响应）
      if (sub === 'messages' && method === 'POST') {
        const body = await readBody<{ content?: string }>(req);
        if (!body.content) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 400, message: 'content 必填' }));
          return true;
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        const agents = this.store.listAgents(sessionId);
        let closed = false;
        res.on('close', () => { closed = true; });
        const onEvent = (evt: StreamEvent) => {
          if (!closed) this.sseWrite(res, evt);
        };
        await runTurn({
          store: this.store,
          db: this.deps.db,
          sessionId,
          userMessage: body.content,
          agents: agents.map((a: (typeof agents)[number]) => ({ id: a.id, name: a.name, roleTitle: a.roleTitle, isEnabled: a.isEnabled, systemPrompt: a.systemPrompt })),
          chat: this.deps.llm.chat,
          chunkTree: this.store.listChunksTree(sessionId),
          onEvent,
        });
        // 诊断重算 → 落库 + 推送
        const allMessages = this.store.listMessages(sessionId);
        const allSuggestions = this.store.listSuggestions(sessionId);
        const snapshot = {
          messages: allMessages.map((m: Record<string, unknown>) => ({ role: m.role as string, content: m.content as string })),
          chunks: this.store.listChunksTree(sessionId),
          suggestions: allSuggestions.map((s: (typeof allSuggestions)[number]) => ({ id: s.id, content: s.content, sourceType: s.sourceType, isDismissed: s.isDismissed })),
        };
        const suggestions = recomputeSuggestions(snapshot);
        this.store.replaceSuggestions(sessionId, suggestions.map((s: typeof suggestions[number]) => ({ content: s.content, sourceType: s.sourceType, sourceReason: s.sourceReason })));
        onEvent({ type: 'suggestions', items: suggestions.map((s: typeof suggestions[number]) => ({ content: s.content, sourceType: s.sourceType, sourceReason: s.sourceReason })) });
        if (!closed) {
          this.sseWrite(res, { type: 'done' });
          res.end();
        }
        return true;
      }

      // SSE 订阅通道
      if (sub === 'stream' && method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
        const clients = this.sseClients.get(sessionId) ?? new Set();
        clients.add(res);
        this.sseClients.set(sessionId, clients);
        res.on('close', () => {
          clients.delete(res);
          if (clients.size === 0) this.sseClients.delete(sessionId);
        });
        return true;
      }

      // 提议处置
      const propMatch = pathname.match(/^\/api\/requirements\/([^/]+)\/proposals\/([^/]+)\/(accept|dismiss)$/);
      if (propMatch) {
        const messageId = decodeURIComponent(propMatch[2] as string);
        const action = propMatch[3] as 'accept' | 'dismiss';
        const body = action === 'accept' ? await readBody<{ proposal?: DetectedProposal; index?: number }>(req) : {};
        const events: StreamEvent[] = [];
        try {
          await acceptProposal({
            store: this.store,
            db: this.deps.db,
            sessionId,
            messageId,
            proposal: action === 'accept' ? (body.proposal ?? null) : null,
            dismiss: action === 'dismiss',
            onEvent: (e: StreamEvent) => events.push(e),
          });
          this.broadcast(sessionId, { type: 'proposal_state', messageId, state: action === 'accept' ? 'accepted' : 'dismissed' });
          const chunks = events.filter((e): e is Extract<StreamEvent, { type: 'chunk_created' }> => e.type === 'chunk_created').map((e) => e.chunk);
          const tasks = events.filter((e): e is Extract<StreamEvent, { type: 'task_created' }> => e.type === 'task_created').map((e) => e.task);
          jsonFn(res, { code: 0, data: { chunks, tasks } });
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 400, message: err instanceof Error ? err.message : String(err) }));
        }
        return true;
      }

      // 分块 CRUD
      if (sub === 'chunks') {
        const chunkIdMatch = pathname.match(/^\/api\/requirements\/[^/]+\/chunks\/([^/]+)$/);
        if (method === 'POST' && !chunkIdMatch) {
          const body = await readBody<{ title?: string; parentId?: string | null; description?: string; priority?: string; tags?: string[] }>(req);
          if (!body.title) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code: 400, message: 'title 必填' })); return true; }
          try {
            const chunk = this.store.insertChunk({ sessionId, parentId: body.parentId ?? null, title: body.title, description: body.description, priority: body.priority as never, tags: body.tags });
            this.broadcast(sessionId, { type: 'chunk_created', chunk });
            jsonFn(res, { code: 0, data: { chunk } });
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 400, message: err instanceof Error ? err.message : String(err) }));
          }
          return true;
        }
        if (chunkIdMatch) {
          const chunkId = decodeURIComponent(chunkIdMatch[1] as string);
          if (method === 'PATCH') {
            const body = await readBody<{ title?: string; description?: string; status?: string; priority?: string; tags?: string[] }>(req);
            try {
              this.store.updateChunk(chunkId, body as never);
              jsonFn(res, { code: 0, data: { ok: true } });
            } catch (err) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ code: 400, message: err instanceof Error ? err.message : String(err) }));
            }
            return true;
          }
          if (method === 'DELETE') {
            this.store.deleteChunk(chunkId);
            jsonFn(res, { code: 0, data: { ok: true } });
            return true;
          }
        }
      }

      // 任务 CRUD（服务端独立叶子校验）
      if (sub === 'tasks') {
        const taskIdMatch = pathname.match(/^\/api\/requirements\/[^/]+\/tasks\/([^/]+)$/);
        if (method === 'POST' && !taskIdMatch) {
          const body = await readBody<{ chunkId?: string; title?: string; acceptanceCriteria?: string; priority?: string }>(req);
          if (!body.chunkId || !body.title) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 400, message: 'chunkId 与 title 必填' }));
            return true;
          }
          // 服务端独立叶子校验：目标分块存在子分块则拒绝
          const tree = this.store.listChunksTree(sessionId);
          const findNode = (nodes: typeof tree): (typeof tree)[number] | null => {
            for (const n of nodes) {
              if (n.id === body.chunkId) return n;
              const hit = findNode(n.children);
              if (hit) return hit;
            }
            return null;
          };
          const target = findNode(tree);
          if (!target) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 400, message: `CHUNK_NOT_FOUND: ${body.chunkId}` }));
            return true;
          }
          if (target.children.length > 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 400, message: 'INVARIANT_VIOLATION: 任务仅能挂载在叶子分块' }));
            return true;
          }
          const task = this.store.insertTask({ sessionId, chunkId: body.chunkId, title: body.title, acceptanceCriteria: body.acceptanceCriteria, priority: body.priority as never });
          this.broadcast(sessionId, { type: 'task_created', task: { id: task.id, chunkId: task.chunkId, title: task.title, status: task.status, priority: task.priority } });
          jsonFn(res, { code: 0, data: { task } });
          return true;
        }
        if (taskIdMatch) {
          const taskId = decodeURIComponent(taskIdMatch[1] as string);
          if (method === 'PATCH') {
            const body = await readBody<{ title?: string; acceptanceCriteria?: string; status?: string; priority?: string }>(req);
            this.store.updateTask(taskId, body as never);
            jsonFn(res, { code: 0, data: { ok: true } });
            return true;
          }
          if (method === 'DELETE') {
            this.store.deleteTask(taskId);
            jsonFn(res, { code: 0, data: { ok: true } });
            return true;
          }
        }
      }

      // Agent 管理
      if (sub === 'agents') {
        const agentIdMatch = pathname.match(/^\/api\/requirements\/[^/]+\/agents\/([^/]+)$/);
        if (method === 'POST' && !agentIdMatch) {
          const body = await readBody<{ name?: string; roleTitle?: string; systemPrompt?: string; modelId?: string; providerId?: string }>(req);
          if (!body.name || !body.roleTitle) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 400, message: 'name 与 roleTitle 必填' }));
            return true;
          }
          const agent = this.store.insertAgent({ sessionId, name: body.name, roleTitle: body.roleTitle, systemPrompt: body.systemPrompt ?? '', modelId: body.modelId ?? 'default', providerId: body.providerId ?? 'default', sortOrder: this.store.listAgents(sessionId).length });
          jsonFn(res, { code: 0, data: { agent } });
          return true;
        }
        if (agentIdMatch && method === 'PATCH') {
          const agentId = decodeURIComponent(agentIdMatch[1] as string);
          const body = await readBody<{ name?: string; roleTitle?: string; systemPrompt?: string; modelId?: string; providerId?: string; isEnabled?: boolean }>(req);
          try {
            const agent = this.store.updateAgent(agentId, body);
            jsonFn(res, { code: 0, data: { agent } });
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 400, message: err instanceof Error ? err.message : String(err) }));
          }
          return true;
        }
        if (agentIdMatch && method === 'DELETE') {
          this.store.deleteAgent(decodeURIComponent(agentIdMatch[1] as string));
          jsonFn(res, { code: 0, data: { ok: true } });
          return true;
        }
      }

      // PRD
      if (sub === 'prd') {
        const prdMatch = pathname.match(/^\/api\/requirements\/[^/]+\/prd\/generate$/);
        if (prdMatch && method === 'POST') {
          const body = await readBody<{ templateId?: string; mode?: 'section' | 'fast' }>(req);
          const templateId = body.templateId ?? BUILTIN_PRD_TEMPLATE.id;
          const mode = body.mode ?? 'section';
          // 服务端快速模式前置校验
          if (mode === 'fast') {
            const count = (function count(nodes: ReturnType<RequirementsStore['listChunksTree']>): number {
              return nodes.reduce((acc: number, n: (typeof nodes)[number]) => acc + 1 + count(n.children), 0);
            })(this.store.listChunksTree(sessionId));
            if (count > 5) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ code: 400, message: 'FAST_MODE_LIMIT: 快速模式仅支持分块总数 ≤ 5' }));
              return true;
            }
          }
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
          let closed = false;
          res.on('close', () => { closed = true; });
          try {
            await generatePrd({
              store: this.store,
              db: this.deps.db,
              sessionId,
              templateId,
              mode,
              chat: this.deps.llm.chatPrd,
              onEvent: (evt: PrdStreamEvent) => { if (!closed) this.sseWrite(res, evt); },
            });
          } catch (err) {
            if (!closed) this.sseWrite(res, { type: 'error', message: err instanceof Error ? err.message : String(err) });
          }
          if (!closed) res.end();
          return true;
        }
        if (method === 'GET' && !prdMatch) {
          const prd = this.store.latestPrd(sessionId);
          if (!prd) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code: 404, message: '尚未生成 PRD' })); return true; }
          jsonFn(res, { code: 0, data: prd });
          return true;
        }
      }

      // 流转 Pipeline
      const transMatch = pathname.match(/^\/api\/requirements\/([^/]+)\/transition$/);
      if (transMatch && method === 'POST') {
        await readBody<{ pipelineTemplateId?: string }>(req);
        // 二次校验：所有任务所在分块必须 approved
        const tree = this.store.listChunksTree(sessionId);
        const notApproved: string[] = [];
        const walk = (nodes: typeof tree) => {
          for (const n of nodes) {
            if (n.tasks.length > 0 && n.status !== 'approved') notApproved.push(n.title);
            walk(n.children);
          }
        };
        walk(tree);
        if (notApproved.length > 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 400, message: `存在非 approved 分块下的任务: ${notApproved.join('、')}` }));
          return true;
        }
        this.store.updateSessionStatus(sessionId, 'transitioned');
        jsonFn(res, { code: 0, data: { ok: true, pipelineInstanceId: null, note: 'Pipeline 创建工单由 MOD-10 既有能力承接' } });
        return true;
      }
    }

    return false;
  }
}
