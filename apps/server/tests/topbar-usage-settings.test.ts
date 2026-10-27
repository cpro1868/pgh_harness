import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.resolve(here, '../client/run-chat.html'), 'utf8');

function inlineScripts(): string {
  const m = html.match(/<script>([\s\S]*?)<\/script>/g) ?? [];
  return m.join('\n');
}

describe('TC-01-08-003: 主会话顶栏布局重构（Token下拉 + 设置菜单 + 模型收窄）', () => {
  it('顶栏存在 Token 下拉与设置下拉（details 元素）', () => {
    assert.ok(html.includes('<details id="usage-dropdown"'), '必须存在 usage-dropdown 下拉');
    assert.ok(html.includes('<details id="settings-dropdown"'), '必须存在 settings-dropdown 下拉');
  });

  it('Token summary 仅显示数字，费用只出现在下拉面板内', () => {
    const usageBlock = html.match(/<details id="usage-dropdown"[\s\S]*?<\/details>/)?.[0] ?? '';
    assert.ok(usageBlock.length > 0, 'usage-dropdown 块必须存在');
    assert.ok(usageBlock.includes('id="session-tokens"'), 'summary 必须包含 session-tokens');
    assert.ok(usageBlock.includes('id="usage-detail-cost"'), '面板必须包含 usage-detail-cost');
    assert.ok(usageBlock.includes('id="usage-detail-tokens"'), '面板必须包含 usage-detail-tokens');
    // 顶栏（details 之外）不得再平铺费用展示
    const header = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? '';
    const outsideDetails = header.replace(/<details id="usage-dropdown"[\s\S]*?<\/details>/g, '').replace(/<details id="settings-dropdown"[\s\S]*?<\/details>/g, '');
    assert.ok(!outsideDetails.includes('session-cost'), '顶栏平铺区不得再出现费用元素');
  });

  it('清零按钮位于 Token 下拉面板内', () => {
    const usageBlock = html.match(/<details id="usage-dropdown"[\s\S]*?<\/details>/)?.[0] ?? '';
    assert.ok(usageBlock.includes('resetSessionUsage()'), '清零按钮必须在 Token 面板内');
  });

  it('模型下拉收窄：max-width 约束 + 短名渲染 + provider 悬停提示', () => {
    // v2：原生 select 隐藏为状态存储，收窄约束转移至自定义触发钮（160px）
    assert.ok(html.includes('id="ms-trigger"') && /w-\[160px\]/.test(html.slice(html.indexOf('id="ms-trigger"') - 100, html.indexOf('id="ms-trigger"') + 300)), '触发钮必须收窄到 160px');
    assert.ok(html.includes('truncate') && html.includes('id="ms-current"'), '超长模型名必须 CSS 截断（ms-current）');
    const script = inlineScripts();
    assert.ok(!/opt\.textContent = `\$\{m\.id\} \(\$\{p\.name\}\)`/.test(script), 'option 文字不得再拼接 provider 后缀');
    assert.ok(script.includes('opt.title ='), 'option 必须带 title 悬停提示 provider');
  });

  it('模型下拉位于左侧组（紧跟工作区之后），右侧组不再拥挤', () => {
    const header = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? '';
    const modelIdx = header.indexOf('id="topbar-model-select"');
    const workspaceIdx = header.indexOf('id="topbar-workspace-select"');
    const rightGroupIdx = header.indexOf('id="topbar-snapshot-full-btn"');
    assert.ok(modelIdx > workspaceIdx, '模型下拉必须紧跟工作区之后（左侧组）');
    assert.ok(modelIdx < rightGroupIdx, '模型下拉必须在右侧功能组之前');
    // 右侧组（保存会话到 settings-dropdown 之间）不得再出现模型 select
    const rightGroup = header.slice(rightGroupIdx, header.indexOf('id="settings-dropdown"'));
    assert.ok(!rightGroup.includes('topbar-model-select'), '右侧组不得再包含模型下拉');
  });

  it('顶栏标题为 PG Harness（节省空间）', () => {
    assert.ok(html.includes('>PG Harness</span>'), '顶栏标题必须为 PG Harness');
    assert.ok(!html.includes('>Purple Grapes Harness</span>'), '不得再用全称标题');
  });

  it('Token 下拉面板含 DSH 对齐统计七项（轮数步数/tok·s/缓存命中/推理）', () => {
    const usageBlock = html.match(/<details id="usage-dropdown"[\s\S]*?<\/details>/)?.[0] ?? '';
    assert.ok(usageBlock.includes('id="usage-detail-turns"'), '面板必须含轮数/步数');
    assert.ok(usageBlock.includes('id="usage-detail-tps"'), '面板必须含 tok/s');
    assert.ok(usageBlock.includes('id="usage-detail-cache"'), '面板必须含缓存命中率');
    assert.ok(usageBlock.includes('id="usage-detail-reasoning"'), '面板必须含推理 Token');
    const script = inlineScripts();
    assert.ok(script.includes('renderUsageStats'), '必须定义 renderUsageStats 聚合渲染');
    assert.ok(script.includes('cachedTokens'), '统计必须聚合 cachedTokens');
    assert.ok(script.includes('llmDurationMs'), 'tok/s 必须基于 llmDurationMs');
  });

  it('设置下拉收纳语音/导出/自动保存三项', () => {
    const settingsBlock = html.match(/<details id="settings-dropdown"[\s\S]*?<\/details>/)?.[0] ?? '';
    assert.ok(settingsBlock.includes('toggleGlobalSpeech()'), '语音开关必须在设置菜单内');
    assert.ok(settingsBlock.includes('exportSession()'), '导出对话必须在设置菜单内');
    assert.ok(settingsBlock.includes('toggleAutoSnapshot()'), '自动保存开关必须在设置菜单内');
  });

  it('页面初始化必须回填语音开关状态（checkbox 勾选态反映实际开关）', () => {
    const script = inlineScripts();
    // 初始化区必须调用 updateSpeechButtonUI（否则加载后 checkbox 永远未勾选）
    assert.ok(/renderAutoSnapshotState\(\);[\s\S]*?updateSpeechButtonUI\(\);/.test(script), '初始化时必须调用 updateSpeechButtonUI 回填语音勾选态');
    // checkbox 勾选态同步必须存在于 updateSpeechButtonUI 内
    const fn = script.match(/function updateSpeechButtonUI\(\)[\s\S]*?\n {4}\}/)?.[0] ?? '';
    assert.ok(fn.includes("getElementById('speech-toggle')"), 'updateSpeechButtonUI 必须同步 speech-toggle checkbox');
    assert.ok(fn.includes('.checked = current.enabled'), 'checkbox 勾选态必须来自实际开关状态');
  });

  it('自动保存状态持久化与回合触发', () => {
    const script = inlineScripts();
    assert.ok(script.includes('pgh_autosnapshot_enabled'), '必须使用 localStorage 键 pgh_autosnapshot_enabled');
    assert.ok(script.includes('function toggleAutoSnapshot()'), '必须定义 toggleAutoSnapshot');
    assert.ok(script.includes('performSnapshotFull'), '必须抽取 performSnapshotFull 供手动/自动复用');
    assert.ok(/silent/.test(script), '自动保存必须走静默模式');
  });

  it('顶栏平铺区不再有语音/导出按钮（已收纳进设置菜单）', () => {
    const header = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? '';
    const outsideDetails = header.replace(/<details id="usage-dropdown"[\s\S]*?<\/details>/g, '').replace(/<details id="settings-dropdown"[\s\S]*?<\/details>/g, '');
    assert.ok(!outsideDetails.includes('toggleGlobalSpeech()'), '语音开关不得再平铺在顶栏');
    assert.ok(!outsideDetails.includes('exportSession()'), '导出对话不得再平铺在顶栏');
  });
});
