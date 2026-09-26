import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { revealInFileManager } from '../src/native-dialog.ts';
import { HarnessServer } from '../src/index.ts';

test('TC-01-08-007: 在系统文件管理器中显示工作区目录', async (t) => {
  await t.test('按平台选择文件管理器命令，且路径以数组参数传递（不经 shell）', () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const spawnFn = (command: string, args: string[]): { unref: () => void } => {
      calls.push({ command, args });
      return { unref: () => undefined };
    };

    const trickyPath = 'C:\\Projects\\my app & calc; rm -rf';

    assert.equal(revealInFileManager(trickyPath, { platform: 'win32', spawnFn }), 'explorer.exe');
    assert.equal(revealInFileManager(trickyPath, { platform: 'darwin', spawnFn }), 'open');
    assert.equal(revealInFileManager(trickyPath, { platform: 'linux', spawnFn }), 'xdg-open');

    assert.deepEqual(calls.map((call) => call.command), ['explorer.exe', 'open', 'xdg-open']);
    for (const call of calls) {
      assert.deepEqual(call.args, [trickyPath], '路径必须作为独立参数传递，含特殊字符也不得被解释为命令');
    }
  });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-reveal-'));
  const registeredDir = path.join(tmpDir, 'registered-proj');
  const missingDir = path.join(tmpDir, 'deleted-proj');
  const unregisteredDir = path.join(tmpDir, 'outsider-proj');
  fs.mkdirSync(registeredDir, { recursive: true });
  fs.mkdirSync(unregisteredDir, { recursive: true });

  const revealed: string[] = [];
  const testPort = 3307;
  const server = new HarnessServer({
    port: testPort,
    dataDir: path.join(tmpDir, 'data'),
    revealFn: (target) => { revealed.push(target); },
  });
  const base = `http://127.0.0.1:${testPort}`;

  t.after(async () => {
    await server.stop().catch(() => undefined);
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  await server.start();

  const reveal = (targetPath: unknown) =>
    fetch(`${base}/api/workspaces/reveal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: targetPath }),
    });

  await fetch(`${base}/api/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Registered', path: registeredDir }),
  });
  await fetch(`${base}/api/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Deleted', path: missingDir }),
  });

  await t.test('已登记且存在的目录：成功打开并被调用', async () => {
    const res = await reveal(registeredDir);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { code: number };
    assert.equal(body.code, 0);
    assert.deepEqual(revealed, [path.resolve(registeredDir)], '必须传入解析后的绝对路径');
  });

  await t.test('未登记的目录被拒绝（信任边界：不得打开任意路径）', async () => {
    const before = revealed.length;
    const res = await reveal(unregisteredDir);
    assert.equal(res.status, 403, '未登记路径必须 fail-closed 拒绝');
    const body = (await res.json()) as { message: string };
    assert.ok(body.message.includes('已登记'));
    assert.equal(revealed.length, before, '被拒绝的请求绝不触发打开动作');
  });

  await t.test('路径缺失或指向不存在的目录时拒绝', async () => {
    assert.equal((await reveal(undefined)).status, 403, '缺少路径参数应被拒绝');
    assert.equal((await reveal('')).status, 403);

    const res = await reveal(missingDir);
    assert.equal(res.status, 404, '已登记但目录已被删除时应明确报错');
  });
});
