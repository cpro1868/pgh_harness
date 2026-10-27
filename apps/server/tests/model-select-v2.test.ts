import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.resolve(here, '../client/run-chat.html'), 'utf8');
const script = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');

describe('TC-01-08-006: 模型选择器 v2（Provider 分组折叠下拉）', () => {
  it('隐藏原生 select（状态存储）+ 自定义触发钮与面板共存', () => {
    assert.ok(html.includes('id="topbar-model-select"'), '原生 select 必须保留（状态存储，兼容 6 处既有引用）');
    assert.ok(html.includes('class="hidden') && /select[\s\S]{0,80}hidden/.test(html.slice(html.indexOf('id="topbar-model-select"') - 200, html.indexOf('id="topbar-model-select"') + 400)), '原生 select 应隐藏');
    assert.ok(html.includes('id="ms-trigger"'), '必须有自定义触发钮');
    assert.ok(html.includes('id="ms-panel"'), '必须有分组面板');
  });

  it('分组渲染：Provider 分组 header + 折叠箭头 + 当前组徽标', () => {
    assert.ok(script.includes('renderModelPanel'), '必须定义 renderModelPanel');
    assert.ok(script.includes('openModelGroups'), '必须存在展开状态记忆');
    assert.ok(script.includes('当前'), '当前组必须有徽标');
  });

  it('选中模型 → 同步隐藏 select 的 value 与 dataset.providerId', () => {
    assert.ok(script.includes('pickModel'), '必须定义 pickModel');
    // pickModel 必须同步原生 select（既有 6 处引用的兼容核心）
    const fn = script.slice(script.indexOf('function pickModel('), script.indexOf('function pickModel(') + 1500);
    assert.ok(fn.includes('topbar-model-select'), 'pickModel 必须同步隐藏原生 select');
    assert.ok(fn.includes('dataset.providerId'), '必须同步 dataset.providerId');
  });

  it('loadModels 改造：写原生 select 同时渲染分组面板', () => {
    const fn = script.slice(script.indexOf('async function loadModels()'), script.indexOf('async function loadModels()') + 4000);
    assert.ok(fn.includes('renderModelPanel') || fn.includes('syncModelPanelFromSelect'), 'loadModels 必须调用分组面板同步');
  });

  it('会话恢复回填走原生 select 后同步面板', () => {
    // 1890 附近的回填逻辑需在尾部触发面板同步
    const syncCount = (script.match(/syncModelPanelFromSelect\(\)/g) ?? []).length;
    assert.ok(syncCount >= 2, `恢复回填与 loadModels 必须调用 syncModelPanelFromSelect，实测 ${syncCount} 处`);
    assert.ok(script.includes('function syncModelPanelFromSelect'), '必须定义 syncModelPanelFromSelect');
  });

  it('外部点击关闭面板（mousedown 判定，防重建误关）', () => {
    assert.ok(script.includes("addEventListener('mousedown'"), '外部关闭必须用 mousedown（click 会在渲染重建后误判）');
  });

  it('内联脚本保持纯 JS', () => {
    assert.doesNotThrow(() => { new Function(script); }, '内联脚本必须可被 new Function 编译');
  });
});
