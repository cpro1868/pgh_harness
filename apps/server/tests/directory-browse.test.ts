import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { listDirectory, createDirectory } from '../src/native-dialog.ts';

describe('TC-01-08-005: 目录浏览与新建子目录服务 (参考 deepseek-harness 架构)', () => {
  it('能够成功列出指定目录并计算正确层级的面包屑导航', async () => {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pgh-browse-test-'));
    const subA = path.join(tmpDir, 'child-a');
    const subB = path.join(tmpDir, 'child-b');
    await fs.promises.mkdir(subA);
    await fs.promises.mkdir(subB);

    try {
      const listing = await listDirectory(tmpDir);
      assert.equal(listing.current, path.resolve(tmpDir));
      assert.ok(listing.crumbs.length >= 1, '面包屑链不应为空');
      assert.equal(listing.crumbs[listing.crumbs.length - 1].path, path.resolve(tmpDir));

      const names = listing.entries.map((e) => e.name);
      assert.ok(names.includes('child-a'));
      assert.ok(names.includes('child-b'));
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('能够安全创建子目录并拦截非法命名', async () => {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pgh-create-test-'));
    try {
      const newDir = await createDirectory(tmpDir, 'test-project-dir');
      assert.ok(fs.existsSync(newDir));
      assert.equal(path.basename(newDir), 'test-project-dir');

      // 拦截非法字符与路径穿越
      await assert.rejects(async () => {
        await createDirectory(tmpDir, '../evil-path');
      });
      await assert.rejects(async () => {
        await createDirectory(tmpDir, 'foo/bar');
      });
      await assert.rejects(async () => {
        await createDirectory(tmpDir, '   ');
      });
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
