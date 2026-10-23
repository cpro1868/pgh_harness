import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface SpillOptions {
  dataDir: string;
  thresholdBytes?: number; // 默认 50KB (51200 字节)
}

export interface SpillResult {
  isSpilled: boolean;
  payload: string;
  sha256?: string;
  sizeBytes?: number;
}

export class SpillBlobService {
  private dataDir: string;
  private thresholdBytes: number;

  constructor(options: SpillOptions) {
    this.dataDir = options.dataDir;
    this.thresholdBytes = options.thresholdBytes ?? 51200; // 50KB
  }

  public spillIfNeeded(sessionId: string, content: string): SpillResult {
    const sizeBytes = Buffer.byteLength(content, 'utf8');

    if (sizeBytes <= this.thresholdBytes) {
      return {
        isSpilled: false,
        payload: content,
      };
    }

    // D68 决策：会话私有子目录隔离 ~/.harness/sessions/<id>/blobs/
    const sessionBlobsDir = path.join(this.dataDir, 'sessions', sessionId, 'blobs');
    if (!fs.existsSync(sessionBlobsDir)) {
      // 安全工程方法论 BL-09：目录严格限制为 0700 (只有宿主进程属主可读写遍历)
      fs.mkdirSync(sessionBlobsDir, { recursive: true, mode: 0o700 });
      try {
        fs.chmodSync(sessionBlobsDir, 0o700);
      } catch {}
    }

    const sha256 = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
    const blobPath = path.join(sessionBlobsDir, `${sha256}.txt`);

    if (!fs.existsSync(blobPath)) {
      // 安全工程方法论 BL-09：文件使用 wx 原子独占创建，严格限制为 0600 (仅属主可读写)
      try {
        fs.writeFileSync(blobPath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      } catch (e: unknown) {
        if ((e as { code?: string }).code !== 'EEXIST') {
          fs.writeFileSync(blobPath, content, { encoding: 'utf8', mode: 0o600 });
        }
      }
      try {
        fs.chmodSync(blobPath, 0o600);
      } catch {}
    }

    // 截取前 120 字作为人类可读摘要，附加寻址指针
    const summary = content.slice(0, 120).replace(/\r?\n/g, ' ');
    const pointer = `[SPILL_BLOB:${sha256}] ${summary}... (Total ${sizeBytes} bytes)`;

    return {
      isSpilled: true,
      payload: pointer,
      sha256,
      sizeBytes,
    };
  }

  public cleanSessionBlobs(sessionId: string): void {
    const sessionDir = path.join(this.dataDir, 'sessions', sessionId);
    if (fs.existsSync(sessionDir)) {
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      } catch {
        // 忽略清理失败
      }
    }
  }
}
