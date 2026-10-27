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
    // 跳过入口在容器头部（向导可见即见），屏 0 起点到屏 1 起点的窗口涵盖头部
    const start = html.indexOf('id="wizard-v2"');
    const window0 = html.slice(start, html.indexOf('id="wizard-screen-1"'));
    assert.ok((window0.match(/value-card/g) ?? []).length >= 3, '屏 0 必须有 3 张价值卡片');
    assert.ok(window0.includes('skipWizard'), '向导必须有跳过入口');
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
    assert.ok(script.includes('wizardProgress'), '必须读写 wizardProgress');
    assert.ok(script.includes('saveWizardProgress'), '必须定义 saveWizardProgress');
  });

  it('设置菜单含「运行向导」入口（引导模式触发）', () => {
    const settingsBlock = html.match(/<details id="settings-dropdown"[\s\S]*?<\/details>/)?.[0] ?? '';
    assert.ok(settingsBlock.includes('🧭'), '设置菜单必须有向导入口');
    assert.ok(settingsBlock.includes('startWizard'), '入口必须调用 startWizard');
  });

  it('完成屏含后续指引与进入工作台', () => {
    const start = html.indexOf('id="wizard-screen-3"');
    const screen3 = html.slice(start, start + 6000);
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
