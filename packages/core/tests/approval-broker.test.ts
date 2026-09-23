import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalBroker, ApprovalDeniedError, ApprovalTimeoutError } from '../src/approval-broker.ts';

describe('TC-01-05-004 审批注册表：批准、拒绝与 fail-closed 超时', () => {
  it('审批标识带 apr_ 前缀且唯一', () => {
    const broker = new ApprovalBroker();
    const first = broker.newRequestId();
    const second = broker.newRequestId();
    assert.ok(first.startsWith('apr_'), `审批标识应以 apr_ 开头，实际 ${first}`);
    assert.notEqual(first, second);
  });

  it('approve 唤醒等待并返回 allow，重复批准返回 false', async () => {
    const broker = new ApprovalBroker();
    const id = broker.newRequestId();
    const waiting = broker.register(id);
    assert.equal(broker.hasPending(id), true);

    assert.equal(broker.approve(id), true);
    assert.equal(await waiting, 'allow');
    assert.equal(broker.approve(id), false);
    assert.equal(broker.hasPending(id), false);
  });

  it('deny 以 ApprovalDeniedError 结束等待并携带原因', async () => {
    const broker = new ApprovalBroker();
    const id = broker.newRequestId();
    const waiting = broker.register(id);

    assert.equal(broker.deny(id, '该命令影响生产库'), true);
    await assert.rejects(waiting, (err: unknown) => {
      assert.ok(err instanceof ApprovalDeniedError);
      assert.ok(String((err as Error).message).includes('该命令影响生产库'));
      return true;
    });
  });

  it('超时按 fail-closed 拒绝，绝不默认放行', async () => {
    const broker = new ApprovalBroker(30);
    const id = broker.newRequestId();
    const waiting = broker.register(id);
    await assert.rejects(waiting, (err: unknown) => err instanceof ApprovalTimeoutError);
    assert.equal(broker.hasPending(id), false);
  });

  it('denyAll 在通道不可达时批量 fail-closed', async () => {
    const broker = new ApprovalBroker();
    const first = broker.newRequestId();
    const second = broker.newRequestId();
    const pending = [broker.register(first), broker.register(second)];

    assert.equal(broker.denyAll('回合已中止'), 2);
    for (const waiting of pending) {
      await assert.rejects(waiting, (err: unknown) => err instanceof ApprovalDeniedError);
    }
    assert.deepEqual(broker.pendingRequestIds(), []);
  });

  it('未知标识的 approve/deny 返回 false，不抛异常', () => {
    const broker = new ApprovalBroker();
    assert.equal(broker.approve('apr_unknown'), false);
    assert.equal(broker.deny('apr_unknown'), false);
  });
});
