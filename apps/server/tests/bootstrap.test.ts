import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HarnessServer } from '../src/index.ts';

interface BootstrapStatus {
  code: number;
  data: {
    hasProvider: boolean;
    hasWorkspace: boolean;
    wizardCompleted: boolean;
    needsWizard: boolean;
  };
}

test('TC-01-08-005: 首次启动破冰向导冷启动检测与完成标记（WBS-01-08-04 / D57）', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bootstrap-'));
  const dataDir = path.join(tmpDir, 'data');
  const wsDir = path.join(tmpDir, 'first-project');
  fs.mkdirSync(wsDir, { recursive: true });

  const testPort = 3296;
  const server = new HarnessServer({ port: testPort, dataDir });
  const base = `http://127.0.0.1:${testPort}`;

  t.after(async () => {
    await server.stop().catch(() => undefined);
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  await server.start();

  const readStatus = async (): Promise<BootstrapStatus['data']> => {
    const res = await fetch(`${base}/api/bootstrap/status`);
    assert.equal(res.status, 200);
    return ((await res.json()) as BootstrapStatus).data;
  };

  await t.test('全新数据目录：无 Provider 且无工作区时判定需要向导', async () => {
    const status = await readStatus();
    assert.equal(status.hasProvider, false);
    assert.equal(status.hasWorkspace, false);
    assert.equal(status.wizardCompleted, false);
    assert.equal(status.needsWizard, true, '冷启动必须触发破冰向导');
  });

  await t.test('完成标记可持久化，标记后不再打扰', async () => {
    const saveRes = await fetch(`${base}/api/settings/section`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: 'wizardCompleted', data: true }),
    });
    assert.equal(saveRes.status, 200);

    const status = await readStatus();
    assert.equal(status.wizardCompleted, true);
    assert.equal(status.needsWizard, false, '已标记完成后不应再次弹出向导');
  });

  await t.test('写入 Provider 与工作区后状态如实反映', async () => {
    await fetch(`${base}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'wizard-provider',
        name: 'Wizard Provider',
        protocol: 'openai-compatible',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-live-key-for-test',
        models: [{ id: 'deepseek-chat', name: 'deepseek-chat', contextWindow: 65536 }],
      }),
    });
    await fetch(`${base}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'First Project', path: wsDir }),
    });

    const status = await readStatus();
    assert.equal(status.hasProvider, true);
    assert.equal(status.hasWorkspace, true);
    assert.equal(status.needsWizard, false);
  });

  await t.test('未标记完成时，缺失任一侧都仍需向导', async () => {
    // 用独立数据目录验证"只配了 Provider、还没选目录"的中间态
    const midDataDir = path.join(tmpDir, 'data-mid');
    const midPort = 3297;
    const midServer = new HarnessServer({ port: midPort, dataDir: midDataDir });
    await midServer.start();

    try {
      const midBase = `http://127.0.0.1:${midPort}`;
      await fetch(`${midBase}/api/providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'only-provider',
          name: 'Only Provider',
          protocol: 'openai-compatible',
          baseUrl: 'https://api.deepseek.com/v1',
          apiKey: 'sk-live-key-for-test',
          models: [],
        }),
      });

      const mid = ((await (await fetch(`${midBase}/api/bootstrap/status`)).json()) as BootstrapStatus).data;
      assert.equal(mid.hasProvider, true);
      assert.equal(mid.hasWorkspace, false);
      assert.equal(mid.needsWizard, true, '只配了模型还没选目录时仍应继续向导');
    } finally {
      // 显式关闭，避免 SQLite 句柄未释放导致临时目录删除失败与事件循环挂起
      await midServer.stop().catch(() => undefined);
    }
  });
});
