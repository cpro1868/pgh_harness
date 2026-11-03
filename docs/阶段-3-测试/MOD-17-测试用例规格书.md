# MOD-17 需求探索与分块管理 —— 测试用例规格书

> 文档标识：`docs/阶段-3-测试/MOD-17-测试用例规格书.md`  
> 所属阶段：阶段-3-测试  
> 版本：v1.0  
> 上游文档：`docs/阶段-1-需求/MOD-17-需求探索与分块管理规格说明书.md`（AC-01~10）、`docs/阶段-2-设计/MOD-17-需求探索详细设计.md`（§9 测试设计）  
> 测试框架：`node --test`（零外部框架）；前端逻辑测试采用 DOM stub 模式（同 topbar-usage-settings.test.ts）

---

## 1. 测试总体策略

| 策略项 | 约定 |
|---|---|
| **TDD 红绿先行** | 每个工作包先写失败测试（红）再写实现（绿），红灯断言必须先于实现提交验证 |
| **拒绝路径全覆盖** | 涉及信任边界的改动，拒绝路径必须有测试断言（只测放行不算通过） |
| **不变量守护** | 「仅叶子分块挂任务」「PRD 版本严格递增」「内置模板不可删除」三项不变量各设专项用例 |
| **变异验证** | 核心守护逻辑（叶子约束、变量白名单）须做变异测试：回退实现后测试必须转红 |
| **注册要求** | 新增测试文件全部注册进 `package.json` 的 `test` 脚本 glob |

**用例优先级定义**：P0 = 阻断交付必须全绿；P1 = 核心体验；P2 = 增强验证。

---

## 2. 测试用例总表

### 2.1 requirements-store.test.ts（存储层）

| 用例 ID | 优先级 | 场景 | 步骤 | 预期结果 | 映射 AC |
|---|---|---|---|---|---|
| TS-ST-01 | P0 | 建表完整性 | 初始化 database 后检查 sqlite_master | req_sessions/req_agents/req_chunks/req_tasks/req_messages/req_suggestions/req_prds/prd_templates/prd_template_sections 共 9 张表存在 | — |
| TS-ST-02 | P0 | 会话 CRUD | create → get → updateStatus → list | 字段往返一致；list 按 updated_at DESC 排序 | AC-01 |
| TS-ST-03 | P0 | 级联删除 | 创建会话+agent+chunk+task+message+prd，删除会话 | 7 张 req_* 表中该会话数据全部为空 | — |
| TS-ST-04 | P0 | 提议状态机非法流转 | 对 proposal_state='accepted' 再执行 dismiss | 抛错拒绝，状态保持 accepted | — |
| TS-ST-05 | P1 | 分块树查询 | 构造 3 层树（root→sub→leaf），listChunksTree | 返回嵌套结构，tasks 仅挂在 leaf 上 | AC-04 |
| TS-ST-06 | P0 | 默认模板唯一性 | setDefaultPrdTemplate(tplB) 时 tplA 已是默认 | tplA.is_default=0，tplB=1；全表仅 1 个默认 | AC-07 |
| TS-ST-07 | P0 | 内置模板删除拦截 | deleteTemplate(内置模板) | 抛错拒绝，数据仍在 | AC-07 |
| TS-ST-08 | P1 | 章节事务替换 | updatePrdTemplate 带 5 个新章节 | 旧章节全部清除，新章节 sort_order 顺序正确 | AC-07 |
| TS-ST-09 | P1 | 导入非法 schema | importTemplate 缺 promptTemplate 字段 | 400 拒绝，不落库 | AC-07 |
| TS-ST-10 | P2 | PRD 版本递增 | 同一会话连续 insertPrd 3 次 | version = 1,2,3 严格递增 | AC-08 |

### 2.2 coordinator.test.ts（协调器）

| 用例 ID | 优先级 | 场景 | 步骤 | 预期结果 | 映射 AC |
|---|---|---|---|---|---|
| TS-CO-01 | P0 | 正常路由 | mock ChatFn 返回合法 JSON（primary=arch） | decision.primaryAgentId='arch'，topic 非空 | AC-03 |
| TS-CO-02 | P0 | @点名强制 | 输入含 `@产品分析师`，Coordinator 返回其他角色 | 最终 primaryAgentId 强制为 PM 角色 | AC-03 |
| TS-CO-03 | P0 | 畸形 JSON 降级 | mock ChatFn 返回非 JSON 文本 | 不抛异常，走关键词规则兜底（含「数据库」→ arch） | AC-03 |
| TS-CO-04 | P0 | 超时降级 | mock ChatFn 挂起 >3s | 3s 后中断走规则兜底 | AC-03 |
| TS-CO-05 | P0 | 禁用 Agent 不可选 | 名册中 pm is_enabled=0，路由结果指向 pm | 被 isOnlyEnabled 过滤，降级首个 enabled | AC-03 |
| TS-CO-06 | P1 | @不存在角色降级 | 输入 `@不存在的角色` | 降级路由（规则/首个 enabled），不抛错 | AC-03 |
| TS-CO-07 | P1 | 关键词全覆盖 | 输入分别含 测试/异常/安全 → qa；接口/存储/性能 → arch；其余 → pm | 三组路由各命中预期 | AC-03 |

### 2.3 engine-proposals.test.ts（研讨引擎·提议）

| 用例 ID | 优先级 | 场景 | 步骤 | 预期结果 | 映射 AC |
|---|---|---|---|---|---|
| TS-EP-01 | P0 | 合法提议解析 | 回复尾部含 ```proposal JSON 数组 | parseProposals 返回 1 个 chunk 提议，字段完整 | AC-04 |
| TS-EP-02 | P0 | 非法提议丢弃 | 提议 title 长度 >60 / priority='P9' | 该项丢弃并 warn，其余合法项保留 | — |
| TS-EP-03 | P0 | 无围栏纯文本 | 回复不含 proposal 围栏 | 返回空数组，正文照常入库 | — |
| TS-EP-04 | P0 | 采纳 chunk 提议事务 | acceptProposal(chunk 提议) | req_chunks 新增一行 status='draft'，proposal_state='accepted'，SSE 发出 chunk_created | AC-04 |
| TS-EP-05 | P0 | **父分块挂任务自动包裹（不变量）** | acceptProposal(task 提议)，目标 chunkTitle 是父分块 | 自动在其下创建同名子分块，任务挂到新叶子；assertOnlyLeafHasTasks 通过 | AC-04 |
| TS-EP-06 | P0 | **直接挂叶子正常路径** | 目标 chunkTitle 是叶子分块 | 任务直接挂载，不新建分块 | AC-04 |
| TS-EP-07 | P0 | chunkTitle 无匹配拒绝 | 目标不存在 | 返回错误，**不落库**，proposal_state 保持 pending | AC-04 |
| TS-EP-08 | P1 | parentId 环校验 | 采纳 chunk 提议 parent_id 指向自身 | 抛错拒绝 | — |
| TS-EP-09 | P1 | 忽略提议 | dismissProposal | proposal_state='dismissed'，分块树无变化 | — |
| TS-EP-10 | P1 | 刷新后提议持久 | 落库后重新 getSessionSnapshot | 提议卡片数据完整返回（messages.proposal_json） | AC-05 |

### 2.4 engine-divergence.test.ts（历史编辑差异）

| 用例 ID | 优先级 | 场景 | 步骤 | 预期结果 | 映射 AC |
|---|---|---|---|---|---|
| TS-DV-01 | P0 | 编辑后产出 notice | 编辑第 2 轮消息重新提交，其后的分块标题集与新提炼不一致 | 新增 system notice 消息，含差异描述 | AC-05 |
| TS-DV-02 | P0 | **分块树不被修改（不变量）** | 同上场景后逐字段断言 req_chunks/req_tasks | 所有行与编辑前完全一致（updated_at 亦不变） | — |
| TS-DV-03 | P1 | 无差异不提示 | 编辑后重放结果与现有一致 | 不追加 notice | — |
| TS-DV-04 | P2 | 新增候选提示 | 重放含新分块标题 | notice 内容含「新增候选分块 X」 | — |

### 2.5 diagnostics.test.ts（诊断器）

| 用例 ID | 优先级 | 场景 | 步骤 | 预期结果 | 映射 AC |
|---|---|---|---|---|---|
| TS-DG-01 | P0 | 覆盖度零命中 | 全量文本无「性能/并发/安全」 | 产出 coverage 建议，source_reason 含「出现 0 次」 | AC-05 |
| TS-DG-02 | P0 | 冲突对命中 | 文本含「零外部依赖」+「高性能」 | 产出 conflict 建议，排序第一（conflict > 其他） | AC-05 |
| TS-DG-03 | P0 | draft 催办 | 某 draft 分块 discussionRounds=2 | 产出 status 建议 | AC-05 |
| TS-DG-04 | P0 | 就绪度推荐 | approved 占比 80%+ 且任务>0 且无 pending | 产出 readiness 建议 | AC-05 |
| TS-DG-05 | P1 | dismissed 保留 | 重算时某建议内容 hash 与已忽略项一致 | is_dismissed 状态延续 | AC-05 |
| TS-DG-06 | P1 | 上限与排序 | 构造 >8 条建议 | 仅保留 8 条，按 conflict>coverage>status>readiness 排序 | — |

### 2.6 prd-template-store.test.ts（模板存储）

| 用例 ID | 优先级 | 场景 | 步骤 | 预期结果 | 映射 AC |
|---|---|---|---|---|---|
| TS-TP-01 | P0 | 种子模板存在 | 全新库初始化 | 「完整 PRD 标准模板」is_builtin=1 is_default=1，12 章节 | AC-07 |
| TS-TP-02 | P0 | 模板 CRUD | 创建→读→更新→删除（非内置） | 往返一致 | AC-07 |
| TS-TP-03 | P0 | 默认唯一事务 | 并发设默认两次 | 最终仍仅 1 个默认 | AC-07 |
| TS-TP-04 | P0 | 内置删除拒绝 | deleteTemplate(builtin) | 抛错 | AC-07 |
| TS-TP-05 | P1 | 导入导出往返 | export → 修改 name → import | 新模板章节内容一致 | AC-07 |

### 2.7 template-renderer.test.ts（变量渲染）

| 用例 ID | 优先级 | 场景 | 步骤 | 预期结果 | 映射 AC |
|---|---|---|---|---|---|
| TS-TR-01 | P0 | 6 变量注入 | promptTemplate 含全部 6 个系统变量 | 每个替换值均包裹 `<data name="...">` | AC-08 |
| TS-TR-02 | P0 | **伪造闭合转义** | 注入内容含 `</data>` 字符串 | 被转义为 `\u003c/data\u003e`，边界不被破坏 | — |
| TS-TR-03 | P0 | 未知变量警告 | promptTemplate 含 `{{user.custom}}` | 渲染为「⚠️ 未知变量」，不静默替换 | — |
| TS-TR-04 | P1 | 上下文按勾选组装 | section.contextSources=['chunks'] | 仅拼入分块树数据段 | AC-08 |
| TS-TR-05 | P1 | dry-run 预览 | preview 渲染指定会话 | 返回完整组装后 prompt 文本 | AC-07 |

### 2.8 prd-engine.test.ts（生成引擎）

| 用例 ID | 优先级 | 场景 | 步骤 | 预期结果 | 映射 AC |
|---|---|---|---|---|---|
| TS-PE-01 | P0 | 逐章全成功 | mock ChatFn 每章返回内容 | 全部 done，拼接 Markdown 含全部章节标题，version=1 | AC-08 |
| TS-PE-02 | P0 | **单章失败不阻塞** | 第 3 章 mock 抛错 | 其余章节正常，error 章节占位文本，version 落盘 | AC-08 |
| TS-PE-03 | P0 | 单章重试 | retry 第 3 章 | 仅该章更新，version 递增，其他章内容不变（逐字段断言） | AC-08 |
| TS-PE-04 | P0 | 手动编辑回写 | edit 章节 | status='manually_edited'，version 递增，内容更新 | AC-10 |
| TS-PE-05 | P0 | **快速模式分块>5 拒绝** | mode='fast' 且分块 6 个 | 400 拒绝，不调用 LLM | AC-09 |
| TS-PE-06 | P0 | **无分块拒绝** | 会话无任何 chunk | 拒绝并返回「请先完成至少一轮需求分块」 | AC-08 |
| TS-PE-07 | P1 | minWords 扩写重试 | 某章返回 < minWords | 自动追加一次扩写调用 | AC-08 |
| TS-PE-08 | P1 | draft 分块只进附录 | 分块含 draft 与 approved | 正文仅 approved，draft 进「待定项」附录 | — |
| TS-PE-09 | P2 | 事件序列 | 收集 SSE 事件 | 顺序为 n×(section_start→section_done/error) → prd_done | AC-08 |

### 2.9 requirements-api.test.ts（API 集成）

| 用例 ID | 优先级 | 场景 | 步骤 | 预期结果 | 映射 AC |
|---|---|---|---|---|---|
| TS-AP-01 | P0 | 未带 token 全路由 401 | 对 15 个端点无凭据请求 | 全部 401 | — |
| TS-AP-02 | P0 | transition 拒绝 | 任务所在分块非 approved | 400，会话状态不变 | AC-06 |
| TS-AP-03 | P0 | transition 正常 | 全部 approved | 返回 pipelineInstanceId，会话状态='transitioned' | AC-06 |
| TS-AP-04 | P0 | SSE 资源清理 | 建立流后客户端断开 | 3s 内 abort 回合，无泄漏监听器（同 TC-00-99-003 模式） | — |
| TS-AP-05 | P1 | 列表统计口径 | 建 3 会话不同状态 | stats{total:3,discussing:1,prdReady:1,draft:1} | AC-01 |
| TS-AP-06 | P1 | 快速模式服务端二次校验 | 分块>5 请求 fast | 400 | AC-09 |
| TS-AP-07 | P1 | 任务 CRUD 叶子校验 | POST task 指向父分块 | 400 拒绝（服务端独立于引擎层校验） | AC-04 |

### 2.10 requirements-ui.test.ts（前端逻辑 · DOM stub）

| 用例 ID | 优先级 | 场景 | 步骤 | 预期结果 | 映射 AC |
|---|---|---|---|---|---|
| TS-UI-01 | P0 | XSS 转义 | 模型输出含 `<script>alert(1)</script>` | escapeHtml 后以文本呈现 | — |
| TS-UI-02 | P0 | 搜索过滤 | 输入关键字 + 状态 Tab 组合 | visibleCount 正确；空结果显示 empty-state | AC-01 |
| TS-UI-03 | P0 | Tab 切换 | switchTab('next') | panel-next 显示、panel-chunks 隐藏，两面板均 overflow-y-auto | AC-02 |
| TS-UI-04 | P1 | 建议一键填入 | 点击建议卡片 | 输入框值=suggestion.content 并触发 send | AC-05 |
| TS-UI-05 | P1 | 提议卡片增量插入 | 收到 chunk_created 事件 | 树增量插入，localStorage 折叠态保持 | AC-04 |
| TS-UI-06 | P1 | 变量插入光标定位 | textarea 光标在中间点变量按钮 | {{var}} 插入 selectionStart 处 | AC-07 |
| TS-UI-07 | P1 | 拖拽排序重编号 | drop 后 | 序号文本重排为 01,02,03… | AC-07 |
| TS-UI-08 | P2 | 人工编辑确认弹窗 | 对 manually_edited 章节点重生成 | 先弹确认，取消则不调用 | AC-10 |

---

## 3. 覆盖率与门禁

| 门禁项 | 标准 |
|---|---|
| 用例总数 | ≥ 60 条（上表 62 条） |
| P0 通过率 | 100%（38 条 P0 全绿方可交付） |
| 拒绝路径 | TS-ST-04/07/09、TS-EP-07/08、TS-TR-03、TS-PE-05/06、TS-AP-01/02/06/07 共 11 条，缺一不可 |
| 不变量守护 | TS-EP-05（叶子挂载）、TS-DV-02（树不篡改）、TS-ST-10/PE-03（版本递增）+ 变异验证 |
| 全量回归 | `pnpm test` 既有 46 套件全绿 + 新增 10 套件全绿 |

---

## 4. 必测端到端场景（人工验收，对应原型）

| # | 场景 | 操作路径 | 预期 |
|---|---|---|---|
| E2E-01 | 一句话开聊到首分块 | 列表页输入想法 → 工作台讨论 → 采纳提议 | 右树出现 draft 分块，刷新不丢 |
| E2E-02 | 完整探索闭环 | 讨论 → 分块 approved → 生成 PRD（逐章）→ 导出 | PRD 含全部章节，深度对齐参考模板 |
| E2E-03 | 模板定制闭环 | 模板库新建模板 → 调整章节/提示词 → 工作台用新模板生成 | 产物结构符合新模板 |
| E2E-04 | 断线恢复 | 讨论中刷新页面 | 快照恢复 + SSE 重连，提议/分块无丢失 |
| E2E-05 | 历史编辑 | 编辑旧消息 | 分块树不动，notice 出现 |
