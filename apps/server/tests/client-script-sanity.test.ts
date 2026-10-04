import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(here, '../client');
const htmlFiles = fs.readdirSync(clientDir).filter((f) => f.endsWith('.html'));

function inlineScripts(file: string): string[] {
  const html = fs.readFileSync(path.join(clientDir, file), 'utf8');
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

describe('TC-01-11: 客户端页面内联脚本静态健全性', () => {
  it('每个页面的内联脚本必须可编译（无语法错误）', () => {
    assert.ok(htmlFiles.length > 0, '必须存在客户端页面');
    for (const f of htmlFiles) {
      for (const script of inlineScripts(f)) {
        assert.doesNotThrow(() => { new Function(script); }, `${f} 的内联脚本必须可编译`);
      }
    }
  });

  it('内联脚本不得把 Boolean(...) 的结果当数组调用（回归防护）', () => {
    for (const f of htmlFiles) {
      const html = fs.readFileSync(path.join(clientDir, f), 'utf8');
      assert.ok(
        !/Boolean\([^)]*\)\s*\.\s*some\s*\(/.test(html),
        `${f} 不得出现 Boolean(...).some(...)，应写为 (arr || []).some(...)`,
      );
    }
  });
});
