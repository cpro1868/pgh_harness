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

/** 按序播放指定工具调用的 stub 模型；工具调用用尽后返回最终文本。 */
function startSequenceStub(calls: Array<{ name: string; args: Record<string, unknown> }>): Promise<{ server: http.Server; port: number }> {
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
        const toolTurns = Array.isArray(payload.messages)
          ? payload.messages.filter((message) => message.role === 'tool').length
          : 0;

        if (payload.stream === false) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const nextCall = calls[toolTurns];
        if (nextCall) {
          res.write(`data: ${JSON.stringify({
            choices: [{
              delta: {
                role: 'assistant',
                tool_calls: [{
                  index: 0,
                  id: `call_${toolTurns + 1}`,
                  type: 'function',
                  function: { name: nextCall.name, arguments: JSON.stringify(nextCall.args) },
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

test('TC-01-08-006/007: 任务清单进度卡片与行级 Diff 审阅数据链路', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-todo-diff-'));
  const wsDir = path.join(tmpDir, 'proj');
  fs.mkdirSync(wsDir, { recursive: true });
  fs.writeFileSync(path.join(wsDir, 'existing.txt'), 'alpha\nbeta\ngamma\n', 'utf8');

  const todoStub = await startSequenceStub([
    {
      name: 'todo_write',
      args: {
        todos: [
          { id: 't1', content: '定位缺陷', status: 'completed' },
          { id: 't2', content: '修复实现', status: 'in_progress' },
          { id: 't3', content: '补测试', status: 'pending' },
        ],
      },
    },
  ]);
  const writeStub = await startSequenceStub([
    { name: 'write_file', args: { path: 'brand-new.txt', content: 'line-1\nline-2\n' } },
  ]);
  const editStub = await startSequenceStub([
    { name: 'read_file', args: { path: 'existing.txt' } },
    { name: 'edit_file', args: { path: 'existing.txt', oldString: 'beta', newString: 'BETA' } },
  ]);

  const testPort = 3298;
  const server = new HarnessServer({ port: testPort, dataDir: path.join(tmpDir, 'data') });
  const base = `http://127.0.0.1:${testPort}`;

  t.after(async () => {
    await server.stop().catch(() => undefined);
    todoStub.server.close();
    writeStub.server.close();
    editStub.server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
  await registerProvider('stub-todo', todoStub.port);
  await registerProvider('stub-write', writeStub.port);
  await registerProvider('stub-edit', editStub.port);

  // full 预设：本用例聚焦数据链路，不引入审批交互
  await fetch(`${base}/api/settings/section`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section: 'permissions', data: { globalPreset: 'full' } }),
  });

  const runTurn = async (providerId: string, modelId: string) => {
    const sessionRes = await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspacePath: wsDir, modelId }),
    });
    const sessionId = ((await sessionRes.json()) as { data: { id: string } }).data.id;
    const res = await fetch(`${base}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message: '执行任务', workspacePath: wsDir, providerId, modelId }),
    });
    assert.equal(res.status, 200);
    const collector = startSseCollector(res);
    await collector.done;
    const listRes = await fetch(`${base}/api/sessions/${sessionId}/messages?after=0`);
    const events = ((await listRes.json()) as { data: Array<{ type: string; payload: Record<string, unknown> }> }).data;
    return { sessionId, collector, events };
  };

  await t.test('todo_write 规范化任务清单、落盘事件并下发 SSE 进度', async () => {
    const { collector, events } = await runTurn('stub-todo', 'stub-todo-model');

    const sseUpdate = collector.events.find((e) => e.event === 'todo-update');
    assert.ok(sseUpdate, '应通过 SSE 下发 todo-update');
    assert.equal((sseUpdate!.data.todos as unknown[]).length, 3);

    const persisted = events.find((e) => e.type === 'todo/update');
    assert.ok(persisted, '应落盘 todo/update 事件（可回放）');
    const todos = persisted!.payload.todos as Array<{ id: string; content: string; status: string }>;
    assert.deepEqual(todos.map((item) => item.status), ['completed', 'in_progress', 'pending']);
    assert.equal(todos[1]!.content, '修复实现');

    const toolResult = events.find((e) => e.type === 'tool/result');
    assert.ok(toolResult, '任务清单更新需以工具结果回填模型');
    assert.equal(toolResult!.payload.isError, false);
    assert.ok(String(toolResult!.payload.output ?? '').includes('共 3 项'));
  });

  await t.test('非法状态被归一化为 pending，空内容条目被剔除', async () => {
    const bogusStub = await startSequenceStub([
      {
        name: 'todo_write',
        args: {
          todos: [
            { id: 'a', content: '合法项', status: 'weird-status' },
            { id: 'b', content: '   ', status: 'pending' },
          ],
        },
      },
    ]);
    const port = 3299;
    const bogusServer = new HarnessServer({ port, dataDir: path.join(tmpDir, 'data-bogus') });
    await bogusServer.start();
    try {
      const bogusBase = `http://127.0.0.1:${port}`;
      await fetch(`${bogusBase}/api/providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'stub-bogus',
          name: 'stub-bogus',
          protocol: 'openai-compatible',
          baseUrl: `http://127.0.0.1:${bogusStub.port}`,
          apiKey: 'sk-live-key-for-test',
          models: [{ id: 'm', name: 'm', contextWindow: 65536 }],
        }),
      });
      await fetch(`${bogusBase}/api/settings/section`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: 'permissions', data: { globalPreset: 'full' } }),
      });
      const sessionRes = await fetch(`${bogusBase}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath: wsDir, modelId: 'm' }),
      });
      const sessionId = ((await sessionRes.json()) as { data: { id: string } }).data.id;
      const res = await fetch(`${bogusBase}/api/chat/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: '清单', workspacePath: wsDir, providerId: 'stub-bogus', modelId: 'm' }),
      });
      await startSseCollector(res).done;

      const listRes = await fetch(`${bogusBase}/api/sessions/${sessionId}/messages?after=0`);
      const events = ((await listRes.json()) as { data: Array<{ type: string; payload: Record<string, unknown> }> }).data;
      const todos = (events.find((e) => e.type === 'todo/update')!.payload.todos) as Array<{ content: string; status: string }>;
      assert.equal(todos.length, 1, '空白条目应被剔除');
      assert.equal(todos[0]!.content, '合法项');
      assert.equal(todos[0]!.status, 'pending', '非法状态应归一化为 pending');
    } finally {
      await bogusServer.stop().catch(() => undefined);
      bogusStub.server.close();
    }
  });

  await t.test('write_file 产出整体新增的 diff 元数据', async () => {
    const { events } = await runTurn('stub-write', 'stub-write-model');
    const toolResult = events.find((e) => e.type === 'tool/result');
    assert.ok(toolResult, '应落盘 tool/result');
    const meta = toolResult!.payload.meta as { path: string; added: number; removed: number; lines: Array<{ type: string; text: string }> };
    assert.ok(meta, '文件写入必须携带 diff 元数据供审阅');
    assert.equal(meta.path, 'brand-new.txt');
    assert.equal(meta.removed, 0);
    assert.ok(meta.added >= 2);
    assert.ok(meta.lines.every((line) => line.type === 'add'));
  });

  await t.test('edit_file 产出精确的增删行级对比', async () => {
    const { events } = await runTurn('stub-edit', 'stub-edit-model');
    const editResult = events.filter((e) => e.type === 'tool/result').pop();
    assert.ok(editResult, '应落盘工具结果');
    const meta = editResult!.payload.meta as { path: string; added: number; removed: number; lines: Array<{ type: string; text: string }> };
    assert.ok(meta, '文件编辑必须携带 diff 元数据');
    assert.equal(meta.path, 'existing.txt');
    assert.equal(meta.added, 1);
    assert.equal(meta.removed, 1);
    assert.deepEqual(meta.lines.filter((line) => line.type === 'del').map((line) => line.text), ['beta']);
    assert.deepEqual(meta.lines.filter((line) => line.type === 'add').map((line) => line.text), ['BETA']);
    assert.equal(fs.readFileSync(path.join(wsDir, 'existing.txt'), 'utf8'), 'alpha\nBETA\ngamma\n');
  });
});
