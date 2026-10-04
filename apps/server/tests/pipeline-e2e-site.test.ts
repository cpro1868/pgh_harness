import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { HarnessServer } from '../src/index.ts';

/**
 * 脚本化「建站 Agent」stub：按阶段角色（需求规格 / 编码实现 / 验收审计）
 * 真实发起工具调用（写文件 / 试改上游工件），用于「带交互个人网站」全链路验收。
 */
function startSiteBuilderLlm(): Promise<{ server: http.Server; port: number; calls: { count: number } }> {
  return new Promise((resolve) => {
    const calls = { count: 0 };
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/chat/completions') {
        res.writeHead(404);
        res.end('{}');
        return;
      }
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        calls.count += 1;
        const parsed = JSON.parse(raw) as { messages?: Array<{ role?: string; content?: string }> };
        const messages = parsed.messages ?? [];
        const system = messages.find((m) => m.role === 'system')?.content ?? '';
        const hasToolResult = messages.some((m) => m.role === 'tool');
        const stage = system.includes('需求规格') ? 'spec'
          : system.includes('编码实现') ? 'code'
            : system.includes('验收审计') ? 'audit'
              : 'unknown';

        const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
        let finalContent = '阶段完成。';

        if (!hasToolResult) {
          if (stage === 'spec') {
            toolCalls.push({ name: 'write_file', args: { path: 'docs/spec.md', content: '# 个人网站需求规格\n\n- 首页展示个人信息\n- 一个可点击交互按钮\n- 完成标准：按钮点击后有反馈\n' } });
            finalContent = '已交付需求规格 docs/spec.md，含交互验收标准。';
          } else if (stage === 'code') {
            toolCalls.push({ name: 'write_file', args: { path: 'index.html', content: '<!DOCTYPE html>\n<html lang="zh-CN">\n<head><meta charset="UTF-8"><title>我的个人网站</title><link rel="stylesheet" href="styles.css"></head>\n<body>\n  <h1>我的个人网站</h1>\n  <button id="greet">点我打招呼</button>\n  <p id="output"></p>\n  <script src="app.js"></script>\n</body>\n</html>\n' } });
            toolCalls.push({ name: 'write_file', args: { path: 'styles.css', content: 'body { font-family: sans-serif; background: #f5f5f5; }\nbutton { padding: 8px 16px; }\n' } });
            toolCalls.push({ name: 'write_file', args: { path: 'app.js', content: "document.getElementById('greet').addEventListener('click', () => {\n  document.getElementById('output').textContent = '你好，欢迎来到我的个人网站！';\n});\n" } });
            finalContent = '已实现带交互的个人网站（index.html / styles.css / app.js）。';
          } else if (stage === 'audit') {
            // 尝试篡改上游已审定工件（应被只读守护拦截），并产出审计报告
            toolCalls.push({ name: 'edit_file', args: { path: 'index.html', oldString: '我的个人网站', newString: '被篡改' } });
            toolCalls.push({ name: 'write_file', args: { path: 'reports/audit.md', content: '# 验收审计报告\n\n- 首页文件存在\n- 交互脚本存在\n- 上游工件未被篡改\n' } });
            finalContent = '验收完成，已产出审计报告。';
          }
        }

        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        if (toolCalls.length > 0) {
          const deltaCalls = toolCalls.map((tc, i) => ({
            index: i,
            id: `call_${calls.count}_${i}`,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          }));
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', tool_calls: deltaCalls } }] })}\n\n`);
          res.write('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n');
        } else {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: finalContent } }] })}\n\n`);
          res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as AddressInfo).port, calls });
    });
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('TC-02-E2E: 多角色流水线端到端验收 —— 制作带简单交互的个人网站', () => {
  let tmpDir: string;
  let ws: string;
  let server: HarnessServer;
  let stub: { server: http.Server; port: number; calls: { count: number } };
  const testPort = 3326;
  const base = `http://127.0.0.1:${testPort}`;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-e2e-site-'));
    ws = path.join(tmpDir, 'site-proj');
    fs.mkdirSync(ws, { recursive: true });
    stub = await startSiteBuilderLlm();
    server = new HarnessServer({ port: testPort, dataDir: path.join(tmpDir, 'data') });
    await server.start();

    const provRes = await fetch(`${base}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'site-builder',
        name: 'Site Builder Stub',
        protocol: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${stub.port}`,
        apiKey: 'sk-live-key-for-e2e-site',
        models: [{ id: 'site-model', name: 'site-model', contextWindow: 65536 }],
      }),
    });
    assert.equal(provRes.status, 200);
  });

  after(async () => {
    await server.stop();
    stub.server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('全流程：需求(审批门) → 编码(写 3 文件) → 验收(只读守护拦截)，最终完成', async () => {
    // 1. 启动三阶段建站流水线
    const startRes = await fetch(`${base}/api/pipeline-instances/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '制作带交互个人网站',
        workspacePath: ws,
        taskPrompt: '制作一个带简单交互功能的个人网站：单页展示，含一个可点击按钮，点击后有反馈。',
        stages: [
          { id: 'stg_spec', name: '需求规格', roleName: '产品经理', promptTemplate: '梳理网站需求与验收标准，产出 docs/spec.md', modelId: 'site-model', toolsAllowed: ['read_file', 'write_file'], artifactPaths: ['docs/spec.md'], gatekeeperRequired: true },
          { id: 'stg_code', name: '编码实现', roleName: '前端工程师', promptTemplate: '按规格实现 index.html / styles.css / app.js', modelId: 'site-model', toolsAllowed: ['read_file', 'write_file', 'edit_file'], artifactPaths: ['index.html', 'styles.css', 'app.js'], gatekeeperRequired: false },
          { id: 'stg_audit', name: '验收审计', roleName: 'QA 工程师', promptTemplate: '验收网站并产出 reports/audit.md', modelId: 'site-model', toolsAllowed: ['read_file', 'write_file', 'edit_file'], artifactPaths: ['reports/audit.md'], gatekeeperRequired: false },
        ],
      }),
    });
    assert.equal(startRes.status, 200);
    const { data: { instanceId } } = (await startRes.json()) as { data: { instanceId: string } };

    // 2. 首阶段应停在审批门，且已真实写出规格工件
    let status = '';
    for (let i = 0; i < 100; i += 1) {
      const d = (await (await fetch(`${base}/api/pipeline-instances/${instanceId}`)).json()) as { data: { status: string } };
      status = d.data.status;
      if (status === 'waiting_gate') break;
      await sleep(50);
    }
    assert.equal(status, 'waiting_gate', '需求阶段必须停在人工审批门');
    const specPath = path.join(ws, 'docs', 'spec.md');
    assert.ok(fs.existsSync(specPath), '需求阶段必须真实产出 docs/spec.md');
    assert.ok(fs.readFileSync(specPath, 'utf8').includes('交互按钮'), '规格内容应含交互验收标准');

    // 3. 审批放行 → 编码阶段真实产出三件套
    const approveRes = await fetch(`${base}/api/pipeline-instances/${instanceId}/gate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    });
    assert.equal(approveRes.status, 200);

    for (let i = 0; i < 160; i += 1) {
      const d = (await (await fetch(`${base}/api/pipeline-instances/${instanceId}`)).json()) as { data: { status: string } };
      status = d.data.status;
      if (status === 'completed') break;
      await sleep(50);
    }
    assert.equal(status, 'completed', '三阶段流水线应最终完成');

    // 4. 网站产物真实存在且带交互能力
    const html = fs.readFileSync(path.join(ws, 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(ws, 'styles.css'), 'utf8');
    const js = fs.readFileSync(path.join(ws, 'app.js'), 'utf8');
    assert.ok(html.includes('<button'), '首页必须含可交互按钮元素');
    assert.ok(html.includes('app.js'), '首页必须引用交互脚本');
    assert.ok(css.includes('button'), '样式表必须生效');
    assert.ok(js.includes('addEventListener'), '交互脚本必须绑定事件监听');

    // 5. 验收阶段真实产出审计报告
    const auditPath = path.join(ws, 'reports', 'audit.md');
    assert.ok(fs.existsSync(auditPath), '验收阶段必须产出 reports/audit.md');

    // 6. 只读守护：下游篡改上游审定工件被拦截，且文件未被改动
    const detail = (await (await fetch(`${base}/api/pipeline-instances/${instanceId}`)).json()) as {
      data: {
        status: string;
        logs: Array<{ type: string; actor: string; content: string; toolName?: string; isError?: boolean }>;
        artifacts: Array<{ path: string }>;
      };
    };
    assert.ok(
      detail.data.logs.some((l) => l.type === 'tool_result' && l.isError === true && l.content.includes('只读守护拦截')),
      '下游修改上游审定工件必须被只读守护拦截',
    );
    assert.ok(html.includes('我的个人网站') && !html.includes('被篡改'), '上游首页文件不得被下游篡改');

    // 7. 真实调用与轨迹留痕
    assert.ok(stub.calls.count >= 3, '三个阶段均应真实调用模型');
    assert.ok(
      detail.data.logs.some((l) => l.type === 'tool_call' && l.toolName === 'write_file'),
      '日志必须记录真实的 write_file 工具调用',
    );

    // 8. 工件清单登记
    const artifactPaths = detail.data.artifacts.map((a) => a.path);
    assert.ok(artifactPaths.includes('index.html'), '工件清单必须登记 index.html');
    assert.ok(artifactPaths.some((p) => p.includes('audit.md')), '工件清单必须登记审计报告');
  });

  it('模板驱动：先建自定义模板，再由模板启动实例并真实产出网站文件', async () => {
    // 1. 创建自定义模板（真实用户路径：config-pipelines → 模板 → start）
    const tplRes = await fetch(`${base}/api/pipelines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '个人网站构建模板',
        description: '需求 → 编码',
        stages: [
          { id: 'tpl_spec', name: '需求规格', roleName: '产品经理', promptTemplate: '产出 docs/spec.md', modelId: 'site-model', toolsAllowed: ['read_file', 'write_file'], artifactPaths: ['docs/spec.md'], gatekeeperRequired: false },
          { id: 'tpl_code', name: '编码实现', roleName: '前端工程师', promptTemplate: '产出 index.html / styles.css / app.js', modelId: 'site-model', toolsAllowed: ['read_file', 'write_file'], artifactPaths: ['index.html', 'styles.css', 'app.js'], gatekeeperRequired: false },
        ],
      }),
    });
    assert.equal(tplRes.status, 200);
    const tplJson = (await tplRes.json()) as { code: number; data: { id: string; stages: Array<{ order: number }> } };
    assert.equal(tplJson.code, 0);
    assert.deepEqual(tplJson.data.stages.map((s) => s.order), [1, 2], '模板阶段顺序必须连续');

    // 2. 由模板启动（不传内联 stages，验证模板→实例装配）
    const ws2 = path.join(tmpDir, 'site-proj-tpl');
    fs.mkdirSync(ws2, { recursive: true });
    const startRes = await fetch(`${base}/api/pipeline-instances/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '模板驱动建站', pipelineId: tplJson.data.id, workspacePath: ws2, taskPrompt: '用模板构建个人网站' }),
    });
    assert.equal(startRes.status, 200);
    const { data: { instanceId } } = (await startRes.json()) as { data: { instanceId: string } };

    let status = '';
    for (let i = 0; i < 120; i += 1) {
      const d = (await (await fetch(`${base}/api/pipeline-instances/${instanceId}`)).json()) as { data: { status: string; pipelineId: string } };
      status = d.data.status;
      if (status === 'completed') break;
      await sleep(50);
    }
    assert.equal(status, 'completed', '模板驱动的两阶段流水线应完成');

    assert.ok(fs.existsSync(path.join(ws2, 'index.html')), '模板驱动必须真实产出 index.html');
    assert.ok(fs.existsSync(path.join(ws2, 'app.js')), '模板驱动必须真实产出 app.js');
    const js = fs.readFileSync(path.join(ws2, 'app.js'), 'utf8');
    assert.ok(js.includes('addEventListener'), '交互脚本必须真实落盘');
  });
});
