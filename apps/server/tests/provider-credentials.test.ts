import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { HarnessServer } from '../src/index.ts';
import { encryptSecret, decryptSecret } from '../src/security/crypto.ts';
import { SqliteDatabase, ProviderStore } from '../../../packages/plugins/storage-sqlite/src/index.ts';

interface PublicProvider {
  id: string;
  hasApiKey: boolean;
  decryptable: boolean;
  apiKeyMasked: string | null;
  apiKeyCipher?: string;
}

test('BL-08: 凭据读路径只回掩码，绝不回传密文', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-provider-cred-'));
  const dataDir = path.join(tmpDir, 'data');
  const testPort = 3303;
  const plainKey = 'sk-custom-secret-1234567890';

  const server = new HarnessServer({ port: testPort, dataDir });
  const base = `http://127.0.0.1:${testPort}`;

  t.after(async () => {
    await server.stop().catch(() => undefined);
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  await server.start();

  await t.test('创建后：响应与列表均不含密文，只暴露掩码', async () => {
    const createRes = await fetch(`${base}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'p-mask',
        name: 'Mask Provider',
        protocol: 'openai-compatible',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: plainKey,
        models: [],
      }),
    });
    const created = (await createRes.json()) as { data: PublicProvider };
    assert.equal(created.data.apiKeyCipher, undefined, '创建响应不得回传密文');
    assert.equal(created.data.hasApiKey, true);
    assert.equal(created.data.decryptable, true);
    assert.equal(created.data.apiKeyMasked, 'sk-cust****7890', '掩码应保留前 7 与后 4 位');

    const listRes = await fetch(`${base}/api/providers`);
    const list = (await listRes.json()) as { data: PublicProvider[] };
    const target = list.data.find((item) => item.id === 'p-mask')!;
    assert.equal(target.apiKeyCipher, undefined, '列表响应不得回传密文');
    assert.equal(target.apiKeyMasked, 'sk-cust****7890');

    const serialized = JSON.stringify(list.data);
    assert.equal(serialized.includes('apiKeyCipher'), false, '响应体任何位置都不应出现 apiKeyCipher');
    assert.equal(serialized.includes('enc:v1:'), false, '响应体不应出现密文信封');
    assert.equal(serialized.includes(plainKey), false, '响应体绝不能出现明文密钥');
    assert.equal(
      serialized.includes(plainKey.slice(7, -4)),
      false,
      '掩码中间段必须被打掉，不得泄露密钥主体',
    );
  });

  await t.test('历史数据透明升级：旧固定密钥加密的凭据首次访问自动用 master.key 重加密落盘', async () => {
    // 模拟旧版本用固定密钥写入的一条记录
    const legacyKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const legacyCipher = encryptSecret('sk-legacy-auto-migrate-key-1234', legacyKey);

    const sideDb = new SqliteDatabase(path.join(dataDir, 'pgh.db'));
    sideDb.initialize();
    try {
      new ProviderStore(sideDb).upsert({
        id: 'p-migrate',
        name: 'Auto Migrate Provider',
        protocol: 'openai-compatible',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKeyCipher: legacyCipher,
        proxy: { enabled: false, mode: 'inherit' },
        models: [],
      });
    } finally {
      sideDb.close();
    }

    const listRes = await fetch(`${base}/api/providers`);
    const list = (await listRes.json()) as { data: PublicProvider[] };
    const migrated = list.data.find((item) => item.id === 'p-migrate')!;

    assert.equal(migrated.decryptable, true, '旧数据在首次访问时应成功解密并完成单向迁移');
    assert.equal(migrated.apiKeyMasked, 'sk-lega****1234');

    // 查库验证：落盘的 cipher 必须已被替换为本机 master.key 加密的新密文，不再是旧 cipher
    const verifyDb = new SqliteDatabase(path.join(dataDir, 'pgh.db'));
    verifyDb.initialize();
    try {
      const stored = new ProviderStore(verifyDb).get('p-migrate')!;
      assert.notEqual(stored.apiKeyCipher, legacyCipher, '落盘密文必须已替换，完成单向升级');
      assert.throws(
        () => decryptSecret(stored.apiKeyCipher, legacyKey),
        /Authentication tag mismatch|unable to authenticate/i,
        '新密文不得再被旧固定密钥解出，证明依赖彻底切断',
      );
    } finally {
      verifyDb.close();
    }
  });

  await t.test('主密钥变更后：如实报告不可解密，并提示重新输入', async () => {
    // 用另一把主密钥加密后写入同一张表，模拟"换了 master.key 的旧数据"
    const foreignCipher = encryptSecret('sk-legacy-key-0987654321', crypto.randomBytes(32).toString('hex'));
    const sideDb = new SqliteDatabase(path.join(dataDir, 'pgh.db'));
    sideDb.initialize();
    try {
      new ProviderStore(sideDb).upsert({
        id: 'p-legacy',
        name: 'Legacy Provider',
        protocol: 'openai-compatible',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKeyCipher: foreignCipher,
        proxy: { enabled: false, mode: 'inherit' },
        models: [],
      });
    } finally {
      sideDb.close();
    }

    const listRes = await fetch(`${base}/api/providers`);
    const list = (await listRes.json()) as { data: PublicProvider[] };
    const legacy = list.data.find((item) => item.id === 'p-legacy')!;

    assert.equal(legacy.hasApiKey, true, '应如实说明"存在已存凭据"');
    assert.equal(legacy.decryptable, false, '用旧主密钥加密的数据必须报告为不可解密');
    assert.equal(legacy.apiKeyMasked, null, '不可解密时不得给出任何掩码');
    assert.equal(JSON.stringify(legacy).includes('enc:v1:'), false, '不可解密项同样不得泄露密文');
  });

  await t.test('编辑 Provider 留空 Key 不得覆盖既有凭据（回归防线）', async () => {
    const originalKey = 'sk-original-key-abcdefghij';
    await fetch(`${base}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'p-edit',
        name: 'Edit Target',
        protocol: 'openai-compatible',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: originalKey,
        models: [],
      }),
    });

    const maskOf = async (): Promise<string | null> => {
      const res = await fetch(`${base}/api/providers`);
      const list = (await res.json()) as { data: PublicProvider[] };
      return list.data.find((item) => item.id === 'p-edit')!.apiKeyMasked;
    };
    const expectedMask = 'sk-orig****ghij';

    assert.equal(await maskOf(), expectedMask);

    // 模拟"只改名称/模型、不重填 Key"的编辑保存
    const editRes = await fetch(`${base}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'p-edit',
        name: 'Edit Target Renamed',
        protocol: 'openai-compatible',
        baseUrl: 'https://api.deepseek.com/v1',
        models: [{ id: 'm1', name: 'm1', contextWindow: 65536 }],
      }),
    });
    assert.equal(editRes.status, 200);

    assert.equal(
      await maskOf(),
      expectedMask,
      '留空保存必须保持原凭据不变（旧实现会把它覆盖成占位串导致密钥被毁）',
    );

    // 显式传入新 Key 时必须真正更新
    await fetch(`${base}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'p-edit',
        name: 'Edit Target Renamed',
        protocol: 'openai-compatible',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-rotated-key-zyxwvutsrq',
        models: [],
      }),
    });
    assert.equal(await maskOf(), 'sk-rota****tsrq', '显式传入的新 Key 必须生效');
  });

  await t.test('探测模型时 Key 留空则回落已保存凭据', async () => {
    const storedKey = 'sk-probe-stored-key-123456';
    const receivedAuth: string[] = [];

    const probeStub = http.createServer((req, res) => {
      receivedAuth.push(String(req.headers.authorization ?? ''));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'probe-model', object: 'model' }] }));
    });
    await new Promise<void>((resolve) => { probeStub.listen(0, '127.0.0.1', () => resolve()); });
    const stubAddr = probeStub.address();
    const stubPort = typeof stubAddr === 'object' && stubAddr ? stubAddr.port : 0;

    try {
      await fetch(`${base}/api/providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'p-probe',
          name: 'Probe Target',
          protocol: 'openai-compatible',
          baseUrl: `http://127.0.0.1:${stubPort}`,
          apiKey: storedKey,
          models: [],
        }),
      });

      const res = await fetch(`${base}/api/providers/models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          protocol: 'openai-compatible',
          baseUrl: `http://127.0.0.1:${stubPort}`,
          apiKey: '',
          providerId: 'p-probe',
        }),
      });
      assert.equal(res.status, 200);
      assert.deepEqual(receivedAuth, [`Bearer ${storedKey}`], '留空时必须用已保存凭据发起探测');
    } finally {
      await new Promise<void>((resolve) => { probeStub.close(() => resolve()); });
    }
  });

  await t.test('例外 E-01：编辑弹窗可按需读取单个 Provider 明文，但列表仍只回掩码', async () => {
    const secretKey = 'sk-reveal-me-plaintext-9876';
    await fetch(`${base}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'p-reveal',
        name: 'Reveal Target',
        protocol: 'openai-compatible',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: secretKey,
        models: [],
      }),
    });

    const secretRes = await fetch(`${base}/api/providers/p-reveal/secret`);
    assert.equal(secretRes.status, 200, '回环来源应允许按需读取单个 Provider 的明文');
    const secretBody = (await secretRes.json()) as { data: { id: string; apiKey: string } };
    assert.equal(secretBody.data.apiKey, secretKey, '返回的必须是可直接回显的完整明文');

    const unknownRes = await fetch(`${base}/api/providers/p-does-not-exist/secret`);
    assert.equal(unknownRes.status, 404, '未知 Provider 必须 404');

    // BL-08 仍须保持闭合：列表接口绝不因该例外而泄露明文或密文
    const listRes = await fetch(`${base}/api/providers`);
    const listText = await listRes.text();
    assert.equal(listText.includes(secretKey), false, '列表接口绝不能出现明文');
    assert.equal(listText.includes('enc:v1:'), false, '列表接口绝不能出现密文');
    assert.equal(listText.includes('apiKeyCipher'), false, '列表接口仍不得暴露密文字段');
  });
});
