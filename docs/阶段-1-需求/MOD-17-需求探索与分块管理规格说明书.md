# MOD-17 / MOD-13 需求探索与分块管理详细需求规格说明书 (全面细化版)

> 文档标识：`docs/阶段-1-需求/MOD-17-需求探索与分块管理规格说明书.md`  
> 所属阶段：阶段-1-需求（客户端发源能力）  
> 版本：v2.0-Detailed  
> 状态：正式归档  
> 关联主文档：`docs/阶段-1-需求/功能模块需求规格说明书.md` (MOD-13 章节)、`docs/superpowers/specs/2026-10-28-requirements-explorer-design.md`、`docs/superpowers/specs/2026-10-28-client-server-boundary.md`  
> 运行原型：`docs/阶段-1-需求/prototype/run-requirements.html`、`docs/阶段-1-需求/prototype/run-requirements-workbench.html`

---

## 1. 业务目标与运行边界

### 1.1 业务核心定位
MOD-17 定位为 PG Harness 客户端的**上游发源地**，专门解决软件工程中最棘手的**「想法发散、边界模糊、任务脱节」**三大难题。
它通过将非结构化的自然语言研讨，与结构化的树形工程分块进行实时双向映射，实现**「边聊边结构化、分块出任务、PRD 自动成型、一键导入流水线」**的连续生产力。

### 1.2 客户端纯前端运行边界
根据《客户端与服务端职责边界规范》（`2026-10-28-client-server-boundary.md`）：
1. **纯单机客户端存储**：需求探索的所有会话数据、分块树、任务清单与建议记录，仅持久化于本地 SQLite / 客户端本地存储；数据表均无需 `owner_id`；
2. **零服务端鉴权侵入**：不依赖企业级 SSO 鉴权与服务端审批流，无需网络连接企业后台即可完整使用；
3. **模型直连能力**：调用系统已配置的全局 Provider 资产池（如 DeepSeek、OpenAI、Anthropic、本地 Ollama）直接发起多 Agent 研讨。

---

## 2. 核心状态机与生命周期流转

### 2.1 探索项目会话生命周期
```mermaid
stateDiagram-v2
    [*] --> draft: 用户新建会话/仅输入一句话
    draft --> discussing: 用户与Agent开始首轮对话
    discussing --> discussing: 多轮启发探讨 / 分块提炼 / 任务挂载
    discussing --> prd_ready: 核心分块 Approved 且 PRD 生成
    prd_ready --> discussing: 用户重新发起深入补充讨论
    prd_ready --> transitioned: 一键导出任务并投递至 Pipeline
    transitioned --> [*]
```

- **草稿态 (draft)**：创建了项目但尚未展开实质性研讨；
- **讨论中 (discussing)**：多 Agent 介入，持续产生对话、分块与任务提炼卡片；
- **PRD 就绪 (prd_ready)**：需求分块大多批准冻结，已生成标准 PRD 文档；
- **已流转 (transitioned)**：任务包已成功投递至角色流水线或会话工作台进入编码实施。

---

### 2.2 需求分块状态机 (Chunk State Machine)
```mermaid
stateDiagram-v2
    [*] --> draft: Agent 识别提议并经用户采纳
    draft --> discussed: 用户与Agent就该分块进行针对性讨论
    discussed --> analyzed: 完成边界规则与技术可行性澄清
    analyzed --> approved: 用户审查确认，冻结分块范围
    approved --> discussed: 需求变更，重新激活讨论
```

- **`draft` (草稿)**：刚从对话中识别并确认落盘，仅有初步标题与范围概要；
- **`discussed` (已讨论)**：至少经历 1 轮针对性讨论，已明确业务范围与排除项；
- **`analyzed` (已分析)**：已补充非功能需求、安全合规要求与关联代码文件边界；
- **`approved` (已批准/冻结)**：用户正式核准，不可随意变更，具备流转实施资格。

---

### 2.3 叶子任务状态机 (Task State Machine)
```mermaid
stateDiagram-v2
    [*] --> todo: 挂载在叶子分块下
    todo --> doing: 分配实施 / 正在开发
    doing --> done: 编码与测试通过
    todo --> deferred: 评估为二期范围 / 延后
    deferred --> todo: 恢复至当期实施
```

- **`todo` (待办)**：待实施的原子工程任务；
- **`doing` (进行中)**：已投递至流水线并由编码 Agent 正在处理；
- **`done` (已完成)**：代码已提交且自动化验证通过；
- **`deferred` (延后)**：经讨论确认为后续期次实现，从当期执行序列中剥离。

---

## 3. 多 Agent 协调器 (Coordinator) 调度架构与 Prompt 规范

### 3.1 调度架构原则
- **动态仲裁**：所有用户输入首先流经 Coordinator，由 Coordinator 基于上下文分析当前最迫切需要解答的视角；
- **发言人数约束**：单次回合仅唤醒 1~2 个最相关的 Agent 发言，杜绝 3 个以上 Agent 同时刷屏；
- **强行点名机制**：若用户输入中显式包含 `@角色名`，Coordinator 必须将该角色作为主答复者。

### 3.2 角色定位矩阵
| 角色标识 | 角色名称 | 核心职责 | 触发关键词/议题范畴 |
|---|---|---|---|
| `agent_pm` | 产品分析师 (PM) | 梳理用户痛点、业务流程、功能边界、排除项与交互预期 | 需求、场景、用户、流程、边界、为什么要做 |
| `agent_arch` | 技术架构师 (Architect) | 评估技术选型、存储模型、接口契约、并发性能、依赖包 | 数据库、API、性能、架构、第三方库、存储、延迟 |
| `agent_qa` | 质检与安全专家 (QA/Security) | 提出异常分支、边界用例、幂等重试、权限防越权与安全审计 | 测试、校验、报错、重试、安全、鉴权、漏洞、异常 |

### 3.3 Coordinator 决策与调度算法 (伪代码与 Prompt 模板)
```typescript
interface CoordinatorDecision {
  primary_agent_id: string;      // 主答复角色
  secondary_agent_id?: string;    // 协作者角色（可选）
  discussion_topic: string;       // 本次回合聚焦点
  detected_actions: {             // 自动侦测的潜在提议
    suggest_new_chunk?: { title: string; parent_id?: string; description: string; priority: 'P0'|'P1'|'P2' };
    suggest_new_task?: { chunk_id: string; title: string; acceptance_criteria: string; priority: 'P0'|'P1' };
  };
}
```

**系统引导 Prompt 规约 (Coordinator System Instruction)**：
```text
你是一个精益软件工程的多角色研讨协调者。你的任务是引导用户将模糊需求逐步结构化：
1. 观察当前对话历史与右侧已有的需求分块树；
2. 如果用户刚刚抛出一个新业务场景，指派【产品分析师】主导提问并细化流程；
3. 如果用户开始讨论实现技术、性能指标或存储，指派【技术架构师】评估方案与边界；
4. 如果某项功能看似讨论成熟，指派【质检与安全专家】挖掘边界异常与验收标准；
5. 如果发现了明确可拆分的功能模块，在回复尾部输出提议卡片（包含分块名称、建议父分块与任务描述），供人类用户确认采纳。
```

---

## 4. 交互时序流详细规格

### 4.1 核心研讨与提议确认时序流
```mermaid
sequenceDiagram
    autonumber
    actor User as 用户 (User)
    participant UI as 工作台界面 (Workbench)
    participant Coord as 协调器 (Coordinator)
    participant Agent as 专家 Agent (PM/Arch/QA)
    participant Store as 本地存储 (SQLite)

    User->>UI: 输入一句话想法："我想做在线支付校验模块"
    UI->>Coord: 提交意图分析请求
    Coord->>Coord: 评估议题范畴 → 裁决由 PM 主答，QA 补充
    Coord->>Agent: 调用 PM 角色发起启发式追问
    Agent-->>UI: 流式返回分析文本，尾部附带 [提议分块: 支付方式校验] 卡片
    UI-->>User: 渲染气泡与提议卡片 (🎯 设为讨论点 / ✓ 采纳 / ✕ 忽略)
    
    User->>UI: 点击【✓ 采纳】
    UI->>Store: 执行 INSERT INTO req_chunks 持久化
    UI->>UI: 右侧分块树动态插入新节点 (状态: draft)
    
    User->>UI: 继续提问："我们要支持 card/paypal，但金额不能为负"
    UI->>Coord: 提交讨论上下文
    Coord->>Agent: 路由至 QA 角色针对金额边界发问
    Agent-->>UI: 回复校验逻辑，尾部附带 [提议叶子任务: 金额有效性边界测试]
    User->>UI: 点击【✓ 采纳挂载到叶子分块】
    UI->>Store: 执行 INSERT INTO req_tasks
    UI->>UI: 叶子分块下动态展开挂载任务看板卡片
```

---

### 4.2 下一步建议一键执行时序流
```mermaid
sequenceDiagram
    autonumber
    actor User as 用户
    participant UI as 工作台界面
    participant Diag as 冲突与覆盖度诊断引擎
    participant Coord as 协调器

    UI->>Diag: 每轮讨论结束触发静态诊断
    Diag->>Diag: 扫描分块树 → 发现「非功能需求」出现频次为 0
    Diag->>UI: 右栏建议面板插入卡片："补充非功能需求（性能/并发/安全）"
    
    User->>UI: 点击建议卡片
    UI->>UI: 自动将推荐议题注入底部输入框："请技术架构师与QA评估本模块的非功能需求（性能要求与安全边界）"
    UI->>Coord: 模拟用户提交，自动触发新一轮研讨
```

---

### 4.3 历史编辑撤回差异提示流
```mermaid
sequenceDiagram
    autonumber
    actor User as 用户
    participant UI as 工作台界面
    participant Store as 本地存储

    User->>UI: 点击编辑第 2 轮历史提问并重新提交
    UI->>UI: 检测到该轮次后已有 3 个分块已生成落盘
    UI->>UI: 保持右侧分块树完全不动（禁止强行清空或篡改）
    UI->>UI: 在最新对话流底部追加黄色预警通知条：
    Note over UI: "⚠️ 检测到前序需求发生修订，已生成分块「支付方式校验」可能存在范围偏差"
    UI-->>User: 提供操作项：【对比差异并重新评估】|【忽略差异，保留当前分块】
```

---

## 5. PRD 模板体系与智能生成规范

### 5.0 模板体系三要素（模板库 + 提示词 + 变量映射）

PRD 生成从「纯模板机械填充」升级为「模板库驱动 + LLM 逐章节智能撰写」：

| 要素 | 定义 | 管理方式 |
|---|---|---|
| **章节骨架 (Sections)** | 有序章节列表，每章含标题、撰写指导说明、篇幅约束与启用开关 | 模板管理页可视编辑、拖拽排序 |
| **生成提示词 (Prompt Template)** | 每章节独立的 LLM 撰写提示词，指导 AI 如何基于会话数据提炼扩写本章节内容 | 模板管理页逐章节编辑 |
| **变量映射 (Context Sources)** | 系统内置变量集 + 章节级上下文勾选（注入哪些数据源供 LLM 撰写） | 引擎自动注入，用户勾选，禁止自造变量语法 |

**系统内置变量集**（引擎自动注入，注入时全部带 `<data>` 边界标注，防提示注入）：
| 变量 | 内容 |
|---|---|
| `{{project.title}}` | 探索项目名称 |
| `{{project.initial_prompt}}` | 一句话初始想法 |
| `{{chunks.tree}}` | 分块树结构化文本（状态/优先级/描述） |
| `{{tasks.by_chunk}}` | 按分块分组的任务清单（含验收准则） |
| `{{messages.recent}}` | 最近讨论摘要（默认 20 条） |
| `{{suggestions.active}}` | 当前未忽略的建议清单 |

### 5.1 参考基准模板（内置预置）
以内置的《智能研究助手_完整PRD》（`docs/templates/智能研究助手_完整PRD.md`）16 章企业级结构为质量基准，预置「完整 PRD 标准模板」，覆盖：文档信息表、背景与问题定义、产品目标/范围/非目标、用户故事与场景、核心概念与统一规则、流程与状态、功能需求、异常流程表、权限规则、字段说明、非功能与风险、验收标准、数据指标、依赖与风险、决策待确认项、评审通过标准。
小规模探索项目可裁剪章节（章节级 enabled 开关），也提供轻量精简模板。

### 5.2 智能生成执行策略
- **逐章节流式生成（默认）**：按章节顺序依次调用 LLM，每章节独立展示生成进度（生成中/完成/失败），支持**单章节失败重试**与**手动编辑后保存**，全部完成后拼接为完整 PRD 入库（版本号递增）；
- **快速模式**：分块数量 ≤ 5 的轻量项目可选用单次 LLM 调用全文直出，降低等待与成本；
- **质量锚定**：产物深度对齐参考 PRD 水准——背景由讨论记录提炼、用户故事由分块场景推演、异常流程表由叶子任务的边界用例归纳、验收矩阵由任务验收准则转化。

### 5.3 模板管理页 (config-prd-templates.html)
- 模板列表：卡片式管理（名称/章节数/是否默认/更新时间），支持新建/复制/删除/设为默认/导入导出（JSON）；
- 模板编辑器：章节列表拖拽排序 + 逐章节编辑（标题/指导说明/生成提示词/上下文勾选/字数下限/启用开关）；
- 变量插入工具栏：点击插入系统变量占位符，杜绝手打错误；
- 生成预览：选择任一探索会话数据做 dry-run 渲染预览。

### 5.4 任务映射至下游角色流水线字典
| MOD-17 实体属性 | 映射至 MOD-10 角色流水线 (Pipeline) | 映射说明 |
|---|---|---|
| `req_chunks.title` | `PipelineStage.name` 或工单模块组 | 分块作为流水线的 Stage 或特性泳道 |
| `req_tasks.title` | `PipelineTask.title` | 直接作为具体的代码编写或测试任务工单 |
| `req_tasks.acceptance_criteria` | `PipelineTask.prompt` | 转化为供编码 Agent 执行的验收断言要求 |
| `req_tasks.priority` | `PipelineTask.priority` | 严格继承 P0~P3 调度优先级 |
| `req_tasks.status = 'approved'` | `PipelineTask.status = 'ready'` | 仅 approved 分块下的任务才允许进入就绪队列 |

---

## 6. 全面验收矩阵 (Acceptance Criteria)

| 编号 | 功能领域 | 测试场景与验证行为 | 预期结果与质量准绳 |
|---|---|---|---|
| **AC-01** | 检索与状态过滤 | 在 `run-requirements.html` 输入关键字实时过滤卡片；点击状态筛选切换分类。 | 响应耗时 < 50ms；无匹配时呈现空状态并提供一键重置。 |
| **AC-02** | 工作台双 Tab 独立布局 | 在 `run-requirements-workbench.html` 切换「需求分块」与「建议」Tab。 | 两个面板均具独立 `overflow-y-auto` 滚动能力，内容完整展开，绝对高度无 0 塌陷。 |
| **AC-03** | Agent 动态管理 | 在左栏切换 Agent 状态开关；点击 ⚙️ 修改模型与提示词；点击删除角色。 | 关闭后半透明禁用，不再参与调度；修改与删除弹窗交互正常且有确认拦截。 |
| **AC-04** | 树形折叠与挂载隔离 | 点击父分块折叠展开子节点；检查任务挂载位置。 | 父分块仅能嵌套子分块；**任务卡片仅在最底层叶子分块展开**，父分块绝对不挂任务。 |
| **AC-05** | 建议清单交互闭环 | 查看建议面板各卡片的来源依据；点击任意建议卡片。 | 每条建议均标注清晰证据来源；点击后立即将议题回填到底部输入框并触发研讨。 |
| **AC-06** | PRD 导出与下游对接 | 在工作台点击「导出需求分块」与「生成 PRD」。 | 能够正确导出标准 Markdown 树形文档，具备跳转 Pipeline 实施的完整数据映射。 |
| **AC-07** | PRD 模板库管理 | 在 `config-prd-templates.html` 新建/编辑/复制/删除模板；调整章节排序；勾选章节上下文；设为默认。 | 模板 CRUD 持久化生效；章节拖拽排序保存正确；变量插入工具栏产出合法占位符；默认模板标记唯一。 |
| **AC-08** | PRD 逐章节智能生成 | 在工作台选择模板生成 PRD，观察逐章进度。 | 每章节独立展示生成中/完成/失败状态；单章失败可重试且不阻塞已完成章节；产物含分块树、任务清单与验收准则，深度对齐参考 PRD 结构。 |
| **AC-09** | PRD 快速模式 | 分块 ≤ 5 的会话选择快速模式生成。 | 单次调用全文直出，产物完整入库且版本号递增。 |
| **AC-10** | 章节手动编辑回写 | 对已生成的某章节手动修改后保存。 | 修改内容持久化，重新拼接的 PRD 包含人工修订，不覆盖其他章节。 |
