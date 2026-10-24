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
    const selectTag = html.match(/<select id="topbar-model-select"[^>]*>/)?.[0] ?? '';
    assert.ok(selectTag.includes('max-w-[160px]'), '模型 select 必须收窄到 160px');
    assert.ok(selectTag.includes('truncate'), '超长模型名必须 CSS 截断');
    const script = inlineScripts();
    assert.ok(!/opt\.textContent = `\$\{m\.id\} \(\$\{p\.name\}\)`/.test(script), 'option 文字不得再拼接 provider 后缀');
    assert.ok(script.includes('opt.title ='), 'option 必须带 title 悬停提示 provider');
  });

  it('设置下拉收纳语音/导出/自动保存三项', () => {
    const settingsBlock = html.match(/<details id="settings-dropdown"[\s\S]*?<\/details>/)?.[0] ?? '';
    assert.ok(settingsBlock.includes('toggleGlobalSpeech()'), '语音开关必须在设置菜单内');
    assert.ok(settingsBlock.includes('exportSession()'), '导出对话必须在设置菜单内');
    assert.ok(settingsBlock.includes('toggleAutoSnapshot()'), '自动保存开关必须在设置菜单内');
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
