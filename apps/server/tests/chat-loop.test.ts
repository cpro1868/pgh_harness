import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { HarnessServer } from '../src/index.ts';
import type { WorkspaceWriteLock } from '../../../packages/core/src/index.ts';

function startStubLlm(): Promise<{ server: http.Server; port: number; calls: { count: number } }> {
  return new Promise((resolve) => {
    const calls = { count: 0 };
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/chat/completions') {
        let raw = '';
        req.on('data', (chunk) => { raw += chunk; });
        req.on('end', () => {
          let payload: { stream?: boolean; model?: string };
          try {
            payload = JSON.parse(raw) as { stream?: boolean; model?: string };
          } catch {
            payload = {};
          }
          // 非流式（如 AI 优化）返回标准 JSON 补全，便于校验模型选择确实生效
          if (payload.stream === false) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              choices: [{ message: { role: 'assistant', content: `# 优化后的 AGENTS.md\n\n由 ${payload.model} 生成\n` } }],
            }));
            return;
          }
          calls.count += 1;
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          if (calls.count === 1) {
            res.write('data: {"choices":[{"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read_file","arguments":"{\\"path\\":\\"hello.txt\\"}"}}]}}]}\n\n');
            res.write('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n');
          } else {
            res.write('data: {"choices":[{"delta":{"role":"assistant","content":"文件内容检查完毕，无需修改。"}}]}\n\n');
            res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
          }
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

async function readSseEvents(res: Response): Promise<Array<{ event: string; data: unknown }>> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const out: Array<{ event: string; data: unknown }> = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      if (!frame.trim()) continue;
      let event = '';
      let dataStr = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataStr = line.slice(5).trim();
      }
      if (!dataStr) continue;
      out.push({ event, data: JSON.parse(dataStr) });
      if (event === 'turn-end' || event === 'done') {
        await reader.cancel().catch(() => undefined);
        return out;
      }
    }
  }
  return out;
}

test('TC-02-02: 对话闭环集成 (会话落盘 + ReAct 工具循环 + SSE 事件 + 断线续传)', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-chat-loop-'));
  const wsDir = path.join(tmpDir, 'proj');
  fs.mkdirSync(wsDir, { recursive: true });
  fs.writeFileSync(path.join(wsDir, 'hello.txt'), 'hello world\n', 'utf8');

  const stub = await startStubLlm();
  const testPort = 3291;
  const server = new HarnessServer({ port: testPort, dataDir: path.join(tmpDir, 'data') });

  t.after(async () => {
    await server.stop().catch(() => undefined);
    stub.server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await server.start();

  await t.test('注册指向 stub 模型的 Provider', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'stub-llm',
        name: 'Stub LLM',
        protocol: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${stub.port}`,
        apiKey: 'sk-live-key-for-test',
        models: [
          { id: 'stub-model', name: 'stub-model', contextWindow: 65536 },
          { id: 'stub-model-b', name: 'stub-model-b', contextWindow: 65536 },
        ],
      }),
    });
    assert.equal(res.status, 200);
  });

  let sessionId = '';
  await t.test('创建会话并绑定工作区 (落盘可查)', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspacePath: wsDir, modelId: 'stub-model' }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { code: number; data: { id: string; workspacePath: string } };
    assert.equal(body.code, 0);
    sessionId = body.data.id;
    assert.ok(sessionId.length > 0);
    assert.equal(body.data.workspacePath, path.resolve(wsDir));
  });

  let turnId = '';
  await t.test('发送消息触发 ReAct 循环: 工具调用 + 最终答案经 SSE 下发', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message: '检查 hello.txt', providerId: 'stub-llm', modelId: 'stub-model' }),
    });
    assert.equal(res.status, 200);
    const events = await readSseEvents(res);
    const types = events.map((e) => e.event);
    assert.ok(types.includes('turn-start'), `缺少 turn-start: ${types}`);
    assert.ok(types.includes('tool-call-start'), `缺少 tool-call-start: ${types}`);
    assert.ok(types.includes('tool-result'), `缺少 tool-result: ${types}`);
    assert.ok(types.includes('turn-end'), `缺少 turn-end: ${types}`);
    const toolResult = events.find((e) => e.event === 'tool-result')!.data as { output: string };
    assert.ok(toolResult.output.includes('hello world'), '工具结果应为真实文件内容');
    const turnEnd = events.find((e) => e.event === 'turn-end')!.data as { turnId: string };
    turnId = turnEnd.turnId;
    assert.ok(turnId.length > 0);
  });

  await t.test('事件已持久化: messages 增量查询可回放', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/sessions/${sessionId}/messages?after=0`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { code: number; data: Array<{ type: string; seq: number; payload?: unknown; createdAt?: number }> };
    assert.equal(body.code, 0);
    const types = body.data.map((e) => e.type);
    assert.ok(types.includes('message/user'));
    assert.ok(types.includes('tool/call'));
    assert.ok(types.includes('tool/result'));
    assert.ok(types.includes('message/assistant'));
    assert.ok(types.includes('turn/completed'));
    const seqs = body.data.map((e) => e.seq);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));

    // 验证每条事件包含 createdAt 时间戳
    for (const ev of body.data) {
      assert.equal(typeof ev.createdAt, 'number', '每条事件必须包含 createdAt 时间戳');
      assert.ok(ev.createdAt! > 0);
    }

    // 验证 turn/completed 事件持久化了 inputTokens、outputTokens 与 totalTokens
    const completedEv = body.data.find((e) => e.type === 'turn/completed');
    assert.ok(completedEv, '必须包含 turn/completed 事件');
    const p = completedEv!.payload as { inputTokens?: number; outputTokens?: number; totalTokens?: number };
    assert.equal(typeof p.inputTokens, 'number', 'turn/completed 必须持久化 inputTokens');
    assert.equal(typeof p.outputTokens, 'number', 'turn/completed 必须持久化 outputTokens');
    assert.equal(typeof p.totalTokens, 'number', 'turn/completed 必须持久化 totalTokens');
  });

  await t.test('断线续传: stream?after=0&follow=0 可一次性重放历史事件', async () => {
    const controller = new AbortController();
    // follow=0：一次性补齐后关闭（follow 默认开启为长期订阅，见 TC-01-08-002）
    const res = await fetch(`http://127.0.0.1:${testPort}/api/sessions/${sessionId}/stream?after=0&follow=0`, {
      signal: controller.signal,
    });
    assert.equal(res.status, 200);
    const events = await readSseEvents(res);
    controller.abort();
    const types = events.map((e) => e.event);
    assert.ok(types.includes('event'), `stream 应重放历史事件: ${types}`);
  });

  await t.test('答复事件带模型标注 (供前端逐轮显示模型来源)', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/sessions/${sessionId}/messages?after=0`);
    const body = (await res.json()) as { data: Array<{ type: string; payload: Record<string, unknown> }> };
    const assistant = body.data.find((e) => e.type === 'message/assistant');
    assert.ok(assistant, '应存在 assistant 消息事件');
    assert.equal(assistant!.payload.model, 'stub-model');
  });

  await t.test('回答反馈接口写入追加式反馈事件', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/sessions/${sessionId}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnId, rating: 'up' }),
    });
    const body = (await res.json()) as { code: number };
    assert.equal(body.code, 0);

    const listRes = await fetch(`http://127.0.0.1:${testPort}/api/sessions/${sessionId}/messages?after=0`);
    const list = (await listRes.json()) as { data: Array<{ type: string; payload: { turnId?: string; rating?: string } }> };
    const feedback = list.data.find((e) => e.type === 'message/feedback');
    assert.ok(feedback, '应写入 message/feedback 事件');
    assert.equal(feedback!.payload.rating, 'up');
    assert.equal(feedback!.payload.turnId, turnId);
  });

  await t.test('POST /api/sessions/:id/usage/reset：用量清零并记录基线', async () => {
    const resetRes = await fetch(`http://127.0.0.1:${testPort}/api/sessions/${sessionId}/usage/reset`, {
      method: 'POST',
    });
    assert.equal(resetRes.status, 200);
    const resetJson = (await resetRes.json()) as { code: number; data: { baselineSeq: number; tokens: number; cost: string } };
    assert.equal(resetJson.code, 0);
    assert.equal(resetJson.data.tokens, 0);
    assert.equal(resetJson.data.cost, '$0.000');
    assert.ok(resetJson.data.baselineSeq > 0);

    // GET /api/sessions 能查到该基线
    const listRes = await fetch(`http://127.0.0.1:${testPort}/api/sessions`);
    const listJson = (await listRes.json()) as { data: Array<{ id: string; usageBaselineSeq?: number }> };
    const target = listJson.data.find((s) => s.id === sessionId);
    assert.equal(target?.usageBaselineSeq, resetJson.data.baselineSeq);
  });

  await t.test('手动压缩上下文：写入基线 compaction 事件与机械摘要', async () => {
    const createRes = await fetch(`http://127.0.0.1:${testPort}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspacePath: wsDir, modelId: 'stub-model' }),
    });
    const created = (await createRes.json()) as { data: { id: string } };
    const compactSessionId = created.data.id;

    for (const message of ['第一轮：查看文件', '第二轮：继续查看']) {
      const sendRes = await fetch(`http://127.0.0.1:${testPort}/api/chat/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: compactSessionId, message, workspacePath: wsDir, modelId: 'stub-model' }),
      });
      await readSseEvents(sendRes);
    }

    // 上下文过短时拒绝压缩
    const shortSessionRes = await fetch(`http://127.0.0.1:${testPort}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspacePath: wsDir, modelId: 'stub-model' }),
    });
    const shortSession = (await shortSessionRes.json()) as { data: { id: string } };
    const rejectRes = await fetch(`http://127.0.0.1:${testPort}/api/sessions/${shortSession.data.id}/compact`, { method: 'POST' });
    const rejectBody = (await rejectRes.json()) as { code: number };
    assert.equal(rejectBody.code, 1, '空会话压缩应被拒绝');

    const res = await fetch(`http://127.0.0.1:${testPort}/api/sessions/${compactSessionId}/compact`, { method: 'POST' });
    const body = (await res.json()) as { code: number; data: { compacted: boolean; baselineSeq: number; before: number } };
    assert.equal(body.code, 0);
    assert.equal(body.data.compacted, true);
    assert.ok(body.data.baselineSeq > 0, '基线 seq 必须指向已落盘事件');
    assert.ok(body.data.before >= 4, '压缩前应含多轮历史消息');

    const listRes = await fetch(`http://127.0.0.1:${testPort}/api/sessions/${compactSessionId}/messages?after=0`);
    const list = (await listRes.json()) as { data: Array<{ type: string; payload: { previousSeq?: number; summary?: string } }> };
    const compaction = list.data.find((e) => e.type === 'compaction');
    assert.ok(compaction, '应写入 compaction 事件');
    const summary = String(compaction!.payload.summary || '');
    assert.ok(summary.includes('上下文压缩摘要'), '摘要应带基线标识');
    assert.ok(summary.includes('第一轮'), '机械摘要应保留历史用户指令要点');
  });

  await t.test('附件（最小版：仅 .md）校验与落盘', async () => {
    const createRes = await fetch(`http://127.0.0.1:${testPort}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspacePath: wsDir, modelId: 'stub-model' }),
    });
    const created = (await createRes.json()) as { data: { id: string } };
    const attSessionId = created.data.id;

    const post = (attachments: unknown) =>
      fetch(`http://127.0.0.1:${testPort}/api/chat/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: attSessionId,
          message: '请阅读附件',
          workspacePath: wsDir,
          modelId: 'stub-model',
          attachments,
        }),
      });

    const rejectExt = await post([{ filename: 'notes.txt', content: '# hi' }]);
    assert.equal(rejectExt.status, 400, '非 .md 扩展名应被拒绝');

    const rejectPath = await post([{ filename: '../secret.md', content: '# hi' }]);
    assert.equal(rejectPath.status, 400, '含路径分隔符的文件名应被拒绝');

    const rejectBig = await post([{ filename: 'big.md', content: 'a'.repeat(64 * 1024 + 1) }]);
    assert.equal(rejectBig.status, 400, '超过 64KB 上限应被拒绝');

    const rejectTooMany = await post([
      { filename: 'a.md', content: '# a' },
      { filename: 'b.md', content: '# b' },
      { filename: 'c.md', content: '# c' },
      { filename: 'd.md', content: '# d' },
    ]);
    assert.equal(rejectTooMany.status, 400, '超过 3 个附件应被拒绝');

    const ok = await post([{ filename: 'spec.md', content: '# 需求\n- A\n- B' }]);
    assert.equal(ok.status, 200);
    await readSseEvents(ok);

    const listRes = await fetch(`http://127.0.0.1:${testPort}/api/sessions/${attSessionId}/messages?after=0`);
    const list = (await listRes.json()) as { data: Array<{ type: string; payload: { filename?: string; content?: string } }> };
    const attachment = list.data.find((e) => e.type === 'message/attachment');
    assert.ok(attachment, '应落盘 message/attachment 事件');
    assert.equal(attachment!.payload.filename, 'spec.md');
    assert.ok(String(attachment!.payload.content || '').includes('需求'));
  });

  await t.test('AI 优化模板：可显式选择 Provider 与模型', async () => {
    const optimize = (payload: Record<string, unknown>) =>
      fetch(`http://127.0.0.1:${testPort}/api/workspaces/optimize-agents-md`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: wsDir, template: '# AGENTS.md\n', ...payload }),
      });

    const fallback = await optimize({});
    assert.equal(fallback.status, 200);
    const fallbackBody = (await fallback.json()) as { code: number; data: { model: string; provider: string } };
    assert.equal(fallbackBody.code, 0);
    assert.equal(fallbackBody.data.model, 'stub-model', '未指定模型时应回落到首个模型');

    const explicit = await optimize({ providerId: 'stub-llm', modelId: 'stub-model-b' });
    assert.equal(explicit.status, 200);
    const explicitBody = (await explicit.json()) as { code: number; data: { model: string; provider: string; content: string } };
    assert.equal(explicitBody.code, 0);
    assert.equal(explicitBody.data.model, 'stub-model-b', '应使用前端显式选择的模型');
    assert.equal(explicitBody.data.provider, 'Stub LLM');
    assert.ok(explicitBody.data.content.includes('stub-model-b'), '返回值应能追溯到实际使用的模型');
  });

  await t.test('重做最近一轮：截断该回合事件并回传原始指令', async () => {
    const before = await fetch(`http://127.0.0.1:${testPort}/api/sessions/${sessionId}/messages?after=0`);
    const beforeBody = (await before.json()) as { data: unknown[] };

    const res = await fetch(`http://127.0.0.1:${testPort}/api/sessions/${sessionId}/redo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnId }),
    });
    const body = (await res.json()) as { code: number; data: { message: string } };
    assert.equal(body.code, 0);
    assert.equal(body.data.message, '检查 hello.txt');

    const after = await fetch(`http://127.0.0.1:${testPort}/api/sessions/${sessionId}/messages?after=0`);
    const afterBody = (await after.json()) as { data: unknown[] };
    assert.ok(afterBody.data.length < beforeBody.data.length, '重做应截断该回合已落盘事件');
  });

  await t.test('重做非最近一轮被拒绝 (保证事件流一致性)', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/sessions/${sessionId}/redo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnId: 'turn_not-last' }),
    });
    assert.equal(res.status, 400);
  });

  await t.test('TC-01-08-001 集成层：并发向同一工作区发写请求触发 HTTP 409 互斥拦截', async () => {
    // 1. 创建另一个绑定相同工作区目录的独立会话 B
    const sessionBRes = await fetch(`http://127.0.0.1:${testPort}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspacePath: wsDir, modelId: 'stub-model' }),
    });
    const sessionBId = ((await sessionBRes.json()) as { data: { id: string } }).data.id;

    // 2. 模拟真实并发：会话 A 占有该工作区写锁（如正在进行长任务执行）
    const wsResolved = path.resolve(wsDir);
    const writeLocks = (server as unknown as { writeLocks: WorkspaceWriteLock }).writeLocks;
    const acquired = writeLocks.tryAcquire(wsResolved, sessionId);
    assert.equal(acquired, true, '会话 A 应成功占有写锁');
    assert.equal(writeLocks.holder(wsResolved), sessionId);

    try {
      // 3. 会话 B 并发向同一工作区发起写请求
      const resB = await fetch(`http://127.0.0.1:${testPort}/api/chat/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionBId,
          message: '第二会话并发冲突写操作',
          workspacePath: wsDir,
          providerId: 'stub-llm',
          modelId: 'stub-model',
        }),
      });

      // 4. 断言核心安全契约：服务端必须立刻返回 409 拦截，绝不发生并发写竞争！
      assert.equal(resB.status, 409, '并发写冲突时必须返回 HTTP 409 Conflict');
      const bodyB = (await resB.json()) as { code: number; message: string; holder?: string };
      assert.equal(bodyB.code, 409);
      assert.ok(bodyB.message.includes('占用写锁'));
      assert.equal(bodyB.holder, sessionId, '409 响应必须明确指明当前写锁持有者会话 ID');
    } finally {
      // 5. 释放写锁
      writeLocks.release(wsResolved, sessionId);
      assert.equal(writeLocks.holder(wsResolved), undefined);
    }
  });
});
