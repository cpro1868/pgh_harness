import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export class MasterKeyError extends Error {
  constructor(message: string) {
    super(`[Security] ${message}`);
    this.name = 'MasterKeyError';
  }
}

/** 允许通过环境变量注入主密钥（便于容器化部署与 CI）。 */
export const MASTER_KEY_ENV = 'PGH_MASTER_KEY';

const KEY_BYTES = 32;
const HEX_PATTERN = /^[0-9a-f]{64}$/i;

/**
 * 解析应用主密钥（安全工程方法论 §4.1 / BL-07）。
 *
 * 优先级：环境变量 `PGH_MASTER_KEY` → 数据目录下已存在的 `master.key` → 随机生成并落盘。
 * **任何情况下都不得硬编码**：固定主密钥会让 AES-256-GCM 的强度归零 ——
 * 任何拿到数据库文件的人都能解出其中的 API Key。
 *
 * @param dataDir - 数据目录（`~/.pg_harness`）。
 * @returns 64 位十六进制的主密钥。
 * @throws MasterKeyError 当环境变量或密钥文件格式非法时（拒绝启动，不静默降级）。
 */
export function resolveMasterKey(dataDir: string): string {
  const fromEnv = process.env[MASTER_KEY_ENV];
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    const candidate = fromEnv.trim();
    if (!HEX_PATTERN.test(candidate)) {
      throw new MasterKeyError(
        `${MASTER_KEY_ENV} 必须是 64 位十六进制字符串（32 字节），当前长度 ${candidate.length}`,
      );
    }
    return candidate.toLowerCase();
  }

  const keyPath = path.join(dataDir, 'master.key');
  if (fs.existsSync(keyPath)) {
    const existing = fs.readFileSync(keyPath, 'utf8').trim();
    if (!HEX_PATTERN.test(existing)) {
      throw new MasterKeyError(`主密钥文件格式非法（应为 64 位十六进制）: ${keyPath}`);
    }
    return existing.toLowerCase();
  }

  const generated = crypto.randomBytes(KEY_BYTES).toString('hex');
  fs.mkdirSync(dataDir, { recursive: true });
  // ponytail: `wx` 独占创建 —— 若文件已存在则失败而非覆盖，阻断符号链接重定向；
  // mode 0600 在 Windows 上不被强制（依赖用户目录 ACL），POSIX 下即"仅当前用户可读写"。
  // 天花板：需要更强保护时应接入 OS 密钥库（Windows Credential Manager / Keychain / libsecret）。
  fs.writeFileSync(keyPath, generated, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return generated;
}
