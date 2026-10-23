# 主会话工作台顶栏布局重构设计（Token 下拉 + 设置菜单 + 模型收窄）

- 日期：2026-10-23
- 状态：已确认（用户批准）
- 关联：`apps/server/client/run-chat.html` 顶栏；TC-01-08 系列

## 1. 背景与问题

主会话工作台 40px 顶栏右侧当前平铺五组控件：`保存会话`按钮、`Token + 费用 + 清零`横条、模型下拉框、`语音开/关`按钮、`导出对话`按钮。存在三个体验问题：

1. **模型下拉过宽**：option 文字为 `model-id (provider名)` 全拼，且 select 无宽度约束，长模型名 + provider 名挤占顶栏；
2. **Token 横条过宽**：Token 数、费用、清零按钮三项横排常驻，信息密度低但占宽大；
3. **低频按钮占位**：语音开关、导出对话属低频操作，平铺造成拥挤。

## 2. 目标（用户确认口径）

- 顶栏右侧收窄为四组：`[📥 保存会话] [⚡ Token ▾] [模型▾ 收窄] [⚙️ 设置▾]`；
- Token 下拉：点开显示**总量 + 费用 + 清零按钮**（用户确认仅此三项，不做逐轮明细）；非自动收起——点 summary 展开、点外部或再次点击 summary 收起；
- 设置下拉（⚙️）收纳三项：**语音播报开关**、**导出对话**、**自动保存会话开关**；
- 自动保存语义：开启后**每个回合结束（`turn/completed`）自动调用 `snapshot-full` 沉淀记忆**（依赖既有 SHA-256 去重，重复内容不重复入库）；状态持久化（刷新保留）；
- 保存会话按钮**保留在顶栏外层**（最高频操作）；
- **后端零改动**：纯前端布局重组，既有 API 与事件流全部不变。

## 3. 方案选型

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| A. 原生 `<details>/<summary>` | 零 JS 状态管理；summary 点击展开/收起、再次点击 summary 收起为原生行为；配合一次性 document click 监听实现"点外部收起"；与现有 Tailwind 风格无缝 | **采用** |
| B. JS 手动 toggle | 自由度高但需自行处理外部点击关闭、多下拉互斥、状态清理，代码量约 3 倍；项目无既存下拉模式可复用 | 弃 |

## 4. 详细设计

### 4.1 顶栏右侧 DOM 结构（改造后）

```html
<div class="flex items-center space-x-2 text-[11px]">
  <!-- 保留：保存会话（原按钮不动） -->
  <button id="topbar-snapshot-full-btn" onclick="snapshotFullSession()">📥 保存会话</button>

  <!-- Token 下拉 -->
  <details id="usage-dropdown" class="relative">
    <summary class="cursor-pointer list-none ...">⚡ <b id="session-tokens">0</b> ▾</summary>
    <div class="absolute right-0 top-full mt-1 w-[220px] ...">   <!-- 面板 -->
      总 Token: <b id="usage-detail-tokens">0</b>
      费用:     <b id="usage-detail-cost">$0.000</b>
      <button onclick="resetSessionUsage()">🔄 清零统计</button>
    </div>
  </details>

  <!-- 模型下拉（收窄） -->
  <select id="topbar-model-select" class="... max-w-[160px] truncate">
    <option title="provider 提示">短模型名</option>
  </select>

  <!-- 设置下拉 -->
  <details id="settings-dropdown" class="relative">
    <summary class="cursor-pointer list-none ...">⚙️ 设置 ▾</summary>
    <div class="absolute right-0 top-full mt-1 w-[220px] ...">
      <label>🔊 语音播报 [toggle] </label>   <!-- 调 toggleGlobalSpeech() -->
      <button>⬇️ 导出对话</button>           <!-- 调 exportSession() -->
      <label>📥 自动保存会话 [toggle]</label> <!-- 调 toggleAutoSnapshot() -->
    </div>
  </details>
</div>
```

要点：
- `summary` 必须显式 `list-none` 去除浏览器默认三角；
- 面板 `absolute right-0 top-full` 右对齐，`z-index` 高于主内容（现有顶栏无 z 上下文冲突）；
- 点击外部收起：一个 document 级 `click` 监听，若点击目标不在任一 `<details open>` 内则移除 `open` 属性（两个下拉互斥自然达成——点另一个下拉的 summary 时，先触发展开，document 监听在下一轮 tick 关闭旧者；为避免竞态，监听里排除 event target 位于任何 `<details>` 内的情况，改由各 summary 的 toggle 事件互斥关闭对方）。

### 4.2 数据流与状态

| 状态 | 来源 | 渲染目标 |
| --- | --- | --- |
| 会话累计 Token | `sumUsageFromEvents()` + `activeUsageBaseline`（不变） | `#session-tokens`（summary）+ `#usage-detail-tokens`（面板） |
| 费用 | `totalTokens * TOKEN_UNIT_PRICE_USD`（不变） | `#usage-detail-cost`（面板；summary 不再显示费用） |
| 清零 | `resetSessionUsage()`（逻辑不变，仅挪位置） | 清零后 `renderUsageBar(0)` 同时刷新 summary 与面板 |
| 语音开关 | `toggleGlobalSpeech()`（逻辑不变） | `#speech-icon` / `#speech-text` 移入面板 |
| 自动保存 | **新增** `toggleAutoSnapshot()` | 面板 checkbox 状态 + 顶栏 📥 按钮圆点指示 |

`renderUsageBar(tokens)` 改造：签名不变，内部同时写 summary 与面板两个目标（面板 id 不存在时静默跳过，保证测试环境下无面板也能跑）。

### 4.3 自动保存会话

- **存储键**：`localStorage['pgh_autosnapshot_enabled']`（`'1'` 开 / `'0'` 关），默认关；页面加载时读入并同步 checkbox 与按钮圆点；
- **触发**：SSE 事件处理中现有 `turn/completed` 分支末尾追加：若开关开启且 `activeSessionId` 存在 → `void snapshotFullSession()`（静默模式，见下）；
- **静默模式**：自动触发时**不复用按钮的 loading/结果态动画**（避免每个回合按钮闪烁），改为调用内部 `performSnapshotFull({silent:true})`：成功/重复时仅在控制台 `console.info` + 面板内"上次自动保存"时间戳更新；失败时 `showErrorBanner`（真实错误必须可见）；
- **去重**：后端 `snapshot-full` 已有 SHA-256 去重（`isDuplicate`），重复回合不产生重复记忆条目，无后端改动。

### 4.4 模型下拉收窄

- `loadModels()` 中 option 文字 `${m.id} (${p.name})` → `${m.id}`，`opt.title = \`${m.id} · ${p.name}\``（悬停可见 provider）；
- select 加 `max-w-[160px]`；超长模型名 CSS 截断（`truncate`）；
- 切换逻辑、`dataset.providerId`、会话恢复回填（`lastModel`）全部不变。

### 4.5 不改动项（明确排除）

- 左侧 logo/标题/工作区选择器/新登记按钮；
- 保存会话按钮外层位置；
- 后端任何接口；其他页面（pipeline/workflow 等）顶栏。

## 5. 错误处理

- 自动保存失败：`showErrorBanner` 显式告警（不静默吞错）；
- localStorage 不可用（隐私模式）：try/catch 包裹，降级为本次会话内存态；
- 面板 id 缺失：`renderUsageBar` 空值保护，兼容测试环境。

## 6. 测试计划

新增 `apps/server/tests/topbar-usage-settings.test.ts`（沿用 `client-script-sanity.test.ts` 的静态结构断言模式）：

1. 顶栏存在 `<details id="usage-dropdown">` 与 `<details id="settings-dropdown">`；
2. summary 仅含 `#session-tokens`，费用 `#usage-detail-cost` 只出现在面板内；
3. 清零按钮在 Token 面板内（onclick=`resetSessionUsage()`）；
4. 模型 select 含 `max-w-[160px]`；`loadModels()` 的 option 文字不含 `(${p.name})` 后缀、含 `opt.title`；
5. 设置面板含语音 toggle（`toggleGlobalSpeech`）、导出（`exportSession`）、自动保存（`toggleAutoSnapshot`）三项；
6. `localStorage` 键名 `pgh_autosnapshot_enabled` 存在于脚本；`turn/completed` 分支含自动保存调用；
7. 回归：`chat-topbar-session-sync.test.ts`、`client-theme-light.test.ts`、`client-script-sanity.test.ts` 全绿。

## 7. 影响范围

- 仅 `apps/server/client/run-chat.html`（HTML 结构 + 内联 JS）与新增测试文件；
- 后端、其他页面、协议层零改动。
