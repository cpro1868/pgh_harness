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

/** 启动一个「无工具结果时先发起指定工具调用、拿到结果后作答」的确定性 stub 模型。 */
function startToolStub(firstCall: { name: string; args: Record<string, unknown> }): Promise<{ server: http.Server; port: number }> {
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
        const alreadyCalled = Array.isArray(payload.messages)
          && payload.messages.some((message) => message.role === 'tool');

        if (payload.stream === false) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        if (!alreadyCalled) {
          res.write(`data: ${JSON.stringify({
            choices: [{
              delta: {
                role: 'assistant',
                tool_calls: [{
                  index: 0,
                  id: 'call_1',
                  type: 'function',
                  function: { name: firstCall.name, arguments: JSON.stringify(firstCall.args) },
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

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('waitFor 超时：条件未在预期时间内满足');
}

test('TC-01-05-003/004: 权限闸门在工具执行前强制生效（拒绝 / 审批 / 硬性红线）', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-perm-'));
  const wsDir = path.join(tmpDir, 'proj');
  fs.mkdirSync(wsDir, { recursive: true });

  const writeStub = await startToolStub({ name: 'write_file', args: { path: 'agent.txt', content: 'written by agent\n' } });
  const pushStub = await startToolStub({ name: 'bash', args: { command: 'git push origin main' } });

  const testPort = 3295;
  const server = new HarnessServer({ port: testPort, dataDir: path.join(tmpDir, 'data') });
  const base = `http://127.0.0.1:${testPort}`;

  t.after(async () => {
    await server.stop().catch(() => undefined);
    writeStub.server.close();
    pushStub.server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await server.start();

  const registerProvider = async (id: string, port: number): Promise<void> => {
    await fetch(`${base}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        name: id,
        protocol: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'sk-live-key-for-test',
        models: [{ id: `${id}-model`, name: `${id}-model`, contextWindow: 65536 }],
      }),
    });
  };
  await registerProvider('stub-write', writeStub.port);
  await registerProvider('stub-push', pushStub.port);

  const setPreset = (preset: string) =>
    fetch(`${base}/api/settings/section`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: 'permissions', data: { globalPreset: preset } }),
    });

  const createSession = async (): Promise<string> => {
    const res = await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspacePath: wsDir, modelId: 'stub-write-model' }),
    });
    return ((await res.json()) as { data: { id: string } }).data.id;
  };

  const sendTurn = async (sessionId: string, providerId: string, modelId: string) => {
    const res = await fetch(`${base}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message: '请执行操作', workspacePath: wsDir, providerId, modelId }),
    });
    assert.equal(res.status, 200);
    return startSseCollector(res);
  };

  const readEvents = async (sessionId: string) => {
    const res = await fetch(`${base}/api/sessions/${sessionId}/messages?after=0`);
    return ((await res.json()) as { data: Array<{ type: string; payload: Record<string, unknown> }> }).data;
  };

  await t.test('readonly 预设：写入被闸门直接拒绝且文件未落盘', async () => {
    await setPreset('readonly');
    const sessionId = await createSession();
    const collector = await sendTurn(sessionId, 'stub-write', 'stub-write-model');
    await collector.done;

    const toolResult = (await readEvents(sessionId)).find((e) => e.type === 'tool/result');
    assert.ok(toolResult, '应回填工具结果');
    assert.equal(toolResult!.payload.isError, true, '被拒绝的调用必须以错误结果回填');
    assert.ok(String(toolResult!.payload.output ?? '').includes('权限闸门拒绝'), `应说明被闸门拒绝，实际：${toolResult!.payload.output}`);
    assert.equal(fs.existsSync(path.join(wsDir, 'agent.txt')), false, '被拒绝的工具绝不能产生副作用');
  });

  await t.test('edit 预设：写入进入审批，批准后执行并留下 approval 事件', async () => {
    await setPreset('edit');
    const sessionId = await createSession();
    const collector = await sendTurn(sessionId, 'stub-write', 'stub-write-model');

    await waitFor(() => collector.events.some((e) => e.event === 'approval-request'));
    const approvalEvent = collector.events.find((e) => e.event === 'approval-request')!;
    const approvalId = String(approvalEvent.data.requestID);
    assert.ok(approvalId.startsWith('apr_'), `审批标识应以 apr_ 开头，实际 ${approvalId}`);
    assert.equal(approvalEvent.data.tool, 'write_file');

    const stateRes = await fetch(`${base}/api/sessions/${sessionId}/state`);
    const stateBody = (await stateRes.json()) as { data: { state: string; pendingApprovals: string[] } };
    assert.equal(stateBody.data.state, 'waiting_approval', '等待裁决时应进入审批等待态');
    assert.ok(stateBody.data.pendingApprovals.includes(approvalId));

    const decideRes = await fetch(`${base}/api/approvals/${approvalId}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'allow' }),
    });
    assert.equal(decideRes.status, 200);

    await collector.done;

    assert.equal(fs.existsSync(path.join(wsDir, 'agent.txt')), true, '批准后工具应真实执行');
    assert.equal(fs.readFileSync(path.join(wsDir, 'agent.txt'), 'utf8'), 'written by agent\n');

    const events = await readEvents(sessionId);
    assert.ok(events.some((e) => e.type === 'approval/requested'), '应落盘 approval/requested');
    const resolved = events.find((e) => e.type === 'approval/resolved');
    assert.ok(resolved, '应落盘 approval/resolved');
    assert.equal(resolved!.payload.decision, 'allow');

    const finalState = await fetch(`${base}/api/sessions/${sessionId}/state`);
    assert.equal(((await finalState.json()) as { data: { state: string } }).data.state, 'idle');
  });

  await t.test('edit 预设：拒绝审批按 fail-closed 处理，文件不落盘', async () => {
    await setPreset('edit');
    fs.rmSync(path.join(wsDir, 'agent.txt'), { force: true });
    const sessionId = await createSession();
    const collector = await sendTurn(sessionId, 'stub-write', 'stub-write-model');

    await waitFor(() => collector.events.some((e) => e.event === 'approval-request'));
    const approvalId = String(collector.events.find((e) => e.event === 'approval-request')!.data.requestID);

    const denyRes = await fetch(`${base}/api/approvals/${approvalId}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'deny', reason: '本次不允许写入' }),
    });
    assert.equal(denyRes.status, 200);
    await collector.done;

    assert.equal(fs.existsSync(path.join(wsDir, 'agent.txt')), false, '被拒绝的审批绝不能执行工具');

    const toolResult = (await readEvents(sessionId)).find((e) => e.type === 'tool/result');
    assert.ok(toolResult, '拒绝也应以工具结果回填，避免回合卡死');
    assert.equal(toolResult!.payload.isError, true);
    assert.ok(String(toolResult!.payload.output ?? '').includes('本次不允许写入'));
  });

  await t.test('硬性红线：full 预设下 git push 仍被拒绝', async () => {
    await setPreset('full');
    const sessionId = await createSession();
    const collector = await sendTurn(sessionId, 'stub-push', 'stub-push-model');
    await collector.done;

    const toolResult = (await readEvents(sessionId)).find((e) => e.type === 'tool/result');
    assert.ok(toolResult);
    assert.equal(toolResult!.payload.isError, true, 'git push 必须被拒绝');
    assert.ok(String(toolResult!.payload.output ?? '').includes('硬性红线'), `应说明命中硬性红线，实际：${toolResult!.payload.output}`);
  });

  await t.test('重复裁决与未知审批标识均被拒绝', async () => {
    await setPreset('edit');
    const sessionId = await createSession();
    const collector = await sendTurn(sessionId, 'stub-write', 'stub-write-model');
    await waitFor(() => collector.events.some((e) => e.event === 'approval-request'));
    const approvalId = String(collector.events.find((e) => e.event === 'approval-request')!.data.requestID);

    const first = await fetch(`${base}/api/approvals/${approvalId}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'allow' }),
    });
    assert.equal(first.status, 200);

    const second = await fetch(`${base}/api/approvals/${approvalId}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'allow' }),
    });
    assert.equal(second.status, 404, '已裁决的审批不应重复通过');

    const unknown = await fetch(`${base}/api/approvals/apr_does-not-exist/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'deny' }),
    });
    assert.equal(unknown.status, 404);

    await collector.done;
  });
});
