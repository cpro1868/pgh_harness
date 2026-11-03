# MOD-17 需求探索与分块管理 —— 开发计划 (WBS)

> 文档标识：`docs/阶段-3-测试/MOD-17-开发计划.md`  
> 所属阶段：阶段-3-测试/实施计划  
> 版本：v1.0  
> 上游文档：`docs/阶段-2-设计/MOD-17-需求探索详细设计.md`（§10 实施顺序）、`docs/阶段-3-测试/MOD-17-测试用例规格书.md`  
> 流程铁律：TDD 红绿先行；每包交付必须 `pnpm check` 全绿；小步提交

---

## 1. WBS 工作包总览

| WBS | 工作包 | 前置依赖 | 关联测试套件 | 规模 | 验收锚点 |
|---|---|---|---|---|---|
| WP-01 | 数据类型与存储层 | 无 | requirements-store / prd-template-store | 中 | TS-ST-*, TS-TP-* |
| WP-02 | Coordinator 协调器 | WP-01 | coordinator | 中 | TS-CO-* |
| WP-03 | 研讨引擎（提议/采纳/差异） | WP-01, WP-02 | engine-proposals / engine-divergence | 大 | TS-EP-*, TS-DV-* |
| WP-04 | 诊断器 | WP-01 | diagnostics | 中 | TS-DG-* |
| WP-05 | 模板渲染器 + PRD 引擎 | WP-01 | template-renderer / prd-engine | 大 | TS-TR-*, TS-PE-* |
| WP-06 | 服务端路由 + SSE 网关 | WP-01~05 | requirements-api | 大 | TS-AP-* |
| WP-07 | 前端工作台接入 | WP-06 | requirements-ui | 大 | TS-UI-* + E2E-01/02/04/05 |
| WP-08 | 模板管理页前端 | WP-06 | requirements-ui（模板部分） | 中 | TS-UI-06/07/08 + E2E-03 |
| WP-09 | 全站导航注入 + 收尾自检 | WP-07, WP-08 | 全量回归 | 小 | pnpm check + self-check + E2E 全通过 |

---

## 2. 工作包详细任务卡

### WP-01 数据类型与存储层（预计 1.5 天）
- [ ] T1 `packages/core/src/requirements/types.ts`：全部 TS 类型（SessionStatus/ChunkNode/DetectedProposal/PrdTemplate/SystemVariable 白名单等，详设 §2）
- [ ] T2 `database.ts`：9 张表 DDL + 索引 + 内置模板种子写入（表空时）
- [ ] T3 `requirements-store.ts`：详设 §1.2 方法集全集（事务包裹）
- [ ] T4 先写 TS-ST-01~10、TS-TP-01~05 测试（红）→ 实现转绿
- **交付物**：存储层可用；不变量用例（默认唯一/内置不可删/级联删除）全绿

### WP-02 Coordinator 协调器（预计 1 天）
- [ ] T1 coordinator.ts：LLM 路由（temperature=0, JSON 输出）+ 3s 超时 + 关键词降级 + @点名强制 + enabled 过滤
- [ ] T2 系统提示词常量（含 `<chunks>`/`<agents>` 边界标注）
- [ ] T3 先写 TS-CO-01~07（红）→ 实现（绿）
- **交付物**：可路由决策对象；畸形输入零异常

### WP-03 研讨引擎（预计 2 天）
- [ ] T1 parseProposals：围栏解析 + schema 校验（长度/枚举）+ 非法丢弃
- [ ] T2 runTurn 主流程：消息落库 → 路由 → 组装 prompt（边界标注）→ 流式回调 → 提议落库 → 诊断触发
- [ ] T3 acceptProposal 事务：chunk 直建 / task 叶子定位（父分块自动包裹）/ 无匹配拒绝
- [ ] T4 assertOnlyLeafHasTasks 守护函数（实现与测试共用）
- [ ] T5 detectEditDivergence：标题集对比 + notice 追加 + 树零修改
- [ ] T6 先写 TS-EP-01~10、TS-DV-01~04（红）→ 实现（绿）→ **变异验证 TS-EP-05**（去掉包裹逻辑测试须红）
- **交付物**：完整研讨回合闭环

### WP-04 诊断器（预计 0.5 天）
- [ ] T1 diagnostics.ts：四维检查器（coverage/conflict/status/readiness）+ 排序 + 8 条上限 + dismissed hash 保留
- [ ] T2 先写 TS-DG-01~06（红）→ 实现（绿）
- **交付物**：建议全量替换策略可用

### WP-05 模板渲染器 + PRD 引擎（预计 2 天）
- [ ] T1 template-renderer.ts：白名单解析 + `<data>` 包裹 + 伪造闭合转义 + 未知变量警告 + 章节上下文组装
- [ ] T2 prd-engine.ts：逐章编排 / 单章重试 / 手动编辑 / 快速模式校验 / minWords 扩写 / draft 附录 / 版本递增
- [ ] T3 先写 TS-TR-01~05、TS-PE-01~09（红）→ 实现（绿）→ **变异验证 TS-TR-02**（去掉转义测试须红）
- **交付物**：PRD 全生命周期（生成/重试/编辑/版本）可用

### WP-06 服务端路由 + SSE（预计 1.5 天）
- [ ] T1 15+11 条路由挂接（详设 §7），全部走既有 token 门禁
- [ ] T2 SSE 通道：StreamEvent/PrdStreamEvent 推送 + res.close 清理（复用 TC-00-99-003 模式）
- [ ] T3 transition 二次校验（approved 门禁）+ SSE 断连清理
- [ ] T4 先写 TS-AP-01~07（红）→ 实现（绿）
- **交付物**：API 全量可用；安全门禁全过

### WP-07 前端工作台接入（预计 2 天）
- [ ] T1 requirements.js：api/state/renderList/renderWorkbench/sse/actions/escapeHtml 模块（详设 §8.2）
- [ ] T2 列表页接真实 API（指标/搜索/过滤/新建弹窗）
- [ ] T3 工作台三栏接真实数据（流式气泡/提议卡片/分块树增量/建议面板/PRD 三步弹层）
- [ ] T4 先写 TS-UI-01~05（红）→ 实现（绿）
- **交付物**：E2E-01/02/04/05 手工通过

### WP-08 模板管理页前端（预计 1 天）
- [ ] T1 config-prd-templates.html + prd-templates.js（详设 §8.2.1）
- [ ] T2 拖拽排序持久化 / 变量插入 / dry-run 预览弹窗 / 导入导出
- [ ] T3 先写 TS-UI-06~08（红）→ 实现（绿）
- **交付物**：E2E-03 手工通过

### WP-09 收尾（预计 0.5 天）
- [ ] T1 全站 activity-bar 注入 PRD 模板库图标
- [ ] T2 `pnpm check`（lint 零警告 + typecheck 严格 + 全量测试绿）
- [ ] T3 `node scripts/self-check.ts` 6/6
- [ ] T4 `git status --short` 无敏感文件；更新工作进展记录与 SESSION.md
- **交付物**：MOD-17 整体验收结项

---

## 3. 里程碑与时间线

```
Week 1
  D1~D2   WP-01 存储层（TDD）
  D3      WP-02 Coordinator
  D4~D5   WP-03 研讨引擎 + 变异验证
Week 2
  D1      WP-04 诊断器 + WP-05 起步
  D2~D3   WP-05 模板渲染器 + PRD 引擎 + 变异验证
  D4~D5   WP-06 服务端路由 + SSE
Week 3
  D1~D2   WP-07 前端工作台
  D3      WP-08 模板管理页
  D4      WP-09 收尾 + E2E 人工验收 + 结项
```

**总计预估：11 个工作日**（含 TDD 红绿往返与变异验证）。

---

## 4. 风险与应对

| # | 风险 | 概率 | 应对 |
|---|---|---|---|
| RK-1 | Coordinator LLM 输出 JSON 不稳定 | 中 | 已设计三级降级（超时/解析失败/禁用过滤）；temperature=0 + few-shot 约束 |
| RK-2 | 逐章生成耗时较长影响体验 | 中 | 快速模式兜底 + SSE 章节级进度 + 后台运行按钮 |
| RK-3 | 提议 JSON 注入异常数据 | 低 | schema 白名单校验 + 非法静默丢弃（TS-EP-02） |
| RK-4 | 前端原生 JS 状态管理复杂度 | 中 | 单文件分段模块化 + 局部渲染（增量事件），避免整树重绘 |
| RK-5 | 与既有测试回归冲突 | 低 | 新代码独立目录（core/requirements），不改既有模块公共接口 |

---

## 5. 交付定义 (Definition of Done)

1. 62 条测试用例全绿（P0 38 条零豁免）；
2. 3 项不变量 + 2 项变异验证通过；
3. AC-01~AC-10 全部有自动化或 E2E 覆盖；
4. `pnpm check` + `self-check` 全绿；
5. 5 个 E2E 场景人工验收通过；
6. 文档（进展记录/SESSION.md）同步更新，依赖变更（如有）登记。
