import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SpillBlobService } from '../src/spill-service.ts';


test('TC-01-02-003: 会话私有 Spill Blobs 隔离存储与删除清理服务', async (t) => {
  const tmpBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-spill-test-'));

  t.after(() => {
    fs.rmSync(tmpBaseDir, { recursive: true, force: true });
  });

  const spillService = new SpillBlobService({
    dataDir: tmpBaseDir,
    thresholdBytes: 1024, // 测试设定 1KB 溢出阈值
  });

  const sessionId = 'sess_spill_demo';

  await t.test('未超阈值内容不触发 Spill 溢出', () => {
    const smallContent = '短日志，仅有几十字节';
    const result = spillService.spillIfNeeded(sessionId, smallContent);

    assert.equal(result.isSpilled, false);
    assert.equal(result.payload, smallContent);
    assert.equal(result.sha256, undefined);
  });

  await t.test('超过 1KB 内容自动存入会话私有 blobs 目录并返回摘要指针', () => {
    // 构造 2KB 的超长日志
    const bigContent = 'Log-Line-Entry-'.repeat(150);
    assert.ok(Buffer.byteLength(bigContent) > 1024);

    const result = spillService.spillIfNeeded(sessionId, bigContent);

    assert.equal(result.isSpilled, true);
    assert.ok(result.sha256 !== undefined);
    assert.ok(result.payload.startsWith('[SPILL_BLOB:'));
    assert.ok(result.payload.includes(result.sha256!));

    // 物理文件校验
    const blobFilePath = path.join(tmpBaseDir, 'sessions', sessionId, 'blobs', `${result.sha256}.txt`);
    assert.equal(fs.existsSync(blobFilePath), true);
    assert.equal(fs.readFileSync(blobFilePath, 'utf8'), bigContent);
  });

  await t.test('删除会话时原子清理该会话的私有 blobs 目录', () => {
    const sessionDir = path.join(tmpBaseDir, 'sessions', sessionId);
    assert.equal(fs.existsSync(sessionDir), true);

    spillService.cleanSessionBlobs(sessionId);

    // 目录及其子文件被彻底清空
    assert.equal(fs.existsSync(sessionDir), false);
  });
});
