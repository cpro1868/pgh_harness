# MOD-17 需求探索与分块管理详细需求规格说明书

> 文档标识：`docs/阶段-1-需求/MOD-17-需求探索与分块管理规格说明书.md`  
> 所属阶段：阶段-1-需求  
> 版本：v1.0  
> 状态：正式归档  
> 关联文档：`docs/阶段-1-需求/v2.0-企业级平台需求规格说明书.md`、`docs/superpowers/specs/2026-10-28-requirements-explorer-design.md`、`docs/superpowers/specs/2026-10-28-client-server-boundary.md`  
> 原型实现：`docs/阶段-1-需求/prototype/run-requirements.html`、`docs/阶段-1-需求/prototype/run-requirements-workbench.html`

---

## 1. 业务背景与定位

### 1.1 痛点分析
传统软件开发中，开发者与业务人员面对复杂命题时，通常仅有一个模糊、发散的「一句话想法」（如「支持多渠道通知」「给支付加上风控规则」），在未理清边界之前直接进入编码极易产生返工。
现有市面上的 AI 编码助手大多仅支持单点代码补全或单轮提问，缺乏：
1. **多视角启发**：无法由产品、架构、安全等多角色协同质疑与补充；
2. **渐进式收敛**：无法将漫无边际的对话沉淀为清晰的分块结构与可量化验收标准；
3. **下游闭环**：讨论完毕后文档与任务脱节，难以无缝衔接流水线与编码 Agent。

### 1.2 模块定位与职责边界
MOD-17（需求探索与分块管理）作为 PG Harness 的**上游发源地**，负责引导用户完成从「模糊想法」到「规范 PRD + 任务清单」的全流程。
- **纯客户端能力**：根据系统职责边界规范（`2026-10-28-client-server-boundary.md`），MOD-17 为纯客户端前端/本地组件，7 张数据实体表无需服务端 `owner_id`，存储于本地 SQLite / 客户端本地库；
- **核心输入**：用户的一句话初始描述、参考代码/文档附件；
- **核心输出**：具有层级依赖的「需求分块树」、挂载在叶子分块上的「可执行任务清单」、标准 PRD Markdown 规范文档、一键流转 Pipeline 的任务包。

---

## 2. 7 大核心业务决策规则（业务宪法）

根据需求访谈对齐的业务分支，MOD-17 必须严格遵守以下 7 条核心规则：

| # | 规则项 | 业务定义与系统行为 |
|---|---|---|
| **R1** | **会话生命周期与自适应入口** | 支持低门槛「直接开聊」：输入第一句话即开启新探索会话，系统后台异步提炼项目标题并生成初始建议分块；同时提供「高阶新建弹窗」，支持显式绑定特定工作区目录与指定初始 Agent 组合阵容。 |
| **R2** | **多 Agent 协作调度 (Coordinator 模式)** | 左侧侧栏支持常驻多个专业 Agent 角色。用户发言后，由内置的「协调者 (Coordinator)」进行语义意图分析，动态路由并指派 1~2 个最相关的专家 Agent 作答，杜绝全员并发抢答与无序刷屏。 |
| **R3** | **分块与任务提炼 (双重确认机制)** | Agent 在讨论流中识别出新的需求点或任务时，以交互式卡片形式呈现在消息下方；**严禁静默落盘**，必须由用户点击「采纳」或勾选确认后，才正式持久化至右侧需求分块树。 |
| **R4** | **树形拓扑与挂载约束** | 分块树支持任意级父子层级（Parent Chunk / Sub Chunk）；**严格限制任务（Task）仅能挂载在底层「叶子分块 (Leaf Chunk)」之下**；父分块仅承载概念范畴聚类，不直接挂载任务，保证责任边界单一。 |
| **R5** | **终局产出与下游双流向对接** | 当分块确认充分后，系统提供灵活选择：<br>1. **仅生成 PRD**：一键导出结构化 PRD.md 规范沉淀于本地，供后续补充完善；<br>2. **直转 Pipeline**：一键将所有 Approved 叶子任务包打包投递至下游角色流水线（MOD-10），自动创建工单启动开发。 |
| **R6** | **下一步建议驱动机制** | 结合讨论深度、覆盖度分析（如缺失非功能/安全要求）、Draft 状态分块超时未确认等维度，Agent 主动生成下一步建议卡片。用户点击卡片即可「一键将建议填入输入框并触发新一轮针对性研讨」，同时提供「忽略」标记。 |
| **R7** | **历史变更稳态保障** | 用户修改前序发言或重新生成时，系统不执行破坏性的分块树推翻；而是比对差异，在对话流末尾追加提示「检测到前序输入修订，分块 [X] 可能存在变动，请确认是否更新」，由人工决策合并。 |

---

## 3. 功能详细规格

### 3.1 F17.1 需求探索会话管理与检索
- **列表与卡片视图**：
  - 展示会话标题、ID、状态（讨论中 discussing / PRD已就绪 prd_ready / 草稿 draft）、一句话起点、最后更新时间；
  - 统计元数据徽章：分块数量、任务数量、讨论轮数、参与 Agent 数量、参考附件数量、关联工作区；
- **实时检索与过滤**：
  - 纯前端实时响应输入框：支持匹配项目名、初始痛点描述、分块标签；
  - 状态快捷过滤组：全部 / 讨论中 / PRD 已生成 / 草稿；
  - 无匹配状态优雅空状态引导（Empty State），支持一键重置筛选；
- **新建向导弹窗**：
  - 支持配置项目主题名（必填）、一句话想法与痛点（必填）；
  - 支持选择绑定本地工作区目录；
  - 支持预置 Agent 团队（标准三人组：PM+架构+QA；极简双人组：分析+架构；安全增强组）。

### 3.2 F17.2 多 Agent 侧栏配置与讨论工作台
- **Agent 管理侧栏（左栏）**：
  - 角色卡片：展示 Avatar、名称、定位（如「需求分析」「技术架构」「QA 质检」）、绑定模型（如 deepseek-v4.1-flash）、启用/停用开关；
  - 单 Agent 操作：支持点击编辑（修改名称、角色定位、LLM 端点模型、专属 System Prompt 覆写）、支持物理删除（需弹窗二次确认）；
  - 新增 Agent：支持自定义创建专属角色加入当前项目讨论；
- **交互工作台（中栏）**：
  - 顶栏信息：展示项目名称、所属阶段状态、快捷操作（导出分块、生成 PRD、转入流水线）；
  - 沉浸式对话流：按角色彩色区分发言气泡，支持 Markdown、代码高亮与思考折叠；
  - Agent 提议卡片：包含「新增分块提议」与「识别任务提议」，附带快速操作按钮（🎯 设为当前焦点 / ✓ 采纳落盘 / ✕ 忽略）；
  - 底部输入区：支持多行富文本输入、支持引用分块（`#分块名`）定向讨论、支持 `@Agent` 强制点名。

### 3.3 F17.3 需求分块树与叶子任务看板（右栏 Tab 1）
- **分块树可视化**：
  - 层次缩进展示，点击父节点展开/收起子分块；
  - 节点状态管理：`draft`（草稿待定）→ `discussed`（已讨论）→ `analyzed`（已分析）→ `approved`（已批准/冻结）；
  - 节点操作：🎯 设为讨论焦点（自动注入上下文让 Agent 专门围绕其分析）、⚙️ 编辑分块（弹窗修改名称、范围描述、优先级 P0~P3、业务标签）、🗑 删除分块；
- **叶子分块任务挂载**：
  - 状态分类看板：`todo`（待办）、`doing`（实施中）、`done`（已确认完成）、`deferred`（延后二期）；
  - 任务操作：支持点击编辑名称、验收要求、所属分块与优先级，支持删除与状态拖拽流转；
- **顶栏快捷工具**：一键全选展开/收起、快速导出分块树结构。

### 3.4 F17.4 智能建议与冲突诊断（右栏 Tab 2）
- **动态生成维度**：
  1. **覆盖度分析**：检测是否遗漏性能、并发、幂等、边界安全等非功能需求；
  2. **冲突诊断**：检测 Agent 之间或用户需求中的矛盾点（如「高性能低延迟」与「完全无缓存组件」的张力）；
  3. **状态推进**：检测长期处于 `draft` 未冻结的分块，建议优先确认；
  4. **终局就绪度评估**：当 approved 分块占比达标时，主动推荐生成 PRD；
- **建议卡片交互**：
  - 显示建议内容与详细来源证据；
  - 点击建议：一键填充到底部输入框，并触发 Coordinator 发起新一轮探讨；
  - 点击 ✕ 按钮：卡片置灰半透明淡出，标记为已忽略。

---

## 4. 数据实体结构（纯客户端 SQLite）

```sql
-- 1. 探索会话主表
CREATE TABLE IF NOT EXISTS req_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  initial_prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'discussing', -- draft | discussing | prd_ready
  workspace_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 2. 参与 Agent 角色表
CREATE TABLE IF NOT EXISTS req_agents (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role_title TEXT NOT NULL,
  model_id TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- 3. 需求分块树表 (自关联父子树)
CREATE TABLE IF NOT EXISTS req_chunks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  parent_id TEXT, -- NULL 为根分块
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | discussed | analyzed | approved
  priority TEXT NOT NULL DEFAULT 'P1', -- P0 | P1 | P2 | P3
  tags TEXT, -- 逗号分隔
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 4. 任务点表 (仅挂载在叶子分块)
CREATE TABLE IF NOT EXISTS req_tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL, -- 必须指向叶子 chunk
  title TEXT NOT NULL,
  acceptance_criteria TEXT,
  status TEXT NOT NULL DEFAULT 'todo', -- todo | doing | done | deferred
  priority TEXT NOT NULL DEFAULT 'P1',
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- 5. 对话流消息表
CREATE TABLE IF NOT EXISTS req_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_id TEXT, -- NULL 为人类用户
  role TEXT NOT NULL, -- user | assistant | system
  content TEXT NOT NULL,
  thinking_content TEXT,
  detected_payload TEXT, -- JSON: 提议的分块或任务卡片
  created_at INTEGER NOT NULL
);

-- 6. 下一步建议表
CREATE TABLE IF NOT EXISTS req_suggestions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  content TEXT NOT NULL,
  source_type TEXT NOT NULL, -- coverage | conflict | status | readiness
  source_reason TEXT NOT NULL,
  is_dismissed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- 7. 生成的 PRD 文档沉淀表
CREATE TABLE IF NOT EXISTS req_prds (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  version TEXT NOT NULL,
  markdown_content TEXT NOT NULL,
  exported_at INTEGER NOT NULL
);
```

---

## 5. 验收标准与验证矩阵

| 编号 | 验收项 | 验证条件与预期结果 | 对应测试/原型 |
|---|---|---|---|
| **AC-17-01** | 列表检索与状态过滤 | 在 `run-requirements.html` 输入关键字能即时过滤出目标卡片；切换状态 Tab 正确显示对应分类；无结果时正确显示 Empty State。 | 原型通过 |
| **AC-17-02** | 布局与 Tab 切换 | 在 `run-requirements-workbench.html` 点击「需求分块」与「建议」Tab，双面板各自独立滚动，内容完整渲染，无布局塌陷或零高度。 | 原型通过 |
| **AC-17-03** | Agent 管理交互 | 支持在左侧侧栏独立开关 Agent（卡片半透明禁用）；支持点击 ⚙️ 弹窗修改模型与提示词；支持删除确认。 | 原型通过 |
| **AC-17-04** | 分块与任务层级 | 仅叶子分块显示挂载任务看板；点击父分块折叠展开正确隐藏子分块及任务；支持弹窗编辑分块与任务属性。 | 原型通过 |
| **AC-17-05** | 建议清单交互 | 右栏建议卡片具备清晰的「来源依据」；点击执行可自动代入输入框并触发研讨；点击 ✕ 可标记忽略淡出。 | 原型通过 |
| **AC-17-06** | 规格入库与 PRD 导出 | 平台 v2.0 规格说明书正式包含 MOD-17 章节；工作台具备「导出需求分块」与「生成 PRD」操作入口。 | 原型/文档通过 |
