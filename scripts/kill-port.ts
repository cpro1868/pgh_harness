import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const port = Number(process.argv[2] || 3210);
const lockFile = path.join(os.homedir(), '.pg_harness', '.lock');

// 1. 清理锁文件
try {
  if (fs.existsSync(lockFile)) {
    fs.unlinkSync(lockFile);
  }
} catch {}

// 2. 用跨平台标准查杀端口占用
try {
  if (process.platform === 'win32') {
    const netstatOut = execSync(`netstat -ano -p tcp`, { encoding: 'utf8' });
    const lines = netstatOut.split('\n');
    const pids = new Set<string>();
    for (const line of lines) {
      if (line.includes(`:${port}`) && line.includes('LISTENING')) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0' && pid !== String(process.pid)) {
          pids.add(pid);
        }
      }
    }
    for (const p of pids) {
      try {
        execSync(`taskkill /pid ${p} /T /F`, { stdio: 'ignore' });
        console.log(`[OK] Terminated PID: ${p}`);
      } catch {}
    }
  }
} catch {}

console.log(`[OK] Port ${port} is clean.`);
