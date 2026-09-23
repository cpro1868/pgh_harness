import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QuestionBroker, QuestionRejectedError, QuestionTimeoutError } from '../src/question-broker.ts';

describe('TC-01-04-006 单元层：QuestionBroker 请求注册、回答与驳回', () => {
  it('生成的 requestID 带 que_ 前缀且唯一', () => {
    const broker = new QuestionBroker();
    const a = broker.newRequestId();
    const b = broker.newRequestId();
    assert.ok(a.startsWith('que_'), `requestID 必须以 que_ 开头，实际 ${a}`);
    assert.ok(b.startsWith('que_'));
    assert.notEqual(a, b);
  });

  it('单选项回答被格式化为人类可读的答案文本', () => {
    const broker = new QuestionBroker();
    const formatted = broker.formatAnswer(
      { id: 'q1', header: '方案选择', question: '采用哪种方案？', options: [{ label: '方案A' }, { label: '方案B' }] },
      ['方案A'],
    );
    assert.ok(formatted.includes('方案选择'));
    assert.ok(formatted.includes('采用哪种方案？'));
    assert.ok(formatted.includes('方案A'));
  });

  it('多选项回答与自由输入均被保留', () => {
    const broker = new QuestionBroker();
    const multiple = broker.formatAnswer(
      { id: 'q1', header: '范围', question: '包含哪些？', options: [{ label: '前端' }, { label: '后端' }], multiple: true },
      ['前端', '后端'],
    );
    assert.ok(multiple.includes('前端'));
    assert.ok(multiple.includes('后端'));

    const free = broker.formatAnswer(
      { id: 'q2', header: '补充', question: '还有别的吗？', options: [] },
      ['就按你说的办'],
    );
    assert.ok(free.includes('就按你说的办'));
  });

  it('reply 唤醒等待中的提问并返回 true，重复 reply 返回 false', async () => {
    const broker = new QuestionBroker();
    const id = broker.newRequestId();
    const waiting = broker.register(id);
    assert.equal(broker.hasPending(id), true);

    assert.equal(broker.reply(id, '方案A'), true);
    assert.equal(await waiting, '方案A');
    assert.equal(broker.reply(id, '方案B'), false, '已回答的请求不应重复唤醒');
    assert.equal(broker.hasPending(id), false);
  });

  it('reject 以 QuestionRejectedError 结束等待，并携带驳回原因', async () => {
    const broker = new QuestionBroker();
    const id = broker.newRequestId();
    const waiting = broker.register(id);

    assert.equal(broker.reject(id, '现在不方便确认'), true);
    await assert.rejects(waiting, (err: unknown) => {
      assert.ok(err instanceof QuestionRejectedError, '应由 QuestionRejectedError 结束等待');
      assert.ok(String((err as Error).message).includes('现在不方便确认'));
      return true;
    });
    assert.equal(broker.reject(id, 'x'), false, '已驳回的请求不应重复结束');
  });

  it('超时未回答以 QuestionTimeoutError 结束，避免回合永久挂起', async () => {
    const broker = new QuestionBroker(30);
    const id = broker.newRequestId();
    const waiting = broker.register(id);
    await assert.rejects(waiting, (err: unknown) => err instanceof QuestionTimeoutError);
    assert.equal(broker.hasPending(id), false);
  });

  it('reply/reject 未知 requestID 返回 false，不抛异常', () => {
    const broker = new QuestionBroker();
    assert.equal(broker.reply('que_unknown', 'x'), false);
    assert.equal(broker.reject('que_unknown'), false);
  });
});
