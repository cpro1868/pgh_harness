import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(here, '..', 'client', 'config-workspace.html');

interface StubElement {
  value: string;
  checked: boolean;
}

/**
 * 载入 config-workspace.html 的内联脚本，用最小 DOM 桩暴露模板生成器，
 * 从而在不引入浏览器测试框架的前提下校验 Markdown 产物结构。
 */
function loadTemplateGenerator() {
  const create = () => {
    const html = fs.readFileSync(htmlPath, 'utf8');
    const source = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)]
      .map((m) => m[1])
      .join('\n;\n');

    const elements = new Map<string, StubElement>();
    const seed = (id: string, value = '', checked = true): void => {
      elements.set(id, { value, checked });
    };
    for (const id of [
      'tpl-overview', 'tpl-honor', 'tpl-stack', 'tpl-strict', 'tpl-nonative', 'tpl-tdd',
      'tpl-git', 'tpl-security', 'tpl-tooling', 'tpl-docs', 'tpl-exclude',
    ]) {
      seed(id);
    }
    seed('tpl-project-name');
    seed('tpl-project-desc');
    seed('tpl-project-features');
    seed('global-exclude-textarea', '.git\nnode_modules\ndist');

    const documentStub = {
      getElementById: (id: string) => elements.get(id) ?? null,
      createElement: () => ({
        style: {},
        classList: { add() {}, remove() {} },
        appendChild() {},
        addEventListener() {},
        querySelector: () => null,
      }),
      addEventListener() {},
    };
    const windowStub = { addEventListener() {}, marked: undefined, hljs: undefined, DOMPurify: undefined };

    const factory = new Function(
      'document',
      'window',
      `${source}\n;return { buildAgentsTemplate, readTemplateFlags, readOverview };`,
    ) as (doc: unknown, win: unknown) => {
      buildAgentsTemplate: (flags: Record<string, boolean>) => string;
      readTemplateFlags: () => Record<string, boolean>;
      readOverview: () => { name: string; description: string; features: string[] };
    };

    return {
      api: factory(documentStub, windowStub),
      setChecked: (id: string, on: boolean) => {
        const el = elements.get(id);
        if (el) el.checked = on;
      },
      setValue: (id: string, value: string) => {
        const el = elements.get(id);
        if (el) el.value = value;
      },
    };
  };

  return { create };
}

const allOn: Record<string, boolean> = {
  overview: true, honor: true, stack: true, strict: true, nonative: true, tdd: true,
  git: true, security: true, tooling: true, docs: true, exclude: true,
};

test('TC-01-09-001: AGENTS.md 模板生成器输出结构与占位符纪律', async (t) => {
  const { create } = loadTemplateGenerator();

  await t.test('生成富 Markdown：章节编号连续、代码围栏配对、忽略清单来自黑名单', () => {
    const { api, setValue } = create();
    setValue('tpl-project-name', 'Purple Grapes Harness');
    setValue('tpl-project-desc', '编码 Agent 运行时平台');
    setValue('tpl-project-features', '端到端编码闭环\n插件化微内核');
    setValue('global-exclude-textarea', '.git\nnode_modules\n*.env');

    const md = api.buildAgentsTemplate(allOn);
    assert.ok(md.startsWith('# AGENTS.md'), '应以一级标题开头');

    const numbered = md.split('\n').filter((line) => /^## \d+\. /.test(line));
    assert.ok(numbered.length >= 11, `章节数应不少于 11，实际 ${numbered.length}`);
    numbered.forEach((line, index) => {
      assert.ok(line.startsWith(`## ${index + 1}. `), `章节编号必须连续：期望 ${index + 1}，实际 "${line}"`);
    });

    const fences = (md.match(/```/g) ?? []).length;
    assert.equal(fences % 2, 0, '代码围栏必须成对出现');

    assert.ok(md.includes('## 1. 项目概览'), '项目概览应为第一章');
    assert.ok(md.includes('Purple Grapes Harness'));
    assert.ok(md.includes('编码 Agent 运行时平台'));
    assert.ok(md.includes('端到端编码闭环'));
    assert.ok(md.includes('- `.git`') && md.includes('- `*.env`'), '忽略清单应逐条来自黑名单');
  });

  await t.test('项目信息缺失时输出占位符，绝不编造', () => {
    const { api, setValue } = create();
    setValue('tpl-project-name', '');
    setValue('tpl-project-desc', '');
    setValue('tpl-project-features', '');

    const md = api.buildAgentsTemplate(allOn);
    assert.ok(md.includes('<待填写>'), '空字段必须落占位符');
    assert.equal((md.match(/<待填写>/g) ?? []).length, 3, '名称/定位/核心功能三处占位');
  });

  await t.test('全部章节关闭时仍保留交付前自检清单', () => {
    const { api } = create();
    const flags = Object.fromEntries(Object.keys(allOn).map((k) => [k, false]));
    const md = api.buildAgentsTemplate(flags);
    assert.ok(md.includes('交付前自检清单'), '自检清单为固定章节');
    assert.ok(!md.includes('## 1. 项目概览'), '关闭的章节不应出现');
  });

  await t.test('readExcludeEntries 回退默认值避免空清单', () => {
    const { api, setValue } = create();
    setValue('global-exclude-textarea', '   \n\n');
    const md = api.buildAgentsTemplate(allOn);
    assert.ok(md.includes('- `node_modules`'), '空黑名单应回退内置默认值');
  });
});
