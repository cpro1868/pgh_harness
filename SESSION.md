# SESSION.md —— 当前会话台账

> 每次会话开始时读此文件恢复上下文，结束前更新状态。
> 当前状态：**Sprint 1、Sprint 2、Sprint 3 全部验收结项；准备开工 Sprint 4 (v0.2.0)**

## 当前目标

交付 **Epic 1 / Sprint 3：扩展生态、MCP 强隔离与双层记忆装配 (目标版本 v0.1.1)** —— **已全量交付！**

## 已实施 WBS 工作包（Sprint 3 全部交付）

- [x] **WBS-01-07-01**：通用 Agent Skills 扫描与渐进披露加载器（`packages/plugins/skills/`，D40）
- [x] **WBS-01-07-02**：MCP 客户端连接池与命名空间强隔离（`packages/plugins/tools-mcp/`，D14/D66/Q9，硬性 `mcp__` 前缀，本地核心工具保留字独占）
- [x] **WBS-01-07-03**：全局与项目双层记忆级联装配（`packages/plugins/memory/`，D67/Q10，对齐 OpenCode `instruction-context`，去重合并）
- [x] **WBS-01-07-04**：记忆受控迁移向导与多存储介质支持（Markdown / SQLite / 混合模式，D39，`.bak` 备份 + SHA-256 去重）

## 测试基线（实测）

- `pnpm test`：**40 个套件 / 212 个断言 100% 全绿**；`/api/health` 上报版本 **`0.1.1`**。
- 服务状态：PID `13652`，端口 `3210` 正常监听。
- **三项 UX 体验修复（2026-09-27）**：
  1. 会话色块悬停浮层消除死区（删除正常命中），并增加重命名按钮；
  2. 大纲视图每条会话下方展示产生时间 `yyyy-MM-dd HH:mm:ss` + 实际消耗 Token；
  3. 用户气泡与助手卡片展示产生时间与真实 Token 明细（`turn/completed` 事件持久化）；顶栏改为会话累计口径，并增加 🔄 清零按钮（基线重置，不删历史）。
- **导航结构（严格按 `docs/阶段-1-需求/prototype/` 原型）**：Sprint 3 的 Skills / MCP / 记忆治理是**三个独立页面 + 独立 Activity Bar 图标**，不是设置中心内的 Tab。
  - 顺序：`run-chat` → `config-workspace` → `config-memories` → `config-providers` → `config-mcp` → `config-skills` →（底部常驻）`config-settings`。
- **UI 缺口纠偏记录（两次）**：
  1. MCP 与记忆治理在 Sprint 3 首轮交付时**只有后端 API、没有界面** → 已补齐页面；
  2. 第二版错误地把三者塞进设置中心 Tab → **已回退**，改为原型定义的独立页面（新增 `GET /api/memory` 只读接口，含 2 项红灯测试）。

## 下一步

1. 用户确认后执行 Git 提交并打标签 `v0.1.1`（Sprint 3 结项）；
2. 按照敏捷规划正式开工 **Epic 2 / Sprint 4 (v0.2.0)**：多角色流水线任务（Role Pipeline）。

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
