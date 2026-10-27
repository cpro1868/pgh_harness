# SESSION.md —— 当前会话台账

> 每次会话开始时读此文件恢复上下文，结束前更新状态。
> 当前状态：**Sprint 1~6 全部交付；D77~D88 全闭环；BPMN 真机验收、向导 v2 双模式、输入建议（/skill + @ 文件）、Token 统计七项、模型选择器 v2（Provider 分组折叠）、运行态恢复与增量重放、断连资源泄漏修复全部交付；43 套件 404 断言全绿**

## 2026-10-27 增量

- **「进程莫名其妙无法使用」真因修复 (TC-00-99-003)**：chat/send SSE 无 close 监听——客户端刷新后回合继续跑，心跳/审批 broker/快照 Buffer 慢性泄漏。修复：res.on('close') 立即 abort 回合 + AbortSignal 透传 LLM fetch + retryWithBackoff 支持 signal。E2E：断开 3s 内回合中止、LLM 流切断。
- **模型选择器 v2 交付 (TC-01-08-006)**：Provider 分组折叠下拉（原型确认→实施），原生 select 隐藏为状态存储零改动兼容，分组点击展开/收起（stopPropagation 防误关），当前组自动展开+徽标，选中同步 dataset.providerId。CDP 真实输入事件 10/10。
- **输入建议交付 (TC-01-03-010)**：/ 行首命令菜单（/skill + Skills 动态子候选）、@ 行内文件引用（新端点 /api/workspace/files，WORKSPACE_SKIP_DIRS 统一清单过滤）。CDP 8/8。
- **向导 v2 双模式交付 (TC-01-08-005)**：全屏四屏流（欢迎/模型/工作区/完成），首启模式自动弹出 + 引导模式设置菜单重跑（预填当前配置+保留快捷通过），进度落盘断点续走。CDP 10/10。
- **门禁**：43 套件 / 404 断言全绿，lint/typecheck 零告警，安全扫描通过。全部已推送。

## 2026-10-23 顶栏布局重构增量

- **主会话顶栏布局重构（TC-01-08-003）**：用户四点需求全部落地——模型下拉收窄（短名+max-w 160px+title 提示）、Token 点击下拉（顶栏仅数字，费用/清零入面板）、语音/导出/自动保存收进 ⚙️ 设置菜单、自动保存开关（每回合结束自动沉淀记忆，localStorage 持久化，按钮圆点指示）；
- **工程纪律**：内联脚本必须纯 JS（`new Function` 编译兼容），TS 语法已全部还原；测试 DOM stub 补齐 `classList.toggle`；
- **验证**：`topbar-usage-settings.test.ts` 7 用例 + 全量 43 套件/374 断言全绿；CDP 真实浏览器 18 项断言全 PASS（含几何实测 160px、互斥、外部收起、localStorage 落盘）；
- **回滚锚点**：tag `v0.3.0-topbar-pre`；设计文档 `docs/superpowers/specs/2026-10-23-topbar-usage-settings-design.md`。

## 2026-10-23 本会话增量（BPMN 验收）

- **BPMN 真实项目端到端验收（TC-03-03-007）**：
  - 工作区 `G:\Projects\Agent\BpmnRealAcceptance`（真实支付校验模块），BPMN 含 代码审查 → userTask → XOR 裁决 → AND 并行(修复∥验收) → AND 汇聚 → 回边回归循环 ×2；
  - approve 轮 `wfi_1792689073110_rty7`：completed，AND 双分支均真实执行，**`Task_Regression_runs: 2`（回边真实跑两轮）**，产物 REVIEW 27.3KB / FIX-REPORT 22.6KB / ACCEPTANCE 21.2KB / REGRESSION 22.5KB，模型自写测试 21/21 通过，审计 174 次工具调用字段齐全；
  - reject 轮 `wfi_1792744301355_wvkd`：completed，XOR 驳回 → `Task_Rewrite` → `End_Rejected`，未进入放行分支。
- **验收中发现并修复的真实缺陷（D86）**：
  1. `BpmnWorkflowEngine.resume({decision:'reject'})` 不推进 token → BPMN 驳回连线永远不可达（死路）；
  2. XOR 网关条件全不满足时兜底 `outs[0]` → 会默认走第一条出线（往往是放行分支），存在越权推进风险；
  - 修复：驳回且出线直达网关时推进到网关选退回流；线性流程仍维持挂起（保留 D77 安全语义）；XOR 选流改为「条件真 → defaultFlow → 无条件流 → 条件假流」，移除 `outs[0]` 兜底；裁决日志时间戳改为裁决时刻并按时序排序；
  - 测试：bpmn-engine 用例 13/14 + workflow-audit-log 人工驳回全链路，**变异验证**（回退修复后两层均转红）。
- **门禁**：42 套件 / 367 断言全绿，lint/typecheck 零告警，self-check 6/6；服务 PID 27408。
- **挂起项清零**：先前挂起的 `BpmnRealAcceptance` 验收已闭环。

## 2026-10-21 本会话增量

- **服务运维**：用户请求重启服务，当前后台运行 PID 6004，`/api/health` ok。
- **文档补档（用户指出久未记录）**：
  - D83 三件套（BPMN 执行审计字段 / `/decide` 日志丢失修复 / `${<节点ID>_runs}` 有限循环）补入 `CONTEXT.md` 决策表与 `docs/工作进展记录.md` 专节——此前仅 SESSION.md 顶部提及，决策快照与进展日志缺失；
  - 确认 D84（长运行崩溃双兜底）、D85（LLM 瞬态错误自动重试）、D50 修订（撤销步数上限）此前均已入档。

- **用户报障修复：LLM「HTTP 520 / terminated」频繁报错（TC-00-98 / D85）**：
  - 澄清：用库内真实凭据复现 PGH 完整调用形态（同 payload + tools + stream），单发/连发/长上下文共 55 次**全部成功**；520 响应体为 Cloudflare 源站异常页模板，属上游网关瞬态故障，与调用参数无关；
  - 真正缺陷：零重试（任何一步撞瞬态错误即全回合报废）+ 报错文案误导；
  - 修复：新增 `security/retry.ts`（瞬态/业务错误分类 + 3 次指数退避重试），接入主会话/BPMN/流水线/Provider ping 全部调用点；文案修正；
  - TDD：`llm-retry.test.ts` 8 用例先红后绿；门禁 **42 套件 / 364 断言全绿**；服务已重启（PID 30260，后经用户重启指令现为 PID 6004）。
- **用户报障修复：长运行进程崩溃（D84 / TC-00-99）**：
  - 根因 1：顶层请求 catch 无条件 `res.writeHead(500)`，SSE 回合中 headers 已发送后再抛异常触发 `ERR_HTTP_HEADERS_SENT`，rejected promise 逃逸杀死进程；且全服务无 `uncaughtException`/`unhandledRejection` 兜底；
  - 根因 2：`ProxyDispatcher` 每次 LLM 调用 `new ProxyAgent` 从不销毁（日志实测 361 次累积），undici 连接池持续泄漏致 OOM；
  - 修复：headersSent/writableEnded 双守卫 + 进程级异常兜底（记录并存活）；ProxyAgent 同路由单例缓存（proxyUrl+token 键）+ `destroyAll()` 生命周期挂载（stop 时释放、代理配置变更时重建）；
  - TDD：新增 `stability-guard.test.ts`（4 用例，含独立子进程真实崩溃回归）与 proxy 单例断言，先红后绿；
  - 门禁：`pnpm check` **42 套件 / 356 断言全绿** + `self-check` 6/6；服务已重启（PID 32132）。
- **用户报障修复：主会话「已达单回合最大步数（25 步）」频繁截断（D50 修订）**：
  - 根因：该上限系自拟规则（D50），非用户需求；硬编码于主会话 `TurnLoop` 的 `maxSteps: 25`，并由 `turn-loop.ts` 的 `?? 25` 兜底；
  - 修复：`TurnLoop.maxSteps` 降级为纯可选预算（未指定即无上限），主会话移除 `maxSteps: 25`；死循环防护保留同参工具连续 3 次熔断、上下文滚动压缩、用户 Abort；
  - TDD：新增「未配置 maxSteps：禁止任何隐式步数上限」用例（40 次工具调用后自然收敛，`stepsUsed=41`），先红后绿；
  - 同批清理：BPMN 节点 ReAct（原 `maxSteps: 5`）与流水线阶段 ReAct（原 `maxSteps: 25`）硬编码预算一并移除，全服务端已无隐式步数上限；
  - 门禁：`pnpm check` **40 套件 / 351 断言 / 0 失败**；
  - 防护仍在：同参工具连续 3 次熔断、BPMN 引擎 `totalSteps` 环路熔断、上下文滚动压缩、用户 Abort。
- **挂起**：BPMN 真实项目端到端验收（`G:\Projects\Agent\BpmnRealAcceptance`）暂缓，待本问题收尾后继续。

## 2026-10-18 本会话增量

- **用户报障修复（第四批）：流程设计器全套功能完备复原与双版本合流（D82 / TC-03-02-003）**：
  - 根因：此前 81KB 完整设计器（含拖拽/缩放/DAG 拓扑去交叉重排/前后指定连线/快捷删除）留在 `config-workflow-detail.html`；资产库链接跳到了 45KB 残卷 `config-workflow-design.html`，导致高级交互全丢失；
  - 修复：81KB 完整实现合流覆盖 `config-workflow-design.html`；注入前缀无关解析；适配 `shared.css`/`theme.js`；新增 TC-03-02-003（7 项守卫全绿）；
  - 真实浏览器 CDP 实测：拖拽移动坐标 `{60,140}` &rarr; `{140,200}` 曲线实时重绘；缩放 100% &rarr; 120% &rarr; 100% 居中复位；`autoLayoutNodes()` 8 节点清晰重排；前后指定连线与快捷删除全部恢复；零 JS 错误；
  - 门禁：`pnpm check` **39 套件 / 345 断言 / 0 失败**，`self-check` 6/6 100%（27ms），服务平滑重启于 3210 端口（PID: 20456）。
- **用户报障修复（第三批）：Dify 设计器 CSS flex-direction 垂直塌陷根除（D81 / TC-03-02-002）**：已闭环。
- **用户报障修复（第二批）：主会话切换工作区联动 + 完全授权高危强提醒（D80 / TC-01-08-002 / TC-01-13-002）**：已闭环。
- **用户报障修复（第一批）：BPMN 资产库「Dify 可视化设计」0 节点数据空页面（D79 / TC-03-01-004）**：已闭环。
- **补记文档缺口**：真机全流程验证已入档。

## 2026-10-18 D77/D78 增量（已完成）

- **用户报障修复（第三批）：Dify 设计器点击后页面空白终极真凶彻底解决（D81 / TC-03-02-002）**：
  - 现象：前两轮修复了 XML 命名空间 0 节点，但用户浏览器打开依然一片空白；
  - 物理几何测量（Chrome DevTools Protocol）：`shared.css:597` 的 `body.app-shell { flex-direction: column; }` 把包含一级侧边栏的设计器页面强行按**上下列排列**——侧边栏高 904px 占满第一屏，主工作台直接被挤到屏幕下方（top: 904px，画布高度塌陷为 64px），8 张卡片全在 `y: 924px ~ 999px` 视口外，屏幕只剩侧边栏和黑底，用户视觉上**彻底空白**；
  - 修复：页面显式声明 `flex-row`；`shared.css` 注入 `body.flex-row, body.app-shell.flex-row { flex-direction: row !important; }`；新增 TC-03-02-002 测试套件；
  - 几何测量验证：画布高度由 64px 恢复至 856px（铺满视口），首张卡片 `viewportY` 由 924px 恢复至 412px（居中可见），`isInViewport` 由 false 恢复为 true，8 张卡片与 8 条贝塞尔连线立即可见；
  - 门禁：`pnpm check` **38 套件 / 338 断言 / 0 失败**，`self-check` 6/6 100%（30ms），后台服务保持监听（PID: 15780）。
- **用户报障修复（第二批）：主会话切换工作区联动 + 完全授权高危强提醒（D80 / TC-01-08-002 / TC-01-13-002）**：已闭环。
- **用户报障修复（第一批）：BPMN 资产库「Dify 可视化设计」0 节点数据空页面（D79 / TC-03-01-004）**：已闭环。
- **补记文档缺口**：真机全流程验证（`wf_1792309274387_oxbk` / `RealTestProject`）已入档。

## 2026-10-18 D77/D78 增量（已完成）

- **用户报障修复（第二批）：主会话切换工作区联动 + 完全授权高危强提醒（D80 / TC-01-08-002 / TC-01-13-002）**：
  - 根因：`switchSession()` 仅同步授权档位与用量基线，从不同步 `activeWorkspacePath`；`handlePermissionPresetChange('full')` 无阻断式确认流直接落盘；
  - 修复：
    1. 切换会话时抽取 `syncSessionMetaFromServer`，同步 `activeWorkspacePath` 与顶栏下拉框 `value`/`title`，未登记工作区动态补建 `<option>`，并刷新 Skills 候选；
    2. 交付 `#full-auth-modal` 强提示模态弹窗（琥珀色边框 + 毛玻璃遮罩），选中 `full` 时下拉框立即回退并弹窗阻断；只有显式点击「我已知晓风险，确认完全授权」才落盘为 `full`；取消则维持原档位不落盘；只读/标准直接落盘；
  - TDD：新增 `chat-topbar-session-sync.test.ts`（5 用例，RED 4/5 失败 → GREEN 5/5 全绿）；`client-theme-light.test.ts` 补齐豁免；
  - 验证：`pnpm check` **37 套件 / 335 断言 / 0 失败**；`self-check` 6/6 100%；Chrome DevTools Protocol 真实浏览器端到端复验（会话 A/B 双向切换顶栏与全局变量同步变动；选择 full 先弹窗阻断、取消不变、确认落盘、后端 SQLite 回查为 `full`）；服务平滑重启（PID: 19220）。
- **用户报障修复（第一批）：BPMN 资产库「Dify 可视化设计」空页面（D79 / TC-03-01-004）**：
  - 命名空间前缀硬编码根因修复（全链路统一前缀无关 + 导入接入 `parseBpmnXml` fail-closed 校验），详见台账与进展记录。
- **补记文档缺口**：真机全流程验证（`wf_1792309274387_oxbk` / `RealTestProject`）已补档进 `docs/工作进展记录.md`。

## 2026-10-18 D77/D78 增量（已完成）

- **用户报障修复：BPMN 资产库「Dify 可视化设计」空页面（D79 / TC-03-01-004）**：
  - 根因（systematic-debugging + Chrome DevTools Protocol 真实浏览器取证）：导入 `bpmn2:`/无前缀合法 BPMN 后，引擎解析器（前缀无关）能跑，但设计器 `parseCurrentXml()`、存储层计数正则、监控大屏三处**硬编码 `<bpmn:` 前缀**解析出 0 节点 → 画布空白；且 `POST /api/workflows` 原先不校验 XML，非法内容可静默入库；
  - 修复：全链路统一前缀无关语义；导入接入 `parseBpmnXml()` 校验（非法 400 fail-closed）+ 真实 `nodeCount`/`gatewayCount`；连线正则同时去除属性顺序依赖；
  - TDD：新增 `workflow-import-namespace.test.ts`（6 用例：三前缀矩阵 × 引擎/导入/列表/PUT 四层 + 非法 XML 拒绝 + 客户端解析断言），RED 5/6 失败 → GREEN 6/6；
  - 验证：`pnpm check` **36 套件 / 330 断言 / 0 失败**；`self-check` 6/6 100%（36ms）；真实浏览器端到端复验（导入 bpmn2: → 列表回显"4 Nodes 1 Gateways" → 点击按钮 → 设计器渲染 5 卡片 5 连线、零 JS 错误）；`git status` 安全扫描无敏感文件入列；服务平滑重启（PID: 24320）。
  - **测试盲区复盘**：测试语料单一（只用 `bpmn:` 前缀）+ 断言过浅（只测页面 200）+ 无真实 DOM 执行层——三层防线全部缺失导致该缺陷穿透；已在 D79 登记并补层。
- **补记文档缺口**：2026-10-18 早前完成的真机全流程验证（`wf_1792309274387_oxbk` / `wfi_1792309303900_6gmi`，真实项目 `G:\Projects\Agent\RealTestProject`）此前未入台账，本轮已补记至 `docs/工作进展记录.md`（见 2026-10-18 条目）。
- **真机全流程验证状态结论**：已完成——`Task_LegalScan` 真实模型驱动 ReAct 工具循环产出 7 份文档约 130KB（磁盘时间戳 10/18 13:52–13:57），`UserTask` 人工裁决 approve，实例 `completed`；遗留缺口：执行日志未记 `toolCalls`/`model` 审计字段（已列入 Backlog）、引擎 `maxSteps` 真机 25 步与当前代码 `maxSteps: 5` 的差异待排查（`turn-loop.ts:231` 文案硬编码 "25 步" 为已确认的显示层缺陷）。

## 2026-10-18 D77/D78 增量（已完成）

- **BPMN 人工审查跨进程断点续接与跨 resume 累计熔断（D77 / D78）**：
  - 引擎新增 `BpmnWorkflowEngine.hydrate()`：从持久化实例快照（completedNodes/activeNodes/variables）重建挂起态并定位 UserTask 锚点，`resume()` 在无锚点时 fail-closed 判 failed；
  - `totalSteps` 升级为跨 resume 累计熔断（`execute()` 重置、`resume()` 不重置、`stepLoop` 自增比对），`resume()` 新增可选 `maxSteps`（默认 500），反复放行含 UserTask 环路必须在有限次内熔断为 failed；
  - 服务端 `/decide` 运行时引擎丢失（进程重启）兜底由「`execute()` 整段重跑」改为「`hydrate + resume` 断点续接」，杜绝重放已完成节点与吞掉裁决语义；驳回后仍挂起时把重建引擎放回 `workflowEngines` 池供后续内存路径裁决；
  - 抽取 `createWorkflowNodeExecutor()` 工厂，`/run` 首次执行与重启兜底续跑共用同一模型调用/权限闸门/执行日志实现；
  - 新增 TC-03-03-005（`workflow-restart-resume.test.ts`：重启后 approve 续接完成且上游不重放、reject 维持挂起写入原因、驳回后二裁仍有效），TC-03-03-001 新增用例 8（跨 resume 熔断，已做变异验证：注入重置后用例如期红灯）与用例 9/10（hydrate 续接 / 无锚点 fail-closed）；
  - `pnpm check` 全量 **35 套件 / 324 断言 / 0 失败**（lint + typecheck + test 三段全绿），服务已平滑重启（PID: 29032，`/api/health` 正常）。

## 2026-10-06 本会话增量

- **模式C（BPMN 业务工作流）全生命周期原型 1:1 对齐与安全工程闭环 (Epic 3 深度收敛)**：
  - 交付 `run-workflow.html` 实例大屏与启动向导（4 指标卡、状态过滤大表、启动向导弹窗）；
  - 交付 `config-workflow-design.html` Dify 风格编排工作台（卡片化 DOM 节点、点阵无限画布、双侧无缝折叠、双轨 Prompt / 变量总线）；
  - 重构 `config-workflows.html` 为标准化 7 列模型资产大表，支持导入/查看/复制 XML 与 Dify 编排跳转；
  - 升级 `run-workflow-detail.html` 独立监控大屏（动态 SVG 流经高亮、人机干预对话流、实时变量总线）；
  - 彻底打通 BPMN 执行层：Task 节点真实驱动 `TurnLoop` 调用大模型并执行编码工具；
  - 闭合安全工程缺口 BL-09（私有文件 0700/0600 权限）与 BL-04（受控网络抓取 `fetch_url` 及严格 SSRF 防火墙）；
  - 全站 15 个页面接入 Web Toast 全局通知系统（毛玻璃提示与平滑动画），全面替换生硬的 `alert()`；
  - 全量 `pnpm check`（33 个测试套件、311 项测试断言）100% 绿灯，服务已平滑重启（PID: 30384）。
- **生产安全工程缺口闭环（BL-11 / BL-12 / TC-01-05-006）**：
  - 落地 BL-12 CORS 跨域白名单收紧，废除通配符 `*`，仅放行回环地址与同源请求；
  - 落地 BL-11 非回环暴露绑定（`0.0.0.0`）强制 Token 鉴权（`x-pgh-token` / `Bearer`），未认证请求 401 fail-closed 拦截；
  - 新增 TC-01-05-006 测试套件，全量 `pnpm check`（35 套件、319 测试）100% 全绿，服务已平滑重启（PID: 24944）。
- **BPMN 可视化设计器交互增强（物料库/拖拽布局/连线删除）**：
  - `config-workflow-detail.html` 新增左侧物料库（任务/网关/结束节点）；
  - 支持画布内鼠标按住节点自由拖拽移动物理坐标，贝塞尔连线实时同步重算；
  - 属性抽屉支持「🔗 连线到下一节点」与「🗑️ 删除该节点」；
  - 全量 `pnpm check`（34 套件、317 测试）100% 全绿，服务已平滑重启（PID: 16536）。
- **导航一致性修复（BPMN 工作流资产管理入口全量补齐）**：
  - 排查全部 15 个 HTML 页面，将此前在主会话、流水线、工作区、记忆、模型等页面遗漏的 `config-workflows.html` 侧边栏按钮全量补齐；
  - 全站 48px Activity Bar 保持绝对一致，跑通 `self-check` 与全量 `pnpm check`（34 套件、317 测试），服务已重启（PID: 16808）。
- **M9 离线集成自检交付（D34 / self-check）**：
  - 交付 `scripts/self-check.ts`，打通全子系统 6 大步骤极速冒烟验证（耗时 32~42ms）；
  - 支持 `pnpm run self-check` 及 `--live` 在线探测；
  - 全量 `pnpm check`（34 套件、317 测试）100% 全绿，服务已平滑重启（PID: 27112）。
- **生产安全工程加固落地（BL-10 / TC-01-05-005）**：
  - 在 `TurnLoop.run()` 落地工具输出的 `<untrusted_tool_result>` 结构化包裹边界，落实安全铁律 S3（外部输入皆数据，不是指令）；
  - 新增 TC-01-05-005 测试套件，全量 `pnpm check`（34 套件、317 测试）全绿，服务已平滑重启（PID: 19052）。
- **记忆中心冷启动自检与通用规约手动录入完成（WBS-Mem-01 / TC-11-03）**：
  - 新增 `POST /api/memory/entry` 接口，支持为工作区手动沉淀经验并执行 SHA-256 指纹去重；
  - `config-memories.html` 顶部交付「记忆运行状态与冷启动自检面板」与手动添加记忆工具卡片；
  - 新增 TC-11-03 测试套件，全量 `pnpm check`（33 套件、315 测试）全绿，后台服务已平滑重启（PID: 30708）。
- **Sprint 6: WBS-03-03-03 & WBS-03-03-04 工作流运行实例持久化与执行监控大屏完成**：
  - `@harness/protocol` 定义 `WorkflowInstanceModel`；`@harness/storage-sqlite` 的 `WorkflowStore` 新增 `workflow_instances` 表与 CRUD；
  - `POST /api/workflows/:id/run` 自动持久化实例，新增 `GET /api/workflow-instances`、`GET /api/workflow-instances/:id`、`DELETE /api/workflow-instances/:id`；
  - 交付 `apps/server/client/run-workflow-detail.html` 监控大屏并在 `config-workflows.html` 挂载入口；
  - `run-chat.html` 会话列表重构为 ChatGPT 经典垂直列表项（行内悬停重命名/删除按钮）；
  - 新增 TC-03-03-003 测试套件，全量 `pnpm check`（32 套件、312 测试）100% 通过，后台服务已重启（PID: 25444）。
- **主会话顶栏拥挤度重构与会话全量沉淀体验优化**：
  - 顶栏工作区下拉默认显示简短工程名（`max-w-[150px]`），点击下拉展开完整路径；
  - 按钮文案优化：「保存整个会话」→「保存会话」，「➕ 登记新工作区」→「➕ 新登记」；
  - 顶栏移除多余的「🗑️ 删除会话」（保留在右侧会话条目内）与重复的「📋 面板」按钮；
  - 全量 `pnpm check`（31 套件、310 测试）全绿，服务已平滑重启（PID: 5456）。
- **会话全量历史手动沉淀与防重复堆积（WBS-Mem-01 / TC-11-02）**：
  - 新增 `POST /api/memory/snapshot-full` 全量沉淀接口，遍历事件流并按精确 SHA-256 指纹判重；
  - `run-chat.html` 顶栏新增「📥 保存整个会话」按钮，实时状态反馈（✅ / ♻️ / ℹ️ / ❌）；
  - 新增 TC-11-02 测试套件，全量 `pnpm check`（31 套件、310 测试）全绿。
- **新增记忆手动沉淀按钮与智能 SHA-256 去重（WBS-Mem-01 / TC-11-01）**：
  - 在 `run-chat.html` 操作栏新增 `💾 存储当前会话记忆` 快捷按钮；
  - 新增 `POST /api/memory/snapshot` 端点，复用 `MemoryCascade` 级联装配，按精确 SHA-256 指纹判定重复并返回 `{ saved, isDuplicate }`；
  - 新增 TC-11-01 测试套件，全量 `pnpm check`（30 套件、308 测试）全绿。
- **新增语音播报系统（WBS-Speech / TC-01-13）**：
  - 参考 `reference/dsh-speak` 设计，落地基于纯原生 Web Speech API 的全自动与单消息手动播报体系；
  - `@harness/protocol` 交付 `cleanSpeechText` 规范化文本清洗器（消除 Markdown/代码块/Emoji 与特殊符号）；
  - `run-chat.html` 接入单消息「🔊 朗读」操作按钮、顶栏全局静音按钮与轮次结束自动朗读；
  - `config-settings.html` 接入语音偏好可视化配置与试听；
  - 新增 TC-01-13 测试套件，全量 `pnpm check`（29 套件、306 测试）全绿。
- **Sprint 6: WBS-03-03-02 BPMN 端到端试运行接口与动态执行可视化完成**：
  - 在 Fastify 后端暴露 `POST /api/workflows/:id/run` 端点，接通状态机与上下文变量注入，返回 `executionLog` 与 `completedNodes`；
  - `config-workflow-detail.html` 顶栏新增「▶️ 试运行流程」，对已执行节点动态打绿色高亮描边；
  - 新增 TC-03-03-002 测试套件，全量 `pnpm check`（28 套件、302 测试）100% 通过。
- **Sprint 6: WBS-03-03-01 BPMN 分支路由状态机引擎完成**：
  - 新建 `packages/core/src/workflow/bpmn-engine.ts`，导出 `BpmnWorkflowEngine`；
  - 支持 Token 驱动的状态机调度、排他网关（XOR）条件表达式安全求值、并行网关（AND Fork/Join）同步屏障与步数上限熔断；
  - 新增 TC-03-03-001 测试套件，4 项测试全绿，全量 `pnpm check`（27 套件、299 测试）100% 通过。
- **Sprint 5: WBS-03-02-01 & WBS-03-02-02 流程可视化设计器与双折叠画布界面完成**：
  - 交付 `apps/server/client/config-workflow-detail.html`，实现基于纯原生 SVG 的轻量 BPMN 2.0 节点与连线渲染；
  - 落地「双折叠」面板：右侧节点属性抽屉（可实时查看与编辑节点名称、`camunda:roleName`、提示词模版与网关条件）+ XML 源码折叠面板，支持图形与代码双向联动保存；
  - `config-workflows.html` 增加「🎨 设计器画布」直达入口；
  - 新增 TC-03-02-001 测试套件，并通过全量 `pnpm check`（26 套件、295 测试全绿）。
- **Sprint 5: WBS-03-01-02 流程定义资产管理界面与后端存储接口完成**：
  - 在 `@harness/protocol` 补充 `WorkflowDefinition` 模型实体契约；
  - 在 `@harness/storage-sqlite` 落地 `WorkflowStore`，自动执行 DDL 创建 `workflows` 表和 `idx_workflows_updated` 索引，内置推荐标准交付模板 `wf_std_feature_dev`；
  - 在 `apps/server` 接入 `WorkflowStore`，提供 `GET /api/workflows`、`GET /api/workflows/:id`、`POST /api/workflows`、`PUT /api/workflows/:id`、`DELETE /api/workflows/:id`，并防护内置模板不可删除；
  - 交付流程定义资产管理前端 `apps/server/client/config-workflows.html` 并挂载全局 48px 一级侧边栏导航，支持查看、新建、编辑 XML 与删除；
  - 编写 TC-03-01-002（SQLite DDL 与 CRUD 存储测试）与 TC-03-01-003（REST API 测试），通过 `client-theme-light.test.ts` 亮色主题对比度审查；
  - 质量门禁验证：`pnpm check` 全绿（25 套件、293 测试断言 100% 通过）。
- **体验专项优化：主会话顶栏快捷登记与清新明亮模式文字/代码块高对比度覆盖**：
  - `run-chat.html` 顶栏工作区下拉框后追加「➕ 登记新工作区」直达按钮；
  - `shared.css` 完善 `light-clean` 主题下会话方块（`.session-block`）底色、悬停、聚焦激活状态及文字加深；
  - 完善源码展示块（`pre`、`code`、`hljs` 高亮）与行级 Diff 审阅卡浅色模式适配；
  - 保持后台服务常驻（PID: 8704，端口: 3210）。
- **Sprint 5: WBS-03-01-01 纯 TS 轻量级 BPMN 2.0 XML 解析器完成**：
  - 新建 `packages/core/src/workflow/bpmn-parser.ts`，导出 `BpmnParser` 及 `BpmnProcessModel`、`BpmnNode`、`BpmnFlow`、`BpmnDiagramLayout` 等类型；
  - 零 C++ 原生扩展、零重量级外部依赖，纯 TS 正则与实体解码实现；
  - 支持解析 `bpmn:process` 元数据、`startEvent`、`endEvent`、`serviceTask`、`userTask`、`exclusiveGateway` 等节点及 `sequenceFlow`（含条件表达式实体解码如 `&gt;=` 转 `>=`）；
  - 支持提取 `camunda:inputOutput` / `camunda:inputParameter` 扩展参数（`roleName`、`modelId`、`promptTemplate`）；
  - 支持提取 `bpmndi:BPMNShape` (Bounds) 和 `bpmndi:BPMNEdge` (waypoints) 布局拓扑；
  - 包含空输入、非法根节点、非法连线属性的 fail-closed 防护；
  - 在 `packages/core/src/index.ts` 导出并加入 `package.json` 的 `test` 脚本；
  - 新增 TC-03-01-001 测试套件，5 项测试断言 100% 绿灯。
- **配置类页面统一拓宽（本会话第三项交付）**：对齐 `run-pipeline.html` 的 `max-w-[1720px] mx-auto`，7 个配置页主容器由 `max-w-4xl/5xl/6xl` 改为 `1720px` 满宽上限（弹窗级与局部 `max-w-` 不动）；设置页右侧功能区（内核插件编排拓扑所在面板）随之拉伸。`pnpm check` **22 套件 / 282 断言全绿**。
- **清新明亮模式文字对比度适配（本会话第二项交付）**：修复 light-clean 下主会话 `.prose-dark` 浅灰正文/白色标题不可读、slate-500/600 过浅、30+ 个强调色类未映射、暗色 chip 未翻转等 5 类根因；全部落在 `shared.css` 主题层（页面/原型零改动）；新增 TC-01-12 覆盖门禁测试（文字/背景类必须有 light-clean 映射或显式豁免）。`pnpm check` **22 套件 / 282 断言全绿**。
- **质量门禁真门禁化（D75，本会话交付）**：
  - `package.json`：`check` = `pnpm lint && pnpm typecheck && pnpm test`；`lint` = `eslint . --max-warnings=0`；`typecheck` = `tsc --noEmit -p tsconfig.check.json`（原 `tsc -b` 组合非法，直接报 TS5023）；
  - 新增根 `eslint.config.mjs`（ESLint 10 + typescript-eslint 8 flat config，`no-explicit-any` = error）与 `tsconfig.check.json`（全仓单工程聚合 + `@harness/protocol` paths）；
  - 存量错误清零：lint 34 → 0（index.ts 15 / chat-loop 5 / turn-loop 死赋值 / 4 个测试文件 `any` 等）；typecheck 5 → 0（settings section `data` 联合类型、`MemoryWorkspaceConfig` + `MemoryStorageMode` 收口 + `normalizeMemoryMode()` fail-closed、`SessionRow.preset` 收口）；
  - `MemoryWorkspaceConfig`/`MemoryWorkspaceConfigs` 正式落地并替换 `workspace.memoryConfigs` 的 3 处 `Record<string, any>`；
  - `apps/server/tests/proxy-config.test.ts` 补入 `test` 脚本清单（此前遗漏、未被任何门禁执行）。
- **依赖变更**：devDeps 增 `eslint` / `@eslint/js` / `typescript-eslint`（纯 TS，零 Native）；deps 增 `undici@^8.11.2`（D60 代理 `ProxyAgent` 显式依赖）。
- **验证**：`pnpm check` 全绿 —— lint 0、typecheck 0、**21 套件 / 277 断言 100%**；`git status --short` 无 `.env`/`*.db`/密钥入列。
- **未做**：顶栏 🌙/☀️ 快捷切换；`data-density` 样式规则；`follow-system` 探测（主题体系遗留）。

## 2026-10-04 本会话增量

- **全站外观主题体系（本会话交付）**：
  - `css/shared.css` 增加 `[data-theme='slate-blue'|'oled-black'|'light-clean']` 三组变量覆盖 + 明亮模式对 21 种硬编码 Tailwind 类的整体映射；
  - 新建 `js/theme.js`（12 个 HTML 页 head 注入）：localStorage 同步打 `data-theme` 防闪烁 → 异步 `fetch('/api/settings/all')` 以 SQLite 为权威源 → `storage` 事件跨标签联动；
  - `config-settings.html` 新增第 4 个 radio「☀️ 清新明亮模式」，radio/字体/密度 onchange 即时预览（不落盘），保存时 `PGHTheme.persist+apply` 立即生效；
  - `loadAllSettings` 补齐 `themeStyle` 回显（此前缺失，是"切换无反应"的表层原因）。
- **验证**：`pnpm check` **21 套件 / 271 断言全绿**；`/api/settings/all` 实测落盘/读取往返正确。
- **未做**：顶栏 🌙/☀️ 快捷切换；`data-density` 样式规则；`follow-system` 探测。

## ⚠️ 状态更正与补全记录（2026-10-02）

此前 Sprint 4 宣称的「100% 交付」**仅对编排层成立**，执行层曾为模拟 stub。已完成如实更正并**补全执行层**：

| 能力 | 状态 |
| --- | --- |
| 模板 CRUD / 阶段编辑 UI / 泳道状态机 / 工件捕获 / 落盘 | ✅ 真实实现 |
| **阶段真实 Agent 执行（调模型 + ReAct 工具循环）** | ✅ **已补全**（`runPipelineStage` 驱动 `TurnLoop`，替换 stub） |
| `roleName`/`promptTemplate`/`modelId`/`toolsAllowed` 真正驱动 Agent | ✅ **已生效**（角色 System Prompt + 模型解析 + 工具白名单） |
| 上游工件注入下游上下文（`buildStageInputContext`） | ✅ **已接线并有测试** |
| 审定工件只读守护（`ArtifactManager.canEdit`） | ✅ **已接线并有测试**（D54） |
| 父子写锁租约让渡（`LockDelegator`） | ✅ **已接线并有测试** |
| 人机干预指令送达运行中 Agent | ✅ **已接线并有测试**（`TurnLoop.drainUserMessages`） |

**根因回顾**：真实 ReAct 引擎 `TurnLoop` 此前仅被 Chat 使用，流水线 `executeStage` 为占位 stub。

## 当前目标

**Epic 2 / Sprint 4 已闭环**；待用户验收后推进 Epic 3 / Sprint 5 (BPMN 2.0)。

## 执行层补全（2026-10-02，本轮核心）

- **真实阶段执行**：`apps/server/src/index.ts` 新增 `runPipelineStage()`，替换原模拟 stub；按 `stage.modelId` 解析 Provider/模型，用 `roleName`/`promptTemplate` 组装 System Prompt，经 `TurnLoop` 真实调用模型并执行工具。
- **工具约束**：阶段 `toolsAllowed` 为硬白名单（fail-closed）；复用 `FileTools`/`SearchTools`/`ShellExecutor`；`PermissionGate` 硬性红线（git push、`.env` 等）始终优先拒绝；`bash` 保留父目录穿越拦截。
- **上游上下文注入**：`ArtifactManager.buildStageInputContext` 已接线，下游阶段请求携带上游角色/总结/工件正文预览。
- **只读守护**：`approve()` 在审批放行（`onGateResolved`）或非审批门阶段完成时登记；下游 `write_file`/`edit_file` 命中即被 `canEdit()` 拦截。
- **写锁租约让渡**：实例父级持有工作区写锁，阶段执行时 `LockDelegator.delegate` 让渡、`finally` 中 `reclaim`；实例结束/停止时释放。
- **人机协同**：`TurnLoop` 新增 `drainUserMessages`，每步推理前抽取人类指令并作为 user 消息注入；`/instruction` 在 running/paused 时入队。
- **无需 Provider 时 fail-soft**：如实输出「未配置可用模型」提示，不伪装成功。
- **测试**：新增 TC-10（真实调用+工具执行）、TC-13（上下文注入）、TC-14（只读守护）、TC-15（人机协同）与 `lock-delegator.test.ts`（5 例）。
- **验证**：`pnpm test` **17 套件 / 260 断言全绿**；服务重启于 `3210`。

### 已知限制（如实登记）

- ~~仓库无 `node_modules`/`tsc`，`pnpm check` 实为 `pnpm test`，`pnpm lint` 为占位；无静态类型门禁（仅运行时校验）~~ **已于 2026-10-06 消除**：`pnpm check` = `lint`（ESLint 零 warning）+ `typecheck`（`tsconfig.check.json` 全仓 `tsc --noEmit`）+ `test`，三段全绿（见 D75）。
- 阶段仅暴露本地 6 大工具，暂未接入 MCP/ask_user；`permissionGate` 以 `full` + 硬红线的组合，无交互审批（流水线为非交互场景）。
- 流水线实例运行态在内存中，服务进程重启不自动续跑。

## 已完成（2026-10-02 修复轮次）

- 修复 `config-pipelines.html`：`stages is not defined`（改用 `pipe.stages`）+ 补全缺失的 `createNewTemplate()`。
- `PipelineStage` 新增 `name?: string` 字段，全链路贯通（协议 / SQLite `stage_name` 列 + 迁移 / API / 三个前端页），**步骤名称现可独立编辑**。
- `run-pipeline-create.html` 信息层次纠偏：上半区「任务基础信息」（非步骤）、下半区「流水线步骤与角色编排」，去掉误导性「第一步/第二步」。
- **模板编辑闭环（第二轮）**：
  - `POST /api/pipelines` 改 **upsert**，修复已有模板保存必 500（UNIQUE 约束）；
  - 新增 `DELETE /api/pipelines/:id`（内置模板 403 保护）；
  - 模板列表卡片增加「删除模板」；修正「内置推荐」标签判断为 `pipeline_std_rd`；
  - 模板详情页左侧顶部新增「模板基础信息」块（名称/描述），阶段编辑区新增「删除此阶段」（至少保留 1 个 + 自动重排）；
  - **全部去除原生 `prompt()`**（新建模板/新增阶段均改为页内内联编辑）。
- **模型绑定去硬编码（第三轮）**：`config-pipeline-detail.html` 与 `run-pipeline-create.html` 的模型下拉改为**动态读取 `/api/providers` 真实配置**（原硬编码 `deepseek-chat`/`deepseek-reasoner` 与实际 `glm-*`/`deepseek-*` 不符）；`PIPELINE_DEFAULT_TEMPLATE` 移除硬编码 `modelId`；启动迁移清理内置模板中失效 `modelId`。注：`pipeline-runner` 阶段执行目前仍为模拟，真实模型调用属后续 WBS。
- 验证：`pnpm check` **46 套件 / 252 断言全绿**；`pipeline-api.test.ts` 12/12；服务重启于 `3210`。

## 已实施 WBS 工作包（Sprint 4 —— 编排层与执行层均交付）

- [x] **WBS-02-01-01**：流水线模板数据模型与 DDL（`pipelines` 与 `pipeline_stages` 表）
- [x] **WBS-02-01-02** / **03**：模板列表大屏与步骤双向插入定制工作台（`config-pipelines.html`、`run-pipeline-create.html`）
- [x] **WBS-02-02-01**：多阶段泳道顺序执行状态机 + **阶段真实 Agent 唤醒**（`runPipelineStage` → `TurnLoop`）
- [x] **WBS-02-02-02**：父子工作区写锁租约让渡（`LockDelegator` 已接线 + 单测）
- [x] **WBS-02-03-01** / **02** / **03**：工件捕获、**上游上下文注入**、**只读守护**、Gatekeeper 审批门
- [x] **WBS-02-04-01** / **02**：任务列表大屏、独立执行工作台、**人机实时干预**

## 测试基线（实测）

- `pnpm check`（lint + typecheck + test）：**22 个套件 / 282 个断言 100% 全绿**（含 TC-01-12 清新明亮文字对比度覆盖门禁、proxy-config 安全边界 6 断言）；`/api/health` 上报版本 **`0.2.0`**。
- **真实模型端到端验收已通过（两个 Provider）**（2026-10-02）：`deepseek-v4-pro` 与 **`glm-5.3`（密钥更新后）** 均跑通三阶段建站流水线；`glm-5.3` 另完成**打回重做闭环**（拒批→意见回传→返工 v2→放行，gateRecords=2）。
- **审批裁决实时留痕**：`onGateResolved` 即时写 `human`/`gate` 活动日志，工作台可实时回放放行/打回。
- **模型连通性测试**：`glm-5.3` ✓ 连通（13.7s）；`deepseek-flash`/`deepseek-v4-pro` ✓。
- **新增「模型连通性测试」**：`POST /api/providers/test` + `config-providers.html` 双入口。实测：deepseek-flash/v4-pro ✓、glm-5.3 ✓、glm-5.2 ✓（但 123s 极慢）、glm-5 / glm-5.1 ✗（上游 503 通道不可用）。
- **遗留（需用户处理）**：`glm-5` / `glm-5.1` 上游通道 503；`glm-5.2` 响应异常缓慢（均属 Provider 侧，非本系统缺陷）。
- 服务状态：端口 `3210` 正常监听（PID 见 `~/.pg_harness/logs`）。
- **全站布局族与导航一致性审计（2026-09-28）**：
  - **布局族**：12 个页面分为两类 —— ①「顶栏型」(body 首个子元素为 `header`) 共 8 个，必须 `flex-direction: column`；②「原型型」(body 首个子元素为 `.activity-bar`) 共 4 个，保持横向 flex。`shared.css` 已通过 `body:has(> header)` + `body.app-shell` 双保险适配，**修复配置类页面左侧大块空白**；
  - **导航一致性**：12 个页面 Activity Bar 顺序已完全统一（`对话 → 流水线 → 工作区 → 记忆 → 模型 → 流水线模板 → MCP → Skills` → 底部齿轮），零死链；
  - 审计脚本已落地为可复跑的检查流程，后续新增页面必须先过「布局族 + 导航一致性」两道审计。
- **页面重建铁律（2026-09-28 起强制）**：
  1. 页面结构以 `docs/阶段-1-需求/prototype/<page>.html` **为唯一源**：先复制原型，再做最小必要注入（动态数据 id / 事件绑定），**禁止手写近似版**；
  2. `apps/server/client/css/shared.css` 已用 `prototype/css/shared.css` **完整覆盖**，杜绝两套样式漂移；
  3. 原型中指向未实现页面的链接必须替换或移除，禁止留下 404 死链。
- **run-pipeline.html 已按上述铁律重建（2026-09-28）**：原型结构 1:1，仅注入四张指标卡动态 id、快速过滤事件、动态 tbody 与数据脚本；页面上方空白已彻底消除。
- **权威文档查阅纪律（2026-09-28 起强制）**：改任何页面前先读 `docs/README.md` 定位文档 → 读 `功能模块需求规格说明书.md` 对应 F 条目 → 读 `界面与交互原型.md` 对应小节 → 逐行对照 `prototype/*.html` 再动手，禁止凭印象开发。
- **run-pipeline.html 按需求原型重建（2026-09-28）**：四张统计卡（原型文案）、大表格 7 列表头（当前阶段与进度 / 当前 Agent 角色）、快速过滤（全部/执行中/待审批）、每行必含【编辑配置】+【进入工作台】、待审批行紫色高亮与【审查并批准】、启动新任务模态向导（含明确用户指令校验）。
- **记忆管理中心三大缺陷修复（2026-09-28）**：
  1. 改用 `addEventListener` 传参，彻底消灭内联 `onclick` 吞掉 Windows 路径反斜杠的 bug；
  2. 补齐四种存储模式（SQLite / Markdown / 双轨 Hybrid / Disabled）选择与专属参数配置、独立修改参数弹窗；
  3. 后端持久化工作区存储模式（`workspace.memoryConfigs`），迁移后动态切换为对应适配器并在主界面如实渲染。
- **Sprint 4 深度补完与闭环重构（2026-09-28）**：
  1. 增加任务规格草稿设计与保存功能（先设计保存规格，再确认启动）；
  2. 落地 `run-pipeline-detail.html` 全屏 IDE 监控工作台，实时追踪各角色活动/思考/工具调用，并支持底部人机干预下发指令；
  3. 启动前强制校验明确用户指令（空指令 HTTP 400 严格阻断）；
  4. 补全停止（Abort）与删除（Delete）后端与前端操作全闭环；
  5. 落地 `config-pipeline-detail.html` 阶段角色、提示词与工件契约深度设计台。

## 下一步

- [x] 用户确认后执行 Git 提交并打标签 `v0.2.0`（commit `8cf491d`，25 文件变更 / +2171 / -23）。
- [ ] 按照敏捷规划正式开工 **Epic 3 / Sprint 5 (v0.3.0-sprint.5)**：BPMN 2.0 双折叠设计器与流转模型。
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
