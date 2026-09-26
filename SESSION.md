# SESSION.md —— 当前会话台账

> 每次会话开始时读此文件恢复上下文，结束前更新状态。
> 当前状态：**Sprint 1、Sprint 2 已正式验收结项 (Tag v0.1.0)；Sprint 3 (v0.1.1) 正式就绪开工**

## 当前目标

交付 **Epic 1 / Sprint 3：扩展生态、MCP 强隔离与双层记忆装配 (目标版本 v0.1.1)**。
围绕生态集成与经验沉淀，贯通 Skills 渐进披露、MCP 命名空间强隔离、全局与项目双层记忆装配，以及记忆受控迁移向导。
遵循最高行为准则 `AGENTS.md`、强制安全规范 `docs/规范/安全工程方法论.md`，全量执行 TDD 先行与零 Native 编译纪律。

## 待实施 WBS 工作包（Sprint 3 核心范围）

1. **WBS-01-07-01**：通用 Agent Skills 扫描与渐进披露加载器（`packages/plugins/skills/`，D40）
2. **WBS-01-07-02**：MCP 客户端连接池与命名空间强隔离（`packages/plugins/tools-mcp/`，D14/D66/Q9，硬性 `mcp__` 前缀，本地核心工具保留字独占）
3. **WBS-01-07-03**：全局与项目双层记忆级联装配（`packages/plugins/memory/`，D67/Q10，对齐 OpenCode `instruction-context`，去重合并）
4. **WBS-01-07-04**：记忆受控迁移向导与多存储介质支持（Markdown / SQLite / 混合模式，D39，`.bak` 备份 + SHA-256 去重）

## 已完成

- [x] **启动/关闭脚本统一规范化 + 主会话 UX 五项优化（2026-09-25）**：`AGENTS.md` 明确运维三档命令；`stop-dev.ps1` 内置 `kill-port.ts`；`start-bg.ps1` 改用 `cmd /c start /b` 彻底解决后台启动脚本卡死；历史会话恢复最后模型、默认滚底、工具细节默认折叠、滚动条加粗 9px、对话区拓宽至 `max-w-6xl`；34 套件/168 断言通过（PID 23732）。
- [x] **会话导出 Markdown 严格层级规范化与服务热更（2026-09-25）**：实现 `demoteMarkdownHeadings` 算法，严格保证外层 `## 轮次 N` 与 `### 助手/用户` 时，正文内标题从 `####` 开始往后按级别逐级递降，且严格跳过代码块防止污染代码；34 套件/168 断言通过，热重启服务于端口 3210 (PID 19264)。
- [x] **Provider 编辑弹窗按需回显明文凭据（2026-09-22，登记例外 E-01）**：新增 `GET /api/providers/:id/secret`，打开编辑弹窗时按需拉取一次并**默认以密码态显示**，点眼睛查看明文；三重约束（仅回环来源、仅单个 Provider、每次读取写审计日志），列表接口仍只回掩码。该放宽已按安全工程方法论 §13.1 正式登记，`AGENTS.md` §0.1.2 同步披露。注：`reference/deepseek-harness` 本身不向浏览器回传明文（`role('secret')` + `set: true`），本项为相对参考实现的主动放宽。
- [x] **右侧轮次大纲面板（2026-09-22）**：主会话右侧新增「本会话轮次大纲」（`w-60 border-l`，可收起），逐轮显示序号/模型/提问摘要/工具次数·步数·停止原因，点击平滑跳转并高亮；数据在回合结束后从服务端事件重取（单一事实源，不做增量维护）。经用户确认口径为"当前会话轮次大纲 + 跳转"，与左侧跨会话列表不重复。
- [x] **修复流式输出不跟随滚动（2026-09-22）**：根因是自动滚动一直写在不可滚动的内层容器上（真实滚动容器是外层 `#messages-scroll-area`），实现之初即无效；现统一到 `scrollMessagesToBottom()`，并做到"贴底才跟随、用户发消息强制滚底"，不打断向上翻阅。
- [x] **修复编辑 Provider 会毁掉已存凭据（2026-09-22）**：旧后端以 `apiKey || 'sk-test'` 兜底、前端以 `apiKey || 'none'` 提交，导致"只改名称不重填 Key"会静默覆盖真实密钥；现定义"留空 = 保持既有凭据不变"，前端改为掩码+状态提示且仅在新输入时提交该字段，探测接口留空时回落已存凭据。明文仍绝不回传前端。
- [x] **工作区清单「📂 打开目录」（2026-09-22）**：新增 `POST /api/workspaces/reveal`，跨平台（explorer / open / xdg-open）在系统文件管理器中打开目录；**信任边界只允许已登记工作区**（未登记 403、目录缺失 404）；`spawn` 数组传参杜绝命令注入；打开实现可注入以便测试不弹窗。5 条新断言全绿。
- [x] **会话级授权档位（2026-09-22）**：聊天框新增「🔒 只读 / ✏️ 标准（需审批）/ ⚡ 完全授权」三档选择（对齐 deepseek-harness 沙箱模式）；档位持久化在会话上（`PATCH /api/sessions/:id/permission`，白名单校验），切换写入 `permission/preset` 审计事件；权限闸门改为会话档位优先于全局默认；**完全授权只免审批，硬性红线仍拒绝**；新建会话回到安全默认档位。6 条新断言全绿。
- [x] **Sprint 2 完整闭环与交付收口 (v0.1.0 结项)**：ReAct 调度大循环 `TurnLoop`、六大本地工具、真实流式协议与标准工具回填、会话/事件落盘、SSE 长期订阅 15s 心跳与半开重连、Git Checkpoint 与 Revert Turn、无上限滚动压缩、主工作台 UX 对齐 deepseek-harness、Todo 进度卡片与行级 Diff 审阅卡、破冰向导、安全方法论上位化、BL-07/08 闭合、仓库初始化并打标签 `v0.1.0`。
- [x] **Sprint 1 垂直切片最小可运行版本达成 (v0.1.0-sprint.1 结项)**

## 测试基线（实测）

- `pnpm test`：**35 个套件 / 168 个断言 100% 全绿**；`/api/health` 上报版本 **`0.1.0`**。
- 真机验证：DeepSeek Provider 正常调用；`toPublicProvider()` 返回脱敏掩码且无密文字段；`~/.pg_harness/master.key` 真实生成生效；组件拓扑接口返回 Active 15 / NotWired 7。

## 进行中

- [ ] 等待用户确认后，将当前工作区改动提交并同步更新 v0.1.0 标签（当前状态干净无冲突）。

## 下一步

1. 用户确认后执行 Git 提交并更新标签；
2. 按照敏捷规划正式开工 **Sprint 3 (v0.1.1)**：
   - `WBS-01-07-01`：通用 Agent Skills 扫描与渐进披露加载器（`packages/plugins/skills/`）
   - `WBS-01-07-02`：MCP 客户端连接池与 `mcp__` 命名空间隔离（`packages/plugins/tools-mcp/`）
   - `WBS-01-07-03`：双层记忆级联装配（`packages/plugins/memory/`）
   - `WBS-01-07-04`：记忆受控迁移向导

## 阻塞点

- 无。

## 已知技术债

- 前端多语言 i18n 明确排在第二批（设计文档 §13.4 / G7），本期不做。
- 设计 §4.1 工具执行管线、`harness.yml` 配置化加载、`ctx.sandbox` seam、`fetch_url`+SSRF 均已在 WBS §8 立项为 Backlog（BL-01~BL-05），需等待统一排期。

## 已完成

- [x] **闭合最高优先级安全缺口 BL-07 / BL-08（2026-09-22）**：`master-key.ts` 解决主密钥硬编码，实现 env → 随机生成 `master.key`（0600）；既有历史凭据在首次访问时自动以新密钥重新加密落盘（断绝离线解密）；`toPublicProvider()` 彻底剔除 `apiKeyCipher` 密文字段，只回脱敏掩码（保留前 7 后 4）。8+4 自动化断言全绿。
- [x] **安全工程方法论上位化至 AGENTS.md（2026-09-22）**：总纲增设 0.1 节六条不可违背安全铁律、缺口清单纪律与安全自检要求；文档索引更新。

- [x] **Sprint 2 收尾（2026-09-22）**：SSE 长期订阅 + 15s 心跳（可注入间隔以支持可控时钟断言）+ `follow=0` 一次性补齐；前端 30s 无心跳看门狗与 `visibilitychange` 主动重连；补上 `TC-01-04-005` 孙进程树 `/T` 终结实证；RTM 按实测校准为 44 用例 / 32 通过并移除虚构覆盖率列；版本号统一为 `0.1.0`。
- [x] **Todo 进度卡片 + 行级 Diff 审阅卡（2026-09-22，WBS-01-08-03）**：`todo_write` 工具（状态规范化 + `todo/update` 落盘 + SSE `todo-update`）、常驻任务清单 dock（进度与断线回放）、`computeLineDiff`（LCS、CRLF 归一、超限降级）、`write_file`/`edit_file` 携带 diff 元数据并随 `tool/result` 落盘，前端红绿行级对比卡（含 `+N/-M` 与折叠）；工具执行契约扩展为可携带 `meta`。
- [x] **偏差登记与 Backlog 立项（2026-09-22）**：WBS 第 7 节登记 6 处实测偏差（含"主工作台为静态 HTML 而非 D12 的 React 18+Vite"这一架构级偏差）；第 8 节把无 WBS 承接的设计能力立项为 BL-01~BL-06，规定先排期再实施。
- [x] **首次启动破冰向导（2026-09-22，WBS-01-08-04 / D57）**：`GET /api/bootstrap/status` 冷启动检测 + `wizardCompleted` 持久化；入口页两步向导（接入模型含模型探测 → 选择项目目录含系统原生选择框），支持跳过。
- [x] **诚信修复 + 权限闸门与人工审批（2026-09-22）**：组件拓扑改为如实状态（22 个组件：Active 15 / NotWired 7，移除虚假 Active 与"真实读取"措辞）；`PermissionGate` 落实 D7（deny>ask>allow、三级预设、`mcp__*` 通配、bash 命令子串与文件路径 glob、硬性红线不可放宽、未知工具默认 ask），在工具执行前强制生效且每回合重读设置；`ApprovalBroker` 落实 §6.3（`apr_` 标识、先落盘再等待、`POST /api/approvals/:id/decide`、状态机 `waiting_approval`、拒绝与超时 fail-closed、三路径主动作废）；前端审批卡片支持断线恢复；设置页修复预设回显并列出硬性红线。
- [x] **人机结构化提问 `ask_user`（2026-09-22，对应 TC-01-04-006 / D53）**：`QuestionBroker`（`que_<uuid>` 请求标识、挂起/唤醒、超时以 `QuestionTimeoutError` 结束、回合中止/会话删除时 `cancelSessionQuestions` 兜底清理）；`ask_user` 工具注入 TurnLoop 并先落盘 `question_asked` 再等待；双轨端点 `POST /api/questions/:id/reply|reject`（reply 格式化选项回填模型，reject 以错误工具结果交模型自主兜底）；会话状态机 `GET /api/sessions/:id/state` 支持 `idle | running | waiting_user_input | waiting_approval`；前端问答卡片支持选项/多选/自由输入、提交与驳回，并按 `question_asked` − `question_answered` 差集在断线重连后原样恢复卡片。
- [x] **主会话对话真实闭环（2026-09-22）**：ReAct 调度大循环 `TurnLoop`（25 步上限 / 同参 3 次熔断 / Abort 中断）、六大本地工具绑定（read/edit/write/glob/grep/bash）、真实 OpenAI 兼容流式协议（含工具调用增量分片组装与 `tool_call_id` 标准回填）、会话与事件落盘、`?after=<seq>` 断线重放、`stream` 增量接口。
- [x] **主工作台 UX 对齐 deepseek-harness（2026-09-22）**：紧凑激活卡列表（悬浮删除）、Send/Stop 二合一状态机、Enter 发送、Markdown 实时渲染 + 代码高亮 + DOMPurify 消毒、输入转义、逐轮模型标注、👍/👎 反馈、单轮重做、整会话/单轮 Markdown 导出。
- [x] **上下文治理贯通（2026-09-22）**：历史组装以最新 `compaction` 事件为基线（D50），手动 `/compact` 与自动压缩共用同一基线逻辑；机械摘要保留用户指令要点与涉及文件。
- [x] **Markdown 附件（最小版，2026-09-22）**：仅 `.md`、≤64KB、单条 ≤3 个；以 `message/attachment` 事件落盘且不写入用户仓库；注入时包裹 `[Untrusted attachment]` 边界；重做本轮自动恢复附件。
- [x] **AGENTS.md 模板生成器升级（2026-09-22）**：11 章节富 Markdown 模板（含项目概览、八荣八耻表、TDD/提交/安全/工具纪律、自检清单）、章节开关、可视化编辑、`system.agentsTemplate` 持久化、写入指定工作区、AI 优化（可选 Provider/模型，只喂真实仓库事实、结果不落盘需人工确认）。
- [x] **Sprint 2 核心攻坚（前序会话）**：CRLF/LF 容错编辑与先读后写、`realpath` 防逃逸、`taskkill` 进程树硬杀、单回合 Git Checkpoint 与 Revert Turn、思维链剥离与滚动压缩；工作区互斥写锁；单实例文件锁；AES-256-GCM 凭据加密；两级代理与静默僵死熔断；SQLite WAL + FTS5 + Spill。
- [x] **Sprint 1 垂直切片最小可运行版本达成 (v0.1.0-sprint.1 结项)**

## 测试基线（实测）

- `pnpm check`：**32 个套件 / 154 个断言 100% 全绿**；`/api/health` 上报版本 **`0.1.0`**。
- 真机验证：DeepSeek Provider 下 `deepseek-flash` 与 `deepseek-v4-pro` 均可正常调用；`toPublicProvider()` 返回脱敏掩码且无密文字段；`~/.pg_harness/master.key` 真实生成生效；组件拓扑接口返回 Active 15 / NotWired 7。

## 进行中

- [ ] 文档更新后工作区出现未提交改动（本次进展记录与台账更新）；按规范不擅自提交，待用户确认后补 `docs: ...` 提交。

## 下一步

1. 补 `TC-01-08-001` 的**并发写 409 集成用例**（当前仅 `WorkspaceWriteLock` 单测覆盖）；
2. 为 `BL-01`（工具执行管线与内核 hook 扩展点）等 Backlog 项确认排期；
3. 评估是否引入覆盖率工具以填上 RTM 中"未测量"的那一列。

## 阻塞点

- 无（版本控制已就绪：分支 `main`，标签 `v0.1.0`）。

## 已知技术债

- `docs/阶段-3-实现/03-系统测试用例说明书.md` 矩阵统计落后于实际代码用例，需重新对齐（已在进展记录中标注）。
- 前端多语言 i18n 明确排在第二批（设计文档 §13.4 / G7），本期不做。
- **设计 §4.1 的工具执行管线（pre-execute / guards / post-execute / finalize 中间件）仍未实现**：当前权限与审批是内联在 `executeTool` 前置判定，尚无通用 hook 扩展点；`@harness/kernel` 仍未被服务端使用，`harness.yml` 不存在；`ctx.sandbox` seam 与 `fetch_url`+SSRF 未实现；`provider-anthropic` 未接入对话协议分流。以上均已立项为 **WBS §8 Backlog BL-01~BL-05**，需先排期再实施。
