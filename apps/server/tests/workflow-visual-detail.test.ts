import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HarnessServer } from '../src/index.ts';

describe('TC-03-02-001: BPMN 可视化设计器页面路由与静态加载 (WBS-03-02-01)', () => {
  let tmpDir: string;
  let server: HarnessServer;
  const testPort = 3338;
  const base = `http://127.0.0.1:${testPort}`;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-wf-detail-test-'));
    server = new HarnessServer({
      port: testPort,
      dataDir: path.join(tmpDir, 'data'),
    });
    await server.start();
  });

  after(async () => {
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('GET /config-workflow-design.html 正常静态托管并返回 HTML 页面', async () => {
    const res = await fetch(`${base}/config-workflow-design.html`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(
      html.includes('BPMN 2.0 Studio') || html.includes('BPMN 2.0') || html.includes('流程可视化设计器'),
      '必须包含设计器标题',
    );
    assert.ok(
      html.includes('id="canvas-container"') || html.includes('id="bpmn-canvas"'),
      '必须包含图形化画布容器',
    );
    assert.ok(
      html.includes('id="right-inspector-panel"') || html.includes('id="node-drawer"'),
      '必须包含节点属性抽屉',
    );
  });

  it('config-workflows.html 资产管理页具备直达可视化设计器的入口链接', async () => {
    const res = await fetch(`${base}/config-workflows.html`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(
      html.includes('config-workflow-design.html') || html.includes('openVisualEditor'),
      '流程资产管理列表必须具备进入可视化设计器的跳转通道'
    );
  });
});
