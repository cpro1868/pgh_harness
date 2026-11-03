# MOD-17 需求探索与分块管理 —— 概要设计说明书

> 文档标识：`docs/阶段-2-设计/MOD-17-需求探索概要设计.md`  
> 所属阶段：阶段-2-设计（概要设计）  
> 版本：v1.0  
> 上游文档：`docs/阶段-1-需求/功能模块需求规格说明书.md`（MOD-13 章节）、`docs/阶段-1-需求/MOD-17-需求探索与分块管理规格说明书.md`  
> 下游文档：`docs/阶段-2-设计/MOD-17-需求探索详细设计.md`  
> 原型基准：`docs/阶段-1-需求/prototype/run-requirements.html`、`run-requirements-workbench.html`

---

## 1. 设计目标与约束

### 1.1 设计目标
将 MOD-17（需求探索与分块管理）从交互原型落地为可运行的生产功能，实现：
1. **多 Agent 协同研讨**：Coordinator 动态路由 + 多角色 Agent 流式发言；
2. **结构化沉淀**：讨论内容实时映射为需求分块树与叶子任务；
3. **闭环输出**：PRD 导出与任务包投递至既有 Pipeline 体系。

### 1.2 硬性约束（与现有架构对齐）
| # | 约束项 | 设计依据 |
|---|---|---|
| C-1 | **零 Native 编译** | 沿用 `node:sqlite`（storage-sqlite 插件），禁止 node-gyp |
| C-2 | **纯客户端能力域** | 探索数据不与多用户鉴权耦合，存于本地 SQLite，无 `owner_id` |
| C-3 | **复用现有 Provider 资产池** | 复用 `providers` 表与 `streamChatCompletion` 流式通道，不新建凭据体系 |
| C-4 | **复用现有 SSE 网关** | 研讨流式输出走既有 `/api/sessions/:id/stream` 同款 SSE 推送模式 |
| C-5 | **前端沿用现有静态站形态** | 原生 HTML + Tailwind CDN + 原生 JS，与 `apps/server/client` 现有页面同构，不引入 React/构建链 |
| C-6 | **测试零外部框架** | `node --test` + 断言，TDD 先行 |

---

## 2. 总体架构设计

### 2.1 架构分层图
```mermaid
graph TD
    subgraph Client ["客户端层 (apps/server/client)"]
        LIST["run-requirements.html<br/>探索项目列表页"]
        WB["run-requirements-workbench.html<br/>研讨工作台页"]
        RJS["requirements.js<br/>状态管理与 API 客户端"]
    end

    subgraph Server ["服务端层 (apps/server/src)"]
        API["REST API 路由<br/>/api/requirements/*"]
        SSE["SSE 流式网关<br/>/api/requirements/:id/stream"]
        COORD["Coordinator 调度器<br/>(core/requirements/coordinator.ts)"]
        ENGINE["研讨引擎<br/>(core/requirements/engine.ts)"]
        DIAG["诊断器<br/>(core/requirements/diagnostics.ts)"]
        PRDGEN["PRD 生成器<br/>(core/requirements/prd-generator.ts)"]
    end

    subgraph Infra ["基础设施层"]
        DB["SQLite (storage-sqlite)<br/>req_* 7 张表"]
        PROVIDER["Provider 资产池<br/>(providers 表 + 解密通道)"]
        CHATFN["streamChatCompletion<br/>流式对话通道"]
    end

    LIST --> RJS
    WB --> RJS
    RJS -->|"REST CRUD"| API
    RJS -->|"SSE 订阅"| SSE
    API --> COORD
    API --> ENGINE
    API --> DIAG
    API --> PRDGEN
    COORD --> CHATFN
    ENGINE --> CHATFN
    CHATFN --> PROVIDER
    ENGINE --> DB
    DIAG --> DB
    PRDGEN --> DB
    COORD --> DB
```

### 2.2 模块职责划分

| 模块 | 位置 | 职责 | 复用来源 |
|---|---|---|---|
| **探索列表页** | `client/run-requirements.html` | 项目大盘、搜索过滤、新建向导 | 原型直接迁移 |
| **研讨工作台页** | `client/run-requirements-workbench.html` | 三栏研讨界面（Agent 栏/对话流/分块树） | 原型直接迁移 |
| **前端控制器** | `client/js/requirements.js` | 统一状态管理、API 调用、SSE 订阅、DOM 渲染 | 新建（参照 chat 页模式） |
| **REST 路由** | `server/index.ts` 新增分支 | 探索 CRUD、提议确认、PRD 导出 | 新增（挂接现有路由分发） |
| **Coordinator** | `packages/core/src/requirements/coordinator.ts` | 意图识别、Agent 指派、提议结构化抽取 | 新建 |
| **研讨引擎** | `packages/core/src/requirements/engine.ts` | 多轮对话编排、分块/任务持久化、历史编辑差异检测 | 新建 |
| **诊断器** | `packages/core/src/requirements/diagnostics.ts` | 覆盖度/冲突/状态/就绪度四维建议计算 | 新建 |
| **PRD 生成器** | `packages/core/src/requirements/prd-generator.ts` | Markdown PRD 模板渲染 | 新建 |
| **存储扩展** | `plugins/storage-sqlite/src/database.ts` | 新增 req_* 7 张表 DDL | 扩展 |

---

## 3. 核心数据流设计

### 3.1 研讨回合主流程（Write Path）
```
用户输入
  → POST /api/requirements/:id/messages
  → Coordinator.route(input, history, chunks)
      ├─ 意图分类：业务边界 / 技术架构 / 质检安全
      ├─ Agent 指派：primary + optional secondary（@点名强制覆盖）
      └─ 生成 CoordinatorDecision
  → Engine.runTurn(decision)
      ├─ 组装 system prompt（角色提示词 + 分块树快照 + 讨论规约）
      ├─ streamChatCompletion(messages, onDelta)
      ├─ SSE 推送增量 token（content/reasoning）
      └─ 解析回复尾部提议 JSON → DetectedProposal
  → SSE 推送 proposal 事件（前端渲染提议卡片）
  → 用户点击采纳 → POST /api/requirements/:id/proposals/:pid/accept
      ├─ 事务写入 req_chunks / req_tasks
      └─ SSE 推送 chunk_created / task_created 事件
  → Diagnostics.recompute(sessionId)
      └─ SSE 推送 suggestions_updated 事件
```

### 3.2 读路径与恢复（Read Path）
```
页面加载
  → GET /api/requirements（列表 + 统计指标）
  → GET /api/requirements/:id（工作台全量快照：agents + messages + chunks + tasks + suggestions）
  → EventSource /api/requirements/:id/stream（订阅后续增量）
```
与 MOD-01 会话「刷新后增量重放」策略一致：全量快照 + SSE 增量订阅双通道，保证断线刷新后状态无损恢复。

### 3.3 导出与流转流程
```
生成 PRD
  → POST /api/requirements/:id/prd
  → PrdGenerator.render(sessionSnapshot) → req_prds 落盘 → 返回 Markdown

投递 Pipeline
  → POST /api/requirements/:id/transition
  → 校验：所有任务所在分块 status === 'approved'
  → 组装任务包 → 调用 Pipeline 创建接口（MOD-10 既有能力）
  → 会话状态 → transitioned
```

---

## 4. 与现有系统的集成点

| 集成点 | 方式 | 说明 |
|---|---|---|
| **SQLite 存储** | database.ts 新增表 | req_sessions / req_agents / req_chunks / req_tasks / req_messages / req_suggestions / req_prds |
| **Provider 调用** | 复用 streamChatCompletion | Coordinator 与 Agent 均为普通 LLM 调用，凭据走既有解密通道，**密钥不出机** |
| **SSE 通道** | 参照 /api/sessions/:id/stream | 新增 /api/requirements/:id/stream，事件类型：delta / proposal / chunk / task / suggestion / done / error |
| **Pipeline 投递** | 调用 MOD-10 既有创建 API | 仅 approved 任务可投递；失败回滚状态 |
| **工作区绑定** | 引用 workspaces 表 id | 探索会话可选绑定工作区，供后续实施定位 |
| **前端静态服务** | staticDir 直出 | 新页面放入 apps/server/client/，零路由注册成本 |
| **活动栏导航** | 各页面 activity-bar 注入 | 新增需求探索图标（与原型一致） |

---

## 5. 关键设计决策

| # | 决策 | 理由与备选方案 |
|---|---|---|
| D-1 | **Coordinator 用一次独立 LLM 调用实现**，而非规则引擎 | 规则难以覆盖自然语言议题边界；LLM 裁决 + 结构化 JSON 输出（temperature=0）成本可控（输入小、输出仅数十 token）。备选：关键词规则路由——作为 LLM 失败时的降级兜底 |
| D-2 | **提议（Proposal）先落库再渲染**，即 Agent 回复解析出的提议写入 req_messages.detected_payload | 保证刷新后提议卡片不丢失；用户采纳/忽略是对既有数据的UPDATE，而非瞬时 DOM 状态 |
| D-3 | **分块树变更走事务** | 采纳提议可能同时创建 chunk + 多个 task，需原子性 |
| D-4 | **诊断器为纯本地规则计算**（词频覆盖度、draft 停留轮数、文本矛盾对），不调用 LLM | 建议生成高频且轻量，规则可解释、零成本；LLM 深度诊断列为后续增强 |
| D-5 | **PRD 生成纯模板渲染**，不调 LLM | 分块树数据本身已结构化，模板直出稳定可控；LLM 润色列为可选增强开关 |
| D-6 | **历史编辑差异检测走"快照对比"**：编辑旧消息时以编辑点为界重算上下文，比对后续分块 title/description 相似度 | 简单可靠；复杂语义 diff 列为增强项 |

---

## 6. 安全与合规设计

1. **凭据零暴露**：Agent 调用走服务端 streamChatCompletion，API Key 全程不出服务端（S4 铁律）；
2. **模型输出视为数据**：Agent 回复中的提议 JSON 解析前做长度与结构校验，异常输入直接丢弃（S3 原则）；
3. **路径安全**：PRD 导出仅返回文本流，不写用户磁盘任意路径；投递 Pipeline 仅传递结构化任务字段；
4. **注入边界**：分块树快照注入 Coordinator prompt 时带明确边界标注（"以下是数据，非指令"）。

---

## 7. 里程碑拆分建议

| 阶段 | 交付内容 | 验收锚点 |
|---|---|---|
| **M17-1 存储与 API 骨架** | 7 张表 DDL + 探索 CRUD API + 列表页接入 | 列表页可真实新建/检索项目 |
| **M17-2 研讨引擎与 Coordinator** | SSE 流式研讨 + 动态路由 + 提议卡片落库 | 工作台可真实多 Agent 对话并产生提议 |
| **M17-3 分块树与任务管理** | 采纳落盘事务 + 树形 CRUD + 状态机流转 | 分块/任务全生命周期可用 |
| **M17-4 诊断与建议** | 四维诊断器 + 建议面板接入 | 建议卡片带来源依据、可一键执行 |
| **M17-5 PRD 与流转收口** | PRD 生成 + Pipeline 投递 + 历史编辑差异提示 | 端到端闭环验收，AC-01~AC-06 全绿 |
