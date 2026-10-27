# 主会话 Prompt 输入建议（命令/Skills 自动补全）设计 + 实施计划合并

> 与《首次启动欢迎向导 v2》同一开发批次交付（用户指定合并排期）。
- 日期：2026-10-24
- 状态：待用户审阅
- 参考：DSH `ui-input-trigger`（触发字符 + TokenSpan + 菜单候选 + 三路径 pick）；opencode TUI slash command 惯例

## 1. 需求

主会话输入框目前无任何输入建议：用户必须精确记住 `/skill <名称>` 语法（`parseExplicitSkillInvocation` 限定 `^/skill\s+`），也看不到可用的 MCP 工具。参考 DSH 的触发字符机制，做**输入时实时建议菜单**。

## 2. 功能定义（三种触发建议）

| 触发 | 语义 | 候选来源 | 选中后行为 |
| --- | --- | --- | --- |
| `/`（行首） | 斜杠命令 | `/skill`（内置）+ 动态 `/skill <每个已启用 Skill 名>` 子候选 | 补全文本到输入框（`/skill 名字 `），焦点回输入框 |
| `@`（任意位置） | 引用文件/目录 | 当前工作区文件树（`SearchTools.glob` 复用，上限 50，前缀匹配） | 插入 `@相对路径 `（作为上下文引用文本传给模型） |
| `#`（行首） | MCP 工具速查 | `mcpPool.getTools()`（`mcp__server__tool`） | 插入提示文本「MCP 工具需由模型在回合内调用：`mcp__server__tool`」 |

（首版范围：`/` 与 `@` 两类必做；`#` 类 MCP 若工作量超一小时则列入后续迭代——见任务拆分。）

## 3. 交互设计（对齐 DSH 三路径 pick）

- **菜单渲染**：输入框正下方浮动面板（absolute，同宽），最多显示 8 条；每条 = 图标 + 名称 + 描述；↑↓ 键导航、Enter 选中、Esc 关闭、Tab 亦可选中；继续输入即前缀过滤；
- **pick 三路径**：鼠标点击 / Enter / Tab 全部等价选中；
- **触发位置**：`/`、`#` 仅行首（trimmed draft starts with，DSH `leading` 语义）；`@` 行内任意位置（取光标前最近的 `@` 到光标为过滤词）；
- **状态清理**：失焦、输入框清空、选中完成、Esc 均关闭菜单；菜单打开时 Enter 不发送消息（与现有 Enter 发送逻辑互斥）。

## 4. 数据来源（零新后端端点）

- Skills 清单：复用现有 `loadSkillsToComposer()` 已拉的 `/api/skills?workspace=` 结果（内存缓存 `enabledSkills`）；
- 文件列表：`@` 触发时调既有 `POST /api/glob`（若无则复用 SearchTools 已暴露的既有端点——实施时确认；兜底用 `/api/sessions` 无关，新建轻量 `GET /api/workspace/files?prefix=` 需评估，**优先复用现有 glob 端点**）；
- MCP 工具：`GET /api/mcp/tools`（既有 6.5 节端点已返回 getTools()）。

## 5. 实施计划（与向导 v2 同批次，任务级拆分）

### Task W-1: 斜杠命令建议（/ → /skill + 动态子候选）
- **Files**: `run-chat.html`（composer 区 DOM + JS）、`apps/server/tests/wizard-v2.test.ts` 或新建 `composer-suggest.test.ts`
- TDD：结构断言（建议容器 `#composer-suggest`、`suggestState`、`handleComposerInput` 钩子挂 textarea input 事件、`/` 行首触发、菜单 Enter 与发送互斥）
- 交互：输入 `/` 行首 → 显示「/skill · 调用技能」主候选 → 继续输入过滤 → 选中补全 `/skill `

### Task W-2: Skills 动态子候选
- **Files**: 同上
- TDD：断言候选含每个 enabledSkill 的 `/skill <name>` 项（来自既有 /api/skills 缓存）
- 选中 `/skill xxx` 后光标定位句尾空格

### Task W-3: @ 文件引用建议
- **Files**: 同上 +（如无现成端点）`apps/server/src/index.ts` 新增 `GET /api/workspace/files?prefix=&limit=50`
- TDD：断言 `@` 行内触发、文件候选渲染、选中插入 `@路径 `；端点测试（临时目录建文件、prefix 过滤、上限）
- **安全**：文件列表仅工作区内、跳过 SKIP_DIRS（复用统一清单），路径遍历拒绝

### Task W-4: 回归 + CDP 验证
- 既有键盘监听（Enter 发送）与新菜单互斥回归
- CDP：输入 `/` → 菜单出现 → Enter 选中补全 → 输入 @ → 文件候选 → Esc 关闭
- 台账更新

## 6. 明确不做（YAGNI）

- fuzzy 模糊匹配（首版前缀过滤够用）；`@` 引用文件内容的自动附件化（仅插文本引用，模型自己用工具读）；自定义命令注册框架；中文拼音过滤。
