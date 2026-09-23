import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret, AuthenticationTagMismatchError } from '../src/security/crypto.ts';


test('TC-01-01-003: AES-256-GCM 敏感凭据加解密与抗篡改测试', async (t) => {
  const masterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; // 32字节十六进制
  const plainText = 'sk-dsk-89f2a41234567890abcdef';

  await t.test('加密输出包含 enc:v1: 前缀且不泄露明文', () => {
    const cipherText = encryptSecret(plainText, masterKey);
    assert.equal(cipherText.startsWith('enc:v1:'), true);
    assert.equal(cipherText.includes(plainText), false);
    assert.ok(cipherText.length > 32);
  });

  await t.test('合法密文可精确无损解密为原明文', () => {
    const cipherText = encryptSecret(plainText, masterKey);
    const decrypted = decryptSecret(cipherText, masterKey);
    assert.equal(decrypted, plainText);
  });

  await t.test('密文被恶意篡改后解密立即报错防注入', () => {
    const cipherText = encryptSecret(plainText, masterKey);
    // 篡改密文正文部分的字符
    const parts = cipherText.split(':');
    const corruptedPayload = parts[2].slice(0, -2) + (parts[2].slice(-2) === 'aa' ? 'bb' : 'aa');
    const tampered = `${parts[0]}:${parts[1]}:${corruptedPayload}:${parts[3]}`;

    assert.throws(
      () => {
        decryptSecret(tampered, masterKey);
      },
      (err: unknown) => {
        assert.ok(err instanceof AuthenticationTagMismatchError);
        return true;
      }
    );
  });
});
