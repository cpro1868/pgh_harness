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

/** 启动一个「无工具结果就先提问、拿到工具结果再作答」的确定性 stub 模型。 */
function startQuestionStub(): Promise<{ server: http.Server; port: number }> {
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

        const alreadyAsked = Array.isArray(payload.messages)
          && payload.messages.some((message) => message.role === 'tool');

        if (payload.stream === false) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        if (!alreadyAsked) {
          const askArgs = JSON.stringify({
            questions: [{
              id: 'q1',
              header: '方案选择',
              question: '采用哪种方案？',
              options: [{ label: '方案A', description: '轻量' }, { label: '方案B', description: '彻底' }],
            }],
          });
          res.write(`data: ${JSON.stringify({
            choices: [{
              delta: {
                role: 'assistant',
                tool_calls: [{
                  index: 0,
                  id: 'call_ask_1',
                  type: 'function',
                  function: { name: 'ask_user', arguments: askArgs },
                }],
              },
            }],
          })}\n\n`);
          res.write('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n');
        } else {
          res.write(`data: ${JSON.stringify({
            choices: [{ delta: { role: 'assistant', content: '已按你的答复继续推进。' } }],
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

test('TC-01-04-006: QuestionV2 独立 Request ID 提问与 Reply/Reject 状态流转', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-question-'));
  const wsDir = path.join(tmpDir, 'proj');
  fs.mkdirSync(wsDir, { recursive: true });

  const stub = await startQuestionStub();
  const testPort = 3293;
  const server = new HarnessServer({ port: testPort, dataDir: path.join(tmpDir, 'data') });
  const base = `http://127.0.0.1:${testPort}`;

  t.after(async () => {
    await server.stop().catch(() => undefined);
    stub.server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await server.start();

  await fetch(`${base}/api/providers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'stub-ask',
      name: 'Stub Ask',
      protocol: 'openai-compatible',
      baseUrl: `http://127.0.0.1:${stub.port}`,
      apiKey: 'sk-live-key-for-test',
      models: [{ id: 'stub-ask-model', name: 'stub-ask-model', contextWindow: 65536 }],
    }),
  });

  const createSession = async (): Promise<string> => {
    const res = await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspacePath: wsDir, modelId: 'stub-ask-model' }),
    });
    const body = (await res.json()) as { data: { id: string } };
    return body.data.id;
  };

  /** 发起一轮并等到提问挂起，返回会话、请求 ID 与流收集器。 */
  const startTurnUntilQuestion = async (sessionId: string) => {
    const res = await fetch(`${base}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message: '请先确认方案', workspacePath: wsDir, modelId: 'stub-ask-model' }),
    });
    assert.equal(res.status, 200);
    const collector = startSseCollector(res);
    await waitFor(() => collector.events.some((e) => e.event === 'question-request'));
    const questionEvent = collector.events.find((e) => e.event === 'question-request')!;
    return { collector, requestId: String(questionEvent.data.requestID) };
  };

  const readEvents = async (sessionId: string) => {
    const res = await fetch(`${base}/api/sessions/${sessionId}/messages?after=0`);
    const body = (await res.json()) as {
      data: Array<{ type: string; payload: Record<string, unknown> }>;
    };
    return body.data;
  };

  await t.test('reply 分支：请求 ID 前缀正确、状态机挂起、答复后唤醒继续', async () => {
    const sessionId = await createSession();
    const { collector, requestId } = await startTurnUntilQuestion(sessionId);

    assert.ok(requestId.startsWith('que_'), `requestID 必须以 que_ 开头，实际 ${requestId}`);

    const stateRes = await fetch(`${base}/api/sessions/${sessionId}/state`);
    const stateBody = (await stateRes.json()) as { data: { state: string; pendingQuestions: string[] } };
    assert.equal(stateBody.data.state, 'waiting_user_input', '提问挂起时应进入等待人类输入状态');
    assert.ok(stateBody.data.pendingQuestions.includes(requestId), '状态接口应暴露挂起中的请求 ID');

    const replyRes = await fetch(`${base}/api/questions/${requestId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: ['方案A'] }),
    });
    assert.equal(replyRes.status, 200);
    const replyBody = (await replyRes.json()) as { code: number; data: { state: string } };
    assert.equal(replyBody.code, 0);
    assert.equal(replyBody.data.state, 'running', '答复后应回到运行态');

    await collector.done;

    const events = await readEvents(sessionId);
    const answered = events.find((e) => e.type === 'question_answered');
    assert.ok(answered, '应落盘 question_answered 事件');
    assert.equal(answered!.payload.action, 'reply');
    assert.deepEqual(answered!.payload.answers, ['方案A']);

    const toolResult = events.find((e) => e.type === 'tool/result');
    assert.ok(toolResult, '应落盘 tool/result 事件');
    const output = String(toolResult!.payload.output ?? '');
    assert.ok(output.includes('方案A'), `模型应收到格式化后的选项，实际：${output}`);
    assert.equal(toolResult!.payload.isError, false);

    const assistant = events.find((e) => e.type === 'message/assistant');
    assert.ok(assistant, '答复后回合应继续并产生最终回答');

    const stateAfter = await fetch(`${base}/api/sessions/${sessionId}/state`);
    const stateAfterBody = (await stateAfter.json()) as { data: { state: string } };
    assert.equal(stateAfterBody.data.state, 'idle', '回合结束后应回到空闲态');
  });

  await t.test('reject 分支：模型收到驳回并以错误结果自主兜底', async () => {
    const sessionId = await createSession();
    const { collector, requestId } = await startTurnUntilQuestion(sessionId);

    const rejectRes = await fetch(`${base}/api/questions/${requestId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: '现在不方便确认' }),
    });
    assert.equal(rejectRes.status, 200);

    await collector.done;

    const events = await readEvents(sessionId);
    const answered = events.find((e) => e.type === 'question_answered');
    assert.ok(answered);
    assert.equal(answered!.payload.action, 'reject');

    const toolResult = events.find((e) => e.type === 'tool/result');
    assert.ok(toolResult, '驳回也应以工具结果回填，避免回合卡死');
    assert.equal(toolResult!.payload.isError, true, '驳回应以错误结果回填');
    assert.ok(String(toolResult!.payload.output ?? '').includes('现在不方便确认'));

    const assistant = events.find((e) => e.type === 'message/assistant');
    assert.ok(assistant, '模型应在驳回后自主兜底并给出回答');
  });

  await t.test('重复应答与未知请求 ID 均被拒绝，不产生脏状态', async () => {
    const sessionId = await createSession();
    const { collector, requestId } = await startTurnUntilQuestion(sessionId);

    const first = await fetch(`${base}/api/questions/${requestId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: ['方案B'] }),
    });
    assert.equal(first.status, 200);

    const second = await fetch(`${base}/api/questions/${requestId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: ['方案A'] }),
    });
    assert.equal(second.status, 404, '已处理的请求不应重复应答');

    const unknown = await fetch(`${base}/api/questions/que_does-not-exist/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(unknown.status, 404);

    await collector.done;

    const events = await readEvents(sessionId);
    const answeredEvents = events.filter((e) => e.type === 'question_answered');
    assert.equal(answeredEvents.length, 1, '同一提问只应产生一条应答事件');
  });
});
