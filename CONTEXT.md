# CONTEXT.md —— 关键决策与上下文快照

> 每次关键确认后更新；只写已确认的决策与当前状态，不写过程讨论。
> 最新确认在最上方。

## 2026-10-21 长运行崩溃修复与步数上限撤销（D84 / D83 / D50 修订 / D85）

## 2026-10-23 BPMN 真实项目端到端验收与驳回分支缺陷修复（D86）

| # | 决策 | 结论 |
| --- | --- | --- |
| D86 | 人工驳回必须可路由到返工分支 | **真机验收发现的引擎级死路缺陷**：`BpmnWorkflowEngine.resume({decision:'reject'})` 原实现只写入 `__rejectionReason` 并原样返回 `waiting`，**完全不推进 token**；而 BPMN 中 UserTask→XOR 网关→退回连线（如 `Task_Rewrite`）只能由网关触发，导致驳回分支永远不可达。同时 XOR 网关选流兜底为 `outs[0]`，条件全不满足时**默认走第一条出线（往往是放行分支）**，属越权推进风险。**决策**：1. 驳回时若 UserTask 出线直达排他网关，则标记 UserTask 完成并把 token 推入网关，由网关按条件表达式选退回流（真实执行返工节点直至结束）；2. 若出线不经过网关（纯线性流程），仍维持挂起，**绝不自行放行**（保留原 D77 安全语义）；3. XOR 选流顺序改为「条件为真 → 显式 defaultFlow → 无条件兜底流 → 条件为假的流」，**彻底移除 `outs[0]` 兜底**，无匹配时不推进（fail-closed）。测试：bpmn-engine 用例 13/14 + workflow-audit-log 人工驳回全链路用例，均做变异验证（回退修复后预期转红）。 |
| D85 | LLM 瞬态错误自动重试 | 520/terminated 经实测复现确认为上游 Cloudflare 网关偶发故障（PGH 同形态调用 55 次全成功；520 响应体为 CF 源站异常页模板），非调用参数问题。**决策**：`security/retry.ts` 对瞬态错误（429/5xx/terminated/fetch failed/UND_ERR_*/ECONNRESET）自动重试 3 次（500ms 指数退避封顶 8s），业务错误（401/403/400/404）绝不重试立即上抛；接入主会话/BPMN/流水线/Provider ping 全部 LLM 调用点；报错文案明示「已自动重试仍失败」并正确归因。 |
| D84 | 长运行稳定性双兜底 | 崩溃根因有二：(1) 顶层请求 catch 无条件 `writeHead(500)`，SSE 回合中 headers 已发送后再抛异常触发 `ERR_HTTP_HEADERS_SENT` 二次异常，rejected promise 逃逸杀死进程；(2) `ProxyDispatcher` 每次 LLM 调用 `new ProxyAgent` 从不销毁（实测 361 次累积），undici 连接池泄漏致长运行 OOM。**决策**：1. 顶层 catch 加 `headersSent`/`writableEnded` 双守卫；2. `start()` 挂载 `uncaughtException`/`unhandledRejection` 进程级兜底（记录日志、进程保持存活，fail-safe 不静默）；3. ProxyAgent 以 `proxyUrl+token` 为键做同路由单例缓存，`destroyAll()` 挂载到 `server.stop()` 与代理配置变更路径。守卫测试 `stability-guard.test.ts`（含独立子进程真实崩溃回归）长期保留。 |
| D50r | 单回合步数无上限（D50 修订） | 撤销自拟的「单回合默认 25 步」：`TurnLoop.maxSteps` 降级为纯可选预算（未指定即无上限），主会话/BPMN 节点/流水线阶段全部移除硬编码；死循环防护交给「同参工具连续 3 次熔断」+ BPMN 引擎 `totalSteps` 环路熔断 + 上下文滚动压缩 + 用户 Abort。 |

## 2026-10-18 流程设计器功能完备性彻底复原与双版本合流（D82）

| # | 决策 | 结论 |
| --- | --- | --- |
| D82 | 设计器完整功能合流（拖拽/缩放/DAG重排/前后指定连线/主题） | **历史追溯**：10月6日会话在 `config-workflow-detail.html`（81KB 高保真版）上交付了手动拖拽、40%~200% 缩放平移、专业 DAG 拓扑分层去交叉自动整理、属性抽屉前后指定连线与快捷删除等全套功能；但对齐原型文件名时新建了简化的 `config-workflow-design.html`（45KB），资产库表格链接跳转了后者，导致完整设计器被闲置、用户访问到缺失功能的残卷。**决策**：1. 将 81KB 完整设计器合流覆盖 `config-workflow-design.html`；2. 注入命名空间前缀无关解析（`extractNodes`/`extractFlows`/`flowRegex` 均支持 `(?:[a-zA-Z0-9_]+:)?`）；3. 适配 `shared.css` 与 `theme.js` 布局；4. 新增 TC-03-02-003（7 断言全绿守卫）。CDP 实测：拖拽移动坐标从 `{60,140}` 到 `{140,200}` 实时吸附曲线、缩放 100%&rarr;120%&rarr;重置复位、DAG 拓扑 8 节点清晰重排、连入连出下拉列表完整工作。 |

## 2026-10-18 Dify 可视化设计器 CSS flex-direction 垂直塌陷根除（D81）

| # | 决策 | 结论 |
| --- | --- | --- |
| D81 | 双栏页面 flex-row 强制规则 + 根除视口外挤压塌陷 | **根因**：`shared.css:597` 的 `body.app-shell { flex-direction: column; }` 命中包含左侧侧边栏的设计器（`config-workflow-design.html`）与监控页（`run-workflow-detail.html`），将左侧栏与主工作台**上下纵向排列**。侧边栏高 904px 占满第一屏，主工作台直接被挤到屏幕下方（top: 904px，画布高度塌陷为 0~64px），8 张卡片全在 `y: 924px+` 视口外，页面只剩侧边栏和黑底，用户眼中**彻底空白**。**决策**：1. 设计器与监控页 `<body>` 显式增加 `flex-row`；2. `shared.css` 注入 `body.flex-row, body.app-shell.flex-row { flex-direction: row !important; }` 硬防御；3. 新增 TC-03-02-002（3 断言）。CDP 实测：画布高度由 64px 恢复为 856px，首张卡片由 `y: 924px` 恢复至 `y: 412px`，`isInViewport` 由 false 恢复为 true。 |

## 2026-10-18 主会话切换工作区联动与完全授权高危强提醒（D80）

| # | 决策 | 结论 |
| --- | --- | --- |
| D80 | 会话工作区顶栏双向联动 + 完全授权阻断式确认 | 1. `switchSession()` 必须同时同步 `workspacePath` 至顶栏 `<select id="topbar-workspace-select">` 与 `activeWorkspacePath`；未在登记列表的工作区动态补建选项；联动触发 `loadSkillsToComposer()` 刷新工作区 Skills。2. 遵循安全工程规范 S5，选择「完全授权 (full)」属于高风险动作，下拉框选中时**先回退当前档位**并呼出 `#full-auth-modal` 强提示弹窗（明确说明文件/命令免审批范围，并重申 `git push`、关机、敏感凭据等硬性红线依然拒绝）；用户显式点击「我已知晓风险，确认完全授权」前**严禁落盘与改变状态**；点击取消回退；只读/标准直接落盘。新增 TC-01-08-002 / TC-01-13-002（5 断言）。 |

## 2026-10-18 BPMN 命名空间前缀一致性与导入 fail-closed（D79）

| # | 决策 | 结论 |
| --- | --- | --- |
| D79 | BPMN 命名空间前缀无关 + 导入 fail-closed | **根因**：设计器 `parseCurrentXml()`（`config-workflow-design.html`）、存储层计数正则（`workflow-schema.ts`）与实例监控大屏（`run-workflow-detail.html`）均硬编码 `<bpmn:` 前缀，而引擎解析器 `bpmn-parser.ts` 是前缀无关的 `(?:[a-zA-Z0-9_]+:)?`——导入 `bpmn2:` 或无前缀（Camunda 导出常见格式）的合法 BPMN 后，引擎能跑但设计器解析 0 节点，即用户报障的**空页面**。**决策**：全链路（引擎/存储/导入 API/设计器/监控大屏）统一前缀无关语义；`POST`/`PUT /api/workflows` 接入 `parseBpmnXml()` 校验，非法 XML 一律 400 拒绝入库（fail-closed），合法 XML 计算真实 `nodeCount`（非网关节点数）/`gatewayCount`。**测试教训**（三重失效）：测试语料只用 `bpmn:` 前缀、断言只测"页面 200 + 有链接"、客户端 JS 从未在真实 DOM 执行——新增 TC-03-01-004 覆盖三前缀矩阵 + 非法 XML 拒绝 + 客户端解析断言，并以 Chrome DevTools Protocol 真实浏览器取证作为验证手段。旧设计器 `config-workflow-detail.html` 同类硬编码但为全站零链接孤儿页面，按 YAGNI 不改。 |

## 2026-10-18 BPMN 人工审查跨进程断点续接（D77 / D78）

| # | 决策 | 结论 |
| --- | --- | --- |
| D77 | 人工审查挂起态重启续接 | `BpmnWorkflowEngine.hydrate()` 从持久化实例快照（`completedNodes` / `activeNodes` / `variables`）重建挂起态并定位 UserTask 锚点；服务端 `/api/workflow-instances/:id/decide` 在运行时引擎丢失（进程重启）时改走 `hydrate + resume` 兜底，**严禁整段重跑**（旧实现用 `execute()` 从头重放已完成节点并吞掉裁决语义）。快照中无 UserTask 锚点时 `resume` fail-closed 判 failed。Task 节点执行器抽取为 `createWorkflowNodeExecutor()`，`/run` 首次执行与重启兜底续跑共用同一实现。新增 TC-03-03-005（重启后 approve 续接完成且上游不重放 / reject 维持挂起写入原因）。 |
| D78 | 跨 resume 步数累计熔断 | `totalSteps` 为引擎实例级累计计数：`execute()` 重置为 0，`resume()` **不重置**，`stepLoop` 每轮自增并与 `maxSteps` 比较，超限抛错熔断为 `failed`。目的：人工放行绝不重置步数预算，反复放行含 UserTask 的环路必须在有限次内 fail-closed，杜绝"每次放行都重置计数器"导致的无限流转。`resume()` 新增可选 `maxSteps`（默认 500）。新增 TC-03-03-001 用例 8（变异验证：注入重置后用例如期失败）。 |

## 2026-10-06 质量门禁真门禁化（D75）

| # | 决策 | 结论 |
| --- | --- | --- |
| D75 | `pnpm check` 三段式真门禁 | `check` = `lint && typecheck && test`，三段任一非零退出即门禁失败。`lint` = `eslint . --max-warnings=0`（flat config，`no-explicit-any` 为 error，白名单豁免未设）；`typecheck` = `tsc --noEmit -p tsconfig.check.json`（全仓单工程聚合，`allowImportingTsExtensions` + `@harness/protocol` paths 映射）；`test` = `node --test` 逐文件清单（**新增测试文件必须同步加入 `package.json` test 脚本**，否则等于没测）。存量 34 lint + 5 typecheck 错误已全部清零。 |

## 2026-09-22 工程诚信与权限落地（D71）

| # | 决策 | 结论 |
| --- | --- | --- |
| D71 | 运行时组件清单如实化 | 面向用户的组件/插件清单**必须反映代码真实接入状态**：真实生效标 `Active`，代码或设计存在但未接入运行链路标 `NotWired` 并附说明。**严禁把未接入组件标为 Active**，也不得使用"真实读取"等与事实不符的措辞。当前实测：22 个组件中 Active 15 / NotWired 7。 |
| D72 | 权限闸门执行时机 | `PermissionGate` 在**工具执行前**强制判定（`deny > ask > allow`，硬性红线不可放宽）；预设与规则**每回合从设置重新读取**，因此改设置即时生效，无需重启。`deny` 以 `is_error` 结果回填且绝不执行；`ask` 挂起等待人工裁决，**拒绝与超时一律 fail-closed**（默认 5 分钟）。 |
| D73 | 偏差登记与 Backlog 立项纪律 | 代码与文档不一致时必须**显式登记实测偏差**（落点路径、架构级偏差如构建链选择），不得默认"文档即事实"；设计文档中有依据但无 WBS 承接的能力（如 §4.1 工具执行管线、`ctx.sandbox` seam、`fetch_url`+SSRF）必须**显式立项为 Backlog**，先排期再实施，禁止以"顺手做了"方式插队。首版登记见 `docs/阶段-3-实现/01-WBS工作分解结构说明书.md` 第 7、8 节。 |
| D74 | Sprint 2 收尾优先于新架构项 | Sprint 2 未闭合项（破冰向导 WBS-01-08-04、Todo/Diff 审阅卡 WBS-01-08-03、SSE 心跳间隔用例 WBS-01-08-02）优先于工具执行管线等 Backlog 项；收尾完成后执行 Sprint 2 验收并打 `v0.1.0` 标签。 |

## 2026-09-16 多智能体协作架构决策定案（D35–D38）

| # | 决策 | 结论 |
| --- | --- | --- |
| D35 | 多智能体定位与形态划分 | 明确解耦为三种形态：**模式B（子任务委派开关）**为会话通用执行策略；**模式A（角色流水线）**为结构化任务模板功能；**模式C（BPMN 2.0 业务流程引擎）**为高级自定义业务流编排平台。 |
| D36 | 模式B（子任务委派）落地策略 | 集成至单会话对话流（`run-chat.html`）。在 Composer 底部设「开启子任务 Agent」开关；后端注入 `spawn_agent` 工具，支持独立上下文、深度与预算限制，子 Agent 结果精炼回传主 Agent。 |
| D37 | 模式A（角色流水线）架构 | 模板化顺序流水线（如：需求分析 Agent → 编码 Agent → 测试审查 Agent）。包含独立配置中心（`config-pipelines.html`）与运行面板（`run-pipeline.html`），各阶段具备专属 Prompt、独立工具清单与产物 Artifact 显式传递协议。 |
| D38 | 模式C（BPMN 2.0 流程引擎）架构 | 标准 BPMN 2.0 XML 驱动的流程图编排。支持任务节点绑定 Agent 角色、排他网关（分支判定）、顺序流条件表达式与执行状态机；具备独立管理（`config-workflows.html`）与运行可视化监控（`run-workflow.html`）。 |

## 2026-09-13 设计定稿（首批架构决策全部确认）

**文档**：`docs/superpowers/specs/2026-09-13-agent-harness-design.md`（单一事实来源）

### 核心决策（D1–D26）

| # | 决策 | 结论 |
| --- | --- | --- |
| D1 | 交付形态 | 分层仓库（kernel + plugins + apps/web），首版做到完整网页版 |
| D2 | 技术栈 | TypeScript / Node 22+ / pnpm workspace |
| D3 | 模型接入 | 统一 Provider 接口；内置 OpenAI 兼容适配器；可自定义；自动发现模型 |
| D4 | 使用形态 | 单用户本地优先，数据模型预留 `user_id` |
| D5 | 会话真相 | **追加式事件日志为唯一真相 + 物化投影表**（不是消息表） |
| D6 | 扩展机制 | **自研精简插件内核，接口与 Cordis 对齐**；本期只做服务/事件/生命周期/配置挂载 |
| D7 | 权限模型 | **规则表（工具 + 参数模式 + allow/ask/deny）+ 预设 + 沙箱 seam** |
| D8 | 上下文治理 | **本期纳入**：token 计量、自动压缩、工具结果裁剪、Spill 落盘 |
| D9 | 存储 | **Node 22 内置 `node:sqlite`（`DatabaseSync`，WAL）+ FTS5**；零 native 编译 |
| D10 | 敏感信息 | AES-256-GCM；凭据优先引用式（环境变量名），每次操作重新解析 |
| D11 | 服务接口 | REST + SSE（回合状态在服务端，可断线续传） |
| D12 | 前端 | React 18 + Vite + Zustand + Tailwind + `react-markdown`（强制 sanitize） |
| D13 | 里程碑 | 分三批；**本期只做第一批（M1–M9）** |
| D14 | 首要用例 | **编码 Agent 优先**；通用能力由 MCP + Skills 覆盖 |
| D15 | V1 验收 | 真实中小型仓库「修 bug → 跑测试 → 出 diff → commit/PR 准备」闭环 |
| D16 | 平台策略 | **零 Native 编译**：`node:sqlite` + `child_process`；Windows 优先，跨平台可用 |
| D17 | 回合消息并发 | 新消息**入队排队**；显式 Abort 按钮可立即打断 |
| D18 | 打断语义 | **干净硬杀**：断 LLM 请求 + 杀子进程 + 保留已产出内容（标 `aborted`）+ 原地续接 + 可重试 |
| D19 | 会话与工作区 | 会话**创建时绑定单个 Workspace**，生命周期内不可变 |
| D20 | 请求可追溯 | `request/context` 快照事件 + 确定性 `deriveMessages`；注入上下文必须先写日志 |
| D21 | 事件版本兼容 | 宽松读取 + 单向惰性迁移；旧会话可续写 |
| D22 | Agent 生命周期 | **按需唤醒 + 空闲超时卸载**（15min）；长驻任务保活；会话级隔离 |
| D23 | 插件启动容错 | **Fail-Fast**：缺依赖或 apply 抛错即整体启动失败并回滚 |
| D24 | Token 计量 | **分层估算**：发送前字符近似法预判，Provider `usage` 精准校正 |
| D25 | 外网暴露控制 | 绑非回环地址**强制 `HARNESS_ACCESS_TOKEN`**，无则拒绝启动 |
| D26 | 工程规范 | `pnpm check`（lint+typecheck+test）为提交门槛；Conventional Commits；`scripts/self-check` 自检 |
| D27 | 系统提示组装 | 6 节流水线（身份 → 规约 → 项目规则 → 技能 → 环境 → 工具清单），由 `ctx.systemPrompt` 插件贡献组装 |
| D28 | 权限参数模式 | 差异化匹配：命令前缀/子命令白名单（shell）、路径 glob（文件）、域名（网络） |
| D29 | 压缩与命令 | 默认跟随会话模型，支持独立廉价模型配置与机械降级；支持 `/compact` 手动触发 |
| D30 | 配置规范 | `harness.yml` 扁平列表按序挂载，支持 CLI 参数与环境变量覆盖 |
| D31 | 视觉语言 | 现代工程师暗色调（Dark Mode 优先）、高信息密度、卡片折叠、代码等宽优先 |
| D32 | 端口与数据目录 | 默认 `~/.harness/` + 3000；支持 `--port` / `--data-dir` 自定义；未指定时端口冲突自动顺延 |
| D33 | 重试耗尽处理 | 429/5xx 3 次重试失败后**优雅挂起**，保留上下文并提供「立即重试 / 更换模型 / 放弃」引导 |
| D34 | 集成自检架构 | `scripts/self-check.ts` 默认基于内置 Fake Provider 离线秒级跑通；`--live` 可选真实模型冒烟 |
| D35 | 多智能体模式B (会话子任务) | `run-chat.html` 底部快捷开关；注入 `spawn_agent` 工具，生命周期独立，产物精炼回传主会话 |
| D36 | 多智能体模式A (角色流水线) | 阶段式交付（PRD→架构→编码→测试）；工件前后契约注入；Gatekeeper 人工审批卡点；独立监控工作台 (`run-pipeline-detail.html`) |
| D37 | 多智能体模式C (BPMN 2.0) | 标准 BPMN 2.0 XML 解析与流转；Dify 风格三栏可视化设计器 (`config-workflow-design.html`)；双轨 Prompt；排他网关表达式求值；动态 SVG 实例追踪 (`run-workflow-detail.html`) |
| D38 | 多智能体工件路径与模型 | 工件输出目录定为「选填输出目录」，留空按 Git 增量追踪；模型统一采用 `<select>` 下拉框 + 独立【获取模型列表】按钮 |
| D39 | 记忆与经验治理 (MOD-11) | 全自动与半自动审核双模；四大存储形态（Disabled / 纯 Markdown / 本地 SQLite / Markdown+向量双轨），坚决剔除鸡肋纯向量；详情态锁定 + 专属受控向导（支持「丢弃测试数据全新起步」与「平滑数据无损迁移」两极分流，SHA-256 去重与 .bak 自动备份） |
| D40 | 通用 Skills 规范与生态兼容 | 严格对齐标准 Agent Skills Spec（YAML Front-matter + Markdown 规约 + 原子目录）；优先扫描 `.agents/skills` 与 `.skills`；首期专注支持本地原子 Skill 包导入与校验（支持文件拷贝或软链）；冷态仅注入元数据，热态通过 `skill(name)` 渐进披露加载正文 |
| D41 | 系统设置中心与导航瘦身 | 建立常驻系统设置中心（Settings Console），聚合网络端口、Token、数据目录、外观字体、底层插件与权限预设；精简外层 Activity Bar 为核心资产 + 底部系统齿轮 |
| D42 | 工作区并发写互斥 | 同一物理工作区允许多个历史会话存在，但物理写操作（改文件/命令执行）严格全局互斥，当前仅由唯一激活会话独占写锁 |
| D43 | 读写锁分级流转 | 纯读/无害指令（查代码、查配置）放行共享；遇到并发写冲突时调度层原生挂起等待并给出可视倒计时状态条，支持人类一键中断冲突会话 |
| D44 | 外部代码变更防卫 | 执行代码写入前强制比对文件物理指纹（mtime/hash），若检测到人类外部修改坚决不覆盖并自动重新读取最新版本，顶栏透传 Git 脏状态并明确劝阻人类并发手改 |
| D45 | 命令超时与非交互防护 | `bash` 执行默认注入非交互环境变量（`CI=true` 等）并硬设 120 秒超时机制，超时自动 SIGTERM/SIGKILL 掐断，杜绝终端假死 |
| D46 | 局部替换失败熔断 | 单文件代码连续匹配替换失败 3 次立即熔断刹车，呼叫人类支援，杜绝模型陷入重试死循环消耗 Token |
| D47 | 流式中断断点恢复 | 网络中途截断时，已生成的半截内容作为真实事实正常落盘入库，前端呈现明确断点并提供【从断点继续】与【重试】按钮 |
| D48 | 敏感凭据双层防泄 | 权限层默认拦截 `.env`、私钥证书读取；输出落盘与外发前通过正则自动替换为 `[REDACTED]` 托底 |
| D49 | 压缩与记忆生命周期解耦 | 上下文滑动窗口压缩专注于释放当前对话空间；长期记忆经验提取严格留在任务/会话圆满终局时刻触发，防止污染中间脏经验 |
| D50 | 无步数上限与滑动压缩 | **撤销**原「单回合默认上限 25 步」；主会话 `TurnLoop` 未显式传 `maxSteps` 即无步数上限，死循环防护交给「同参工具连续 3 次熔断」+ 上下文滚动压缩 + 用户 Abort。废除孤立的2次压缩死限，采用 OpenCode 的滚动压缩（Epoch/Seq基线）与溢出自动恢复机制 |
| D51 | 模型物理窗口动态感知 | 支持按模型配置实际上下文物理窗口（如 16k/64k/192k/200k），压缩触发阈值严格绑定当前模型物理上限的 80% |
| D52 | 沙箱防逃逸与扫描防黑洞 | 路径执行前强制 `realpath` 解析拦截符号链接 (Symlink) 逃逸；文件搜索强制跳过 `node_modules`、`.git` 等目录，硬卡 200 条上限防 OOM |
| D53 | 人机提问异步等待 | `ask_user` 对齐 OpenCode `QuestionV2`，设独立 `requestID` 与 reply/reject 双轨端点，支持断线重拉 |
| D54 | 多智能体工件基线保护 | 流水线与工作流上游已审定交付工件自动设为下游只读，严禁下游 Agent 篡改上游基线 |
| D55 | 外部扩展故障隔离 | MCP 服务启动失败或单次调用超时立即局部降级隔离，本地核心文件与执行工具照常运转，不拖垮主会话 |
| D56 | 版本控制安全红线 | Agent 仅生成提交信息草稿供人类预览，`git commit` 需审批，严禁自主静默 `git push` |
| D57 | 首次启动破冰向导 | 零配置冷启动时弹出极简两步向导（配模型 Key + 选工作区目录），一分钟内打通端到端闭环 |
| D58 | 思考模型思维链治理 | 增设 `reasoning` 独立事件流与 `tokens_reasoning` 计量；单回合支持展开查看，历史组装时默认折叠剥离，防止打爆上下文 |
| D59 | 单回合 Git 原子回滚与快照隔离 | 回合前轻量快照隔离用户未提交手写修改；`Revert Turn` 仅撤销当前回合 Agent 改动；新回合开启前一回合快照自动静默销毁 |
| D60 | 两级网络代理分流体系 | 区分系统全局代理与 Provider 专项代理；卡片提供独立 Toggle 秒切直连与代理；支持 HTTP/HTTPS/SOCKS5 与 Bypass 名单；底层基于 `undici` |
| D61 | 双轨模型协议适配 | 显式支持 `OpenAI Compatible` 与 `Anthropic Native` 双轨；Anthropic 协议下原生支持提示词缓存与思考块 |
| D62 | 跨平台底层适配吸收原则 | 底层操作系统（Shell 探测、进程树硬杀 `taskkill`、换行符容错）重点吸收 OpenCode/pi 成熟经验；模型接入自研高保真体验；存储与插件完全自主 |
| D63 | 代理网络静默僵死熔断 | 首包 30s + Chunk 静默 45s 硬超时熔断挂起，通知用户排查或重试，严禁代理故障时静默降级直连 |
| D64 | 多智能体写锁租约让渡 | 父子任务实行 Parent-Child Lock Delegation：子继承父写锁租约（`rootSessionId`），子运行父挂起，子完成原路返还，杜绝父子死锁 |
| D65 | SQLite 进程防争抢锁 | 系统数据目录启动单实例锁 (`~/.harness/.lock`)，检测到已有实例在跑立即阻断，杜绝 `SQLITE_BUSY` 冲突 |
| D66 | MCP 工具命名空间隔离 | 外部 MCP 工具强制增加 `mcp__<server>__<tool>` 命名空间前缀，本地 6 大编码工具保留字独占，防止本地沙箱被劫持 |
| D67 | 记忆与规约双层装配 | 对齐 OpenCode `instruction-context.ts`：全局偏好 (`~/.pg_harness/`) + 项目规约 (`<workspace>/.harness/`) 双层物理隔离与级联去重装配 |
| D68 | Spill Blobs 私有隔离清理 | 放弃全局引用计数，Spill 文件存入会话私有子目录 `~/.pg_harness/sessions/<id>/blobs/`，随会话删除原子清空，零孤儿垃圾 |
| D69 | SSE 息屏休眠心跳重连 | 服务端 15s 心跳 + 客户端 `visibilitychange` 感知重连，30s 无心跳自动判定半开死链接，携带最新 `seq` 秒级拉齐状态 |
| D70 | 项目全称与命名空间防撞 | 项目正式命名为 Purple Grapes Harness（缩写为 pgh 或 pg_harness）；数据目录定为 `~/.pg_harness/`；数据库为 `pgh.db`；锁文件为 `.lock`；环境变量前缀为 `PGH_*` |
| D76 | 原生标准语音播报体系 | 参考 `reference/dsh-speak` 思想，坚决奉行零 Native 依赖原则；采用 W3C 原生 Web Speech API (`window.speechSynthesis`) + `@harness/protocol` 规范化文本清洗（剥离代码块/URL/Emoji 防挂起）；提供会话顶栏一键静音、每条消息 🔊 重播与系统设置项独立偏好面板 |

### 关键结论

- **首要用例**：编码 Agent（真实 GitHub 项目修 bug + 跑测试 + 出 diff + commit/PR 准备）。
- **架构基石**：事件日志 + 插件内核 + 上下文治理 + 权限规则表，四者都是第一批的地基，事后补代价极高。
- **环境约束**：零 Native 编译（无 MSVC），全部用 Node 内置或纯 TS；Windows 优先。
- **范围边界**：本期 M1–M9 交付完整网页版；第二批做 checkpoint/@引用/斜杠命令/通知/OTel/i18n；第三批做多 Agent/ACP/定时任务/代码运行时/LSP/多模态。

## 2026-09-13 项目规范定稿

- 文档体系建立：`AGENTS.md`（总纲）+ `CONTEXT.md`（本文件）+ `SESSION.md` + `docs/`（规范、阶段、进展、规格）。
- 八荣八耻为最高行为准则。
- 生命周期阶段（需求→设计→实现→测试→交付）文档不跳过。
