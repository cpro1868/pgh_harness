# Git 提交与分支协作规范

> 归属规范：项目版本控制与敏捷工程协作规范  
> 前置铁律：**禁止使用 Subagent 自主派发；严禁将未完成测试的代码推入仓库**

---

## 1. 分支管理策略 (Branch Strategy)

- **主开发主干分支**：`dev`（团队集成与日常开发主干）；
- **生产发布分支**：`main`（仅承载经全量验收测试通过的正式 Release 版本）；
- **敏捷迭代分支 (Sprint Branches)**：
  - 命名规范：小写短横线分隔，最多 3 个单词，严禁带 `feat/` 等斜杠前缀；
  - 示例：`sprint1-core-base`、`revert-turn-checkpoint`、`bpmn-canvas-designer`。

---

## 2. 提交信息规范 (Conventional Commits)

每次提交的 Commit 消息必须严格遵循以下结构：

```
<type>(<scope>): <summary>
```

### 2.1 允许的 Type 类型
- `feat`: 新增业务功能特性（对应 WBS 工作包交付）；
- `fix`: 修复缺陷或解决测试用例失败；
- `test`: 新增或修改测试用例（TDD 测试先行提交）；
- `docs`: 文档变动（生命周期说明书、设计文档、进展记录）；
- `refactor`: 重构优化代码（在不改变外部行为的前提下，保持测试绿灯）；
- `chore`: 工程基建、脚本修改、依赖更新；
- `style`: 代码格式调整（不影响业务逻辑的空白或格式排版）。

### 2.2 规范化的 Scope 作用域
- `kernel`: 微内核与服务生命周期
- `protocol`: 同构通信协议与 DTO
- `sqlite`: 原生持久化与事件表
- `provider`: 大模型适配与流式协议
- `tools`: 本地编码工具与 Shell 驱动
- `permissions`: 权限规则与审批流水线
- `chat`: 主对话工作台与心跳
- `pipeline`: 多角色流水线与工件守护
- `workflow`: BPMN 设计器与状态机
- `scripts`: 运维脚本与自检工具

### 2.3 规范提交示例
- `test(tools): add CRLF tolerance and multi-match unit tests for edit_file`
- `feat(tools): implement atomic edit_file with line replacement fallback`
- `feat(sqlite): add single-instance lock check on server startup`
- `fix(network): handle 45s silent zombie timeout in proxy dispatcher`

---

## 3. 本地提交门禁流水线 (Pre-commit Gates)

在执行 `git commit` 之前，必须在本地通过统一质量检查：

```bash
pnpm check
```

包含：
1. **Lint 检查**：ESLint 代码规范；
2. **类型检查**：`tsc --noEmit` 严格类型断言；
3. **自动化测试**：`pnpm test`（`node:test` 全量单测与集成测试）；
4. **离线自检**：`node scripts/self-check.ts` 退出码必须为 0。

---

## 4. 安全提交红线

1. **严禁凭据入库**：绝对禁止在提交中包含真实的 `.env`、API Key、密码、私钥证书；
2. **严禁脏 Stash 残留**：单回合 Git 检查点在回合结束前必须妥善清理，不污染仓库工作区；
3. **禁止静默 Push**：Agent 执行任何任务仅生成变更供人类预览，严禁自主执行无授权推送。
