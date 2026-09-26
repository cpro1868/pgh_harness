import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { HarnessServer } from '../src/index.ts';

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

/** 启动一个「先调用 write_file，拿到结果后作答」的 stub 模型。 */
function startWriteStub(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/chat/completions') {
        res.writeHead(404);
        res.end('{}');
        return;
      }
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        let payload: { stream?: boolean; messages?: Array<{ role: string }> } = {};
        try {
          payload = JSON.parse(raw) as typeof payload;
        } catch {
          payload = {};
        }
        const called = Array.isArray(payload.messages)
          && payload.messages.some((message) => message.role === 'tool');

        if (payload.stream === false) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        if (!called) {
          res.write(`data: ${JSON.stringify({
            choices: [{
              delta: {
                role: 'assistant',
                tool_calls: [{
                  index: 0,
                  id: 'call_w1',
                  type: 'function',
                  function: { name: 'write_file', arguments: JSON.stringify({ path: 'preset-probe.txt', content: 'hello\n' }) },
                }],
              },
            }],
          })}\n\n`);
          res.write('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n');
        } else {
          res.write(`data: ${JSON.stringify({
            choices: [{ delta: { role: 'assistant', content: '已完成。' } }],
          })}\n\n`);
          res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

function startSseCollector(res: Response): { events: SseEvent[]; done: Promise<SseEvent[]> } {
  const events: SseEvent[] = [];
  const done = (async () => {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done: finished, value } = await reader.read();
      if (finished) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        if (!frame.trim() || frame.trim().startsWith(':')) continue;
        let event = '';
        let dataStr = '';
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          if (line.startsWith('data:')) dataStr = line.slice(5).trim();
        }
        if (!dataStr) continue;
        try {
          events.push({ event, data: JSON.parse(dataStr) as Record<string, unknown> });
        } catch {
          // 忽略畸形帧
        }
      }
    }
    return events;
  })();
  return { events, done };
}

test('TC-01-05-005: 会话授权档位（只读 / 标准 / 完全授权）与硬性红线不可放宽', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-preset-'));
  const wsDir = path.join(tmpDir, 'proj');
  fs.mkdirSync(wsDir, { recursive: true });

  const stub = await startWriteStub();
  const testPort = 3305;
  const server = new HarnessServer({ port: testPort, dataDir: path.join(tmpDir, 'data') });
  const base = `http://127.0.0.1:${testPort}`;

  t.after(async () => {
    await server.stop().catch(() => undefined);
    stub.server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  await server.start();

  await fetch(`${base}/api/providers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'stub-preset',
      name: 'stub-preset',
      protocol: 'openai-compatible',
      baseUrl: `http://127.0.0.1:${stub.port}`,
      apiKey: 'sk-live-key-for-test',
      models: [{ id: 'stub-preset-model', name: 'stub-preset-model', contextWindow: 65536 }],
    }),
  });

  const createSession = async (preset?: string): Promise<string> => {
    const res = await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preset === undefined
        ? { workspacePath: wsDir, modelId: 'stub-preset-model' }
        : { workspacePath: wsDir, modelId: 'stub-preset-model', preset }),
    });
    return ((await res.json()) as { data: { id: string } }).data.id;
  };

  const readPreset = async (sessionId: string): Promise<string> => {
    const res = await fetch(`${base}/api/sessions`);
    const body = (await res.json()) as { data: Array<{ id: string; preset: string }> };
    return body.data.find((item) => item.id === sessionId)!.preset;
  };

  const sendTurn = async (sessionId: string, permissionPreset?: string) => {
    const payload: Record<string, unknown> = {
      sessionId,
      message: '请写入探针文件',
      workspacePath: wsDir,
      providerId: 'stub-preset',
      modelId: 'stub-preset-model',
    };
    if (permissionPreset !== undefined) payload.permissionPreset = permissionPreset;
    const res = await fetch(`${base}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(res.status, 200);
    return startSseCollector(res);
  };

  await t.test('创建会话可指定档位，非法档位一律 400（fail-closed）', async () => {
    const fullSession = await createSession('full');
    assert.equal(await readPreset(fullSession), 'full');

    const readonlySession = await createSession('readonly');
    assert.equal(await readPreset(readonlySession), 'readonly');

    const invalid = await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspacePath: wsDir, preset: 'yes-please' }),
    });
    assert.equal(invalid.status, 400, '非法档位必须被拒绝，不得静默降级');
  });

  await t.test('PATCH 切换档位：持久化并落盘审计事件', async () => {
    const sessionId = await createSession();
    assert.equal(await readPreset(sessionId), 'edit');

    const res = await fetch(`${base}/api/sessions/${sessionId}/permission`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: 'full' }),
    });
    assert.equal(res.status, 200);
    assert.equal(await readPreset(sessionId), 'full', '切换后必须持久化到会话');

    const eventsRes = await fetch(`${base}/api/sessions/${sessionId}/messages?after=0`);
    const events = ((await eventsRes.json()) as { data: Array<{ type: string; payload: Record<string, unknown> }> }).data;
    const audit = events.find((event) => event.type === 'permission/preset');
    assert.ok(audit, '档位变更必须留痕（可审计）');
    assert.equal(audit!.payload.preset, 'full');
    assert.equal(audit!.payload.previous, 'edit');

    const badRes = await fetch(`${base}/api/sessions/${sessionId}/permission`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: 'super-user' }),
    });
    assert.equal(badRes.status, 400);

    const unknownRes = await fetch(`${base}/api/sessions/sess_not-exist/permission`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: 'full' }),
    });
    assert.equal(unknownRes.status, 404);
  });

  await t.test('完全授权：写操作免审批执行', async () => {
    const sessionId = await createSession('full');
    fs.rmSync(path.join(wsDir, 'preset-probe.txt'), { force: true });

    const collector = await sendTurn(sessionId);
    await collector.done;

    assert.equal(
      collector.events.some((event) => event.event === 'approval-request'),
      false,
      '完全授权档位下不应弹出审批请求',
    );
    assert.equal(fs.existsSync(path.join(wsDir, 'preset-probe.txt')), true, '完全授权下写操作应直接执行');
  });

  await t.test('标准档位：写操作进入人工审批（默认安全）', async () => {
    const sessionId = await createSession('edit');
    fs.rmSync(path.join(wsDir, 'preset-probe.txt'), { force: true });

    const collector = await sendTurn(sessionId);
    // 等待审批请求出现即证明拦截生效，随后中止该回合
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !collector.events.some((event) => event.event === 'approval-request')) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(
      collector.events.some((event) => event.event === 'approval-request'),
      true,
      '标准档位下写操作必须进入审批',
    );
    assert.equal(fs.existsSync(path.join(wsDir, 'preset-probe.txt')), false, '未批准前绝不能落盘');

    await fetch(`${base}/api/sessions/${sessionId}/abort`, { method: 'POST' });
  });

  await t.test('只读档位：写操作被闸门直接拒绝且无副作用', async () => {
    const sessionId = await createSession('readonly');
    fs.rmSync(path.join(wsDir, 'preset-probe.txt'), { force: true });

    const collector = await sendTurn(sessionId);
    await collector.done;

    const eventsRes = await fetch(`${base}/api/sessions/${sessionId}/messages?after=0`);
    const events = ((await eventsRes.json()) as { data: Array<{ type: string; payload: Record<string, unknown> }> }).data;
    const toolResult = events.find((event) => event.type === 'tool/result');
    assert.ok(toolResult);
    assert.equal(toolResult!.payload.isError, true);
    assert.ok(String(toolResult!.payload.output ?? '').includes('权限闸门拒绝'));
    assert.equal(fs.existsSync(path.join(wsDir, 'preset-probe.txt')), false);
  });
});
