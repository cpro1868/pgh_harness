import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MarkdownMemoryAdapter, SqliteMemoryAdapter, migrateMemory } from '../src/index.ts';

describe('TC-01-10-004: 记忆受控迁移向导与备份', () => {

  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-migration-test-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('平滑无损迁移：Markdown 条目无损导入 SQLite，并生成 .bak 备份', async () => {
    const mdAdapter = new MarkdownMemoryAdapter(tmpDir);
    await mdAdapter.append({ content: '记忆 1：不要动生产配置', source: 'turn_1', scope: 'project' });
    await mdAdapter.append({ content: '记忆 2：全部单测跑 node:test', source: 'turn_2', scope: 'project' });

    const targetDb = path.join(tmpDir, 'migrated.db');
    const result = await migrateMemory({
      workspacePath: tmpDir,
      targetDbPath: targetDb,
      mode: 'lossless-migrate',
    });

    assert.equal(result.migrated, 2);
    assert.equal(result.skipped, 0);
    assert.ok(result.backupPath);
    assert.ok(fs.existsSync(result.backupPath!));

    // 检查 SQLite 数据
    const sqliteAdapter = new SqliteMemoryAdapter(targetDb);
    const rows = await sqliteAdapter.list();
    assert.equal(rows.length, 2);
    assert.ok(rows.some(r => r.content.includes('不要动生产配置')));
  });

  it('平滑迁移幂等性：二次迁移因 SHA-256 指纹相同而跳过', async () => {
    const mdAdapter = new MarkdownMemoryAdapter(tmpDir);
    await mdAdapter.append({ content: '重复条目', source: 't', scope: 'project' });
    const targetDb = path.join(tmpDir, 'dedup-test.db');

    await migrateMemory({ workspacePath: tmpDir, targetDbPath: targetDb, mode: 'lossless-migrate' });
    // 二次迁移
    const second = await migrateMemory({ workspacePath: tmpDir, targetDbPath: targetDb, mode: 'lossless-migrate' });
    assert.equal(second.migrated, 0);
    assert.equal(second.skipped, 1);
  });

  it('全新起步模式：保留 .bak 备份，原记忆文件清空，目标全新启动', async () => {
    const mdAdapter = new MarkdownMemoryAdapter(tmpDir);
    await mdAdapter.append({ content: '旧测试数据', source: 'test', scope: 'project' });

    const result = await migrateMemory({
      workspacePath: tmpDir,
      mode: 'fresh-start',
    });

    assert.ok(result.backupPath);
    assert.ok(fs.existsSync(result.backupPath!));
    // 备份包含旧数据
    assert.ok(fs.readFileSync(result.backupPath!, 'utf8').includes('旧测试数据'));
    // 原文件已被清空或重置
    const remaining = await mdAdapter.list();
    assert.equal(remaining.length, 0);
  });
});
