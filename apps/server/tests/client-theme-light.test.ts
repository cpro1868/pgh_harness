import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(here, '../client');
const cssPath = path.join(clientDir, 'css', 'shared.css');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(html|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const TEXT_CLASS = /^(?:(?:hover|focus):)?text-(?:[a-z]+-\d{2,3}(?:\/\d{1,3})?|white(?:\/\d{1,3})?)$/;
const BG_CLASS = /^(?:(?:hover|focus):)?bg-(?:[a-z]+-\d{3}(?:\/\d{1,3})?|black\/\d{1,3}|white\/\d{1,3}|\[#[0-9a-fA-F]{6}\])$/;

function usedClasses(re: RegExp): string[] {
  const out = new Set<string>();
  for (const file of walk(clientDir)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const token of text.split(/[\s"'`<>{}();=]+/)) {
      if (re.test(token)) out.add(token);
    }
  }
  return [...out].sort();
}

type Rule = { selector: string; body: string };

function lightCleanRules(): Rule[] {
  const css = fs.readFileSync(cssPath, 'utf8');
  const rules: Rule[] = [];
  const re = /(\[data-theme='light-clean'\][^{}]*)\{([^{}]*)\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) rules.push({ selector: m[1], body: m[2] });
  return rules;
}

function selectorClasses(selector: string): string[] {
  const out: string[] = [];
  const re = /(?:^|[\s,>+~(.])\.((?:[\w-]|\\.)+)/g;
  for (let m = re.exec(selector); m; m = re.exec(selector)) out.push(m[1].replace(/\\(.)/g, '$1'));
  return out;
}

/** 按声明属性区分覆盖：background 规则只对背景类生效，color 规则只对文字类生效。 */
function coveredClasses(kind: 'text' | 'background'): Set<string> {
  const out = new Set<string>();
  for (const rule of lightCleanRules()) {
    const isBackground = /background(?:-color)?:/.test(rule.body);
    const isText = /(?:^|[;\s])color:/.test(rule.body.replace(/background-color:/g, 'skip:'));
    if ((kind === 'background' && isBackground) || (kind === 'text' && isText)) {
      for (const cls of selectorClasses(rule.selector)) out.add(cls);
    }
  }
  return out;
}

/**
 * 白底上原生即达标、无需亮色主题映射的文本类（附理由）。
 * 与 AGENTS.md「缺口清单纪律」同思路：不覆盖必须显式豁免，禁止静默漏配。
 */
const TEXT_EXEMPT = new Set([
  'text-slate-700', // #334155，白底 10.4:1
  'text-slate-800', // #1e293b，白底 14.1:1
  'text-blue-600', // #2563eb，白底 5.1:1
  'text-purple-600', // #9333ea，白底 5.9:1
  'text-black',
]);

/**
 * 明亮模式下无需翻转的背景类：透明、浮层遮罩、饱和色按钮底（白字规则由豁免分支保证）、
 * 本就浅色的 tint、以及深色状态指示点（非文字载体）。
 */
const BG_EXEMPT = new Set([
  'bg-transparent',
  'bg-black/60',
  'bg-black/70',
  'bg-black/80',
  'bg-black/85',
  'bg-[#f8fafc]',
  'bg-slate-600', // 状态指示圆点：#475569 深点在浅底可见
  'bg-blue-600',
  'bg-purple-600',
  'bg-purple-700',
  'bg-purple-600/90',
  'bg-emerald-600',
  'bg-emerald-700',
  'bg-rose-600',
  'bg-rose-800',
  'bg-purple-400',
  'bg-blue-400',
  'bg-emerald-400',
  'bg-amber-400',
  'bg-purple-500',
  'bg-amber-500',
  'bg-blue-500/10',
  'bg-blue-600/10',
  'bg-blue-600/20',
  'bg-blue-600/30',
  'bg-emerald-500/10',
  'bg-emerald-500/20',
  'bg-emerald-600/20',
  'bg-emerald-600/30',
  'bg-purple-500/30',
  'bg-rose-500/10',
  'hover:bg-blue-500',
  'hover:bg-blue-600/30',
  'hover:bg-emerald-500',
  'hover:bg-emerald-600',
  'hover:bg-emerald-600/30',
  'hover:bg-purple-500',
  'hover:bg-purple-600',
  'hover:bg-rose-500',
  'hover:bg-rose-600',
  'hover:bg-rose-700',
]);

describe('TC-01-12: 清新明亮模式文字对比度覆盖（light-clean 文字/背景映射完整性）', () => {
  it('页面使用的每个文字色类都必须在 shared.css 的 light-clean 段有映射或显式豁免', () => {
    const covered = coveredClasses('text');
    const used = usedClasses(TEXT_CLASS);
    assert.ok(used.length > 0, '必须能扫描到页面文字色类');
    const missing = used.filter((c) => !covered.has(c) && !TEXT_EXEMPT.has(c));
    assert.deepEqual(missing, [], `以下文字色类缺少 light-clean 明亮映射（白底将不可读）: ${missing.join(', ')}`);
  });

  it('页面使用的深色背景类都必须在 light-clean 段翻转为浅色或显式豁免（防止文字加深后暗上加暗）', () => {
    const covered = coveredClasses('background');
    const used = usedClasses(BG_CLASS);
    assert.ok(used.length > 0, '必须能扫描到页面背景色类');
    const missing = used.filter((c) => !covered.has(c) && !BG_EXEMPT.has(c));
    assert.deepEqual(missing, [], `以下深色背景类缺少 light-clean 翻转映射: ${missing.join(', ')}`);
  });

  it('主会话 Markdown 正文 (.prose-dark) 必须随主题切换为深色文字', () => {
    const prose = lightCleanRules().filter((r) => r.selector.includes('.prose-dark'));
    assert.ok(prose.some((r) => /color:\s*var\(--text-main\)/.test(r.body)), '.prose-dark 正文必须映射到 var(--text-main)');
    assert.ok(
      prose.some((r) => /\.prose-dark h1/.test(r.selector) && /--text-strong/.test(r.body)),
      '.prose-dark 标题必须映射到 var(--text-strong)',
    );
    assert.ok(
      prose.some((r) => /\.prose-dark th/.test(r.selector) && /--bg-inset/.test(r.body)),
      '.prose-dark 表头底色必须翻转为浅色变量',
    );
  });

  it('彩色按钮上的 text-white 必须保持白色（不得被全局加深规则误伤）', () => {
    const rules = lightCleanRules();
    const hit = rules.find((r) => r.selector.includes('.bg-blue-600') && r.selector.includes('.text-white') && r.body.includes('#fff'));
    assert.ok(hit, '缺少饱和色按钮背景上的 text-white 豁免规则');
  });

  it('页面自定义深色顶栏 (.ide-top-bar) 必须在明亮模式翻转为浅色', () => {
    const rules = lightCleanRules();
    const hit = rules.find((r) => r.selector.includes('.ide-top-bar'));
    assert.ok(hit, '缺少 .ide-top-bar 的 light-clean 映射');
    assert.ok(hit.body.includes('var(--bg-topbar)'), '.ide-top-bar 必须使用 var(--bg-topbar)');
  });
});
