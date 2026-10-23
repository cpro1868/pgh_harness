import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HarnessServer } from '../src/index.ts';

describe('TC-01-08-001: 工作区并发写锁互斥集成测试 (HTTP 409 Conflict)', () => {
  let tmpDir: string;
  let server: HarnessServer;
  const testPort = 3339;
  const base = `http://127.0.0.1:${testPort}`;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-lock-integration-test-'));
    server = new HarnessServer({
      port: testPort,
      dataDir: path.join(tmpDir, 'data'),
    });
    await server.start();
  });

  after(async () => {
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('当工作区已被活跃任务锁定时，其他任务发起并发写入必须严格返回 409 Conflict (fail-closed)', async () => {
    const wsDir = path.join(tmpDir, 'workspace-target');
    fs.mkdirSync(wsDir, { recursive: true });

    // 1. 模拟一个正在运行的任务抢占并持有该工作区的写锁
    // 直接调用写锁管理器尝试加锁
    const acquired = server.writeLocks.tryAcquire(wsDir, 'task_holder_A');
    assert.equal(acquired, true, '首个任务必须成功获取工作区写锁');

    // 2. 发起流水线任务启动接口，目标工作区指向同一个 wsDir
    const startRes = await fetch(`${base}/api/pipeline-instances/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspacePath: wsDir,
        instruction: '执行并发写操作测试',
        stages: [{ id: 's1', roleName: 'Tester', order: 1 }],
      }),
    });

    // 3. 必须命中 409 Conflict，严禁无锁硬跑破坏文件系统
    assert.equal(startRes.status, 409, '并发写入必须返回 HTTP 409 Conflict');
    const json = (await startRes.json()) as { code: number; message: string };
    assert.equal(json.code, 409);
    assert.ok(json.message.includes('工作区正在被其他任务写入'), '报错信息必须明确提示写锁冲突与持有者');

    // 4. 释放前任锁后，检查持有者已被清除
    server.writeLocks.release(wsDir, 'task_holder_A');
    assert.equal(Boolean(server.writeLocks.holder(wsDir)), false);
  });
});
