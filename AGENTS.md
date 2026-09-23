# AGENTS.md —— Purple Grapes Harness (PGH) 项目规范（总纲）

> 本文件是 Purple Grapes Harness（缩写 pgh 或 pg_harness）项目的最高行为准则，约束所有人类开发者与 AI Agent。
> 上级目录 `G:\Projects\AGENTS.md` 的 ponytail（lazy senior dev）规则仍然生效；本文件在其基础上补充本项目特有规范，冲突处以本文件为准。

## 0. 铁律 · 八荣八耻

| 耻 | 荣 |
| --- | --- |
| 以臆猜接口为耻 | **以查档求证为荣**——写代码前查文档/读源码，不猜 API |
| 以模糊开工为耻 | **以对齐需求为荣**——开工前确认需求、验收标准 |
| 以脑补业务为耻 | **以请示规则为荣**——业务规则不明确就问，不自作主张 |
| 以新增冗余为耻 | **以复用存量为荣**——优先复用已有代码/库/平台能力 |
| 以省略校验为耻 | **以完备测例为荣**——非 trivial 逻辑必须留可运行的验证 |
| 以乱改架构为耻 | **以恪守规范为荣**——不擅自改架构，改动先评审 |
| 以不懂装懂为耻 | **以坦诚存疑为荣**——不确定就明说，给出疑点清单 |
| 以批量乱改为耻 | **以分步迭代为荣**——小步提交，一次只做一件事 |

## 1. 项目定位

- **产品全称**：Purple Grapes Harness（紫葡萄智能体运行时平台，CLI 简写 `pgh`，数据目录 `~/.pg_harness/`）。
- **首要用例**：编码 Agent（修 bug → 跑测试 → 出 diff → commit/PR 准备的端到端闭环）。
- **技术栈**：TypeScript / Node 22+ / pnpm workspace；**零 Native 编译**（`node:sqlite` + `node:child_process`，禁用 `node-gyp`）。
- **设计文档**：`docs/superpowers/specs/2026-09-13-agent-harness-design.md`（单一事实来源，代码与文档冲突时先改文档再改代码，或在文档中标注偏离原因）。


## 2. 文档体系（全部必读）

| 文件 | 职责 | 更新时机 |
| --- | --- | --- |
| `AGENTS.md` | 项目规范总纲（本文件） | 规范变更时 |
| `CONTEXT.md` | 关键决策与上下文快照 | 每次关键确认后 |
| `SESSION.md` | 当前会话台账（目标/状态/下一步） | 会话开始与结束时 |
| `docs/工作进展记录.md` | 按日期倒序的工作日志 | 每次工作完成后 |
| `docs/superpowers/specs/` | 设计规格文档（概要/详细设计） | 设计定稿与变更时 |
| `docs/规范/` | 细分规范（编码、测试、Git、文档管理） | 规范变更时 |
| `docs/阶段-*/` | 生命周期各阶段交付物 | 各阶段完成时 |

**文档纪律**：
- 关键确认（架构决策、范围变更、需求调整）必须在 `CONTEXT.md` 留痕；
- 每次会话开始前读 `SESSION.md` 恢复上下文，结束前更新它；
- 完成任一里程碑/任务后立即更新 `docs/工作进展记录.md`；
- 生命周期阶段（需求→设计→实现→测试→交付）的文档不得跳过，到阶段即建文。

## 3. 目录结构

```
harness/
├─ AGENTS.md                    # 本文件（最高准则）
├─ CONTEXT.md                   # 关键决策快照 (D1–D69)
├─ SESSION.md                   # 会话台账
├─ docs/                        # 生命周期文档、原型与规格
├─ reference/                   # 外部参考源码库 (opencode 精简核心)
├─ packages/
│   ├─ kernel/                  # 插件微内核 (Cordis-like: Context, Service, LifeCycle)
│   ├─ protocol/                # 前后端同构协议与数据实体 (Events, Messages, DTO)
│   ├─ core/                    # 核心业务调度引擎 (ReAct调度循环, 上下文治理, 权限流水线)
│   └─ plugins/                 # 标准插件包目录
│       ├─ storage-sqlite/      # Node 22 原生 SQLite (WAL, events 表, FTS5, spill)
│       ├─ provider-openai/     # OpenAI 兼容协议适配器 (DeepSeek, Ollama, 自动探测)
│       ├─ provider-anthropic/  # Anthropic 原生协议适配器 (Prompt Caching, 原生思考块)
│       ├─ tools-coding/        # 本地 6 大核心编码工具 (换行符容错, taskkill 硬杀)
│       ├─ tools-mcp/           # MCP 客户端服务连接池 (强制 mcp__ 命名空间前缀隔离)
│       ├─ skills/              # 通用 Agent Skills 扫描与渐进披露加载器
│       └─ memory/              # 记忆沉淀与双层级联装配 (Global vs Project)
├─ apps/
│   ├─ server/                  # Node 22 后端服务 (Fastify, SSE 流式网关, 单实例锁)
│   └─ web/                     # 现代化 Web 前端 (React 18 + Vite + Tailwind + Zustand)
│       └─ src/features/        # 业务功能切片 (敏捷三阶段：chat/config/pipeline/workflow)
├─ scripts/                     # 工程与集成自检脚本 (self-check.ts)
├─ harness.yml                  # 插件组合配置
├─ package.json                 # pnpm workspace
├─ pnpm-workspace.yaml
└─ tsconfig.base.json
```

## 4. 编码规约（速查，细则见 `docs/规范/`）

- **TypeScript strict**；禁止 `any`（确需时用 `unknown` + 收窄）。
- **零 Native 与版权合规铁律（最高级别约束）**：
  - **严禁 MSVC 编译依赖**：鉴于本项目运行的宿主系统环境限制，**绝对禁止引入任何需要 MSVC、Visual Studio C++ 编译链或 `node-gyp` 编译的 Node.js 依赖包或原生扩展工具**（任何带 `bindings.gyp` 或触发本地编译的包一律禁止）；
  - **杜绝版权与争议依赖**：绝不引入任何存在许可证争议（如 GPL 传染性）、协议风险或涉嫌版权纠纷的第三方包与工具，仅使用 MIT、Apache-2.0、BSD 或纯 TypeScript/Node 内置标准库；
  - 新增依赖必须评审并写进 `docs/工作进展记录.md` 的「依赖变更」。
- **提前预置工程开发工具与 Skills**：
  - 在项目研发启动前，允许并推荐**提前预安装或配置好相关的开发工具链与 Agent Skills**（如本地 `pwsh`、测试运行器、必要的 TypeScript 库、预置的标准规范 Skill 包等），以保障后续研发流水线顺畅无阻、高效推进。
- **杜绝重复造轮子 · 开源参考与代码复用规范（最高效率原则）**：
  - **模块开工前必查参考源**：在启动任何模块功能构建或算法设计之前，**必须首先深度检索与参考 `reference/` 目录下的优秀开源项目源码**（如 `opencode`、`bpmn-moddle`、`xyflow`、`dify` 等）；
  - **能复用直接 Copy / 提炼复用**：若参考库中有成熟的算法实现、正则规则、类型声明或工具函数，**优先直接 Copy 过来或做最小适配复用，坚决杜绝从零闭门造车重复造轮子**；
  - **不能直接复用参考其优秀逻辑**：若由于技术栈差异（如 Python 转 TS）无法直接拷贝，必须深入吸收其架构流转、边界条件与状态机设计思想；
  - **核心准绳**：只要能符合本项目既定设计与质量门禁，** shortest working diff 与最高复用率优先**。
- **禁止使用 Subagent / Task 委派（最高纪律铁律）**：
  - **任何开发、审阅、查找、分析工作必须由主 Agent 亲自使用基础工具链（Read, Edit, Write, Bash, Glob, Grep）直接单线程处理，绝对严禁自主派发 Subagent（Task 工具）！**
  - **核心理由**：Subagent 在后台并发黑盒执行，执行过程不可直接追踪、无法实时受控，严重违反透明可控原则；
  - 只有在未来业务层代码中被用户显式在界面勾选授权开启时，方可按需运行。在 Harness 自身的研发与设计流程中，**全量禁用 Task 工具**。
- **不加注释**（除 `ponytail:` 有意简化标注与公开 API 的 JSDoc）。
- **YAGNI**：不为「以后可能要」写代码；预留点已在设计文档第 12 节列明，不在其中的先不做。
- **错误处理**：信任边界（工具入参、HTTP 请求、文件路径、密钥）必须校验；错误不吞，写日志或上抛。
- **安全红线**：密钥/Token 不入库明文、不进日志、不回传前端；文件工具不越 workspace 根；`fetch_url` 过 SSRF 检查；模型输出渲染必须 sanitize。

## 5. 质量门槛与测试驱动开发 (TDD 铁律)

提交前必须通过：

```bash
pnpm check        # = lint + typecheck + test
node scripts/self-check.ts   # 集成自检（实现后）
```

- **TDD 测试驱动先行**：非 trivial 业务代码编写前，**必须先编写对应的自动化测试用例（红灯），再编写业务实现使其通过（绿灯）**；
- **验收唯测试论**：所有 WBS 工作包的交付验收，必须严格以自动化测试用例 100% 通过为唯一客观准绳；
- `pnpm lint`：ESLint 零 warning；`pnpm typecheck`：`tsc --noEmit` 严格类型检查；`pnpm test`：`node --test`（零外部重型测试框架，纯标准库）；
- 跨平台开发运维脚本：Windows 使用 `scripts/start-dev.ps1` 与 `stop-dev.ps1`；Linux/macOS 使用 `scripts/start-dev.sh` 与 `stop-dev.sh`。
- 遇到八荣八耻冲突时，宁可多问一次，不可带病提交。

## 6. 工作流程

1. **会话开始**：读 `SESSION.md` + `CONTEXT.md` 恢复上下文 → 在 `SESSION.md` 登记本次会话目标；
2. **开工前**：对齐任务与验收标准（模糊就问）；
3. **执行中**：分步迭代，小步提交；改动涉及架构的，先更新设计文档；
4. **完成后**：跑 `pnpm check` → 更新 `docs/工作进展记录.md` → 更新 `SESSION.md`（状态+下一步）→ 关键决策写入 `CONTEXT.md`；
5. **会话结束/中断前**：确保 `SESSION.md` 写清「已完成 / 进行中 / 下一步 / 阻塞点」，使下个会话能无缝接续。

## 7. 里程碑（本期第一批）

M1 内核与组装 → M2 事件日志与存储 → M3 模型接入 → M4 工具与执行 → M5 上下文治理 → M6 权限与交互 → M7 Web 服务层 → M8 Web UI → M9 收尾（npx/Docker/README/自检）。

详见设计文档第 11 节。
