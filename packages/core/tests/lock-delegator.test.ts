import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceWriteLock } from '../src/workspace-lock.ts';
import { LockDelegator } from '../src/pipeline/lock-delegator.ts';

describe('TC-02-02-002: 父子工作区写锁租约让渡 (WBS-02-02-02 / D64)', () => {
  it('非当前持有者发起让渡必须被拒绝（fail-closed）', () => {
    const lock = new WorkspaceWriteLock();
    const delegator = new LockDelegator(lock);
    lock.tryAcquire('/ws', 'parent');

    assert.equal(delegator.delegate('/ws', 'intruder', 'child'), false);
    assert.equal(lock.holder('/ws'), 'parent', '非持有者无权让渡，锁归属不得改变');
  });

  it('让渡成功：父级 → 子级，工作区仍只有唯一活跃写者', () => {
    const lock = new WorkspaceWriteLock();
    const delegator = new LockDelegator(lock);
    lock.tryAcquire('/ws', 'parent');

    assert.equal(delegator.delegate('/ws', 'parent', 'child'), true);
    assert.equal(lock.holder('/ws'), 'child', '让渡后子级持有写锁');
    assert.equal(lock.tryAcquire('/ws', 'other'), false, '第三方仍无法获取写锁（唯一写者）');
  });

  it('子级完毕归还：reclaim 将写锁交还父级', () => {
    const lock = new WorkspaceWriteLock();
    const delegator = new LockDelegator(lock);
    lock.tryAcquire('/ws', 'parent');
    delegator.delegate('/ws', 'parent', 'child');

    assert.equal(delegator.reclaim('/ws', 'child'), true);
    assert.equal(lock.holder('/ws'), 'parent', '归还后父级重新持有写锁');
  });

  it('无让渡链或非持有者归还一律拒绝', () => {
    const lock = new WorkspaceWriteLock();
    const delegator = new LockDelegator(lock);
    lock.tryAcquire('/ws', 'parent');

    assert.equal(delegator.reclaim('/ws', 'parent'), false, '从未让渡时归还需被拒绝');
    delegator.delegate('/ws', 'parent', 'child');
    assert.equal(delegator.reclaim('/ws', 'parent'), false, '非当前持有者归还需被拒绝');
    assert.equal(lock.holder('/ws'), 'child');
  });

  it('多级让渡链：祖父 → 父 → 子逐级归还', () => {
    const lock = new WorkspaceWriteLock();
    const delegator = new LockDelegator(lock);
    lock.tryAcquire('/ws', 'root');

    assert.equal(delegator.delegate('/ws', 'root', 'mid'), true);
    assert.equal(delegator.delegate('/ws', 'mid', 'leaf'), true);
    assert.equal(lock.holder('/ws'), 'leaf');

    assert.equal(delegator.reclaim('/ws', 'leaf'), true);
    assert.equal(lock.holder('/ws'), 'mid');
    assert.equal(delegator.reclaim('/ws', 'mid'), true);
    assert.equal(lock.holder('/ws'), 'root');
  });
});
