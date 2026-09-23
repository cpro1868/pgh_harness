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
      fs.mkdirSync(sessionBlobsDir, { recursive: true });
    }

    const sha256 = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
    const blobPath = path.join(sessionBlobsDir, `${sha256}.txt`);

    if (!fs.existsSync(blobPath)) {
      fs.writeFileSync(blobPath, content, 'utf8');
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
