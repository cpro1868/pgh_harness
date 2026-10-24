# 工作区体检与画像（Workspace Profile）设计

- 日期：2026-10-24
- 状态：已确认（用户批准）
- 关联：TC-01-05（撤销快照范围失控事件）后续改进；`workspace-profile.ts` 新模块

## 1. 背景与动机

真机取证发现两类系统性问题：

1. **插件缓存拖垮关键路径**：Kalar 工作区（OneDrive 同步盘）3676 文件/190MB 中 95% 是 `.smart-env`/`.obsidian` 等工具缓存，导致撤销检查点同步读全工作区（1.9s，已在 `aee17a5` 修复快照侧）；且 Agent 对"哪些目录能碰"毫无认知，全靠自行试探。
2. **外来工具遗留物无识别**：该工作区顶层散落 `.claude`/`.codewhale`/`.kode`/`.claudian`/`.aider.*`/`.aionrs`/`copilot/` 等至少 8 种其他 Agent 工具的痕迹，以及 `temp/`、`Chats/` 等性质模糊目录。Agent 无法区分"用户真实内容"与"别人家的工具产物"，存在误读、误改、误判工作区规模的风险。
3. **项目类型盲区**：Kalar 是 markdown 小说世界观知识库，Agent 却可能按代码工程假设行事（建 package.json、跑构建）；反之代码工程也可能被当文档处理。

**目标**：任何工作区，Harness 在 Agent 工作前先自动"体检"出一份画像——搞清楚这是什么类型的项目、哪些目录能碰、哪些是工具缓存、哪些是外来工具遗留物——并让画像对 Agent（提示词）与用户（文件）双向可见。纯本地确定性分析，零模型调用。

## 2. 需求（用户确认口径）

- **R1 项目类型识别**：规则自动分类 `empty / code / docs-kb / mixed`，判定依据透明写入画像；不调模型。
- **R2 目录四类归类**：`core`（工作内容）/ `tool-cache`（工具缓存，屏蔽）/ `foreign-agent`（外来 Agent 工具痕迹，屏蔽+告知）/ `unclassified`（默认按 core，画像中标注请确认）。
- **R3 外来痕迹策略**：屏蔽不处理 + 画像列名告知，**绝不自动删除或修改**。
- **R4 用户改判（override）**：画像文件内置可编辑 override 区（`目录名 => 类别`），重新分析时优先生效；语法错误行忽略并提示，不炸。
- **R5 统一屏蔽清单**：单一来源 `WORKSPACE_SKIP_DIRS`，GitRollbackManager / SearchTools / 画像模块三处共享（消除现有两处定义不一致）。
- **R6 双产物**：系统提示词注入精简画像块 + 落盘 `.harness/workspace-profile.md`（完整报告 + override 模板）；签名复用（未变不重算不重写）。
- **R7 行为随类型调整**：`docs-kb` 型提示词附加"以 markdown 内容工作为主，勿引入代码工程假设"；`code` 型行为不变。
- **R8 失败降级**：画像分析任何异常不阻塞回合，降级为提示词一句"画像不可用"。

## 3. 架构设计

### 3.1 新模块 `packages/core/src/workspace-profile.ts`

```
WORKSPACE_SKIP_DIRS        — 统一屏蔽清单（单一事实来源）
FOREIGN_AGENT_MARKERS      — 外来工具标志物清单
detectProjectType(ws)      — 规则分类，返回 { type, evidence }
analyzeWorkspace(ws)       — 三段式体检，返回 WorkspaceProfile 对象
renderProfileMarkdown(p)   — 画像文件内容渲染（含 override 模板）
parseOverrides(md)         — 从画像文件读用户改判（容错）
loadOrAnalyze(ws)          — 签名复用入口（回合热路径调用）
toPromptFragment(p)        — 提示词精简块渲染
```

### 3.2 屏蔽与外来清单（初始值）

- `WORKSPACE_SKIP_DIRS`：`.git, node_modules, dist, build, .next, coverage, .obsidian, .smart-env, .smart-composer, .aionrs, .trash, .harness`（`.harness` 是我们自己的画像目录，自屏蔽）。
- `FOREIGN_AGENT_MARKERS`：目录 `.claude, .codex, .cursor, .codewhale, .kode, .claudian, .windsurf, .gemini, .continue, .aider*` + 文件 `CLAUDE.md, .cursorrules, .windsurfrules, .aider.chat.history.md, CONVENTIONS.md`（可后续扩充）。

### 3.3 判定规则（确定性）

- **类型**：空目录 → `empty`；检出工程清单文件（package.json / Cargo.toml / go.mod / pyproject.toml / *.csproj 等）或代码扩展名占比 >30% → `code`；非代码且 md/txt 占比 >70% → `docs-kb`；其余 → `mixed`。证据（各占比）写入画像。
- **归类优先级**：override > `WORKSPACE_SKIP_DIRS`（tool-cache）> `FOREIGN_AGENT_MARKERS`（foreign-agent）> 其余 unclassified→core（附提示）。
- **同步盘检测**：路径含 `OneDrive`/`iCloud`/`Dropbox` 等或属性探测，命中则画像附加"云同步盘，大目录读取缓慢，避免全量遍历"警告。
- **规模事实**：只统计 core 类目录的文件数/字节（防止 Agent 误判规模）。

### 3.4 签名复用

签名 = 顶层目录名列表 + 各目录内文件数（快速统计，不读内容）。签名与画像文件头部记录一致 → 直接复用缓存画像（解析已有文件取结论 + override），不重算不重写；不一致 → 重算并重写（保留用户 override 区原文）。

### 3.5 集成点

- `apps/server/src/index.ts` chat/send pre-SSE：`loadOrAnalyze(ws)` → `toPromptFragment` 拼入 systemPrompt（失败 catch 降级一句"画像不可用"）。
- `packages/core/src/git-rollback.ts` / `packages/plugins/tools-coding/src/search-tools.ts`：SKIP_DIRS 改引统一清单。
- `read_file` 屏蔽：FileTools 拒绝读取 tool-cache/foreign-agent 类目录内文件（错误信息注明"该目录属于工具缓存/外来工具痕迹，已被工作区画像屏蔽"）。

## 4. 画像文件格式（`.harness/workspace-profile.md`）

````markdown
# Workspace Profile
> 由 PG Harness 自动生成；`override` 区之外的内容请勿手工编辑。
signature: <sig>

## 项目类型
- type: docs-kb
- evidence: md/txt 占比 87%，未检出工程清单文件

## 目录归类
| 目录 | 类别 | 说明 |
| --- | --- | --- |
| raw/ | core | 工作内容（94 files, 1.8 MB） |
| .obsidian/ | tool-cache | 工具缓存（已屏蔽） |
| .claude/ | foreign-agent | 外来 Agent 工具痕迹（已屏蔽） |
| copilot/ | unclassified | 未分类，默认按 core 处理，请确认 |

## 外来工具痕迹
- .claude, .codewhale, .kode, .claudian, copilot/（已屏蔽，绝不自动删除）

## 用户改判（override）
> 语法：`目录名 => 类别`（类别：core / tool-cache / foreign-agent）；每行一条；错误行将被忽略。
<!-- override-begin -->
<!-- override-end -->
````

## 5. 提示词块（精简版，目标 <500B）

```
[Workspace Profile]
- 项目类型: docs-kb（依据: md/txt 占比 87%）
- 规模: 650 files / 8.8 MB（仅工作内容，缓存目录除外）
- 已屏蔽目录（glob/grep 不返回，禁止读取）: .obsidian .smart-env .claude ...
- 外来 Agent 工具痕迹（已屏蔽，不要处理）: .claude .codewhale copilot/
- 云同步盘警告: 该工作区位于 OneDrive，避免全量遍历
- 工作类型指引: 以 markdown 内容工作为主，勿引入代码工程假设
```

## 6. 错误处理与安全

- 任何画像步骤异常 → 降级"画像不可用"，**绝不阻塞回合**；
- 画像文件损坏/签名错 → 视为未命中缓存重算；
- override 只改变类别标签，**永不触发删除/移动任何文件**（R3 红线）；
- `.harness/` 自屏蔽：不入快照、不入 grep、不被 Agent 写。
- 画像分析只读工作区顶层与一层子目录统计（不深递归内容），控制在 <100ms。

## 7. 测试计划

- **单测**（`packages/core/tests/workspace-profile.test.ts`）：
  - 类型判定矩阵（empty/code/docs-kb/mixed 各构造目录，证据正确）；
  - 四类归类 + override 生效 + override 语法错误容错；
  - 签名复用（同签名不重写文件）与失效重算；
  - 外来清单命中（.claude/.cursorrules 等）；OneDrive 检测；异常降级。
- **一致性测试**：git-rollback / search-tools / profile 引用同一 `WORKSPACE_SKIP_DIRS`。
- **集成回归**：chat-loop systemPrompt 含 `[Workspace Profile]`；FileTools 拒读屏蔽目录。
- **性能**：Kalar 规模模拟目录分析 <100ms。
