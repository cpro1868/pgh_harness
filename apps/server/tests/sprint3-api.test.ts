import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HarnessServer } from '../src/index.ts';

describe('TC-01-10-005: Sprint 3 服务端 API 集成 (Skills, MCP, 记忆迁移)', () => {
  let tmpDir: string;
  let server: HarnessServer;
  const testPort = 3315;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-sprint3-api-'));
    server = new HarnessServer({ port: testPort, dataDir: path.join(tmpDir, 'data') });
    await server.start();
  });

  after(async () => {
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('GET /api/skills：扫描当前工作区技能并返回清单', async () => {
    const ws = path.join(tmpDir, 'ws');
    const skillDir = path.join(ws, '.pg_harness', 'skills', 'my-test-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: my-test-skill\ndescription: API test skill\n---\n\nBody content');

    const res = await fetch(`http://127.0.0.1:${testPort}/api/skills?workspace=${encodeURIComponent(ws)}`);
    const json = await res.json();
    assert.equal(json.code, 0);
    assert.ok(Array.isArray(json.data));
    const target = json.data.find((s: { name: string }) => s.name === 'my-test-skill');
    assert.ok(target);
    assert.equal(target.enabled, true, '默认扫描出来的技能应该是启用状态');
  });

  it('PATCH /api/skills/:name/toggle：支持切换技能的启用/禁用状态', async () => {
    // 禁用
    const disableRes = await fetch(`http://127.0.0.1:${testPort}/api/skills/my-test-skill/toggle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    const disableJson = await disableRes.json();
    assert.equal(disableJson.code, 0);
    assert.equal(disableJson.data.enabled, false);

    // 重新查列表，反映为已禁用
    const listRes = await fetch(`http://127.0.0.1:${testPort}/api/skills`);
    const listJson = await listRes.json();
    const item = listJson.data.find((s: { name: string }) => s.name === 'my-test-skill');
    if (item) assert.equal(item.enabled, false);

    // 再启用
    const enableRes = await fetch(`http://127.0.0.1:${testPort}/api/skills/my-test-skill/toggle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    const enableJson = await enableRes.json();
    assert.equal(enableJson.code, 0);
    assert.equal(enableJson.data.enabled, true);

    // 非法技能名格式拦截
    const badRes = await fetch(`http://127.0.0.1:${testPort}/api/skills/..%2Fevil/toggle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(badRes.status, 400);
  });

  it('POST /api/skills/install：支持将本地技能安装至工作区', async () => {
    const src = path.join(tmpDir, 'src-skill');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'SKILL.md'), '---\nname: installed-skill\ndescription: installed\n---\n\nInstalled body');

    const ws = path.join(tmpDir, 'ws2');
    fs.mkdirSync(ws, { recursive: true });

    const res = await fetch(`http://127.0.0.1:${testPort}/api/skills/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceDir: src, workspacePath: ws }),
    });
    const json = await res.json();
    assert.equal(json.code, 0);
    assert.equal(json.data.skillName, 'installed-skill');
    assert.ok(fs.existsSync(path.join(ws, '.pg_harness', 'skills', 'installed-skill', 'SKILL.md')));
  });

  it('GET & POST /api/mcp/servers：配置与读取 MCP 服务器', async () => {
    const postRes = await fetch(`http://127.0.0.1:${testPort}/api/mcp/servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        servers: [{ id: 'mock', transport: 'http', url: 'http://127.0.0.1:59999' }],
      }),
    });
    const postJson = await postRes.json();
    assert.equal(postJson.code, 0);

    const getRes = await fetch(`http://127.0.0.1:${testPort}/api/mcp/servers`);
    const getJson = await getRes.json();
    assert.equal(getJson.code, 0);
    assert.equal(getJson.data.servers.length, 1);
    assert.equal(getJson.data.servers[0].id, 'mock');
  });

  it('POST /api/memory/migrate：全新起步模式成功备份并清空', async () => {
    const ws = path.join(tmpDir, 'ws-mem');
    const harnessDir = path.join(ws, '.harness');
    fs.mkdirSync(harnessDir, { recursive: true });
    fs.writeFileSync(path.join(harnessDir, 'memory.md'), '## [123456789012] 旧记忆\n\n- scope: project\n\n旧记忆正文');

    const res = await fetch(`http://127.0.0.1:${testPort}/api/memory/migrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspacePath: ws, mode: 'fresh-start' }),
    });
    const json = await res.json();
    assert.equal(json.code, 0);
    assert.ok(json.data.backupPath);
    assert.ok(fs.existsSync(json.data.backupPath));
    // 原文件已被清空
    assert.equal(fs.readFileSync(path.join(harnessDir, 'memory.md'), 'utf8'), '');
  });

  it('GET /api/memory：返回指定工作区的记忆条目与存储路径', async () => {
    const ws = path.join(tmpDir, 'ws-mem-list');
    const harnessDir = path.join(ws, '.harness');
    fs.mkdirSync(harnessDir, { recursive: true });
    fs.writeFileSync(
      path.join(harnessDir, 'memory.md'),
      '## [aaaaaaaaaaaa] 项目约定\n\n- scope: project\n- source: manual\n- created: 2026-09-26T00:00:00.000Z\n\n提交前必须跑 pnpm check\n',
    );

    const res = await fetch(`http://127.0.0.1:${testPort}/api/memory?workspace=${encodeURIComponent(ws)}`);
    const json = await res.json();
    assert.equal(json.code, 0);
    assert.ok(Array.isArray(json.data.entries));
    assert.ok(json.data.entries.some((e: { content: string }) => e.content.includes('pnpm check')));
    assert.ok(json.data.projectPath.endsWith('memory.md'));
  });

  it('GET /api/memory：缺少 workspace 参数一律拒绝（fail-closed）', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/memory`);
    assert.equal(res.status, 400);
  });
});
