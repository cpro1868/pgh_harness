import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextGovernor, type MessageItem } from '../src/context-governor.ts';

test('TC-01-06-001 & TC-01-06-002 & TC-01-06-003: 上下文治理、思维链剥离与无上限滚动压缩测试', async (t) => {
  const governor = new ContextGovernor({
    maxContextTokens: 1000,
    thresholdRatio: 0.8, // 800 tokens 触发压缩
    tailTurns: 2, // 保护最近 2 轮
  });

  await t.test('TC-01-06-001: 历史回传 deriveMessages 自动剥离旧思维链', () => {
    const rawMessages: MessageItem[] = [
      { role: 'user', content: '分析溢出' },
      { role: 'assistant', content: '这是正式修复', reasoning: '这是一长串内部思考链内容...' },
    ];

    const derived = governor.deriveMessages(rawMessages);
    assert.equal(derived.length, 2);
    assert.equal(derived[1].content, '这是正式修复');
    assert.equal((derived[1] as { reasoning?: string }).reasoning, undefined, '历史消息回传必须剥离 reasoning 字段');
  });

  await t.test('TC-01-06-002: 基于 Epoch/Seq 边界的无上限滚动压缩', () => {
    // 构造超过 800 tokens 的超长历史（假设每个消息约 150 tokens，造 10 轮）
    const longHistory: MessageItem[] = [];
    for (let i = 1; i <= 10; i++) {
      longHistory.push({ role: 'user', content: `需求 ${i}: ${'代码段落 '.repeat(20)}` });
      longHistory.push({ role: 'assistant', content: `回复 ${i}: 已完成修改` });
    }

    assert.equal(governor.shouldCompact(longHistory), true);

    const compacted = governor.compact(longHistory, (oldItems) => {
      return `[自动化结构化摘要: 已完成前 ${oldItems.length / 2} 轮的代码分析与修改]`;
    });

    // 验证压缩产物：首条为压缩摘要基线，尾部保留最近 tailTurns 轮交互
    assert.ok(compacted[0].content.startsWith('[自动化结构化摘要'));
    assert.ok(compacted.length < longHistory.length);
    assert.equal(compacted[compacted.length - 1].content, '回复 10: 已完成修改');
  });

  await t.test('TC-01-06-003: compactAfterOverflow 溢出就地紧急恢复', () => {
    const overflowItems: MessageItem[] = [
      { role: 'user', content: '大文件A' },
      { role: 'assistant', content: '处理结果A' },
      { role: 'user', content: '大文件B' },
      { role: 'assistant', content: '处理结果B' },
    ];

    const recovered = governor.compactAfterOverflow(overflowItems);
    assert.ok(recovered[0].content.includes('溢出紧急恢复摘要'));
    assert.ok(recovered.length <= 3);
  });
});
