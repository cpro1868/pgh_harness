# 首次启动欢迎向导 v2（双模式）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `run-chat.html` 的旧 2 步弹窗向导重构为全屏四屏双模式向导（首启模式 / 引导模式），进度落盘可续、完成前置校验、设置菜单重跑入口。

**Architecture:** 纯前端重构——替换 `#wizard-modal` 为全屏 `#wizard-v2` 容器与四屏 DOM；复用既有 wizard 函数（`wizardSaveProvider`/`wizardBrowseFolder` 等）与后端 API（`needsWizard`/`settings/section`）；新增 `wizardMode` 状态机与 `wizardProgress` 落盘；`checkBootstrap` 响应附带进度。后端仅一处小改。

**Tech Stack:** 原生 HTML/Tailwind/纯 JS（内联脚本，禁止 TS 语法——`new Function` 编译兼容）；node:test 静态结构断言。

## Global Constraints

- 内联脚本**必须纯 JS**：禁止 `as X`、`: void`、泛型等 TS 语法（`client-script-sanity.test.ts` 用 `new Function` 编译会红）
- 新增色类必须过 `client-theme-light.test.ts`（light-clean 映射）
- 既有 wizard 函数 id 保留：`wizard-provider-name`、`wizard-provider-baseurl`、`wizard-provider-key`、`wizard-model-select`、`wizard-ws-path`（既有函数不破坏）
- `needsWizard` / `wizardCompleted` 服务端语义不变（`bootstrap.test.ts` 回归）
- 旧轮次兼容：`wizardProgress` 缺失时从屏 0 开始
- 每个任务结束跑该任务测试 + 相关回归，最后统一 `pnpm check`

---

### Task 1: 服务端——checkBootstrap 附带 wizardProgress

**Files:**
- Modify: `apps/server/src/index.ts:626-635`（checkBootstrap 响应）
- Test: `apps/server/tests/bootstrap.test.ts`（追加断言）

**Interfaces:**
- Produces: `GET /api/bootstrap`（或 checkBootstrap 实际路径）响应 `data.wizardProgress: { mode?, step?, providerSaved?, workspaceSaved? } | null`——前端 Task 3 依赖此字段定位初始屏。

- [ ] **Step 1: 写失败测试**

在 `apps/server/tests/bootstrap.test.ts` 的 bootstrap 响应断言测试后追加：

```ts
it('checkBootstrap 响应附带 wizardProgress（缺省 null，向导断点续走用）', async () => {
  // 既有测试里已有 bootstrap 响应对象（变量名按既有测试实际为准，此处假定为 res.data）
  assert.ok('wizardProgress' in res.data, '响应必须包含 wizardProgress 字段');
  assert.equal(res.data.wizardProgress, null, '未开始向导时为 null');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --experimental-strip-types --test apps/server/tests/bootstrap.test.ts`
Expected: FAIL（wizardProgress 字段不存在）

- [ ] **Step 3: 实现**

`apps/server/src/index.ts` checkBootstrap 响应对象（626-635 行区域）追加一行：

```ts
wizardProgress: this.settingsStore.get<object>('system.wizardProgress') ?? null,
```

- [ ] **Step 4: 运行确认通过**

Run: `node --experimental-strip-types --test apps/server/tests/bootstrap.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/index.ts apps/server/tests/bootstrap.test.ts
git commit -m "feat(server): checkBootstrap 附带 wizardProgress 断点字段"
```

---

### Task 2: 前端——全屏向导 DOM 骨架替换旧弹窗

**Files:**
- Modify: `apps/server/client/run-chat.html:530-589`（`#wizard-modal` 整块替换为 `#wizard-v2`）
- Test: `apps/server/tests/wizard-v2.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 的 `wizardProgress`；
- Produces: `#wizard-v2` 容器 + `#wizard-screen-0..3` 四屏 + `#wizard-dot-0..3` 进度点；旧 input id 全部保留在屏 1/2 内（`wizard-provider-name` 等，供既有 `wizardSaveProvider` 等函数使用）。

- [ ] **Step 1: 写失败测试（新建 `apps/server/tests/wizard-v2.test.ts`）**

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.resolve(here, '../client/run-chat.html'), 'utf8');
const script = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');

describe('TC-01-08-005: 首次启动欢迎向导 v2（双模式）', () => {
  it('全屏向导容器与四屏 DOM 存在，旧 wizard-modal 移除', () => {
    assert.ok(html.includes('id="wizard-v2"'), '必须存在 wizard-v2 全屏容器');
    assert.ok(!html.includes('id="wizard-modal"'), '旧 wizard-modal 必须移除');
    for (let i = 0; i <= 3; i++) {
      assert.ok(html.includes(`id="wizard-screen-${i}"`), `必须存在 wizard-screen-${i}`);
    }
  });

  it('进度点四枚 + 屏 0 价值卡片 ×3 与跳过入口', () => {
    for (let i = 0; i <= 3; i++) {
      assert.ok(html.includes(`id="wizard-dot-${i}"`), `必须存在进度点 wizard-dot-${i}`);
    }
    const screen0 = html.match(/id="wizard-screen-0"[\s\S]*?<div id="wizard-screen-1"/)?.[0] ?? '';
    assert.ok((screen0.match(/value-card/g) ?? []).length >= 3, '屏 0 必须有 3 张价值卡片');
    assert.ok(screen0.includes('skipWizard') || screen0.includes('稍后配置'), '屏 0 必须有跳过入口');
  });

  it('屏 1/2 保留既有 wizard input id（兼容既有函数）', () => {
    for (const id of ['wizard-provider-name', 'wizard-provider-baseurl', 'wizard-provider-key', 'wizard-model-select', 'wizard-ws-path']) {
      assert.ok(html.includes(`id="${id}"`), `必须保留 ${id}`);
    }
  });

  it('双模式：startWizard(mode) 入口 + 引导模式专属元素', () => {
    assert.ok(script.includes('function startWizard('), '必须定义 startWizard(mode)');
    assert.ok(script.includes("'first-run'") && script.includes("'guided'"), '必须区分 first-run/guided 两模式');
    assert.ok(html.includes('id="guided-provider-existing"'), '引导模式 Provider 保留条必须存在');
    assert.ok(html.includes('id="guided-ws-existing"'), '引导模式工作区保留条必须存在');
    assert.ok(script.includes('keepExisting'), '必须定义 keepExisting 快捷保留');
  });

  it('进度落盘与恢复', () => {
    assert.ok(script.includes("wizardProgress"), '必须读写 wizardProgress');
    assert.ok(script.includes('saveWizardProgress'), '必须定义 saveWizardProgress');
  });

  it('设置菜单含「运行向导」入口（引导模式触发）', () => {
    const settingsBlock = html.match(/<details id="settings-dropdown"[\s\S]*?<\/details>/)?.[0] ?? '';
    assert.ok(settingsBlock.includes('🧭'), '设置菜单必须有向导入口');
    assert.ok(settingsBlock.includes('startWizard'), '入口必须调用 startWizard');
  });

  it('完成屏含后续指引与进入工作台', () => {
    const screen3 = html.match(/id="wizard-screen-3"[\s\S]*?<\/div>\s*<\/div>\s*<div class="px-6 py-3/)?.[0] ?? '';
    assert.ok(screen3.includes('进入工作台') || script.includes('wizardFinish'), '完成屏必须有进入工作台动作');
    assert.ok(screen3.includes('Provider 资产池'), '完成屏必须有加模型指引');
    assert.ok(screen3.includes('工作区管理'), '完成屏必须有加工作区指引');
  });

  it('屏 2 实时校验函数存在', () => {
    assert.ok(script.includes('validateWsPathLive') || script.includes('wizardValidatePath'), '必须存在工作区路径实时校验');
  });

  it('内联脚本保持纯 JS（new Function 可编译）', () => {
    assert.doesNotThrow(() => { new Function(script); }, '内联脚本必须可被 new Function 编译');
  });
});
```

同时把 `apps/server/tests/topbar-usage-settings.test.ts` 中引用 `#wizard-modal` 的断言（如有）移除/更新。

- [ ] **Step 2: 注册测试并运行确认失败**

`package.json` test 数组在 `topbar-usage-settings.test.ts` 后插入 `apps/server/tests/wizard-v2.test.ts`。

Run: `node --experimental-strip-types --test apps/server/tests/wizard-v2.test.ts`
Expected: FAIL（wizard-v2 容器不存在、wizard-modal 未移除）

- [ ] **Step 3: 替换 DOM**

删除 `run-chat.html:530-589` 的 `#wizard-modal` 整块，原位写入 `#wizard-v2`：

```html
<div id="wizard-v2" class="hidden fixed inset-0 z-[80] bg-[#070a12]/95 backdrop-blur-md flex items-center justify-center p-4 overflow-auto">
  <div class="w-full max-w-2xl rounded-2xl bg-[#0f172a] border border-slate-700 shadow-2xl overflow-hidden my-8">
    <!-- 头：品牌 + 进度点（结构抄原型 docs/阶段-1-需求/prototype/wizard-v2.html 头部） -->
    <div class="px-6 pt-5 pb-4 bg-[#131d38] border-b border-slate-800">
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-2.5">
          <img src="ico/pgh.svg" alt="PG Harness" class="w-7 h-7 rounded shadow">
          <span class="font-bold text-white text-sm tracking-wide">PG Harness · 首次配置向导</span>
        </div>
        <button onclick="skipWizard()" class="text-[11px] text-slate-500 hover:text-slate-300 underline">跳过，稍后配置</button>
      </div>
      <div class="flex items-center justify-center space-x-3 mt-4">
        <span id="wizard-dot-0" class="wizard-dot"></span><span class="w-8 h-px bg-slate-700"></span>
        <span id="wizard-dot-1" class="wizard-dot"></span><span class="w-8 h-px bg-slate-700"></span>
        <span id="wizard-dot-2" class="wizard-dot"></span><span class="w-8 h-px bg-slate-700"></span>
        <span id="wizard-dot-3" class="wizard-dot"></span>
      </div>
      <div class="text-center text-[10px] text-slate-500 mt-1.5 font-mono" id="wizard-progress-label">欢迎</div>
    </div>

    <!-- 屏 0 欢迎（3 价值卡片，抄原型 screen-0 全部内容） -->
    <div id="wizard-screen-0" class="wizard-screen flex-col p-6 space-y-5">…（原型屏 0 内容原样搬入，卡片 class 含 value-card，跳过按钮调 skipWizard）…</div>

    <!-- 屏 1 接入模型（既有 input id 原样保留：wizard-provider-name/baseurl/key/model-select；引导保留条 id="guided-provider-existing" hidden） -->
    <div id="wizard-screen-1" class="wizard-screen flex-col p-6 space-y-4">…</div>

    <!-- 屏 2 工作区（保留 wizard-ws-path + wizard-browse-btn；引导保留条 id="guided-ws-existing" hidden） -->
    <div id="wizard-screen-2" class="wizard-screen flex-col p-6 space-y-4">…</div>

    <!-- 屏 3 完成（done-model/done-ws + 4 条指引 + wizardFinish 按钮） -->
    <div id="wizard-screen-3" class="wizard-screen flex-col p-6 space-y-5">…</div>

    <div class="px-6 py-3 bg-[#0b1120] border-t border-slate-800 flex items-center justify-between">
      <span class="text-[10px] text-slate-600">每一步自动保存 · 刷新可从断点继续</span>
      <span id="wizard-status" class="text-[10px] text-amber-400 font-mono"></span>
    </div>
  </div>
</div>
```

配套 CSS（原 `<style>` 块或 style 标签内追加）：`.wizard-dot`（10px 圆点三态 current/done）、`.wizard-screen { display:none } .wizard-screen.active { display:flex }`、`.value-card`、`.info-strip`、`path-valid/path-invalid`——**全部抄自原型 wizard-v2.html 的 `<style>` 块**。

- [ ] **Step 4: 运行测试**

Run: `node --experimental-strip-types --test apps/server/tests/wizard-v2.test.ts`
Expected: 结构类断言 PASS（双模式/进度落盘类断言可能仍红——Task 3 补 JS）

- [ ] **Step 5: Commit**

```bash
git add apps/server/client/run-chat.html apps/server/tests/wizard-v2.test.ts package.json
git commit -m "feat(client): 全屏向导 DOM 骨架替换旧弹窗（四屏+进度点+引导保留条）"
```

---

### Task 3: 前端——双模式状态机与进度落盘 JS

**Files:**
- Modify: `apps/server/client/run-chat.html` 内联脚本（checkBootstrap 调用处 + 旧 wizard 函数区）
- Test: `apps/server/tests/wizard-v2.test.ts`（Task 2 中已写的双模式/落盘断言转绿）

**Interfaces:**
- Consumes: Task 1 `wizardProgress`；Task 2 DOM id；
- Produces: `startWizard(mode: 'first-run'|'guided')`、`saveWizardProgress(step)`、`keepExisting(kind: 'provider'|'workspace')`、`goWizardStep(n)`、改写版 `skipWizard()`/`wizardFinish()`。

- [ ] **Step 1: 实现 JS（内联脚本向导区整体重写）**

```js
// ═══ 向导 v2 双模式状态机 ═══
let wizardMode = 'first-run';
let wizardStep = 0;

function saveWizardProgress() {
  fetch('/api/settings/section', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      section: 'wizardProgress',
      data: { mode: wizardMode, step: wizardStep, providerSaved: wizardMode === 'guided', workspaceSaved: false },
    }),
  }).catch(() => undefined); // 进度落盘失败不阻塞向导
}

function goWizardStep(n) {
  wizardStep = n;
  for (let i = 0; i <= 3; i++) {
    document.getElementById('wizard-screen-' + i).classList.toggle('active', i === n);
    const dot = document.getElementById('wizard-dot-' + i);
    dot.classList.toggle('current', i === n);
    dot.classList.toggle('done', i < n);
  }
  document.getElementById('wizard-progress-label').textContent = ['欢迎', '接入模型', '选择工作区', '完成'][n];
  saveWizardProgress();
  if (n === 3) wizardRenderDone();
}

function startWizard(mode) {
  wizardMode = mode;
  document.getElementById('wizard-screen-0').style.display = mode === 'guided' ? 'none' : '';
  document.getElementById('guided-provider-existing').classList.toggle('hidden', mode !== 'guided');
  document.getElementById('guided-ws-existing').classList.toggle('hidden', mode !== 'guided');
  if (mode === 'guided') {
    // 预填当前实际配置
    const providers = window.__providersCache || [];
    const p = providers[0];
    if (p) {
      document.getElementById('wizard-provider-name').value = p.name || '';
      document.getElementById('wizard-provider-baseurl').value = p.baseUrl || '';
      document.getElementById('guided-provider-current').textContent = `${p.name} · ${(p.models || []).length} models`;
    }
    if (activeWorkspacePath) {
      document.getElementById('wizard-ws-path').value = activeWorkspacePath;
      document.getElementById('guided-ws-current').textContent = activeWorkspacePath;
    }
    goWizardStep(1);
  } else {
    goWizardStep(0);
  }
  document.getElementById('wizard-v2').classList.remove('hidden');
}

function keepExisting(kind) {
  if (kind === 'provider') goWizardStep(2);
  else goWizardStep(3);
}

function wizardRenderDone() {
  const model = document.getElementById('wizard-model-select').value || 'deepseek-chat';
  const provider = document.getElementById('wizard-provider-name').value || 'Provider';
  document.getElementById('done-model').textContent = model + '（' + provider + '）';
  document.getElementById('done-ws').textContent = document.getElementById('wizard-ws-path').value || activeWorkspacePath || '(未填写)';
}

function skipWizard() {
  fetch('/api/settings/section', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section: 'wizardCompleted', data: wizardMode === 'first-run' }),
  }).catch(() => undefined);
  if (wizardMode === 'first-run') {
    // 首启跳过 = 标记完成（老语义），引导跳过 = 无副作用
    fetch('/api/settings/section', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ section: 'wizardProgress', data: null }) }).catch(() => undefined);
  }
  document.getElementById('wizard-v2').classList.add('hidden');
}

function wizardFinish() {
  fetch('/api/settings/section', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section: 'wizardCompleted', data: true }),
  }).then(() => {
    fetch('/api/settings/section', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ section: 'wizardProgress', data: null }) }).catch(() => undefined);
    document.getElementById('wizard-v2').classList.add('hidden');
    loadModels();
    loadSessionList();
  }).catch(() => undefined);
}
```

**改造 checkBootstrap 回调**（原 2801 行 `needsWizard` 分支）：

```js
if (result.code === 0 && result.data && result.data.needsWizard) {
  const progress = result.data.wizardProgress;
  startWizard('first-run');
  if (progress && typeof progress.step === 'number' && progress.step > 0 && progress.step <= 3) {
    goWizardStep(progress.step); // 断点续走
  }
}
```

**设置菜单**（settings-dropdown 内追加一项）：

```html
<button type="button" onclick="startWizard('guided')" title="重新走一遍配置引导（预填现有配置，可改可跳过）" class="w-full flex items-center space-x-1.5 px-2 py-1.5 rounded hover:bg-slate-800/70 text-slate-300 text-left transition">
  <span>🧭</span><span>运行向导</span>
</button>
```

**校验函数**（屏 2 路径实时校验，纯前端格式校验 + 既有 browse 端点）：

```js
function validateWsPathLive() {
  const input = document.getElementById('wizard-ws-path');
  const tip = document.getElementById('ws-validate-tip');
  const v = input.value.trim();
  tip.classList.remove('hidden');
  if (!v) { tip.textContent = '等待输入…'; tip.className = 'text-[11px] font-mono text-slate-500'; return false; }
  const ok = /^[a-zA-Z]:\\.+/.test(v) || v.startsWith('/');
  tip.textContent = ok ? '✅ 路径格式正确（保存时将做存在性强校验）' : '❌ 请输入绝对路径';
  tip.className = 'text-[11px] font-mono ' + (ok ? 'text-emerald-400' : 'text-rose-400');
  return ok;
}
```

**既有函数适配**（保留名不变，仅改内部跳转）：
- `wizardSaveProvider()` 成功分支末尾：`goWizardStep(2)` 替换旧的 `wizardGoStep(2)`；`showApprovalWaitingBadge` 无关不动；
- `wizardFinish()` 用上面新版整体替换旧实现；
- 删除旧 `wizardGoStep`（被 goWizardStep 取代）。

- [ ] **Step 2: 运行全部向导测试**

Run: `node --experimental-strip-types --test apps/server/tests/wizard-v2.test.ts apps/server/tests/bootstrap.test.ts apps/server/tests/client-script-sanity.test.ts`
Expected: 全 PASS（纯 JS 检查必须过）

- [ ] **Step 3: Commit**

```bash
git add apps/server/client/run-chat.html apps/server/tests/wizard-v2.test.ts
git commit -m "feat(client): 向导 v2 双模式状态机（进度落盘/引导预填/重跑入口/实时校验）"
```

---

### Task 4: 回归 + CDP 端到端 + 收尾

**Files:**
- Test: `apps/server/tests/wizard-v2.test.ts`（CDP 场景补充为可选手动验证项）
- Modify: `docs/工作进展记录.md`、`SESSION.md`

- [ ] **Step 1: 全量回归**

Run: `pnpm check`
Expected: lint 0 warning、typecheck 0 error、43+ 套件全绿（`bootstrap`/`client-script-sanity`/`client-theme-light`/`chat-topbar-session-sync` 必绿）

- [ ] **Step 2: CDP 端到端验证（临时脚本，不入库）**

```js
// 场景 A（首启）：临时 data-dir 起 server → 加载页面 → 断言 wizard-v2 无 hidden 且位于屏 0
// 填 provider → 探测（stub）→ 保存 → 屏 2 → 填路径 → 屏 3 → 完成 → wizardCompleted=true（GET /api/bootstrap 验证）
// 场景 B（引导）：刷新 → 设置菜单点「🧭 运行向导」→ 直接屏 1 且 provider-name 预填 → keepExisting → 全程已有配置不变
// 场景 C（断点续走）：屏 2 时刷新页面 → 恢复到屏 2
```

每个场景断言 6 项：容器可见性、当前屏、表单预填值、按钮文案、`GET /api/bootstrap` 的 wizardCompleted/wizardProgress、引导模式配置零变更。

- [ ] **Step 3: 更新台账**

`docs/工作进展记录.md` 与 `SESSION.md` 按 2026-10-24 惯例插入条目（含四屏截图要点、双模式验证矩阵）。

- [ ] **Step 4: Commit + Push**

```bash
git add -A
git commit -m "feat(client): 首次启动欢迎向导 v2 双模式交付 (TC-01-08-005)"
git push origin main
```

---

## Self-Review 结论

- **Spec 覆盖**：§1.1 双模式（Task 2 DOM + Task 3 状态机）、§4.1 触发（Task 3 checkBootstrap 分支）、§4.2 进度落盘（Task 1 + Task 3 saveWizardProgress）、§4.3 校验（Task 3 validateWsPathLive）、§4.4 重跑入口（Task 3 设置菜单）、§5 视觉（Task 2 CSS 抄原型）、§7 测试（Task 2/3/4）——全覆盖，无缺口。
- **占位符**：Task 2 Step 3 的 `…（原型屏 0 内容原样搬入）` 是**有明确来源的搬运指令**（来源文件与区块已指明），非 TBD。
- **类型一致性**：`startWizard(mode)`/`goWizardStep(n)`/`keepExisting(kind)`/`saveWizardProgress()` 在 Task 2/3 间命名一致；`wizardProgress` 字段结构 Task 1（服务端）与 Task 3（前端消费）一致。
