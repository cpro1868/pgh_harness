import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { resolveMasterKey, MasterKeyError, MASTER_KEY_ENV } from '../src/security/master-key.ts';
import { encryptSecret, decryptSecret } from '../src/security/crypto.ts';

test('BL-07: 主密钥必须来自环境变量或随机生成的 master.key，绝不允许硬编码', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-masterkey-'));
  t.after(() => {
    delete process.env[MASTER_KEY_ENV];
    fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  await t.test('未设置环境变量时自动生成 256-bit 随机密钥并落盘', () => {
    delete process.env[MASTER_KEY_ENV];
    const dataDir = path.join(tmpRoot, 'data-a');
    const key = resolveMasterKey(dataDir);

    assert.match(key, /^[0-9a-f]{64}$/, '主密钥必须是 64 位十六进制（32 字节）');
    const keyPath = path.join(dataDir, 'master.key');
    assert.ok(fs.existsSync(keyPath), 'master.key 必须落盘以便重启后仍能解密');
    assert.equal(fs.readFileSync(keyPath, 'utf8').trim(), key);
  });

  await t.test('不同数据目录生成不同密钥（证明不再是固定常量）', () => {
    delete process.env[MASTER_KEY_ENV];
    const first = resolveMasterKey(path.join(tmpRoot, 'data-b'));
    const second = resolveMasterKey(path.join(tmpRoot, 'data-c'));
    assert.notEqual(first, second, '不同实例必须持有不同密钥；相等即说明仍在使用固定值');
  });

  await t.test('同一数据目录多次解析得到同一密钥（保证历史密文可解密）', () => {
    delete process.env[MASTER_KEY_ENV];
    const dataDir = path.join(tmpRoot, 'data-d');
    const first = resolveMasterKey(dataDir);
    const again = resolveMasterKey(dataDir);
    assert.equal(first, again, '重启后必须能解出既有密文');
  });

  await t.test('端到端：一处加密、另一实例（同目录）可解密；换目录则解密失败', () => {
    delete process.env[MASTER_KEY_ENV];
    const dirA = path.join(tmpRoot, 'data-e');
    const dirB = path.join(tmpRoot, 'data-f');

    const cipher = encryptSecret('sk-super-secret', resolveMasterKey(dirA));
    assert.equal(decryptSecret(cipher, resolveMasterKey(dirA)), 'sk-super-secret', '同目录重启后应可解密');

    assert.throws(
      () => decryptSecret(cipher, resolveMasterKey(dirB)),
      /Authentication tag mismatch|unable to authenticate/i,
      '换到另一数据目录（另一密钥）必须解密失败 —— 这正是硬编码主密钥会掩盖的风险',
    );
  });

  await t.test('环境变量优先，且必须是合法长度', () => {
    const provided = crypto.randomBytes(32).toString('hex');
    process.env[MASTER_KEY_ENV] = provided;
    const dir = path.join(tmpRoot, 'data-g');
    assert.equal(resolveMasterKey(dir), provided);
    assert.equal(fs.existsSync(path.join(dir, 'master.key')), false, '环境变量已提供时不应再生成文件');

    process.env[MASTER_KEY_ENV] = 'not-a-valid-key';
    assert.throws(() => resolveMasterKey(dir), MasterKeyError, '非法长度必须拒绝启动而不是静默降级');
  });

  await t.test('已存在的密钥文件若被篡改格式则拒绝启动', () => {
    delete process.env[MASTER_KEY_ENV];
    const dataDir = path.join(tmpRoot, 'data-h');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'master.key'), 'corrupted!!', 'utf8');
    assert.throws(() => resolveMasterKey(dataDir), MasterKeyError);
  });

  await t.test('源码中不得存在硬编码主密钥常量（单向升级过渡密钥除外）', () => {
    const indexSource = fs.readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    assert.equal(
      /DEFAULT_MASTER_KEY\s*=\s*'/.test(indexSource),
      false,
      'index.ts 不得再出现 DEFAULT_MASTER_KEY 常量（BL-07 回归防线）',
    );
  });
});
