<div align="center">

# 🍇 Purple Grapes Harness (PGH)
### 中文名：紫提开发智能套件 (PGH Harness)

**自主可控 · 零 Native 编译 · 面向软件工程全生命周期的可插拔编码 Agent 运行时与多形态协作工作台**

[![Node.js](https://img.shields.io/badge/Node.js-22%2B-brightgreen?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Architecture](https://img.shields.io/badge/Architecture-Event%20Sourcing-orange)]()
[![Zero Native](https://img.shields.io/badge/Dependencies-Zero%20Native%20Addons-success)]()
[![Tests](https://img.shields.io/badge/Tests-271%20Passed-emerald)]()
[![License](https://img.shields.io/badge/License-MIT-purple.svg)]()

[产品定位](#-产品定位与解决痛点) • [三大核心能力形态](#-三大核心能力形态重点介绍) • [系统架构](#-系统架构) • [安全工程与信任边界](#-安全工程与信任边界) • [快速开始](#-快速开始) • [文档索引](#-文档体系)

</div>

---

## 📖 产品定位与解决痛点

**Purple Grapes Harness（简写：PGH / PGH Harness，中文名：紫提开发智能套件）** 是一款专为专业软件工程师与研发团队打造的高性能、可插拔编码智能体（Coding Agent）运行时引擎与现代化 Web 交互工作台。

在现存的大模型编码工具中，开发者往往面临诸多痛点：
- **安装繁琐与环境崩溃**：过度依赖含 C++ 原生扩展的底层依赖（如 `node-gyp`、Visual Studio MSVC、Python 编译链），在 Windows 或精简容器环境经常安装失败；
- **黑盒不可控**：缺乏确定性的代码审计与行级 Diff 对照，模型自由度过高容易发生不可逆的代码覆盖与污染；
- **长任务失忆与上下文爆炸**：长时序编码任务中 Token 迅速消耗，冗余思维链导致模型推理质量断崖式下跌；
- **单一对话无法支撑复杂研发**：单 Agent 难以兼顾“需求分析、架构设计、测试驱动开发、代码审查、流程把关”的规范化软件工程分工。

紫提套件提供从需求拆解到交付就绪的端到端闭环支持：
$$\text{需求/缺陷定位} \longrightarrow \text{架构与契约设计} \longrightarrow \text{测试驱动开发 (TDD)} \longrightarrow \text{行级 Diff 审查} \longrightarrow \text{人工审批放行} \longrightarrow \text{交付归档}$$

---

## 🌟 三大核心能力形态（重点介绍）

紫提套件围绕软件研发的不同业务深度，提供三大核心支柱能力：

```mermaid
graph LR
    %% 样式定义
    classDef rootStyle fill:#2e1065,stroke:#a855f7,stroke-width:2px,color:#f5f3ff,font-weight:bold;
    classDef modeAStyle fill:#0f172a,stroke:#38bdf8,stroke-width:2px,color:#f0f9ff;
    classDef modeBStyle fill:#1e1b4b,stroke:#818cf8,stroke-width:2px,color:#e0e7ff;
    classDef modeCStyle fill:#312e81,stroke:#c084fc,stroke-width:2px,stroke-dasharray: 4 4,color:#f3e8ff;

    ROOT["🍇 Purple Grapes Harness<br>紫提开发智能套件"]

    subgraph Mode1 ["支柱一 · Harness 编码主体 (单 Agent 核心工作台)"]
        direction TB
        M1_A["🛡️ 确定性编辑：先读后写 / CRLF 容错 / 3次熔断"]
        M1_B["🔒 沙箱与防线：realpath 物理防逃逸 / Deny>Ask>Allow 权限闸门"]
        M1_C["⏪ 变更与可逆：Git Checkpoint 快照 / Revert Turn 原子撤销"]
        M1_D["📊 审查与交互：行级红绿 Diff 对照 / 交互式单多选提问"]
        M1_E["🧠 认知治理：思维链剥离 / 无上限平滑滚动自压缩 / Spill 溢出"]
        M1_F["🧩 生态接入：双协议模型 / Skills 渐进披露 / mcp__ 强隔离池"]
        M1_G["📜 事实真相：不可变追加式事件日志 (Event Sourcing)"]
    end

    subgraph Mode2 ["支柱二 · 多角色流水线 (多阶段工程化协同)"]
        direction TB
        M2_A["🏊 泳道状态机：自定义多阶段顺序流转 (PRD→架构→TDD→QA)"]
        M2_B["🛑 质量卡点：Gatekeeper 人工审批卡点门 (waiting_gate)"]
        M2_C["🔁 治理反馈：带原因打回修改循环 & 超限 fail-closed 熔断"]
        M2_D["🔐 并发安全：父子工作区独占写锁租约让渡保护 (D64)"]
        M2_E["🛡️ 契约隔离：上游已审定工件下游只读守护 (防基线篡改)"]
        M2_F["🎮 中途控制：运行中暂停 (Pause) / 指令注入 (Instruction) / 恢复 (Resume)"]
    end

    subgraph Mode3 ["支柱三 · 流程图工作流 (BPMN 2.0 图形编排 · 规划中)"]
        direction TB
        M3_A["📐 标准模型：BPMN 2.0 XML 语义解析与持久化"]
        M3_B["🎨 编排画板：Dify 风格三栏可视化拖拽画板 (全景可折叠)"]
        M3_C["🔀 逻辑分支：排他网关 (Exclusive) 分支表达式动态求值"]
        M3_D["🔄 复杂拓扑：并行网关 (Parallel) / 子流程容器 / 循环重试"]
        M3_E["⚡ 动态监控：执行流轨迹 SVG 实时高亮染色追踪"]
        M3_F["🚌 状态总线：跨节点输入输出结构化变量总线消费"]
    end

    ROOT --> Mode1
    ROOT --> Mode2
    ROOT --> Mode3

    class ROOT rootStyle;
    class M1_A,M1_B,M1_C,M1_D,M1_E,M1_F,M1_G modeAStyle;
    class M2_A,M2_B,M2_C,M2_D,M2_E,M2_F modeBStyle;
    class M3_A,M3_B,M3_C,M3_D,M3_E,M3_F modeCStyle;
```

---

### 一、 Harness 编码主体功能（单 Agent 核心工作台）

作为整个套件的执行基座，Harness 主体提供严密、安全、高效的端到端编码回路：

1. **确定性文件与代码编辑机制**：
   - **严格先读后写**：禁止 Agent 在未读取物理文件上下文的情况下盲目写入，杜绝凭空脑补代码；
   - **精确换行符容错**：自动识别并保持 Windows CRLF 与 Unix LF 换行风格，杜绝因换行符差异产生满屏伪 Diff；
   - **局部替换 3 次熔断**：单文件局部匹配连续失败 3 次立即熔断并请求人类协助，杜绝死循环空转烧 Token；
   - **物理沙箱防逃逸**：路径强制通过真实物理路径反解校验，彻底拦截 `../` 路径穿越与符号链接 (Symlink) 逃逸。
2. **Git Checkpoint 原子撤销与代码保护**：
   - 每回合执行前自动建立原子快照，隔离并保护开发者原本手写未提交的代码；
   - 支持一键 **Revert Turn** 原地撤销当前轮次的所有物理文件变更。
3. **行级 Diff 审阅与人机交互 (Ask & Approval)**：
   - 文件写入与命令执行前直观展现红绿高亮行级代码对比；
   - 内置基于优先级的权限闸门（`Deny > Ask > Allow`），破坏性操作实时挂起等待人类审批；
   - 原生支持交互式单选/多选提问，让 Agent 在遇到模糊需求时主动对齐意图。
4. **深度上下文治理与超长输出溢出**：
   - **思维链自动剥离**：历史轮次自动精简旧思维链，保留纯净对话事实，大幅降低 Token 消耗；
   - **平滑自压缩**：基于轮次边界进行无上限平滑滚动压缩，保障超长任务不失忆；
   - **Spill 溢出机制**：超长命令输出或日志（> 50KB）自动存入私有 Blob，模型上下文与数据库仅保留指针。
5. **生态与资产连接池**：
   - **模型接入**：原生兼容 OpenAI / DeepSeek / 通义千问及 Anthropic（支持 Prompt Caching 与原生思维块），支持端点模型自动探测与双级代理分流；
   - **Skills 技能库**：对齐业界标准（YAML Front-matter + Markdown），支持技能渐进披露加载（仅在调用时展开正文）；
   - **MCP 客户端池**：支持 Stdio 与 SSE 连接外部 MCP 服务器，强制 `mcp__` 命名空间前缀强隔离；
   - **双层记忆中心**：支持纯 Markdown 与嵌入式 SQLite 存储，区分全局与项目级记忆，内置零丢失受控迁移向导。

---

### 二、 多角色流水线功能（多阶段工程化协同）

针对中大型任务或规范化交付场景，紫提套件将软件工程的“岗位分工机制”原生引入智能体执行体系：

1. **阶段泳道状态机**：
   - 固化并支持灵活定制多阶段工程流（例如：`Stage 1: 需求定义 PRD` $\rightarrow$ `Stage 2: 架构与契约设计` $\rightarrow$ `Stage 3: 测试驱动编码 TDD` $\rightarrow$ `Stage 4: 交付验收 QA`）；
   - 支持阶段双向动态插桩、自定义各阶段绑定的 Agent 角色、专属 Prompt 与产出工件契约。
2. **Gatekeeper 人工审批卡点门**：
   - 关键交付节点执行完毕后，流水线自动挂起为 `waiting_gate`（待审批），绝不盲目进入下一阶段；
   - 人类主管可在控制台审阅产物并执行 **一键批准放行** 或 **附带原因打回修改**。
3. **打回重做机制与安全收敛**：
   - 当阶段产物被人类驳回时，当前阶段 Agent 将携带打回原因及上下文自动重新执行并修正工件；
   - 内置打回次数超限安全熔断（fail-closed），防止逻辑发散引发死循环。
4. **父子工作区写锁租约让渡保护**：
   - 调度器持有目标物理工作区总锁，阶段执行时向当前 Agent 动态出借写锁租约，阶段结束后安全收回；
   - 严格保证多角色协作期间物理工作区始终**只有唯一活跃写者**，杜绝文件并发读写冲突。
5. **上游工件只读守护 (Artifact Guard)**：
   - 前序阶段审定通过的工件自动结构化注入下游阶段的上下文；
   - 后续阶段对上游已审定工件的操作被严格锁定为**只读保护**，防止下游角色意外篡改上游需求或架构基线。
6. **运行中全链路控制（暂停、干预与恢复）**：
   - **中途暂停 (Pause)**：支持任务执行中下达暂停指令，任务在当前阶段边界精准平滑挂起；
   - **下达干预指令 (Instruction)**：支持在暂停期间人类向流水线注入调整指令；
   - **恢复运行 (Resume)**：后续角色自动抽取并吸收中途干预指令，确保任务按人类预期精准修正。

---

### 三、 流程图工作流功能（BPMN 2.0 图形编排 · 暂未实现 / 规划中）

> 💡 **状态说明**：该模块已完成前期的业务规格定义与原型交互设计，核心运行时引擎处于规划与研发路线图中，计划作为后续重点能力推出。

1. **企业级标准建模兼容**：
   - 原生支持标准 BPMN 2.0 XML 模型的导入、解析与持久化存储；
   - 面向包含复杂逻辑判定、循环重试、多分支汇总的复杂企业级业务场景。
2. **可视化三栏拖拽编排画板**：
   - 提供现代化三栏画布（左侧节点库、中央无限编排画布、右侧属性参数面板）；
   - 支持面板一键折叠全景视野、节点连线、条件分支拖拽连接。
3. **复杂逻辑网关调度引擎**：
   - **排他网关 (Exclusive Gateway)**：支持线上动态求值分支表达式，依据执行结果动态路由下一节点；
   - **并行网关 (Parallel Gateway)** 与 **子流程容器**；
   - **输入变量总线**：在各节点之间消费并传递上下文结构化变量。
4. **动态执行流高亮监控**：
   - 任务执行期间在 SVG 画布上动态高亮当前运行节点与已走过的分支轨迹，具备端到端可视化追踪能力。

---

## 🏗️ 系统架构

紫提套件遵循分层高内聚、低耦合的软件工程架构，严格基于 Node.js 22+ 原生标准库装配。以下为系统完整拓扑与数据流向 Mermaid 架构全景图：

```mermaid
flowchart TB
    %% 样式定义
    classDef clientLayer fill:#1e1b4b,stroke:#818cf8,stroke-width:2px,color:#e0e7ff;
    classDef gatewayLayer fill:#0f172a,stroke:#38bdf8,stroke-width:2px,color:#f0f9ff;
    classDef coreLayer fill:#1e293b,stroke:#a855f7,stroke-width:2px,color:#faf5ff;
    classDef toolLayer fill:#1c1917,stroke:#f59e0b,stroke-width:2px,color:#fef3c7;
    classDef storageLayer fill:#064e3b,stroke:#34d399,stroke-width:2px,color:#ecfdf5;

    %% 1. 表现层
    subgraph LayerUI ["表现层 · 现代化 Web 交互工作台 (Web Presentation Console)"]
        direction TB
        subgraph ModeRun ["【运行态监控】"]
            UI_Chat["单 Agent 对话工作台<br>(run-chat.html)<br>· 流式输出 / 轮次时间线<br>· 红绿行级 Diff 对照<br>· 交互提问 & 审批弹窗"]
            UI_PipeRun["多角色流水线任务大屏<br>(run-pipeline.html)<br>· 并发实例进度看板<br>· 泳道阶段卡点感知<br>· 宽屏响应式大表"]
            UI_PipeDetail["流水线专属交互与监控<br>(run-pipeline-detail.html)<br>· 阶段状态流转图<br>· Gatekeeper 审阅/打回<br>· 暂停/干预/恢复中途控制"]
        end
        subgraph ModeConfig ["【资产与模板编排】"]
            UI_PipeCfg["流水线模板编排<br>(config-pipelines.html)<br>· 阶段双向插桩配置<br>· 角色与契约绑定"]
            UI_Mem["记忆治理中心<br>(config-memories.html)<br>· 全局/项目双层记忆<br>· 受控迁移向导"]
            UI_Prov["模型 Provider 管理<br>(config-providers.html)<br>· API 凭据密码态存储<br>· 模型连通性测试"]
            UI_Ext["技能与工具配置<br>(config-skills.html / config-mcp.html)<br>· Skills 渐进开关<br>· MCP 外部服务器管理"]
            UI_BPMN["BPMN 工作流画板 (规划中)<br>(config-workflow-design.html)<br>· 三栏拖拽画布<br>· 排他分支与循环网关"]
        end
    end

    %% 2. 网关与通信层
    subgraph LayerGW ["接入与网关层 · Fastify 网关引擎 (Gateway & Transport)"]
        GW_Router["RESTful 路由控制器<br>(/api/sessions, /api/pipelines, /api/providers ...)"]
        GW_SSE["SSE 增量推送管道 (Server-Sent Events)<br>· 周期心跳保活 ping 帧<br>· 实时 Token / 思考块 / 工具调用流式推送"]
        GW_Resume["断点续传重放引擎<br>(?after=seq 差异帧智能补齐)"]
        GW_Audit["安全审计守卫<br>· 仅监听 127.0.0.1 本地回环<br>· 敏感动作审计打点 (BL-08 / E-01)"]
    end

    %% 3. 核心调度引擎层
    subgraph LayerCore ["核心调度与治理层 (Core Orchestration Engine)"]
        RT_Loop["TurnLoop 智能体核心循环调度器<br>· ReAct 思维-行动-观察循环<br>· 超步熔断 (25步硬顶)<br>· 3次同参死循环阻断"]
        RT_Pipe["PipelineRunner 流水线多阶段泳道执行器<br>· 阶段状态机 (idle → running → waiting_gate → completed)<br>· Gatekeeper 审批挂起与带原因打回修改<br>· 运行中暂停 (Pause) / 干预 (Instruction) / 恢复 (Resume)"]
        RT_Lock["LockDelegator 写锁租约让渡调度器 (D64)<br>· 全局持有工作区总写锁<br>· 阶段流转动态让渡与安全回收<br>· 严格保证唯一活跃写者"]
        RT_Artifact["ArtifactManager 阶段工件守护管理器<br>· 阶段物理产出捕获 (artifactPaths / Git 增量)<br>· 结构化注入下游上下文<br>· 上游审定工件只读守护 (拦截篡改)"]
        RT_Gov["ContextGovernor 上下文治理引擎<br>· 历史轮次思维链自动剥离 (stripThinking)<br>· 基于 Epoch/Seq 边界的无上限平滑滚动压缩<br>· 物理模型窗口 80% 警戒线感知"]
        RT_Sec["PermissionGate 权限与安全闸门<br>· Deny > Ask > Allow 规则引擎<br>· 硬性红线拦截 (git push/跨目录/关机)<br>· 人工审批挂起机制 (ApprovalBroker)"]
        RT_BPMN["BPMN 2.0 状态机工作流引擎 (规划中)<br>· 标准 XML 语义解析<br>· 排他网关表达式线上求值<br>· 输入变量总线消费"]
    end

    %% 4. 工具与生态扩展层
    subgraph LayerTools ["扩展工具与执行层 (Tools & Ecosystem Connectors)"]
        TOOL_Coding["本地 6 大核心编码工具链 (tools-coding)<br>· read_file: 先读后写强制检查<br>· edit_file: CRLF/LF 换行容错 & 3次失败熔断<br>· write_file: 新建文件与增量 Diff 元数据<br>· bash: taskkill /T 子孙进程树硬超时杀灭 (120s)<br>· grep / glob: 高性能文件检索"]
        TOOL_Sandbox["SandboxGuard 沙箱隔离围栏<br>· fs.realpathSync 物理路径反解<br>· 绝对禁止越出工作区根目录<br>· 拦截 ../ 与符号链接 (Symlink) 逃逸"]
        TOOL_Skills["Skills 技能库服务 (渐进披露)<br>· 扫描 YAML front-matter 仅注入元数据<br>· 模型发起 /skill 时按需加载完整正文"]
        TOOL_MCP["MCP 客户端连接池 (tools-mcp)<br>· Stdio / SSE 双协议适配<br>· 强制附加 mcp__ 命名空间前缀隔离"]
        TOOL_Models["统一模型适配 Seam (统一接口)<br>· OpenAI 兼容适配器 (DeepSeek / Ollama / 通义千问)<br>· Anthropic 适配器 (Prompt Caching / 原生思考块)<br>· 全局 & 专属双级代理分流 / 静默超时熔断"]
    end

    %% 5. 持久化存储层
    subgraph LayerStorage ["持久化与存储层 (Zero-Native Storage Engine)"]
        ST_SQLite["Node 22 原生 node:sqlite 引擎 (DatabaseSync)<br>· 开启 WAL 模式 (Write-Ahead Logging)<br>· NORMAL 同步级别保障零延迟落盘"]
        ST_Events["追加式不可变事件日志表 (events)<br>· 局部单调递增 seq 保证无空洞<br>· 系统唯一事实来源 (Event Sourcing)"]
        ST_FTS["FTS5 全文倒排索引虚拟表 (events_fts)<br>· 会话与流水线事件秒级全文检索"]
        ST_Blobs["私有超长日志存储目录 (~/.pg_harness/blobs/)<br>· 超 50KB 命令输出自动提取 SHA-256 落盘<br>· 数据库仅保存指针，防内存撑爆"]
        ST_Memory["长期记忆双层资产库<br>· 全局/项目双层结构化 Markdown (.harness/memory.md)<br>· 独立 memory.db (支持 FTS5 语义召回)"]
        ST_Git["Git 仓储与检查点保护<br>· 单回合原子检查点 (Checkpoint)<br>· 隔离手写未提交代码 & 支持 Revert Turn 撤销"]
    end

    %% 跨层关联与数据调用
    LayerUI -->|HTTP REST & EventSource SSE| LayerGW
    GW_Router --> LayerCore
    GW_SSE <-->|推送事件流| LayerCore
    GW_Resume --> ST_Events

    RT_Loop --> RT_Gov
    RT_Loop --> RT_Sec
    RT_Loop --> TOOL_Coding
    RT_Loop --> TOOL_Models
    RT_Pipe --> RT_Lock
    RT_Pipe --> RT_Artifact
    RT_Pipe --> RT_Loop

    TOOL_Coding --> TOOL_Sandbox
    TOOL_Coding --> ST_Git
    RT_Sec --> TOOL_Coding
    RT_Loop --> TOOL_Skills
    RT_Loop --> TOOL_MCP

    LayerCore -->|写入不可变事件| ST_Events
    ST_Events --> ST_FTS
    LayerCore -->|超限 Spill| ST_Blobs
    LayerCore --> ST_SQLite
    TOOL_Skills --> ST_Memory
    ST_SQLite --> ST_Events

    %% 样式挂载
    class UI_Chat,UI_PipeRun,UI_PipeDetail,UI_PipeCfg,UI_Mem,UI_Prov,UI_Ext,UI_BPMN clientLayer;
    class GW_Router,GW_SSE,GW_Resume,GW_Audit gatewayLayer;
    class RT_Loop,RT_Pipe,RT_Lock,RT_Artifact,RT_Gov,RT_Sec,RT_BPMN coreLayer;
    class TOOL_Coding,TOOL_Sandbox,TOOL_Skills,TOOL_MCP,TOOL_Models toolLayer;
    class ST_SQLite,ST_Events,ST_FTS,ST_Blobs,ST_Memory,ST_Git storageLayer;
```

---

## 🔒 安全工程与信任边界

本项目将安全防线置于核心准则，严格遵照安全工程方法论落地：

| 编号 | 原则 | 工程落地实现 |
| :---: | :--- | :--- |
| **S1** | **默认拒绝 (Fail-Closed)** | 判定不确定时一律拒绝：未知工具不静默放行、审批超时与通道不可达一律拒绝。 |
| **S2** | **最小权限** | 文件与命令操作严格锚定用户显式绑定的物理目录，自动拦截逃逸；服务仅监听本地回环 (`127.0.0.1`)。 |
| **S3** | **外部输入皆数据** | 模型输出、工具输出、文件内容一律视为不可信数据，注入上下文处强制携带信任边界标注。 |
| **S4** | **凭据不出机** | API Key、Token 均经主密钥加密入库，绝不明文落盘、不进日志、不进 Git、列表接口绝不回传。 |
| **S5** | **破坏性操作不可自主执行** | 硬性红线（如 `git push`、关机、格式化磁盘、跨目录写入）在任何预设下严格拒绝，不可配置放宽。 |
| **S6** | **决策与副作用必留痕** | 所有工具调用、权限决策、人机交互全部落为不可变追加事件，历史不可篡改，支持事后完整复盘。 |

---

## 🚀 快速开始

### 前置要求
- **Node.js**：`v22.16.0` 或更高版本（必须包含原生 `node:sqlite`）
- **包管理器**：`pnpm`（推荐）
- **操作系统**：Windows 10/11、macOS、Linux（零 C++ 编译，全平台完全一致）

### 1. 克隆与安装依赖

```bash
git clone https://github.com/your-org/pgh.git
cd pgh

# 秒级安装纯 TypeScript 依赖（绝不触发 node-gyp 或 MSVC 编译）
pnpm install
```

### 2. 启动服务与工作台

紫提套件提供了跨平台启动与运维脚本：

**Windows 环境 (PowerShell)：**
```powershell
# 前台交互启动（自动检测环境、启动服务并拉起默认浏览器）
pwsh scripts/start-dev.ps1

# 或后台静默守护启动
pwsh scripts/start-bg.ps1 -NoBrowser

# 统一停止服务（确定性硬杀与单实例锁清理）
pwsh scripts/stop-dev.ps1
```

**Linux / macOS 环境 (Bash)：**
```bash
# 赋予执行权限并前台启动
chmod +x scripts/*.sh
./scripts/start-dev.sh

# 统一停止服务
./scripts/stop-dev.sh
```

服务就绪后，通过浏览器访问：
👉 **http://127.0.0.1:3210/run-chat.html**（单 Agent 智能对话与编码工作台）  
👉 **http://127.0.0.1:3210/run-pipeline.html**（多角色流水线任务与运行监控中心）

### 3. 代码质量自检与测试运行

```bash
# 全量质量门禁自检（包含 ESLint 检查、严格类型检查与全量测试套件）
pnpm check

# 运行全量 21 个原生测试套件 (271 个测试断言)
pnpm test
```

---

## 📚 文档体系

本项目坚持严格的规范驱动开发（SDD）与测试驱动开发（TDD）准则，相关技术文档均完备归档于 `docs/` 目录：

- **规范与安全**：[`AGENTS.md`](./AGENTS.md)（行为总纲）、[`docs/规范/安全工程方法论.md`](./docs/规范/安全工程方法论.md)（强制安全规约）；
- **技术设计文档**：包含概要设计、详细设计、数据库设计与接口设计说明书，归档于 [`docs/阶段-2-设计/`](./docs/阶段-2-设计/)；
- **业务需求与原型**：包含 11 大功能模块详细规格说明书与高保真原型，归档于 [`docs/阶段-1-需求/`](./docs/阶段-1-需求/)；
- **工程实施说明**：包含 WBS 工作分解结构与系统测试用例说明书，归档于 [`docs/阶段-3-实现/`](./docs/阶段-3-实现/)。

---

## 📄 开源许可证

本项目基于 [MIT License](./LICENSE) 协议开源。
