import fs from 'node:fs';
import path from 'node:path';

export interface LockOptions {
  dataDir: string;
  port: number;
  pid?: number;
}


export interface LockResult {
  acquired: boolean;
  lockPath: string;
  existingPid?: number;
  existingPort?: number;
}

interface LockFileContent {
  pid: number;
  port: number;
  createdAt: number;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireInstanceLock(options: LockOptions): LockResult {
  const { dataDir, port, pid = process.pid } = options;
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const lockPath = path.join(dataDir, '.lock');

  if (fs.existsSync(lockPath)) {
    try {
      const content = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as LockFileContent;
      if (content && typeof content.pid === 'number') {
        if (isProcessAlive(content.pid)) {
          return {
            acquired: false,
            lockPath,
            existingPid: content.pid,
            existingPort: content.port,
          };
        }
      }
    } catch {
      // 残留损坏的锁文件直接覆盖
    }
  }

  const payload: LockFileContent = {
    pid,
    port,
    createdAt: Date.now(),
  };

  fs.writeFileSync(lockPath, JSON.stringify(payload, null, 2), 'utf8');

  return {
    acquired: true,
    lockPath,
  };
}

export function releaseInstanceLock(dataDir: string): void {
  const lockPath = path.join(dataDir, '.lock');
  try {
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    // 忽略删除失败
  }
}
