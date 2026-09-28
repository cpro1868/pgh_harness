import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HarnessServer } from '../src/index.ts';

test('TC-01-08-006: staticDir follows source location, independent of process CWD', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-static-test-'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-static-data-'));
  const originalCwd = process.cwd();
  process.chdir(tmpDir);

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const server = new HarnessServer({ port: 3299, dataDir });
  assert.ok(fs.existsSync(server.staticDir), `staticDir must exist even when CWD=${tmpDir}`);
  assert.ok(
    fs.existsSync(path.join(server.staticDir, 'run-chat.html')),
    'run-chat.html must resolve from any CWD (regression: scripts/*.ps1 launch from any directory)',
  );
  await server.db.close();
});

test('TC-01-08-008: 品牌 Logo 单一来源（ico/pgh.svg）与 favicon 路由', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-logo-test-'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-logo-data-'));
  const originalCwd = process.cwd();
  // 故意切换 CWD：Logo 解析必须锚定源码位置，不依赖启动目录
  process.chdir(tmpDir);

  const testPort = 3318;
  const server = new HarnessServer({ port: testPort, dataDir });
  t.after(async () => {
    await server.stop().catch(() => undefined);
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  await server.start();
  const base = `http://127.0.0.1:${testPort}`;

  for (const route of ['/ico/pgh.svg', '/favicon.svg', '/favicon.ico']) {
    const res = await fetch(`${base}${route}`);
    assert.equal(res.status, 200, `${route} 应返回 200`);
    assert.match(res.headers.get('content-type') ?? '', /image\/svg\+xml/, `${route} 必须是 SVG 图标`);
    const body = await res.text();
    assert.ok(body.includes('<svg'), `${route} 返回内容必须是 SVG 图形`);
    assert.ok(body.includes('viewBox="0 0 512 512"'), `${route} 必须返回设计稿 Logo（而非占位图）`);
  }

  // 前端页面必须引用同一份 Logo，且不再残留旧版 “PG” 文字占位徽标
  const pages = [
    'run-chat.html',
    'config-workspace.html',
    'config-providers.html',
    'config-settings.html',
    'config-skills.html',
    'config-mcp.html',
    'config-memories.html',
  ];
  for (const page of pages) {
    const res = await fetch(`${base}/${page}`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('href="ico/pgh.svg"'), `${page} 必须声明 favicon`);
    assert.ok(html.includes('src="ico/pgh.svg"'), `${page} 必须使用设计稿 Logo 作为品牌标识`);
    assert.ok(!html.includes('>PG<'), `${page} 不得残留旧版 PG 文字徽标`);
  }
});
