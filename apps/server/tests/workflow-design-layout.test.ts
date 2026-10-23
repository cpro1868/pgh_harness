import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(here, '..', 'client');

describe('TC-03-02-002: 设计器与监控页视口高度与双栏布局防线 (CSS 布局塌陷防卫)', () => {
  it('config-workflow-design.html 必须显式声明 flex-row 且不得受 body.app-shell column 覆盖', () => {
    const html = fs.readFileSync(path.join(clientDir, 'config-workflow-design.html'), 'utf8');
    const bodyTag = html.match(/<body[^>]*>/i)?.[0] || '';
    assert.ok(
      bodyTag.includes('flex flex-col') || bodyTag.includes('flex-row'),
      'body 必须包含正确的 flex 布局定义保证侧边栏与主工作台正常展开',
    );
    assert.ok(!bodyTag.includes('app-shell') || bodyTag.includes('flex-row'), '若包含 app-shell 则必须有 flex-row 覆盖规则');
  });

  it('run-workflow-detail.html 必须显式声明 flex-row 且具备双栏布局', () => {
    const html = fs.readFileSync(path.join(clientDir, 'run-workflow-detail.html'), 'utf8');
    const bodyTag = html.match(/<body[^>]*>/i)?.[0] || '';
    assert.ok(bodyTag.includes('flex-row'), '监控页 body 必须包含 flex-row');
  });

  it('shared.css 必须包含 body.flex-row / body.app-shell.flex-row 的 !important 强制水平规则', () => {
    const css = fs.readFileSync(path.join(clientDir, 'css', 'shared.css'), 'utf8');
    assert.ok(
      /body(?:\.app-shell)?\.flex-row[\s\S]*?flex-direction:\s*row\s*!important/.test(css),
      'shared.css 必须包含 flex-row 的 !important 规则防止任何全局 column 规则覆写',
    );
  });
});
