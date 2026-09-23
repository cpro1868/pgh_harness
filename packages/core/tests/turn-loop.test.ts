import test from 'node:test';
import assert from 'node:assert/strict';
import { TurnLoop, type ChatFn } from '../src/turn-loop.ts';
import { WorkspaceWriteLock } from '../src/workspace-lock.ts';

test('TC-02-01: TurnLoop ReAct 工具循环真实交付', async (t) => {
  await t.test('工具调用闭环: 模型调 read_file 后给出最终答案', async () => {
    const events: Array<{ type: string; data: unknown }> = [];
    const appended: Array<{ type: string; payload: unknown }> = [];
    let calls = 0;
    const chat: ChatFn = async () => {
      calls += 1;
      if (calls === 1) {
        return {
          content: '',
          reasoning: '先看看文件',
          toolCalls: [{ id: 'c1', name: 'read_file', args: { path: 'src/a.ts' } }],
        };
      }
      return { content: '文件内容正常，无需修改。', toolCalls: [] };
    };

    const loop = new TurnLoop({
      sessionId: 'sess_t1',
      turnId: 'turn_t1',
      workspacePath: '/tmp/ws',
      systemPrompt: 'test',
      history: [],
      userMessage: '检查 src/a.ts',
      maxSteps: 25,
      chat,
      executeTool: async (name, args) => {
        assert.equal(name, 'read_file');
        assert.equal((args as { path: string }).path, 'src/a.ts');
        return 'const a = 1;';
      },
      onEvent: (ev) => events.push(ev),
      appendEvent: (type, payload) => appended.push({ type, payload }),
    });

    const result = await loop.run();
    assert.equal(result.stoppedReason, 'completed');
    assert.equal(result.stepsUsed, 2);
    assert.ok(result.finalContent.includes('无需修改'));
    assert.ok(events.some((e) => e.type === 'tool-call-start'));
    assert.ok(events.some((e) => e.type === 'tool-result'));
    assert.ok(appended.some((a) => a.type === 'tool/call'));
    assert.ok(appended.some((a) => a.type === 'tool/result'));
    assert.ok(appended.some((a) => a.type === 'message/assistant'));
  });

  await t.test('超步熔断: 始终调工具时按 maxSteps 收敛', async () => {
    let n = 0;
    const chat: ChatFn = async () => {
      n += 1;
      return {
        content: '',
        toolCalls: [{ id: `c${n}`, name: 'bash', args: { command: `echo hi-${n}` } }],
      };
    };
    const loop = new TurnLoop({
      sessionId: 's',
      turnId: 't',
      workspacePath: '/tmp/ws',
      systemPrompt: 't',
      history: [],
      userMessage: 'hi',
      maxSteps: 3,
      chat,
      executeTool: async () => 'hi',
    });
    const result = await loop.run();
    assert.equal(result.stoppedReason, 'max-steps');
    assert.equal(result.stepsUsed, 3);
  });

  await t.test('同参重复 3 次中断防死循环', async () => {
    const chat: ChatFn = async () => ({
      content: '',
      toolCalls: [{ id: 'c', name: 'grep', args: { pattern: 'foo' } }],
    });
    const loop = new TurnLoop({
      sessionId: 's',
      turnId: 't',
      workspacePath: '/tmp/ws',
      systemPrompt: 't',
      history: [],
      userMessage: 'hi',
      maxSteps: 25,
      chat,
      executeTool: async () => 'no match',
    });
    const result = await loop.run();
    assert.equal(result.stoppedReason, 'repeat-loop');
  });

  await t.test('Abort 生效: 已取消的信号直接中断', async () => {
    const controller = new AbortController();
    controller.abort();
    const loop = new TurnLoop({
      sessionId: 's',
      turnId: 't',
      workspacePath: '/tmp/ws',
      systemPrompt: 't',
      history: [],
      userMessage: 'hi',
      chat: async () => ({ content: 'never', toolCalls: [] }),
      executeTool: async () => 'never',
      signal: controller.signal,
    });
    const result = await loop.run();
    assert.equal(result.stoppedReason, 'aborted');
  });
});

test('TC-01-08-001: 工作区写锁互斥独占', () => {
  const locks = new WorkspaceWriteLock();
  assert.equal(locks.tryAcquire('/ws/a', 'sess_1'), true);
  assert.equal(locks.tryAcquire('/ws/a', 'sess_2'), false);
  assert.equal(locks.holder('/ws/a'), 'sess_1');
  locks.release('/ws/a', 'sess_1');
  assert.equal(locks.tryAcquire('/ws/a', 'sess_2'), true);
  locks.release('/ws/a', 'sess_2');
  assert.equal(locks.holder('/ws/a'), undefined);
});
