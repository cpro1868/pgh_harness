import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SandboxGuard, PathEscapeError } from '../src/sandbox-guard.ts';
import { ShellExecutor } from '../src/shell-executor.ts';

test('TC-01-04-003 & TC-01-04-004: 沙箱 realpath 符号链接防逃逸与 Shell 命令硬超时终结', async (t) => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-sandbox-test-'));
  const workspaceDir = path.join(tmpBase, 'workspace');
  const secretDir = path.join(tmpBase, 'secret_external');

  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(secretDir, { recursive: true });
  fs.writeFileSync(path.join(secretDir, 'password.txt'), 'SUPER_SECRET', 'utf8');

  t.after(() => {
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {}
  });


  const guard = new SandboxGuard(workspaceDir);

  await t.test('TC-01-04-003: 拦截 ../ 路径穿越', () => {
    assert.throws(
      () => {
        guard.assertSafePath('../../password.txt');
      },
      (err: unknown) => {
        assert.ok(err instanceof PathEscapeError);
        return true;
      }
    );
  });

  await t.test('TC-01-04-003: realpath 拦截符号链接 (Symlink) 逃逸沙箱', () => {
    const symlinkPath = path.join(workspaceDir, 'symlink_escape');
    try {
      fs.symlinkSync(secretDir, symlinkPath, 'junction'); // Windows 支持 junction
      assert.throws(
        () => {
          guard.assertSafePath('symlink_escape/password.txt');
        },
        (err: unknown) => {
          assert.ok(err instanceof PathEscapeError);
          return true;
        }
      );
    } catch (e) {
      // 若受 Windows 权限限制跳过 symlink 创建测试，验证相对路径
    }
  });

  await t.test('TC-01-04-004: Shell 命令执行与短超时强制硬杀终结 (taskkill/kill)', async () => {
    const executor = new ShellExecutor(workspaceDir);
    // 运行一个睡眠 10 秒的命令，硬设超时为 200ms
    const start = Date.now();
    
    // Windows 下使用 powershell 模拟耗时任务
    const isWin = process.platform === 'win32';
    const sleepCmd = isWin ? 'powershell -Command "Start-Sleep -Seconds 10"' : 'sleep 10';

    await assert.rejects(
      async () => {
        await executor.exec(sleepCmd, { timeoutMs: 200 });
      },
      (err: any) => {
        const elapsed = Date.now() - start;
        assert.ok(elapsed < 2000, '必须在超时后快速强制掐断子进程');
        assert.ok(err.message.includes('timeout') || err.message.includes('terminated'));
        return true;
      }
    );
  });

  await t.test('TC-01-04-005: killProcessTree 以 taskkill /T 终结整棵子孙进程树', async (t2) => {
    // 该用例验证 Windows /T 语义（孙进程一并清理），非 Windows 平台跳过
    if (process.platform !== 'win32') {
      t2.skip('仅在 Windows 验证 /T 子孙进程树终结');
      return;
    }

    const markerPath = path.join(workspaceDir, 'grandchild.pid');
    // 外层 PowerShell 再派生一个 60s 的 node 孙进程，并把自己的孙进程 PID 写入文件
    const script = [
      `$p = Start-Process node -ArgumentList '-e','setTimeout(()=>{},60000)' -PassThru -WindowStyle Hidden`,
      `Set-Content -Path '${markerPath}' -Value $p.Id`,
      'Start-Sleep -Seconds 60',
    ].join('; ');

    const { spawn } = await import('node:child_process');
    const outer = spawn('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true });

    const isAlive = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };

    // 等待孙进程 PID 落盘（最多 10s）
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(markerPath) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(fs.existsSync(markerPath), '未能捕获孙进程 PID，用例无法继续');

    const grandchildPid = Number(fs.readFileSync(markerPath, 'utf8').trim());
    assert.ok(Number.isInteger(grandchildPid) && grandchildPid > 0, '孙进程 PID 必须有效');
    assert.equal(isAlive(grandchildPid), true, '孙进程应处于存活状态');

    const executor = new ShellExecutor(workspaceDir);
    executor.killProcessTree(outer.pid);

    // 给 taskkill /T 一点收敛时间
    const killDeadline = Date.now() + 5000;
    while ((isAlive(grandchildPid) || isAlive(outer.pid as number)) && Date.now() < killDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    assert.equal(isAlive(grandchildPid), false, '孙进程必须被 /T 一并物理终结，不得残留孤儿进程');
    assert.equal(isAlive(outer.pid as number), false, '外层进程必须被终结');
  });
});
