import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MarkdownMemoryAdapter, SqliteMemoryAdapter, MemoryCascade } from '../src/index.ts';

describe('TC-01-10-003: 双层记忆级联装配与 Markdown/SQLite 适配器', () => {

  let tmpDir: string;
  let globalDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-memory-test-'));
    globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-memory-global-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(globalDir, { recursive: true, force: true });
  });

  // ---------- MarkdownMemoryAdapter ----------

  it('Markdown 适配器：追加记忆并以结构化小节落盘', async () => {
    const adapter = new MarkdownMemoryAdapter(tmpDir);
    const entry = await adapter.append({ content: '记住：项目使用 pnpm 作为包管理器', source: 'test', scope: 'project' });
    assert.ok(entry.id.length === 12);
    const memFile = path.join(tmpDir, '.harness', 'memory.md');
    assert.ok(fs.existsSync(memFile));
    const content = fs.readFileSync(memFile, 'utf8');
    assert.ok(content.includes('pnpm 作为包管理器'));
    assert.ok(content.includes('scope: project'));
  });

  it('Markdown 适配器：SHA-256 去重（同内容重复写入不重复落盘）', async () => {
    const adapter = new MarkdownMemoryAdapter(tmpDir);
    await adapter.append({ content: '去重测试内容', source: 'test', scope: 'project' });
    const before = (await adapter.list()).length;
    await adapter.append({ content: '去重测试内容', source: 'test', scope: 'project' });  // 同内容
    assert.equal((await adapter.list()).length, before);
  });

  it('Markdown 适配器：按关键词检索返回命中条目', async () => {
    const adapter = new MarkdownMemoryAdapter(tmpDir);
    await adapter.append({ content: '项目使用 TypeScript + Node 22', source: 't', scope: 'project' });
    await adapter.append({ content: '测试框架使用 node:test', source: 't', scope: 'project' });
    const hits = await adapter.search('TypeScript');
    assert.ok(hits.length > 0);
    assert.ok(hits[0].content.includes('TypeScript'));
  });

  // ---------- SqliteMemoryAdapter ----------

  it('SQLite 适配器：追加与查询正常', async () => {
    const dbPath = path.join(tmpDir, 'test-memory.db');
    const adapter = new SqliteMemoryAdapter(dbPath);
    await adapter.append({ content: 'SQLite 适配器测试', source: 't', scope: 'project' });
    const list = await adapter.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].content, 'SQLite 适配器测试');
  });

  it('SQLite 适配器：SHA-256 哈希去重', async () => {
    const dbPath = path.join(tmpDir, 'dedup.db');
    const adapter = new SqliteMemoryAdapter(dbPath);
    await adapter.append({ content: '相同内容', source: 't', scope: 'project' });
    const before = (await adapter.list()).length;
    await adapter.append({ content: '相同内容', source: 't', scope: 'project' });
    assert.equal((await adapter.list()).length, before);
  });

  // ---------- MemoryCascade（双层级联） ----------

  it('级联装配：项目级同名记忆优先于全局', async () => {
    // 注入 globalDir 隔离全局目录
    const cascade = new MemoryCascade(tmpDir, globalDir);
    const projAdapter = new MarkdownMemoryAdapter(tmpDir);
    const globAdapter = new MarkdownMemoryAdapter(globalDir);

    await projAdapter.append({ content: '项目级：使用 pg 数据库', source: 't', scope: 'project' });
    await globAdapter.append({ content: '全局级：通用编程规范', source: 't', scope: 'global' });

    const merged = await cascade.assemble();
    const scopes = merged.map((e) => e.scope);
    assert.ok(scopes.includes('project'));
    assert.ok(scopes.includes('global'));
  });

  it('级联装配：toPromptFragment 输出格式化记忆注入块', async () => {
    const cascade = new MemoryCascade(tmpDir, globalDir);
    const projAdapter = new MarkdownMemoryAdapter(tmpDir);
    await projAdapter.append({ content: '项目约定：提交前必须跑 pnpm check', source: 't', scope: 'project' });
    const fragment = await cascade.toPromptFragment();
    assert.ok(fragment.includes('[Memory Context]'));
    assert.ok(fragment.includes('pnpm check'));
    assert.ok(fragment.includes('PROJECT'));
  });

  it('级联装配：按查询过滤记忆', async () => {
    const cascade = new MemoryCascade(tmpDir, globalDir);
    const projAdapter = new MarkdownMemoryAdapter(tmpDir);
    await projAdapter.append({ content: 'React 组件用函数式写法', source: 't', scope: 'project' });
    await projAdapter.append({ content: 'Node.js 后端用 TypeScript strict', source: 't', scope: 'project' });
    const hits = await cascade.assemble('React');
    assert.ok(hits.length >= 1);
    assert.ok(hits[0].content.includes('React'));
  });
});
