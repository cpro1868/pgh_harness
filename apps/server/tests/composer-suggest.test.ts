import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.resolve(here, '../client/run-chat.html'), 'utf8');
const script = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');

describe('TC-01-03-010: 主会话输入建议（/ 命令 · Skills 子候选 · @ 文件引用）', () => {
  it('建议容器与状态机存在', () => {
    assert.ok(html.includes('id="composer-suggest"'), '必须存在建议浮动面板 composer-suggest');
    assert.ok(script.includes('suggestState'), '必须存在 suggestState 状态对象');
    assert.ok(script.includes('renderSuggestItems'), '必须存在 renderSuggestItems 渲染函数');
    assert.ok(script.includes('closeComposerSuggest'), '必须存在 closeComposerSuggest 关闭函数');
  });

  it('textarea input 事件挂接建议更新', () => {
    const textarea = html.match(/<textarea[^>]*id="composer-textarea"[^>]*>/)?.[0] ?? '';
    assert.ok(textarea.includes('oninput') || script.includes("addEventListener('input'"), 'textarea 必须监听 input 事件');
    assert.ok(script.includes('handleComposerInput'), '必须有 handleComposerInput 统一入口');
  });

  it('/ 行首触发：候选含 /skill 主候选与 Skills 动态子候选', () => {
    assert.ok(script.includes("'/skill'") || script.includes('"/skill"'), '必须内置 /skill 主候选');
    assert.ok(script.includes('enabledSkills') || script.includes('/api/skills'), '候选必须来自 Skills 清单缓存');
    // 选中补全逻辑
    assert.ok(script.includes('pickSuggest'), '必须定义 pickSuggest 选中函数');
  });

  it('@ 行内触发：文件引用候选', () => {
    assert.ok(script.includes("characterData: null") === false, 'sanity');
    assert.ok(script.includes("'@'") || script.includes("`@`"), '必须处理 @ 触发字符');
    assert.ok(script.includes('/api/workspace/files'), '文件候选必须调 /api/workspace/files 端点');
  });

  it('菜单打开时 Enter 不发送消息（互斥）', () => {
    // setupKeyboardListener / handleComposerKeydown 中必须先判建议菜单打开
    assert.ok(/suggestState[\s\S]{0,200}isRunning|isRunning[\s\S]{0,200}suggestState/.test(script) || script.includes('suggestOpen'), '键盘监听必须感知建议菜单打开态');
  });

  it('Esc 关闭建议菜单', () => {
    assert.ok(script.includes('Escape'), '必须处理 Escape 关闭');
  });

  it('服务端文件列表端点存在且安全（仅工作区内 + SKIP_DIRS 过滤）', () => {
    const src = fs.readFileSync(path.resolve(here, '../src/index.ts'), 'utf8');
    assert.ok(src.includes('/api/workspace/files'), '必须存在 GET /api/workspace/files 端点');
    assert.ok(src.includes('WORKSPACE_SKIP_DIRS') || src.includes('SKIP_DIRS'), '文件列表必须跳过屏蔽目录');
  });
});
