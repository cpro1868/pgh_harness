import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';

export interface ExecOptions {
  timeoutMs?: number; // 默认 120 秒
  workdir?: string;
  env?: Record<string, string>;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export class ShellExecutor {
  public readonly defaultWorkdir: string;

  constructor(defaultWorkdir: string) {
    this.defaultWorkdir = defaultWorkdir;
  }


  public exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    const timeoutMs = options.timeoutMs ?? 120000;
    const isWin = process.platform === 'win32';
    const workdir = options.workdir ?? this.defaultWorkdir;

    // 默认注入非交互环境变量 (D45)
    const env = {
      ...process.env,
      CI: 'true',
      GIT_TERMINAL_PROMPT: '0',
      PAGER: 'cat',
      ...options.env,
    };

    let shellExe: string;
    let shellArgs: string[];

    if (isWin) {
      // Windows Shell 探测降级与 ExecutionPolicy 绕过 (Q2)
      shellExe = 'powershell.exe';
      shellArgs = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command];
    } else {
      shellExe = '/bin/bash';
      shellArgs = ['-c', command];
    }

    return new Promise((resolve, reject) => {
      let child: ChildProcess;
      let timedOut = false;
      let timer: NodeJS.Timeout | null = null;

      try {
        child = spawn(shellExe, shellArgs, {
          cwd: workdir,
          env,
          windowsHide: true,
        });
      } catch (err) {
        return reject(err);
      }

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (d) => {
        stdout += d.toString();
      });

      child.stderr?.on('data', (d) => {
        stderr += d.toString();
      });

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          this.killProcessTree(child.pid);
          reject(new Error(`[ShellExecutor] Command timeout exceeded ${timeoutMs}ms and was terminated`));
        }, timeoutMs);
      }

      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        if (!timedOut) {
          resolve({ stdout, stderr, exitCode: code });
        }
      });

      child.on('error', (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      });
    });
  }

  /**
   * 跨平台进程树硬杀实现 (D18, D62)
   */
  public killProcessTree(pid?: number): void {
    if (!pid) return;
    const isWin = process.platform === 'win32';

    if (isWin) {
      // Windows 平台使用 taskkill /T /F 彻底硬杀整棵子进程树
      spawn('taskkill', ['/pid', pid.toString(), '/T', '/F'], { windowsHide: true });
    } else {
      // POSIX 平台发送负进程组信号
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {}
      }
    }
  }
}
