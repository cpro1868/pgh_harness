# MOD-17 需求探索与 PRD 生成模块设计

- 日期：2026-10-28
- 状态：设计定稿（用户确认全部流程与机制）
- 关联：v2.0 企业级平台需求规格说明书 §MOD-17；`run-requirements.html` / `run-requirements-prd.html` 原型
- 核心理念：Agent 既是**聆听者**也是**引导者**；支持**单 Agent** 或**多 Agent 讨论**（不同 Agent 提供不同方案，用户定夺）

## 1. 需求背景

FDE/开发者落地项目的第一步是输出 PRD，但 PRD 之前需要大量**非结构化的讨论**——一句话起点、反复澄清、方案对比、任务识别、优先级调整。这个过程主观性强、项目间差异大，不适合用固定阶段流水线管理。

v2.0 的解法：不预设阶段，用**自由讨论 + Agent 自动识别与引导**的方式，让需求自然生长。

## 2. 核心角色定义

### Agent 的双重角色

| 角色 | 行为 | 示例 |
| --- | --- | --- |
| **聆听者** | 接收用户输入，提炼要点，写入分块 | 用户说"金额用分"→ Agent 提炼为分块"精度处理（元↔分）" |
| **引导者** | 主动分析讨论覆盖度，提醒下一步，建议子分块/子任务，发起诊断 | "目标用户和核心功能已覆盖，还剩约束和验收标准——关于性能有什么要求？" |

### 单 Agent vs 多 Agent

| 模式 | 说明 | 适用场景 |
| --- | --- | --- |
| **单 Agent** | 一个需求分析师 Agent 与用户对话 | 小项目、需求简单明确 |
| **多 Agent 讨论** | 多个 Agent（可配置不同角色/模型）各自提供方案或观点，用户对比定夺 | 大项目、方案有分歧、需要多角度分析 |

多 Agent 讨论机制：
- Agent 之间**不直接对话**（用户是仲裁者），各自向用户输出观点/方案
- 用户选定某个 Agent 的方案后，其他 Agent 的合理部分可被采纳合并
- Agent 角色可自定义（如"安全专家 Agent"、"性能优化 Agent"、"业务分析 Agent"），每个可配置不同模型

## 3. 核心实体与关系

### 3.1 需求分块 (Requirement Chunk)——一等公民

分块是**已提炼的需求单元**，有自己的生命周期。不是讨论的副产品，而是稳定资产。

```sql
CREATE TABLE requirement_chunks (
  id TEXT PRIMARY KEY,              -- reqc_<uuid>
  session_id TEXT NOT NULL,         -- 所属探索会话
  parent_id TEXT,                   -- 父分块（细分产生子块时指向父）
  name TEXT NOT NULL,               -- '支付方式校验'
  description TEXT,                 -- 详细描述
  status TEXT DEFAULT 'draft',      -- draft | discussed | analyzed | approved
  priority TEXT DEFAULT 'P1',       -- P0 | P1 | P2
  tags_json TEXT,                   -- 自由标签数组（功能/非功能/约束/接口/数据 等，不限数量）
  sort_order INTEGER,               -- 同级排序
  created_by TEXT,                  -- user | agent
  created_at INTEGER,
  updated_at INTEGER
);
```

### 3.2 工作活动 (Work Activity)——过程记录

工作活动是**为形成/完善/验证分块而做的具体工作**，临时性，做完即完成。

```sql
CREATE TABLE work_activities (
  id TEXT PRIMARY KEY,              -- act_<uuid>
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,               -- collect | interview | diagnose | sketch | research | refine | custom
  title TEXT,
  status TEXT DEFAULT 'done',       -- todo | doing | done
  trigger TEXT,                     -- user_manual | agent_diagnostic_found_gap | agent_next_step | sequential
  seq INTEGER,
  created_at INTEGER
);
```

预定义六种活动类型 + 用户自由扩展：

| 活动类型 | 交互模式 | 典型产出 |
| --- | --- | --- |
| **采集** (collect) | 自由对话 | 需求要点（Agent 提炼入分块） |
| **访谈** (interview) | 结构化问答（Agent 问 → 用户答） | 访谈记录 |
| **诊断** (diagnose) | Agent 主动分析现有分块 | 诊断报告（冲突/遗漏/歧义/依赖） |
| **流程草图** (sketch) | Agent 画流程图 / 用户描述流程 | Mermaid 流程图 |
| **技术调研** (research) | Agent 搜索/对比/实验 | 调研结论 |
| **完善** (refine) | 对已有分块的精化/拆分/重写 | 分块内容更新 |

### 3.3 分块间关系 (Chunk Relations)

```sql
CREATE TABLE chunk_relations (
  id TEXT PRIMARY KEY,
  from_chunk TEXT NOT NULL,
  to_chunk TEXT NOT NULL,
  relation TEXT NOT NULL,           -- dependency | conflict | related | composed_of
  discovered_by TEXT DEFAULT 'user', -- user | agent_diagnostic
  confirmed INTEGER DEFAULT 0,      -- Agent 发现的需用户确认
  note TEXT
);
```

五种关系类型：`dependency`（依赖）/ `conflict`（冲突）/ `related`（关联）/ `composed_of`（组合来源）/ 父子通过 `parent_id` 实现。

Agent 诊断是**关系的主动发现者**：诊断发现冲突 → 创建 `conflict` 关系（confirmed=0）→ 用户确认 → 正式生效。

### 3.4 活动-分块关联（多对多）

```sql
CREATE TABLE activity_chunk_links (
  activity_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  action TEXT NOT NULL,             -- produced | modified | diagnosed | validated
  detail TEXT
);
```

### 3.5 任务 (Task)——从分块自然生长

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,              -- task_<uuid>
  session_id TEXT NOT NULL,
  source_chunk_id TEXT,             -- 关联的需求分块（可为 null，用户手动创建无分块）
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'todo',       -- todo | doing | done | deferred
  priority TEXT DEFAULT 'P1',
  origin TEXT DEFAULT 'agent_detected', -- agent_detected | user_manual | discussion
  created_at INTEGER
);
```

任务来源：Agent 从讨论中自动识别（`agent_detected`，以建议卡片呈现，用户确认后入列）+ 用户手动添加（`user_manual`）。

### 3.6 下一步建议队列 (Next Steps)

```sql
CREATE TABLE next_steps (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  suggestion TEXT NOT NULL,         -- 建议内容
  reason TEXT,                      -- 建议原因（覆盖度缺口/诊断发现/分块状态）
  source TEXT NOT NULL,             -- coverage_gap | diagnostic_finding | chunk_status | agent_forward_look
  status TEXT DEFAULT 'pending',    -- pending | executed | ignored
  sort_order INTEGER,
  created_at INTEGER
);
```

Agent 每轮对话后自动计算（覆盖度 + 诊断 + 分块状态）→ 生成有序建议 → UI 侧栏展示 → 用户点击执行或忽略。

### 3.7 决策轨迹 (Decision Log)

```sql
CREATE TABLE decision_log (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  decision TEXT NOT NULL,           -- 关键决策内容
  reason TEXT,                      -- 决策原因
  alternatives_rejected TEXT,       -- 被拒绝的方案及原因
  related_chunks_json TEXT,         -- 关联分块
  decided_by TEXT,                  -- user | agent_suggested
  created_at INTEGER
);
```

自动生成 `decisions.md` 到项目文件夹——记录"为什么这么做"而不只是"要做什么"。

## 4. 交互流程（完整闭环）

### 4.1 起点：一句话

用户创建需求探索会话，输入一句话（"我想做一个在线支付校验的东西"）。Agent 开始自由讨论。

### 4.2 讨论过程（自由流动）

1. **Agent 引导**：分析用户描述 → 追问影响设计的关键点 → 主动提醒未覆盖维度 → 提出下一步建议
2. **Agent 诊断**：实时分析讨论内容 → 发现分块间冲突/依赖 → 以建议卡片呈现 → 用户确认后写入
3. **Agent 预判**：对 draft 分块分析 → 建议子分块拆分 / 建议关联任务 → 用户确认后落盘
4. **用户自由**：随时补充想法、手动加分块/任务、跳过建议、改变讨论方向

### 4.3 产出：PRD + 决策轨迹

用户觉得讨论充分后点击「生成 PRD」→ Agent 从全部讨论记录 + 分块 + 任务中提炼 → 渲染为可编辑预览 → 用户确认后落盘 `PRD.md` → 同时自动生成 `decisions.md`（决策轨迹）→ 流转到 Pipeline / 主会话实施。

## 5. UI 设计（三栏）

- **左栏：项目文件夹**——`docs/projects/<项目名>/` 下的文件树（discussions/、tasks.md、PRD.md、attachments/），Agent 可直接读写
- **中栏：自由对话区**——用户与 Agent 的讨论流，Agent 自动识别的任务点以蓝色内联卡片呈现
- **右栏：任务面板 + 下一步建议**——任务按状态分组（进行中/待办/延后），下方为下一步建议队列

## 6. 数据模型（DDL 级）

见 §3，共 7 张表：`requirement_chunks` / `work_activities` / `chunk_relations` / `activity_chunk_links` / `tasks` / `next_steps` / `decision_log`。

## 7. 测试计划

- 状态机：分块 CRUD / 五种关系类型 / 活动类型 / 下一步建议生成
- Agent 行为：覆盖度追踪 / 向前预判 / 诊断输出关系建议 / 多 Agent 方案对比
- 集成：PRD 生成落盘 / Pipeline 模板联动 / 决策轨迹文档生成
- 回归：既有模块不受影响
