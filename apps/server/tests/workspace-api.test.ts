import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HarnessServer } from '../src/index.ts';

test('TC-01-08-004: 工作区登记、路径校验与 AGENTS.md 生成接口测试', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-ws-test-'));
  const testWorkspaceDir = path.join(tmpDir, 'mock-project');
  fs.mkdirSync(testWorkspaceDir, { recursive: true });

  const testPort = 3288;
  const server = new HarnessServer({
    port: testPort,
    dataDir: tmpDir,
  });

  t.after(async () => {
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await server.start();

  await t.test('API: POST /api/workspaces 成功登记工作区并持久化', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Mock Project',
        path: testWorkspaceDir,
        description: '测试项目工程',
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json() as { code: number; data: { name: string; rules: { hasAgentsMd: boolean } } };
    assert.equal(body.code, 0);
    assert.equal(body.data.name, 'Mock Project');
    assert.equal(body.data.rules.hasAgentsMd, false);
  });

  await t.test('API: POST /api/workspaces/init-agents-md 成功向目标物理目录写入 AGENTS.md', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/workspaces/init-agents-md`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: testWorkspaceDir,
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json() as { code: number };
    assert.equal(body.code, 0);

    // 验证物理文件真实落盘
    const targetFile = path.join(testWorkspaceDir, 'AGENTS.md');
    assert.equal(fs.existsSync(targetFile), true);
    assert.ok(fs.readFileSync(targetFile, 'utf8').includes('八荣八耻'));
  });

  await t.test('API: GET /api/workspaces 动态感知 AGENTS.md 状态变为已就绪', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/workspaces`);
    assert.equal(res.status, 200);
    const body = await res.json() as { code: number; data: Array<{ path: string; exists: boolean; rules: { hasAgentsMd: boolean } }> };
    assert.equal(body.code, 0);
    const target = body.data.find((w) => w.path === testWorkspaceDir);
    assert.equal(target?.rules.hasAgentsMd, true);
    assert.equal(target?.exists, true);
  });

  await t.test('API: AGENTS.md 模板可持久化并在写入工作区时生效', async () => {
    const template = '# AGENTS.md —— 自定义模板\n\n## 1. 铁律\n\n- 以查档求证为荣\n\n| 项 | 值 |\n| --- | --- |\n| 门槛 | `pnpm check` |\n';

    const saveRes = await fetch(`http://127.0.0.1:${testPort}/api/settings/section`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: 'agentsTemplate', data: template }),
    });
    assert.equal(saveRes.status, 200);

    const allRes = await fetch(`http://127.0.0.1:${testPort}/api/settings/all`);
    const all = (await allRes.json()) as { code: number; data: { agentsTemplate: string } };
    assert.equal(all.code, 0);
    assert.equal(all.data.agentsTemplate, template, '模板应可从设置中心读回');

    const badRes = await fetch(`http://127.0.0.1:${testPort}/api/settings/section`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: 'agentsTemplate', data: { not: 'a string' } }),
    });
    assert.equal(badRes.status, 400, '非字符串模板应被拒绝');

    const writeRes = await fetch(`http://127.0.0.1:${testPort}/api/workspaces/init-agents-md`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: testWorkspaceDir, template }),
    });
    assert.equal(writeRes.status, 200);
    assert.equal(
      fs.readFileSync(path.join(testWorkspaceDir, 'AGENTS.md'), 'utf8'),
      template,
      '写入内容应为用户编辑后的模板而非内置默认值',
    );
  });

  await t.test('API: AI 优化模板的信任边界校验', async () => {
    const missing = await fetch(`http://127.0.0.1:${testPort}/api/workspaces/optimize-agents-md`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path.join(tmpDir, 'not-exist'), template: '# t' }),
    });
    assert.equal(missing.status, 404, '目录不存在应返回 404');

    const empty = await fetch(`http://127.0.0.1:${testPort}/api/workspaces/optimize-agents-md`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: testWorkspaceDir, template: '   ' }),
    });
    assert.equal(empty.status, 400, '空模板应返回 400');

    const noProvider = await fetch(`http://127.0.0.1:${testPort}/api/workspaces/optimize-agents-md`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: testWorkspaceDir, template: '# 模板' }),
    });
    assert.equal(noProvider.status, 400, '未配置 Provider 应返回 400');
    const noProviderBody = (await noProvider.json()) as { message: string };
    assert.ok(noProviderBody.message.includes('Provider'), '应给出配置引导而非静默失败');
  });
});
