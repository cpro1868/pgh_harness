# Agent Harness 设计文档

> 状态：全部决策已确认（D1–D26，含 grilling 阶段决议）；文档待最终审阅
> 最后更新：2026-09-13
> 设计文档位置：`docs/superpowers/specs/2026-09-13-agent-harness-design.md`

## 0. 决策摘要

| # | 决策 | 结论 |
| --- | --- | --- |
| D1 | 交付形态 | 分层仓库（core 库 + 应用层），首版直接做到**完整网页版** |
| D2 | 技术栈 | TypeScript / Node 22 + pnpm workspace |
| D3 | 模型接入 | 统一 Provider 接口；内置 OpenAI 兼容适配器（覆盖 OpenAI/DeepSeek/Qwen/OpenRouter/Ollama/vLLM 等）；可自定义适配器；支持按 `baseURL + apiKey` **自动发现模型**并下拉选择 |
| D4 | 使用形态 | 单用户本地优先，数据模型预留多用户（`user_id`） |
| D5 | 会话真相 | **追加式事件日志为唯一真相 + 物化投影表**（不是消息表） |
| D6 | 扩展机制 | **自研精简插件内核，接口与 Cordis 对齐**；本期只做服务/事件/生命周期/配置挂载，不做 HMR 与外部插件加载器 |
| D7 | 权限模型 | **规则表（工具 + 参数模式 + allow/ask/deny）+ 预设 + 沙箱 seam** |
| D8 | 上下文治理 | **本期纳入**：token 计量、自动压缩、工具结果裁剪、大输出 Spill 落盘 |
| D9 | 存储 | **Node 22 内置 `node:sqlite`（`DatabaseSync`，WAL）+ FTS5**；零 native 编译 |
| D10 | 敏感信息 | AES-256-GCM 加密；凭据优先以**引用**（环境变量名）存在，每次操作重新解析 |
| D11 | 服务接口 | REST + SSE（回合状态在服务端，可断线续传） |
| D12 | 前端 | React 18 + Vite + Zustand + Tailwind + `react-markdown`（强制 sanitize） |
| D13 | 里程碑 | 分三批；**本期只做第一批**（见第 11 节） |
| D14 | 首要用例 | **编码 Agent 优先**；通用能力由 MCP + Skills 覆盖 |
| D15 | V1 验收场景 | 真实中小型仓库「修 bug → 跑测试 → 出 diff → 提 commit/PR 准备」端到端闭环 |
| D16 | 平台策略 | **零 Native 编译**：`node:sqlite` + `node:child_process`；Windows/Linux/macOS 均可跑，优先 Windows |
| D17 | 回合消息并发 | 新消息**入队排队**（piggyback），显式 **Abort** 按钮可立即打断 |
| D18 | 打断语义 | **干净硬杀**：断 LLM 请求 + 杀子进程 + 保留已产出内容（标 `aborted`）+ 原地续接 + 可重试 |
| D19 | 会话与工作区 | 会话**创建时绑定单个 Workspace**，生命周期内不可变；默认启动目录 |
| D20 | 请求可追溯 | `request/context` 快照事件 + 确定性 `deriveMessages` 投影；注入上下文必须先写日志 |
| D21 | 事件版本兼容 | 宽松读取 + 单向惰性迁移；旧会话可续写，新事件按新格式追加 |
| D22 | Agent 生命周期 | **按需唤醒 + 空闲超时卸载**（15min 无活动回收）；长驻任务保活；会话级隔离 |
| D23 | 插件启动容错 | **Fail-Fast**：缺依赖服务或 apply 抛错即整体启动失败并回滚已挂插件 |
| D24 | Token 计量 | **分层估算**：发送前字符近似法预判超限，Provider 返回 `usage` 后精准校正 |
| D25 | 外网暴露控制 | 绑定非回环地址时**强制要求 `HARNESS_ACCESS_TOKEN`**，无则拒绝启动；前端凭 Token 访问 |
| D26 | 工程规范 | `pnpm check`（lint+typecheck+test）为提交门槛；Conventional Commits；`scripts/self-check` 集成自检 |
| D27 | 系统提示组装 | 6 节流水线（身份 → 规约 → 项目规则 → 技能 → 环境 → 工具清单），由 `ctx.systemPrompt` 插件贡献组装 |
| D28 | 权限参数模式 | 差异化匹配：命令前缀/子命令白名单（shell）、路径 glob（文件）、域名（网络） |
| D29 | 压缩与命令 | 默认跟随会话模型，支持独立廉价模型配置与机械降级；支持 `/compact` 手动触发 |
| D30 | 配置规范 | `harness.yml` 扁平列表按序挂载，支持 CLI 参数与环境变量覆盖 |
| D31 | 视觉语言 | 现代工程师暗色调（Dark Mode 优先）、高信息密度、卡片折叠、代码等宽优先 |
| D32 | 端口与数据目录 | 默认 `~/.harness/` + 3000；支持 `--port` / `--data-dir` 自定义；未指定时端口冲突自动顺延 |
| D33 | 重试耗尽处理 | 429/5xx 3 次重试失败后**优雅挂起**，保留上下文并提供「立即重试 / 更换模型 / 放弃」引导 |
| D34 | 集成自检架构 | `scripts/self-check.ts` 默认基于内置 Fake Provider 离线秒级跑通；`--live` 可选真实模型冒烟 |
| D35 | 多智能体协作形态 | 解耦为三种模式：模式B（会话内子任务委派开关）、模式A（固定角色流水线模板）、模式C（BPMN 2.0 自定义业务流程引擎） |
| D36 | 模式B（子任务委派） | 会话级开关；注入 `spawn_agent` 工具，支持独立事件前缀与上下文，产物收敛回传主 Agent |
| D37 | 模式A（角色流水线） | 顺序角色执行看板，独立 System Prompt 与模型绑定，阶段 Gatekeeper 审批与 Artifact 传递协议 |
| D38 | 模式C（BPMN 2.0 引擎） | 支持标准 BPMN 2.0 XML 导入/执行，排他网关表达式分支判定，SVG 实时流转高亮与节点变量审计 |
| D39 | 记忆与经验治理 (MOD-11) | 全自动与半自动审核双模；四大存储形态（Disabled / 纯 Markdown / 本地 SQLite / Markdown+向量双轨），坚决剔除鸡肋纯向量；详情态锁定 + 专属受控向导（支持「丢弃测试数据全新起步」与「平滑数据无损迁移」两极分流，SHA-256 去重与 .bak 自动备份） |
| D40 | 通用 Skills 规范与生态兼容 | 严格对齐标准 Agent Skills Spec（YAML Front-matter + Markdown 规约 + 原子目录）；优先扫描 `.agents/skills` 与 `.skills`；首期专注支持本地原子 Skill 包导入与校验（支持文件拷贝或软链）；冷态仅注入元数据，热态通过 `skill(name)` 渐进披露加载正文 |
| D41 | 系统设置中心与导航瘦身 | 建立常驻系统设置中心（Settings Console），聚合网络端口、Token、数据目录、外观字体、底层插件与权限预设；精简外层 Activity Bar 为核心资产 + 底部系统齿轮 |

## 1. 总体架构与插件内核

### 1.1 目录结构

```
harness/
├─ packages/kernel/                 # 自研精简插件内核（与 Cordis 概念兼容）
├─ packages/plugins/                # 全部能力以插件形式提供
│   ├─ llm-openai/                  # OpenAI 兼容适配器（Provider seam 的实现）
│   ├─ session-log/                 # 事件日志（唯一真相）+ 投影
│   ├─ storage-sqlite/              # SQLite 实现（日志持久化 / 投影 / 设置）
│   ├─ credentials/                 # 凭据引用与加密（引用式 + AES-GCM）
│   ├─ tools-core/                  # 内置工具族（文件 / 搜索 / shell / 网络）
│   ├─ shell-session/               # 持久 shell（child_process 长驻管道）+ 后台任务
│   ├─ permissions/                 # 规则表 + 预设 + 审批流
│   ├─ sandbox-local/               # 沙箱本地实现（路径 + 网络约束）
│   ├─ context/                     # token 计量 + 压缩 + 裁剪
│   ├─ spill/                       # 大输出落盘
│   ├─ skills/                      # 技能发现与加载
│   ├─ mcp/                         # MCP 客户端
│   ├─ hooks/                       # 钩子（pre/post tool、turn 事件）
│   ├─ commands/                    # 斜杠命令（无模型回合，第二批）
│   ├─ session-title/               # 会话自动命名
│   └─ agent-loop/                  # ReAct 循环（驱动）
├─ apps/web/
│   ├─ server/                      # Fastify + SSE + 应用组装
│   └─ ui/                          # React + Vite 前端
├─ harness.yml                      # 组合配置（挂哪些插件、参数）
├─ package.json                     # pnpm workspace
└─ pnpm-workspace.yaml
```

### 1.2 内核概念（对齐 Cordis，精简实现）

| 概念 | 说明 |
| --- | --- |
| `ctx` | 共享上下文对象，插件与服务的挂载点 |
| 服务 | `ctx.provide('name', impl)` / `ctx.inject(['name'], cb)`；同一 key 只能有一个实现，重复挂载报错 |
| 事件 | `ctx.emit`（通知）、`ctx.waterfall`（可拦截改写，须 `next()`）、`ctx.serial`（顺序执行）；失败被隔离且记录 |
| 插件 | `apply(ctx, config)` + 注册即产出 disposer；卸载时效果自动回退 |
| 挂载 | `ctx.plugin(plugin, config)`；应用启动时按 `harness.yml` 的条目顺序挂载 |
| 作用域 | 注册归属调用方 scope；读取时「全局层 + 当前层」合并，近层优先（为会话级/预设级差异预留） |

**与 Cordis 的兼容边界**：概念、命名与调用形状对齐（`provide`/`inject`/`emit`/`waterfall`/`plugin`），使将来替换为 Cordis 或引入其 loader 时，插件代码基本不用改。**本期不实现**：HMR 热重载、profile/bundle 分层、外部 npm 插件加载、客户端插件槽位。

### 1.3 组装与配置

- `harness.yml` 声明要挂载的插件与参数；未声明的能力就是不存在的（例：不挂 `mcp` 就没有 MCP 工具）。
- 应用启动 = 读配置 → 按序挂载 → 校验必需服务是否齐备（缺则启动失败并明确报错，不静默降级）。
- `ctx` 的服务清单与事件清单由代码生成文档，避免文档漂移（阶段二）。

### 1.4 插件启动容错（Fail-Fast）

- 每个插件通过 `inject` 显式声明依赖服务；启动时构建依赖图。
- 缺依赖服务或 `apply` 抛错 → **整体启动失败**，调用已挂载插件的 `dispose()` 回滚资源后退出，不留后遗症。
- 绝不带病启动：控制台打印明确路径错误（如 `Plugin 'tools-core' failed: required service 'ctx.permissions' is missing`）。

## 2. 事件日志、消息模型与会话

### 2.1 唯一真相：追加式事件日志

```
events(id, session_id, seq, type, payload_json, created_at)
```

- **只追加，不修改不删除**；`seq` 从 0 单调递增，连续。
- 事件类型（首版）：
  `session/start`、`turn/start`、`turn/end`、`step/start`、`step/end`、`system/message`、`user/message`、`assistant/message`、`tool/call`、`tool/result`、`approval/request`、`approval/decision`、`question/request`、`question/answer`、`context/injected`、`request/context`、`compaction/start`、`compaction/summary`、`compaction/end`、`spill/created`、`permission/decision`、`permission/grant`、`session/title`、`usage`、`error`。
- **不变量：模型可见必已入日志。** 任何进入模型请求的内容（系统提示、注入上下文、工具结果）都必须能从日志重建；违反即为缺陷。这条是 fork/replay/审计成立的前提。
- **请求快照**：每次模型调用前写 `request/context` 事件，记录 `modelId`、`temperature`、`maxTokens`、可见事件序列号范围（`seq` 区间）、系统提示分节哈希、工具定义快照哈希；配合 `deriveMessages` 保证可 100% 复现当时发给 LLM 的完整请求。
- **版本兼容**：事件 payload 自带 `v` 字段；旧会话宽松读取（缺字段用默认值、忽略废弃字段）；续写时新事件按最新格式追加，旧事件不回写；未知破坏性类型明确拒绝并提示版本不兼容。

### 2.2 投影：物化消息表

```
messages(id, session_id, seq, role, content_json, created_at)
```

- 与事件日志**在同一事务内写入**，作为读模型供列表/搜索/渲染使用，不承担真相职责。
- 可随时从 `events` 重建（提供 `rebuildProjection` 命令），用于修复或投影规则变更。
- 投影规则（`deriveMessages`）：只取 message 类事件 + 压缩替换指令，处理 `surfaceOp: replace` 的遮挡关系。

### 2.3 消息与内容模型

- 消息类型：`SystemMessage` / `UserMessage` / `AssistantMessage`（含 `toolCalls`）/ `ToolMessage`（关联 `callId`）。
- **内容一律为 parts 数组**：`ContentPart = TextPart | ImagePart | FilePart`，本期只实现 `TextPart`；多模态只扩类型与渲染，不动表结构。
- 助手消息额外保存：思考/推理内容、`usage`、耗时；失败的尝试作为 `assistant/attempt` 保留（进审计，不进模型历史）。

### 2.4 崩溃恢复

- 崩溃时日志会停在「有 `turn/start` 没有 `turn/end`」。
- 启动/恢复时（握有写所有权）补齐：未闭合 `step/end`、缺失的工具失败结果、一条合成 `turn/end { reason: 'interrupted' }`。
- **不截断、不删除**已落盘的半成品内容。
- 只读观察者仅在内存中做同样的补齐视图，不写回。

### 2.5 fork / replay / 导出 / 会话树

- **fork**：复制到指定 `seq` 的事件前缀为新会话（记 `parent_id` 与继承前缀长度），可继续对话。
- **replay**：按日志重放，用于复现「模型当时看到了什么」。
- **导出**：JSON（含事件与投影）与 Markdown（可读记录）。
- **搜索**：`messages` 与 `events.payload_json` 走 FTS5。
- **会话树**：`sessions.parent_id` 本期恒为 `NULL`，为子 Agent 会话预留。
- **自动标题**：首轮结束后用廉价模型生成标题，写入 `session/title` 事件，用户可改。

### 2.6 表结构总览

```
users     (id, name, created_at)
sessions  (id, user_id, parent_id, title, provider_id, model, workspace, created_at, updated_at)
events    (id, session_id, seq, type, payload_json, created_at)      -- 唯一真相
messages  (id, session_id, seq, role, content_json, created_at)      -- 物化投影
settings  (key, value_json, updated_at)                              -- 非敏感配置
secrets   (name, ciphertext, kind, updated_at)                       -- 加密后的敏感值
索引：events(session_id, seq) 唯一、messages(session_id, seq) 唯一、
      sessions(user_id, updated_at desc)
PRAGMA journal_mode=WAL, foreign_keys=ON
```

## 3. 模型接入（Provider）

### 3.1 接口

```ts
interface Provider {
  name: string
  chat(req: ChatRequest): AsyncIterable<ChatEvent>
  listModels?(): Promise<ModelInfo[]>
}

interface ModelInfo {
  id: string
  name: string
  capabilities: ('tools' | 'vision' | 'reasoning')[]
  contextWindow?: number      // 用于上下文治理，缺省走内置登记表
}

type ChatRequest = {
  model: string
  messages: Message[]
  tools?: ToolSchema[]
  temperature?: number
  maxTokens?: number
  reasoning?: 'off' | 'low' | 'medium' | 'high'
}

type ChatEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'tool-call'; id: string; name: string; args: unknown }
  | { type: 'usage'; inputTokens: number; outputTokens: number; cachedTokens?: number }
  | { type: 'done' }
  | { type: 'error'; code: string; message: string; retryable: boolean }
```

### 3.2 内置适配器与自定义

- **内置 `OpenAICompatProvider`**：一套实现覆盖所有 OpenAI 兼容端点，配置仅 `baseURL / apiKey(or 引用) / model`。
- **自定义**：实现 `Provider` 接口即可接入任意协议（Anthropic Messages、自建网关等），循环层不感知差异。
- **模型自动发现**：`listModels()` 调 `GET {baseURL}/models`，前端在填完 `baseURL + apiKey` 后给出**下拉选择**，并保留手动输入兜底；按 `baseURL` 缓存、可手动刷新。
- **能力判定**：`capabilities` 缺失时按内置登记表推断角色（如已知 `vision` 模型），设置页可手动覆盖。

### 3.3 流与容错

- 统一产出增量事件；工具调用参数分片在适配器内累积后组装。
- 网络错误与 429/5xx 指数退避重试（默认 3 次，带抖动）；401/403/404 不重试；上下文超长交由第 5 节压缩流程处理一次，仍超限则明确报错。
- 记录 `usage`（含缓存命中 token）用于第 5 节计量与第 10 节成本统计。

## 4. 工具、MCP 与执行能力

### 4.1 工具定义与执行管线

```ts
interface Tool {
  name: string
  description: string
  parameters: JSONSchema
  execute(args, ctx): Promise<ToolResult>
  needsApproval?: boolean          // 供权限预设推导默认动作，最终以规则表为准
  finalize?(result): ToolResult    // 结果收尾（裁剪/附件化）最后一道
}
```

执行管线（每步都在事件日志留痕）：

```
tool/call（先落日志）
  → tools/pre-execute   waterfall：权限判定、钩子、沙箱包装
  → 单调守卫 guards     只允许 deny 或弃权，不可放行
  → 审批（如需）：ctx.approval 一次性询问；不可达 → 拒绝（fail-closed）
  → tools/execute       around：超时、重试、度量
  → 工具体
  → tools/post-execute  waterfall：接受 / 阻断 / 替换 / 追加上下文
  → finalize            内容收尾（超限即触发 Spill，见 5.4）
  → tool/result（落日志，唯一模型可见结果）
```

### 4.2 内置工具

| 工具 | 说明 |
| --- | --- |
| `read_file` | 读取并记录 `fs/observed`（供先读后写校验） |
| `write_file` / `edit_file` | **必须先读后写**：未观察过的已存在文件拒绝盲改；`edit_file` 走精确串替换并对失败给出可诊断错误 |
| `list_dir` / `glob` / `grep` | 目录列举、文件匹配、内容检索 |
| `bash` | 一次性命令，超时 + 输出上限；工作目录锁定 workspace 根 |
| `shell_session` | **持久 shell（`child_process` 长驻管道，非 PTY）**：可增量读取输出、发送输入、发信号、停止；长驻进程（dev server、watch）由后台任务承载；Windows 默认走 `powershell.exe` |
| `job_*` | 后台任务：启动、读取增量输出、停止、列举 |
| `fetch_url` | 抓取网页（SSRF 防护见第 10 节），超限内容走 Spill |
| `todo_write` | 任务清单读写，UI 渲染进度 |
| `skill` | 按名加载技能正文（渐进披露，见 4.4） |
| `ask_user` | 结构化提问（选项 + 自由输入），见第 6 节 |

工具默认在 workspace 根内工作；文件类工具路径必须解析后仍位于根内，且对已存在路径做 `realpath` 校验以阻断软链逃逸。

### 4.3 MCP 客户端

- JSON-RPC 2.0，支持 `stdio` 与 `HTTP/SSE` transport。
- 启动时 `initialize` → `tools/list` 动态注册为工具，`source: 'mcp:<server>'`；重名冲突报错。
- 连接断开：标记该 server 工具不可用并后台退避重连，不阻塞当前回合。
- 服务器配置存 `settings`，凭据走 `secrets` 引用。

### 4.4 Skills 技能包管理（通用标准规范）

- **标准形态**：
  - 严格采用业界事实标准的原子技能目录形态：`<name>/SKILL.md`，正文采用 **YAML Front-matter + Markdown** 规约。
  - 元数据字段收敛：`name` (kebab-case)、`description` (声明触发时机与用途)、`version`、`tools`、`disable-model-invocation` 等；支持包内携带 `scripts/` 与 `references/` 资产。
- **发现路径与优先级**：
  1. `<project>/.agents/skills/` 与 `<project>/.skills/`（通用行业跨工具标准目录，最高优先级）；
  2. `<project>/.harness/skills/`（本地项目专属目录）；
  3. `~/.config/agents/skills/` 与 `~/.harness/skills/`（用户全局目录）；
  4. 内置基础技能库（Built-in）。
- **本地导入与安装**：
  - 首期严格聚焦支持本地原子目录直接校验导入（支持完整文件拷贝或建立软链接），自动校验 `SKILL.md` 的 YAML Front-matter 合规性并建立目录索引。不引入复杂的远程 Git 子模块管理，保持轻量。
- **渐进披露装配流**：
  - **只把 `name` + `description` 摘录组装入系统提示**；正文由模型调用 `skill` 工具按需热加载，彻底避免 Token 膨胀。
  - 目录变化（外部 git pull 或在线编辑）触发热重扫。

### 4.5 持久 Shell 与后台任务（零 Native）

- **实现**：`node:child_process.spawn` 长驻子进程，通过 `stdin`/`stdout`/`stderr` 管道交互；Windows 默认 `powershell.exe`，Linux/macOS 走 `bash`/`sh`。
- **能力**：启动持久 shell → 发送命令 → 增量读取输出 → 发信号（SIGINT）→ 停止；支持后台任务（`job_*`）跑长驻进程（如 `npm run dev`、`pytest --watch`）。
- **无 PTY**：不依赖 `node-pty`（无 C++ 编译）；对 AI 编码场景，纯文本流足够，且没有 ANSI 控制符对 LLM 更友好。
- **清理**：会话卸载或 abort 时，向进程树发信号，3 秒未退出则强制 kill，不留孤儿进程。

## 5. 上下文治理

> 这是交叉比对中最大的缺口。没有这一节，长会话和中大型工具输出必然崩。

### 5.1 Token 计量与窗口登记

- 单例 `ctx.tokenMeter`：提供 `estimate(messages)`、`record(usage)`、`usageOf(session)`。
- 模型上下文窗口来源：`ModelInfo.contextWindow` → 内置登记表 → 保守默认值。
- 每步请求前检查：`估算输入 + 预留输出 > 窗口 × 阈值` 即触发压缩。
- **手动触发**：支持在输入框或界面调用 `/compact` 命令主动发起压缩。
- **摘要模型选择**：默认使用当前会话模型；支持在配置中指定独立的廉价模型（`compaction.model`）；若调用失败，优雅降级为纯文本机械摘要（保留指令、涉及文件与最后状态），不中断执行流。
- **计费归属**：压缩消耗的 Token 打上 `category: 'compaction'` 独立记账。

### 5.2 自动压缩（Compaction）

- 触发：`pressure`（接近阈值）与 `context-overflow`（Provider 明确报超长）。
- 流程：选一段可替换区间 → 生成摘要 → 写 `compaction/start` → `compaction/summary` → **以一条 `user/message` 执行 `surfaceOp: replace`** 遮挡原区间（事件仍保留，只是不再进入模型可见面）→ `compaction/end`。
- 约束：**必须保持工具调用与结果的配对完整**，不能切断；压缩期间锁定，防并发压缩。
- 保留尾部最近的若干轮不压缩（配置项）。
- 压缩摘要作为普通消息可被后续再次压缩。

### 5.3 工具结果裁剪

- 超预算的工具结果保留**头部 + 尾部**、中间替换为截断标记与省略字符数（按 Unicode 码点切分，不切断代理对）。
- 裁剪是一次新的 `tool/result` 替换事件（保留原事件以支持回放），并记账节省量。

### 5.4 Spill（大输出落盘）

- seam：`ctx.spillStore.saveText({ owner, source, suggestedName, content }) → { locator, bytes, retrievalHint }`。
- 本地实现：`<data>/spill/session-<hash>/<random>-<safeName>`，目录私有（0700），独占创建（`wx`, 0600）防符号链接重定向。
- 策略：工具结果超过 `maxInlineBytes` 时，落盘并只把「预览 + `locator` + 读取提示」放进上下文，模型需要时用 `read_file`/`grep` 自取。
- 失败降级：落盘失败**不把成功的调用变成错误**，退回内联结果（best-effort）。

## 6. 权限、审批与问答

### 6.1 权限规则表

```ts
type PermissionRule = {
  tool: string                       // 工具名，支持 'bash' / 'mcp:*' 等
  pattern?: string                   // 参数模式：如命令前缀 'git status'、路径 glob
  action: 'allow' | 'ask' | 'deny'
}
```

- 判定顺序：**deny > ask > allow**；无匹配则回落到工具默认（`needsApproval` 推导）。
- 会话级临时放行（「本会话内始终允许该工具」）**以事件形式写入日志**（`permission/grant`），随会话恢复而保留，不污染全局规则。
- 决策本身写 `permission/decision` 事件（可审计）。

### 6.2 预设

| 预设 | 行为 |
| --- | --- |
| 只读 | 读/搜索/抓取 allow；一切写入与命令 deny（plan 模式使用） |
| 编辑 | 读 allow；文件写入 ask；命令按规则表（危险命令 deny） |
| 全权 | 绝大多数 allow；不可逆与越界操作仍 deny |

### 6.3 审批与 fail-closed

- 审批请求写 `approval/request`，前端弹卡展示**将执行的确切内容/命令**；回应写 `approval/decision`。
- 挂起超时（默认 5 分钟）→ 拒绝；审批系统不可达 → 拒绝；客户端重连后重新下发待批项。
- **不因审批失败而假装成功**：拒绝以 `is_error` 工具结果回填，让模型改道。

### 6.4 用户提问（与审批分离）

- `ask_user`：向用户提结构化问题（多选项、单选、自由输入），写 `question/request`，回答写 `question/answer`，作为正常工具结果回填。
- 用于澄清需求，不用于授权；授权走审批。

## 7. 存储、凭据与加密

### 7.1 选型

SQLite 单文件（**Node 22 内置 `node:sqlite` / `DatabaseSync`**，同步 API、WAL），数据放 `data/harness.db`。理由：无需服务端、事务化追加、自带 FTS5、加 `user_id` 即平滑多用户、**零 native 编译零外部依赖**。

### 7.2 一致性

- **写路径**：一个回合内的 `tool/call`、`tool/result`、`assistant/message` 等写入 `events`，**同一事务内同步更新 `messages` 投影**。投影失败即整体回滚，绝不出现「日志有、投影无」。
- **重建**：`rebuildProjection` 可从 `events` 全量重建投影；投影规则变更后也走这条路径。
- **读路径**：列表/搜索/渲染走 `messages`；轨迹、replay、fork、导出、用量走 `events`。
- 启动时做一次 `integrity_check`；WAL 崩溃自恢复。

### 7.3 凭据：引用式 + 加密

- **引用优先**：凭据以「环境变量名」形式存于 `settings`（如 `providers.deepseek.apiKeyRef = "DEEPSEEK_API_KEY"`）；解析时按 **进程环境 → 项目 `.env` → 用户 `.env` → 加密库** 分层查找，**每次操作重新解析**，因此轮换环境变量后下一个请求即生效，无需重启。
- **落库加密**：必须入库的值以 AES-256-GCM 写入 `secrets`，格式 `v1.<iv>.<authTag>.<ciphertext>`（base64url），每条随机 12 字节 IV。
- **空值语义**：空字符串在任何层都视为「未配置」，不得伪装成已配置。
- **描述接口**：对外只提供 `describe`（是否已配置、来源层、是否可写、掩码），**任何读路径都不返回明文**；前端为只写字段（留空表示不修改）。

### 7.4 主密钥

- 优先级：环境变量 `HARNESS_MASTER_KEY` → 首启动生成 32 随机字节写入 `data/master.key`。
- // ponytail: Windows 上文件权限约束有限，依赖用户目录 ACL；需要更严再上 OS 密钥库。
- `v1.` 前缀为将来换算法/轮换预留；本期不提供轮换工具。
- 明文密钥只存在于服务端内存与出站请求；日志与错误信息按 `sk-` 类模式脱敏。

### 7.5 上限与清理

| 对象 | 策略 |
| --- | --- |
| `spill` 文件 | 随会话保留；超过保留期（默认 30 天）随会话删除任务一并清理 |
| 超大投影 | 单条 `content_json` 上限 2MB，超过则内容必须走 Spill（超限即拆分） |
| 会话/事件 | 不做自动删除；提供导出与手动删除 |

## 8. Web 服务层 · REST/SSE

### 8.1 接口一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 存活 + 已挂载插件与服务清单 |
| `GET` `POST` | `/api/sessions` | 列表（按 updated_at 倒序）/ 新建 |
| `GET` `PATCH` `DELETE` | `/api/sessions/:id` | 详情（含 `running`）/ 改名或切换预设 / 删除 |
| `GET` | `/api/sessions/:id/messages` | 历史消息（`?after=<seq>` 增量） |
| `GET` | `/api/sessions/:id/events` | 原始事件流（轨迹视图 / replay） |
| `POST` | `/api/sessions/:id/messages` | 发消息，返回 **SSE 流** |
| `GET` | `/api/sessions/:id/stream` | 重新挂载进行中的回合（SSE，`?after=<seq>`） |
| `POST` | `/api/sessions/:id/abort` | 中断当前回合 |
| `POST` | `/api/sessions/:id/approvals/:callId` | 批准 / 拒绝 |
| `POST` | `/api/sessions/:id/questions/:callId` | 回答 agent 的提问 |
| `POST` | `/api/sessions/:id/compact` | 手动触发压缩 |
| `POST` | `/api/sessions/:id/fork` | 从指定 `seq` 分叉 |
| `GET` | `/api/sessions/:id/export` | 导出 JSON / Markdown（`?format=`） |
| `GET` | `/api/sessions/:id/usage` | 用量与花费（含按模型分解） |
| `POST` | `/api/runs` | **headless 调用**：无 UI 跑一次，返回 JSON 事件流 |
| `GET` `PUT` | `/api/settings` | 非敏感配置读写（含权限规则、预设、预算、workspace） |
| `GET` | `/api/secrets` | 掩码与来源层，永不返回明文 |
| `PUT` `DELETE` | `/api/secrets/:name` | 写入 / 移除敏感值 |
| `GET` `POST` | `/api/providers` | Provider 列表 / 新增 |
| `POST` | `/api/providers/:id/models` | 服务端代理拉取模型列表（Key 不出服务端） |
| `POST` | `/api/providers/:id/test` | 连通性测试 |
| `GET` `POST` `DELETE` | `/api/mcp/servers` | MCP 服务器管理；另有 `/reconnect` |
| `GET` | `/api/skills` | 技能目录（区分模型可用 / 用户可用） |
| `GET` | `/api/commands` | 斜杠命令目录 |

### 8.2 SSE 事件协议

- 命名事件 + JSON `data`，每个事件带会话内自增 `seq`：
  `turn-start`、`step-start`、`text-delta`、`reasoning-delta`、`tool-call-start`、`tool-result`、`approval-request`、`question-request`、`todo-update`、`compaction`、`usage`、`error`、`turn-end`。
- **断线重连**：先 `GET /api/sessions/:id` 拿 `running`；若在跑，用 `/stream?after=<seq>` 续传，历史用 `/messages?after=` 补齐。服务端不因客户端断开而中断回合。
- **多标签同步**：同一会话的事件广播给所有已连接客户端；回合结束后缓冲释放，此时 `/stream?after=` 直接 `204`，客户端改从 `/messages?after=` 补齐。
- **心跳**：每 15s 注释行，防代理空闲断连。
- **互斥**：同一会话同时仅一个运行中回合，并发 POST 返回 `409 session_busy`。
- **排队**：回合运行中用户发新消息 → 前端立即呈现并标「等待中」，服务端在当前 Step 结束后将排队消息合并为上下文喂给 Agent；用户可随时点 **Abort** 立即打断。
- **幂等**：客户端为每条消息生成 `clientMessageId`，服务端按会话去重，防重试重复发送。

### 8.3 headless 模式

`POST /api/runs` 接受 `{ workspace, prompt, preset, model?, budget? }`，返回 NDJSON/SSE 事件流，无 UI 依赖；用于 CI 与脚本。`core` 本身是库，SDK 形态近乎免费（后续可加轻量 JS 客户端）。

### 8.4 实现约定

- Fastify；SSE 直接写 `reply.raw`；请求/响应校验用 Fastify 内置 JSON Schema（不引 zod）。
- 生产 `@fastify/static` 托管构建产物（同源无 CORS）；开发态 Vite proxy 转发 `/api`。
- 回合执行与连接解耦：事件先写入内存 `TurnStream`（可回放缓冲，带 `seq`），日志落库与 SSE 消费都从它读取。

### 8.5 Agent 生命周期管理

- **按需唤醒**：打开会话发消息时，若内存无对应 `Agent` 实例，从事件日志秒级重建并挂上持久进程。
- **空闲卸载**：会话空闲 15 分钟无新消息且无后台长驻任务 → 销毁内存实例回收资源；有长驻任务的实例标 `keepAlive` 不卸载。
- **会话隔离**：不同会话拥有完全独立的执行上下文（子进程、工作目录、上下文计数），A 的崩溃不影响 B。
- **中断清理**：Abort 时断 LLM 请求（`AbortSignal`）+ 杀子进程树（SIGINT → 3 秒未退强制 kill）+ 审批弹窗自动关闭 + 已产出内容保留并标 `aborted`。

## 9. 前端 UI

### 9.1 技术选型

React 18 + Vite + TypeScript + React Router；状态用 Zustand；样式用 Tailwind；Markdown 用 `react-markdown` + `remark-gfm` + `rehype-highlight`，**强制加 `rehype-sanitize`**（模型输出不可信，防 XSS）。

### 9.2 页面结构与组件

- 路由规划：
  - **运行态 (Workbench)**：`/`（新建会话）、`/s/:id`（主对话）、`/s/:id/trajectory`（轨迹审计）。
  - **配置态 (Settings)**：`/settings/workspace`（工作区与知识库）、`/settings/providers`（模型）、`/settings/permissions`（权限与沙箱）、`/settings/mcp`（MCP 扩展）、`/settings/skills`（技能库）、`/settings/plugins`（内核插件装配）。
- 整体架构：
  - **顶栏常驻**：显式展示当前绑定工作区绝对路径（带快速切换与历史抽屉）+ 「工作台 (Run) / 设置中心 (Settings)」顶级双态模式切换器。
  - **工作区与知识库支持**：自动扫描工作区根目录下的 `AGENTS.md` / `CLAUDE.md` 进行规范注入，提供本地文档知识库目录索引与 SQLite FTS5 语义检索支持。

| 组件 | 职责 |
| --- | --- |
| `WorkspaceBadge` | 顶栏高亮展示当前工作目录，点击呼出切换与最近项目抽屉 |
| `ModePill` | 顶栏一键平滑切换「工作台 (Run)」与「设置中心 (Settings)」 |
| `SessionList` | 会话列表、分组、改名/删除/分叉入口 |
| `MessageList` | 消息流、贴底自动滚动（上滑暂停跟随，出现「回到底部」） |
| `MessageBubble` | Markdown、代码高亮、复制、思考内容折叠 |
| `ToolCallCard` | 工具调用：名称、参数、状态、结果、耗时；可折叠；`shell_session`/`job` 支持增量输出与停止 |
| `DiffCard` | 文件修改以 diff 呈现，可接受/拒绝 |
| `ApprovalDialog` | 危险操作批准：展示确切内容/命令；「本会话内始终允许」 |
| `QuestionCard` | agent 的结构化提问（单选/多选/自由输入） |
| `TodoPanel` | 任务清单与进度 |
| `Composer` | 自适应输入框；`Enter` 发送、`Shift+Enter` 换行；运行中变「停止」；`@` 引用文件；`/` 命令补全；附件入口（按模型能力启停）；排队中的消息标「等待中」 |
| `PlanToggle` | 只读/编辑/全权预设切换，或 plan 模式开关 |
| `UsageBadge` | 当前模型、token 用量、会话花费、预算余量 |
| `SettingsConsole` | 设置中心控制台：工作区知识库、Provider、权限规则、MCP Server、Skills、插件装配 |
| `TrajectoryView` | 按来源查看事件流，支持 replay 与 fork |

### 9.3 交互与状态

- SSE 用 `fetch` + `ReadableStream` 手动解析（`EventSource` 不支持 POST body），封装 `useAgentStream(sessionId)`。
- 发送消息**乐观插入**用户气泡；`turn-start` 后开始流式追加；`tool-call-start` 立刻出现工具卡片。
- 错误：SSE `error` 渲染为可重试提示；网络错误 toast；预算超限给出明确阻断原因。
- 可访问性：流式文本容器 `aria-live="polite"`；全部操作可键盘完成；弹窗焦点陷阱。
- // ponytail: 消息列表暂不做虚拟滚动，长会话先全量渲染；出现卡顿再引入虚拟列表。

### 9.4 交付与分发

`npx @harness/web web` 一条命令起服务（自动打开浏览器）；提供 Dockerfile；数据目录默认 `~/.harness`（可用环境变量覆盖）。

### 9.5 工程规范

| 命令 | 说明 |
| --- | --- |
| `pnpm lint` | ESLint（TS 规范 + 逻辑检查） |
| `pnpm typecheck` | `tsc --noEmit`（strict 模式，杜绝 `any`） |
| `pnpm test` | `node --test`（全部单测） |
| `pnpm format` | Prettier / `eslint --fix` |
| `pnpm check` | **提交门槛**：lint + typecheck + test 合并跑 |

- **风格**：`strict: true`；禁硬编码密钥/路径/魔法数字。
- **Git**：`main` 分支保护，开发走 `feat/xxx` / `fix/xxx`；Conventional Commits；**绝不提交** `node_modules`、构建产物、`.env`、真实 API Key、`.db`。
- **自检**：`scripts/self-check.ts` 默认基于内置 Fake Provider 纯离线秒级跑通「建会话→发消息→读文件→写文件→跑命令」闭环；支持 `--live` 参数调用真实 API 做线上冒烟。

## 10. 错误处理与安全边界

### 10.1 错误分类与策略

| 来源 | 场景 | 策略 |
| --- | --- | --- |
| Provider | 网络错误 / 429 / 5xx | 指数退避重试（默认 3 次，带抖动）；重试耗尽后**优雅挂起**（不抛弃上下文），提示诊断并在界面提供「立即重试 / 更换模型与Key / 放弃此步」引导 |
| Provider | 401 / 403 / 404 | 不重试，提示检查 Key / baseURL / 模型名 |
| Provider | 上下文超长 | 触发一次压缩后重试；仍超限则明确报错并给出 token 估算 |
| 工具 | 执行失败 | **不炸循环**：以 `is_error` 的工具结果回填，让模型改道；计入最大步数 |
| 工具 | 超时 / 输出过大 | 超时中断并返回错误结果；超限输出走 Spill，失败则按阈值截断并标注 |
| MCP | 连接断开 | 标记该 server 工具不可用，后台退避重连；不阻塞当前回合 |
| Agent | 超出最大步数 | 停止，返回「已达最大步数」+ 已完成内容 |
| Agent | 重复调用检测 | 同 `tool + args` 连续 3 次相同 → 中断，提示疑似死循环 |
| 权限 | 审批不可达 / 超时 | **fail-closed**：一律拒绝，并以 `is_error` 结果回填 |
| 服务端 | 未捕获异常 | 统一错误信封 `{ error: { code, message, details? } }`；500 不泄露堆栈 |
| 存储 | 约束 / IO 错误 | 事务回滚；启动做 `integrity_check`；WAL 自恢复 |
| 崩溃 | 回合未闭合 | 启动补齐 `interrupted` 结束与缺失的工具失败结果（见 2.4） |
| 用户 | 主动中止 | `AbortController` 贯穿 Provider 请求与工具执行；半成品标记 `aborted` 落库 |
| 预算 | 超限 | 回合开始前阻断并说明原因；回合中途超限则优雅收尾 |

### 10.2 安全边界

**威胁模型**：单机单用户优先，但**模型输出与工具返回内容均视为不可信输入**（提示注入来源），而工具在宿主机执行——这是主要风险面。所有防线默认开启，不依赖用户配置。

- **沙箱 seam**：`ctx.sandbox` 提供「包装 argv / 约束文件系统与网络」的能力；本期实现本地后端（workspace 根约束 + 网络出口策略），Docker/远端后端预留。**不挂任何沙箱时启动必须显著警告**（对齐 OpenHands 的显式提示），并默认降级为只读预设。
- **文件约束**：所有路径 `resolve` 后必须位于 workspace 根内；已存在路径再做 `realpath` 校验阻断软链逃逸；trash 而非直接删除（可恢复）。
- **先读后写**：未通过 `read_file` 观察过的已存在文件拒绝盲改；`write_file` 覆盖需已读或显式标记为新文件。
- **SSRF 防护**：`fetch_url` 仅允许 `http/https`；拒绝解析到私有/回环/链路本地地址（`127.0.0.0/8`、`10/8`、`172.16/12`、`192.168/16`、`169.254.0.0/16`）及**重定向后的目标**；响应体大小与超时设上限。
- **命令执行**：以服务进程用户权限执行，无额外提权；工作目录锁定 workspace 根；默认超时与输出上限；长驻进程走持久 shell 与后台任务，可随时停止。
- **权限闸门**：规则表 + 预设（第 6 节）；危险操作展示确切内容；「始终允许」仅限本会话。
- **提示注入缓解**：工具结果以明确 `untrusted` 边界标注写入上下文；系统提示声明工具输出仅为数据；真正兜底是沙箱 + 权限闸门。
- **凭据**：引用式 + 加密（第 7 节）；日志/错误按 `sk-` 类模式脱敏；接口只回掩码。
- **XSS / CSP**：Markdown 强制 sanitize；响应头 CSP（禁内联脚本与外部脚本源）。
- **网络暴露**：默认只监听 `127.0.0.1`；显式绑 `0.0.0.0` 时**强制要求 `HARNESS_ACCESS_TOKEN`**（无则 `exit(1)` 拒绝启动），前端凭 Token 访问，CORS 限制为当前源。
- **资源上限**：单回合最大步数、单回合最大工具调用数、单工具超时、单次输出上限、会话预算，均可配。
- **审计**：事件日志即完整审计轨迹；另以结构化日志（pino）写 `data/logs/`，不额外建审计表。

## 11. 里程碑与测试

### 11.1 第一批（本期交付）

| 里程碑 | 内容 | 完成判据 |
| --- | --- | --- |
| M1 内核与组装 | 自研内核（服务/事件/生命周期/scope）、`harness.yml` 挂载、插件骨架、启动校验 | 能按配置挂载，缺失必需服务时启动失败并明确报错；`/api/health` 输出已挂插件与服务清单 |
| M2 事件日志与存储 | `events` + `messages` 投影（同事务）、崩溃恢复、FTS 搜索、fork/replay、导出、自动标题 | 崩溃后重启能识别并补齐中断回合；fork 后可继续对话；replay 能重建模型当时的输入 |
| M3 模型接入 | Provider seam、OpenAI 兼容适配器、模型自动发现、usage、重试 | 填入 `baseURL+apiKey` 能列出模型；真实模型跑通一轮对话；429 触发退避重试 |
| M4 工具与执行 | 执行管线（pre/guards/execute/post/finalize）、内置工具、持久 shell + 后台任务、沙箱本地实现、MCP、Skills、hooks | 模型能读写文件、跑长驻进程并读增量输出、调用一个真实 MCP server 的工具、按需加载一个 skill |
| M5 上下文治理 | tokenMeter、压缩、结果裁剪、Spill | 长会话自动压缩且工具调用/结果配对不破；超大输出落盘且模型可自行取回 |
| M6 权限与交互工具 | 规则表、预设、审批、`ask_user`、`todo_write` | 「`git status` 免问、`rm -rf` 直接拒」按规则生效；审批超时拒绝；提问能往返 |
| M7 Web 服务层 | REST/SSE、续传、多标签广播、幂等、headless、预算阻断 | 刷新能续传进行中的回合；两个标签页状态一致；`POST /api/runs` 无 UI 跑通 |
| M8 Web UI | 第 9 节全部组件与页面 | 浏览器完成一次带工具调用、审批、提问、todo、diff 审阅、压缩提示的完整对话 |
| M9 收尾 | `npx` 启动 + Dockerfile、安全清单逐项复核、README、自检脚本 | 第 10.2 节清单逐项可验证 |

M1–M8 合起来即「完整网页版」首版。

### 11.2 第二批（增量，不动地基）

Checkpoint 回滚（按回合快照被改文件，可回退）· `@` 引用文件 · 斜杠命令（`commands` 插件，不消耗模型回合）· 通知（浏览器通知：需审批/回合结束）· OTel 遥测导出 · i18n（中/英）· 客户端插件槽位。

### 11.3 第三批（预留）

多 Agent 编排与 agent teams · ACP 适配 · 定时与 Webhook 触发 · 代码运行时（程序化工具调用）· LSP 诊断回灌 · 结构化输出 · 模型回退与顾问模型 · 多模态输入 · 会话存储后端可插拔 · 插件加载器 / profile-bundle / 插件市场。

### 11.4 测试策略

用 Node 内置 `node:test` + `node:assert`（标准库，零新依赖），`pnpm test` 统一跑；不引 Vitest/Jest，不搭复杂 fixture。

| 测试对象 | 用例要点 |
| --- | --- |
| 内核 | 服务重复挂载报错、waterfall 拦截与 `next()`、插件卸载效果回退、缺服务启动失败 |
| 事件日志 | `seq` 连续单调、同事务投影一致、`rebuildProjection` 结果等价、崩溃补齐 `interrupted` |
| fork/replay | fork 前缀正确、继承长度准确、replay 输入与原始请求一致 |
| Provider 流解析 | 文本增量与工具参数分片组装（stub server 喂固定 SSE）、重试与超长处理 |
| 循环 | 最大步数、工具失败回填、同参重复 3 次中断、abort 生效（脚本化 fake Provider） |
| 工具与沙箱 | 路径穿越、软链逃逸、SSRF 网段判定、先读后写约束（纯函数，易测） |
| 权限 | 规则优先级 deny>ask>allow、参数模式匹配、会话级放行不泄漏、fail-closed |
| 上下文治理 | 压缩保持工具配对、裁剪不切代理对、Spill 失败降级为内联 |
| 凭据与加密 | 加解密往返、GCM 篡改检测失败、空值视为未配置、掩码格式、引用分层解析 |
| 存储 | `:memory:` 事务、`after` 增量查询、FTS 命中 |
| 服务层 | 集成脚本：起服务 → 建会话 → 发消息 → 校验 SSE 序列 → 断线续传 → 并发 409 → 幂等去重 |
| 前端 | 手动验证为主；仅对 SSE 解析函数做单测 |

## 12. 多智能体协作架构设计 (Multi-Agent Architecture)

### 12.1 模式B：会话内子任务委派 (Subagent Delegation)
- **内核机制**：在 `packages/plugins/agent-loop` 中支持委派能力。当会话开启子任务模式时，动态向工具注册表注入 `spawn_agent` 工具。
- **工具契约**：
  ```ts
  interface SpawnAgentArgs {
    task: string
    expectedOutput: string
    tools?: string[]
    modelId?: string
  }
  ```
- **会话树与隔离**：子 Agent 会话自动关联 `sessions.parent_id = parentSessionId`。日志写入主数据库 `events` 表，但分配子 session ID。
- **边界控制**：继承父会话环境变量与权限规则，单次最多派生 3 层（`maxDepth = 3`），单子任务默认上限 10 步，超时 3 分钟自动中断。
- **产物收敛**：子 Agent 产出的最终文本作为 `tool/result` 回填主 Agent 上下文，主 Agent 消息流仅展示紧凑卡片与折叠详情。

### 12.2 模式A：角色流水线模式 (Role Pipeline)
- **组件结构**：`packages/plugins/orchestrator-pipeline`
- **核心数据模型**：
  ```ts
  interface PipelineDef {
    id: string
    name: string
    stages: {
      id: string
      roleName: string
      systemPromptTemplate: string
      modelId?: string
      toolsAllowed: string[]
      gatekeeperRequired: boolean // 是否需要人工确认产物
      inputArtifactKeys: string[]
      outputArtifactKey: string
    }[]
  }
  ```
- **执行生命周期**：
  1. 初始化阶段上下文 `ArtifactsMap`；
  2. 顺序激活当前阶段 Agent，将前序 Artifacts 作为上下文注入；
  3. 阶段产出校验；若 `gatekeeperRequired: true`，进入审批挂起；
  4. 人工确认后将 Artifact 落盘，推进至下一阶段。

### 12.3 模式C：BPMN 2.0 业务流程引擎 (BPMN Workflow Engine)
- **组件结构**：`packages/plugins/workflow-bpmn`（纯 TS 实现轻量解析与执行）
- **核心能力**：
  1. **BPMN 2.0 XML 解析与映射**：无损双向映射 `bpmn:process`、`bpmn:serviceTask`、`bpmn:exclusiveGateway`、`bpmn:sequenceFlow` 与现代节点卡片图数据（Graph Model）。
  2. **节点深度参数契约**：
     - **输入变量消费**：声明节点所需上游变量（如 `${workflow.variables.prId}`）；
     - **双轨 Prompt 架构**：分离固定人设约束的 `systemPrompt` 与支持变量模板插值的 `userPrompt`；
     - **输出变量总线**：节点产出的结构化 JSON 按提取路径写入流程实例 `executionVariables`；
     - **排他网关表达式引擎**：纯 TS 沙箱评估序列流判定条件（如 `${testCoverage >= 85.0}`），支持默认 Else 分支。
  3. **状态机与流转总线**：每个流程实例分配 `instanceId`，维护 `activeTokens`（当前活跃节点/网关集合）与节点流经历史。
  4. **流程可视化事件**：服务端通过 SSE 实时下发 `workflow-token-move { from, to, timestamp }`，前端 SVG 图层高亮相应连线与节点。

### 12.4 记忆与经验治理 (MOD-11 Memory Engine)
- **组件结构**：`packages/plugins/memory-engine`
- **核心能力**：
  1. **双模式沉淀流**：
     - 全自动：由会话生命周期事件（如 `session:complete`）触发后台静默提取任务，直接入库；
     - 半自动：提取产物标记为 `pending_review`，需人工在控制台审核放行。
  2. **四大多样化存储状态**：
     - `Disabled`：显式关闭记忆反思与召回，零存储、零开销、防污染；
     - `MarkdownAdapter`：负责 `.harness/memory.md` 的增量读写，结构化生成二级标题小节；
     - `SqliteAdapter`：基于原生 `node:sqlite`（零 Native），支持用户自定义相对路径与绝对路径，建立 FTS5 虚拟表并执行全文关键词快速检索；
     - `FileVectorHybridAdapter`：**Markdown 文件 + 向量双轨适配器**。真相源始终为 `.harness/memory.md`（Git 友好），挂载轻量 Embedding 模型计算切片向量，兼备版本化管理与语义联想切片召回。坚决剔除黑盒脱节的纯向量存储。
  3. **受控存储变更与数据迁移契约**：
     - 详情态锁定：工作区列表杜绝随意下拉即时生效；
     - 两极诉求分流向导：
       - **全新起步，丢弃测试数据**：适用于初期调试验证产生的数据，不执行迁移，直接建立全新目标介质，原文件自动更名为 `.bak` 归档冷备份；
       - **平滑数据无损迁移**：在 `db.transaction()` 原子事务中执行结构化提取与写入，基于 SHA-256 内容指纹自动去重，确保经验无缝延续；
     - 预检目标路径写权限与连通性，失败完全回滚。
  4. **检索与动态注入**：在 Agent 会话上下文组装阶段，根据用户当前任务 Prompt 执行相似度与关键词检索，取 Top-K（带阈值过滤）条目格式化为 System Prompt 记忆注入块。

## 13. 未来扩展设计（预留，不在本期实现）

### 13.1 多模态
- 消息内容已是 parts 数组，新增 `ImagePart = { type: 'image', blobId, mimeType, width?, height? }` 即可。
- 二进制走 `blobs` 表 + 内容寻址 `data/blobs/<sha256>`，消息只存引用；Spill 复用同一机制。
- 上传：`POST /api/uploads`（multipart）→ `blobId`；Provider 映射为 `image_url` data URI。
- 能力门控：`ModelInfo.capabilities` 含 `vision` 才开放附件入口，可手动覆盖。

### 13.2 编辑器与平台接入
- **ACP 适配器**：实现 Agent Client Protocol，使任意兼容编辑器能驱动本 harness（复用 MCP 的 JSON 表示 + diff 约定）。
- SDK：在 `core` 之上加轻量 JS 客户端（已是库，成本低）；headless 已在 M1–M9 交付。
- 定时 / Webhook：按 cron 或事件触发会话创建，复用 headless 入口。

### 13.3 能力增强
- 代码运行时（程序化工具调用）：把工具暴露为一段可执行代码的 SDK，让模型用一次调用编排多步。
- LSP 诊断回灌：编辑后把类型/编译诊断作为上下文注入，形成自修闭环。
- 结构化输出：JSON Schema 约束最终输出。
- 模型回退与顾问模型：主模型失败降级；难题咨询更强模型。
- 会话存储后端可插拔：抽象持久化 seam，支持镜像到外部对象存储。
- 插件生态：外部加载器、profile/bundle 组合、依赖版本约束、客户端槽位、市场（均以 M1 内核的兼容边界为基础）。

### 13.4 i18n 与通知
第二批已含中英 i18n 与浏览器通知；更远的移动端推送、IM 接入（Slack/Telegram）不做。

## 14. 交叉比对差距 → 归属（决策已定）

参考对象：DeepSeek Harness (dsh)、Claude Code、Codex CLI、Cline、OpenHands、Aider、goose、pi、ACP。

| 组 | 差距项 | 归属 |
| --- | --- | --- |
| A 上下文治理 | A1 token 计量、A2 自动压缩、A3 结果裁剪、A4 Spill | **第一批（M5）** |
| B 会话与可追溯 | B1 事件日志+投影、B2 崩溃恢复、B3 fork/replay/搜索、B4 自动标题、B5 导出、B6 多标签同步 | **第一批（M2、M7）** |
| C 交互能力 | C1 plan 模式、C2 结构化提问、C3 todo、C5 斜杠命令、C6 Skills、C7 @引用、C8 diff 审阅、C9 checkpoint、C11 项目规则文件、C12 系统提示分节、C13 预设 | C1/C2/C3/C6/C8/C11/C12 **第一批**；C5/C7/C9/C13 → 第二批 |
| D 执行能力 | D1 持久 shell + 后台任务、D2 LSP 诊断、D3 代码运行时、D4 网络分级、D5 网页检索 | D1 **第一批（M4）**；D2–D5 → 第三批 |
| E 权限与安全 | E1 规则表+预设、E2 沙箱 seam、E3 先读后写、E4 fail-closed、E5 凭据热轮换 | **第一批（M4、M5、M6）** |
| F 扩展机制 | F1 钩子、F2 插件内核、F3 工具检索、F4 分层可见性 | F1/F2 **第一批（M1、M4）**；F3/F4 → 第三批 |
| G 平台化 | G1 headless/SDK、G2 ACP、G3 定时/Webhook、G4 遥测、G5 预算、G6 分发、G7 i18n | G1/G5/G6 **第一批（M7、M9）**；G4/G7 → 第二批；G2/G3 → 第三批 |
| H 其他 | H1 结构化输出、H2 模型回退/顾问、H3 存储后端可插拔 | 第三批 |

**明确不跟随（首版且无计划）**：桌面端 / IDE 插件 / 移动端 App、语音输入、computer use、浏览器自动化、订阅制 OAuth 鉴权、插件市场、社区会话数据集共享。

## 15. 环境与约束（已查的事实）

| 事实 | 结果 | 影响 |
| --- | --- | --- |
| Node / npm / pnpm | v22.16.0 / 11.14.1 / 10.29.3 | 目标运行时下限 Node 22 |
| git | 2.52.0 ✓ | 项目根探测、worktree、diff 可用 |
| Python | 3.13.5 ✓ | node-gyp 可用（但本期不用） |
| MSVC (`cl.exe`) | **未安装** | **零 Native 编译**：不用 `better-sqlite3`/`node-pty`；存储走 `node:sqlite`，终端走 `child_process` |
| npm registry | `registry.npmmirror.com` ✓ | 依赖安装走国内镜像 |
| 代理 | 无 | — |

**技术约束**：零本地 C++ 编译，杜绝 `node-gyp`；全部依赖为纯 TS/JS 或 Node 内置模块。
