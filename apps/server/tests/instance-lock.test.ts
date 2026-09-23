import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { acquireInstanceLock, releaseInstanceLock } from '../src/instance-lock.ts';


test('TC-01-01-002: 全局单实例文件锁防线与并发冲突拦截', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-lock-test-'));

  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test('首个实例成功获取锁并写入 PID 与 Port', () => {
    const lock = acquireInstanceLock({
      dataDir: tmpDir,
      port: 3000,
      pid: process.pid,
    });

    assert.equal(lock.acquired, true);
    assert.equal(lock.existingPid, undefined);

    const lockPath = path.join(tmpDir, '.lock');
    assert.equal(fs.existsSync(lockPath), true);

    const content = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    assert.equal(content.pid, process.pid);
    assert.equal(content.port, 3000);
  });

  await t.test('并发第二实例检测到锁冲突并安全拦截', () => {
    // 模拟第二个进程（端口设为 3001，但同一 dataDir）
    const secondLock = acquireInstanceLock({
      dataDir: tmpDir,
      port: 3001,
      pid: 999999, // 模拟另一个 PID
    });

    assert.equal(secondLock.acquired, false);
    assert.equal(secondLock.existingPid, process.pid);
    assert.equal(secondLock.existingPort, 3000);
  });

  await t.test('正常释放锁文件', () => {
    releaseInstanceLock(tmpDir);
    const lockPath = path.join(tmpDir, '.lock');
    assert.equal(fs.existsSync(lockPath), false);
  });
});
