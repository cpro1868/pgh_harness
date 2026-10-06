import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { HarnessServer } from '../src/index.ts';

interface RawFrame {
  kind: 'comment' | 'event';
  name?: string;
  data?: Record<string, unknown>;
}

/**
 * 逐帧读取 SSE 原始流，**保留注释帧**（`: ping` 心跳正是注释帧，
 * 常规解析器会丢弃它，因此这里必须自己切帧）。
 */
async function readFrames(
  res: Response,
  stopWhen: (frames: RawFrame[]) => boolean,
  timeoutMs = 5000,
): Promise<RawFrame[]> {
  const frames: RawFrame[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const trimmed = chunk.trim();
      if (trimmed === '') continue;
      if (trimmed.startsWith(':')) {
        frames.push({ kind: 'comment' });
        continue;
      }
      let name = '';
      let dataStr = '';
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) name = line.slice(6).trim();
        if (line.startsWith('data:')) dataStr = line.slice(5).trim();
      }
      if (!dataStr) continue;
      try {
        frames.push({ kind: 'event', name, data: JSON.parse(dataStr) as Record<string, unknown> });
      } catch {
        // 忽略畸形帧
      }
    }
    if (stopWhen(frames)) {
      await reader.cancel().catch(() => undefined);
      return frames;
    }
  }
  await reader.cancel().catch(() => undefined);
  return frames;
}

function startStubModel(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/chat/completions') {
        res.writeHead(404);
        res.end('{}');
        return;
      }
      req.on('data', () => {});
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({
          choices: [{ delta: { role: 'assistant', content: '收到。' } }],
        })}\n\n`);
        res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
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

test('TC-01-08-002: SSE 心跳保活、增量推送与 follow 模式', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-sse-'));
  const wsDir = path.join(tmpDir, 'proj');
  fs.mkdirSync(wsDir, { recursive: true });

  const stub = await startStubModel();
  const testPort = 3301;
  // 用可控时钟替代 15s，才能对"精准推送"做断言
  const server = new HarnessServer({ port: testPort, dataDir: path.join(tmpDir, 'data'), heartbeatMs: 40 });
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
      id: 'stub-sse',
      name: 'stub-sse',
      protocol: 'openai-compatible',
      baseUrl: `http://127.0.0.1:${stub.port}`,
      apiKey: 'sk-live-key-for-test',
      models: [{ id: 'stub-sse-model', name: 'stub-sse-model', contextWindow: 65536 }],
    }),
  });

  const sessionRes = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath: wsDir, modelId: 'stub-sse-model' }),
  });
  const sessionId = ((await sessionRes.json()) as { data: { id: string } }).data.id;

  await t.test('心跳间隔可注入且默认值为 15s', () => {
    assert.equal(server.heartbeatMs, 40);
    const defaults = new HarnessServer({ port: 3399, dataDir: path.join(tmpDir, 'data-default') });
    assert.equal(defaults.heartbeatMs, 15000, '默认心跳必须为 15 秒');
    defaults.db.close();
  });

  await t.test('follow 模式：精准周期性推送 `: ping` 注释帧', async () => {
    const controller = new AbortController();
    const res = await fetch(`${base}/api/sessions/${sessionId}/stream?after=0`, { signal: controller.signal });
    assert.equal(res.status, 200);
    assert.match(String(res.headers.get('content-type')), /text\/event-stream/);

    const frames = await readFrames(res, (acc) => acc.filter((f) => f.kind === 'comment').length >= 3, 4000);
    controller.abort();

    const pings = frames.filter((frame) => frame.kind === 'comment');
    assert.ok(pings.length >= 3, `应周期性收到心跳，实际 ${pings.length} 次`);
    assert.ok(frames.some((frame) => frame.kind === 'event' && frame.name === 'stream-ready'));
  });

  await t.test('follow 模式：新增事件无需重连即可增量推送', async () => {
    const controller = new AbortController();
    const res = await fetch(`${base}/api/sessions/${sessionId}/stream?after=0`, { signal: controller.signal });

    // 在订阅已建立后追加事件（走 feedback 追加式写入）
    const pendingWrite = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      await fetch(`${base}/api/sessions/${sessionId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnId: 'turn_sse_probe', rating: 'up' }),
      });
    })();

    const frames = await readFrames(
      res,
      (acc) => acc.some((frame) => frame.kind === 'event' && frame.name === 'event'
        && (frame.data?.type === 'message/feedback')),
      4000,
    );
    await pendingWrite;
    controller.abort();

    const pushed = frames.find((frame) => frame.kind === 'event' && frame.name === 'event'
      && frame.data?.type === 'message/feedback');
    assert.ok(pushed, '订阅期间新落盘的事件必须被实时推送');
    assert.ok(Number(pushed!.data?.seq) > 0, '推送的事件必须带 seq 供客户端续传定位');
  });

  await t.test('follow=0：一次性补齐后立即关闭，供脚本与回放使用', async () => {
    const res = await fetch(`${base}/api/sessions/${sessionId}/stream?after=0&follow=0`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(body.includes('stream-ready'), '应下发 stream-ready');
    assert.ok(!body.includes(': ping'), 'follow=0 不应启动心跳');
  });

  await t.test('after=<seq> 只补齐缺失帧，不重发已消费事件', async () => {
    // 用 messages 接口取权威游标，避免从 SSE 文本里猜 seq
    const listRes = await fetch(`${base}/api/sessions/${sessionId}/messages?after=0`);
    const events = ((await listRes.json()) as { data: Array<{ seq: number }> }).data;
    const maxSeq = events.reduce((max, event) => Math.max(max, event.seq), 0);
    assert.ok(maxSeq > 0, '应已落盘事件');

    const tailRes = await fetch(`${base}/api/sessions/${sessionId}/stream?after=${maxSeq}&follow=0`);
    const tail = await tailRes.text();
    const eventFrames = [...tail.matchAll(/^event: event$/gm)];
    assert.equal(eventFrames.length, 0, '游标之后的帧应为空，避免重复投递');
    assert.ok(tail.includes('stream-ready'), '即使无新帧也应确认游标位置');
  });
});
