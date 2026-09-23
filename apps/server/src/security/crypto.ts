import crypto from 'node:crypto';

export class AuthenticationTagMismatchError extends Error {
  constructor(message = 'Ciphertext authentication tag mismatch or payload corrupted') {
    super(`[Security] ${message}`);
    this.name = 'AuthenticationTagMismatchError';
  }
}

export function encryptSecret(plainText: string, masterKeyHex: string): string {
  const key = Buffer.from(masterKeyHex, 'hex');
  const iv = crypto.randomBytes(12); // GCM 推荐 12 字节 IV
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');

  // 格式: enc:v1:<ivHex>:<cipherHex>:<authTagHex>
  return `enc:v1:${iv.toString('hex')}:${encrypted}:${authTag}`;
}

export function decryptSecret(cipherText: string, masterKeyHex: string): string {
  if (!cipherText.startsWith('enc:v1:')) {
    throw new AuthenticationTagMismatchError('Invalid ciphertext prefix');
  }

  const parts = cipherText.split(':');
  if (parts.length !== 5) {
    throw new AuthenticationTagMismatchError('Malformed ciphertext envelope');
  }

  const [, , ivHex, encryptedHex, authTagHex] = parts;
  const key = Buffer.from(masterKeyHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err) {
    throw new AuthenticationTagMismatchError((err as Error).message);
  }
}
