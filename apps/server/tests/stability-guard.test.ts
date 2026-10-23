import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HarnessServer } from '../src/index.ts';

const entryPath = fileURLToPath(new URL('../src/index.ts', import.meta.url));

interface StubLlm {
  server: http.Server;
  port: number;
  calls: { count: number };
}

/** 可编程 stub LLM：第 1 次调用返回工具调用，之后返回收尾；boom=true 时第 2 次调用中途断流模拟异常 */
function startStubLlm(opts: { boomOnCall?: number } = {}): Promise<StubLlm> {
  return new Promise((resolve) => {
    const calls = { count: 0 };
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/chat/completions') {
        req.resume();
        req.on('end', () => {
          calls.count += 1;
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          if (calls.count === 1) {
            res.write('data: {"choices":[{"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read_file","arguments":"{\\"path\\":\\"hello.txt\\"}"}}]}}]}\n\n');
            res.write('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n');
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
          if (opts.boomOnCall === calls.count) {
            res.write('data: {broken json\n\n');
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
          res.write('data: {"choices":[{"delta":{"role":"assistant","content":"收尾完成。"}}]}\n\n');
          res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
          res.write('data: [DONE]\n\n');
          res.end();
        });
        return;
      }
      res.writeHead(404);
      res.end('{}');
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port, calls });
    });
  });
}

async function waitHealthy(port: number, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return;
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server on :${port} not healthy within ${timeoutMs}ms`);
}

describe('TC-00-99-001: 长运行稳定性守卫（进程级崩溃防护）', () => {
  it('进程级兜底：uncaughtException / unhandledRejection 监听器必须挂载', async () => {
    assert.ok(process.listenerCount('uncaughtException') > 0, 'uncaughtException 兜底缺失：任何异步逃逸异常都会杀死服务进程');
    assert.ok(process.listenerCount('unhandledRejection') > 0, 'unhandledRejection 兜底缺失：任何游离 Promise 拒绝都会杀死服务进程');
  });
});

describe('TC-00-99-002: 回合中途异常不得杀死服务进程', () => {
  let tmpDir: string;
  let wsDir: string;
  let server: HarnessServer;
  let stub: StubLlm;
  const testPort = 3362;
  const base = `http://127.0.0.1:${testPort}`;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-stability-test-'));
    wsDir = path.join(tmpDir, 'proj');
    fs.mkdirSync(wsDir, { recursive: true });
    fs.writeFileSync(path.join(wsDir, 'hello.txt'), 'hello world\n', 'utf8');
    stub = await startStubLlm({ boomOnCall: 2 });
    server = new HarnessServer({ port: testPort, dataDir: path.join(tmpDir, 'data') });
    await server.start();
  });

  after(async () => {
    await server.stop();
    stub.server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('注册 stub Provider 并创建会话', async () => {
    await waitHealthy(testPort);
    const res = await fetch(`${base}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'stability-stub',
        name: 'Stability Stub',
        protocol: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${stub.port}`,
        apiKey: 'sk-live-key-for-test',
        models: [{ id: 'stub-model', name: 'stub-model', contextWindow: 65536 }],
      }),
    });
    assert.equal(res.status, 200);
  });

  it('LLM 流式中途断流：回合以 error 收场，服务进程必须存活且可继续服务', async () => {
    const sessions = (await (await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'stability-probe', workspacePath: wsDir, modelId: 'stub-model', providerId: 'stability-stub' }),
    })).json()) as { data?: { id?: string } };
    const sessionId = sessions.data?.id;
    assert.ok(sessionId, '必须能创建测试会话');

    const res = await fetch(`${base}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message: '触发中途断流', providerId: 'stability-stub', modelId: 'stub-model' }),
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    const completed = text.includes('event: turn-end') || text.includes('event: error');
    assert.ok(completed, `回合必须以 turn-end/error 收场而非悬挂，实际: ${text.slice(0, 400)}`);

    const health = (await (await fetch(`${base}/api/health`)).json()) as { status?: string };
    assert.equal(health.status, 'ok', '回合异常后服务必须仍然存活');

    const again = await fetch(`${base}/api/sessions/${sessionId}/messages?after=0`);
    assert.equal(again.status, 200, '回合异常后必须能继续正常处理请求');
  });

  it('独立子进程：异常回合后进程必须存活（真实崩溃回归）', async () => {
    const crashPort = 3363;
    const crashTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-crash-test-'));
    const crashWs = path.join(crashTmp, 'proj');
    fs.mkdirSync(crashWs, { recursive: true });
    fs.writeFileSync(path.join(crashWs, 'hello.txt'), 'x\n', 'utf8');
    const crashStub = await startStubLlm({ boomOnCall: 2 });
    const child = spawn(process.execPath, ['--experimental-strip-types', entryPath, '--port', String(crashPort)], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
      cwd: path.dirname(entryPath),
      env: { ...process.env, PGH_DATA_DIR: crashTmp },
    });
  let stderr = '';
  child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
    try {
      await waitHealthy(crashPort);
      const create = (await (await fetch(`http://127.0.0.1:${crashPort}/api/providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'crash-stub',
          name: 'Crash Stub',
          protocol: 'openai-compatible',
          baseUrl: `http://127.0.0.1:${crashStub.port}`,
          apiKey: 'sk-live-key-for-test',
          models: [{ id: 'stub-model', name: 'stub-model', contextWindow: 65536 }],
        }),
      })).json()) as { code?: number };
      assert.equal(create.code, 0);

      const sess = (await (await fetch(`http://127.0.0.1:${crashPort}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'crash-probe', workspacePath: crashWs, modelId: 'stub-model', providerId: 'crash-stub' }),
      })).json()) as { data?: { id?: string } };
      const sessionId = sess.data?.id;
      assert.ok(sessionId);

      await fetch(`http://127.0.0.1:${crashPort}/api/chat/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: '触发断流', providerId: 'crash-stub', modelId: 'stub-model' }),
      }).catch(() => undefined);

      await new Promise((r) => setTimeout(r, 1500));
      const exitCode = await Promise.race([exited.then((c) => (c === null ? 'running' : c)), new Promise((r) => setTimeout(() => r('running'), 100))]);
      assert.equal(exitCode, 'running', `服务进程不得退出。stderr:\n${stderr.slice(-1500)}`);
      const h = (await (await fetch(`http://127.0.0.1:${crashPort}/api/health`)).json()) as { status?: string };
      assert.equal(h.status, 'ok');
    } finally {
      child.kill();
      crashStub.server.close();
      await exited.catch(() => undefined);
      fs.rmSync(crashTmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
