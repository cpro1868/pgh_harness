import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HarnessServer } from '../src/index.ts';

describe('TC-01-10-006: Sprint 3 端到端内置全链路验证 (Skills 渐进披露 / Mock MCP 工具 / 双层记忆迁移)', () => {
  let tmpDir: string;
  let server: HarnessServer;
  const testPort = 3320;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-sprint3-e2e-'));
    server = new HarnessServer({ port: testPort, dataDir: path.join(tmpDir, 'data') });
    await server.start();
  });

  after(async () => {
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('1. Skills 发现与渐进披露：扫描内置 demo skill 并可通过 /skill 激活', async () => {
    const ws = path.join(tmpDir, 'ws');
    const skillDir = path.join(ws, '.agents', 'skills', 'test-demo-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: test-demo-skill\ndescription: Demo skill description\nversion: 1.0.0\n---\n\n# Rules\n1. Do something useful.',
    );

    const res = await fetch(`http://127.0.0.1:${testPort}/api/skills?workspace=${encodeURIComponent(ws)}`);
    const json = await res.json();
    assert.equal(json.code, 0);
    const found = json.data.find((s: { name: string }) => s.name === 'test-demo-skill');
    assert.ok(found, '应扫描出 test-demo-skill');
    assert.equal(found.enabled, true);
  });

  it('2. 内置 Mock MCP：挂载 stdio 服务并成功执行 add 工具计算', async () => {
    const postRes = await fetch(`http://127.0.0.1:${testPort}/api/mcp/servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        servers: [
          {
            id: 'math',
            transport: 'stdio',
            command: 'node',
            args: ['--experimental-strip-types', 'scripts/mock-mcp-server.ts'],
          },
        ],
      }),
    });
    const postJson = await postRes.json();
    assert.equal(postJson.code, 0);
    assert.equal(postJson.data.counts['math'], 2, 'math 服务应注册 2 个工具');

    // 验证可通过连接池调用工具
    const output = await server.mcpPool.callTool('mcp__math__add', { a: 21, b: 35 });
    assert.equal(output.trim(), 'Result: 56', '加法计算应得到正确结果');

    // 验证回声工具
    const echoOut = await server.mcpPool.callTool('mcp__math__echo', { message: 'hello-pgh' });
    assert.ok(echoOut.includes('hello-pgh'));
  });

  it('3. 记忆双层装配与无损迁移：支持提取并迁移至 SQLite，原文件生成 .bak', async () => {
    const ws = path.join(tmpDir, 'ws-mem');
    const harnessDir = path.join(ws, '.harness');
    fs.mkdirSync(harnessDir, { recursive: true });
    fs.writeFileSync(
      path.join(harnessDir, 'memory.md'),
      '## [112233445566] 架构准则\n\n- scope: project\n- source: manual\n- created: 2026-09-28T00:00:00.000Z\n\n零 Native 编译铁律\n',
    );

    // 查询记忆列表
    const getRes = await fetch(`http://127.0.0.1:${testPort}/api/memory?workspace=${encodeURIComponent(ws)}`);
    const getJson = await getRes.json();
    assert.equal(getJson.code, 0);
    assert.equal(getJson.data.entries.length, 1);
    assert.ok(getJson.data.entries[0].content.includes('零 Native 编译铁律'));

    // 执行无损迁移
    const targetDb = path.join(harnessDir, 'memory.db');
    const migRes = await fetch(`http://127.0.0.1:${testPort}/api/memory/migrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspacePath: ws,
        targetDbPath: targetDb,
        mode: 'lossless-migrate',
      }),
    });
    const migJson = await migRes.json();
    assert.equal(migJson.code, 0);
    assert.equal(migJson.data.migrated, 1);
    assert.ok(fs.existsSync(path.join(harnessDir, 'memory.md.bak')), '.bak 备份必须存在');
    assert.ok(fs.existsSync(targetDb), '目标 SQLite 数据库必须生成');
  });
});
