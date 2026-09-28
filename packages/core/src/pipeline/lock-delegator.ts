import type { WorkspaceWriteLock } from '../workspace-lock.ts';

/**
 * 父子工作区写锁租约让渡机制 (WBS-02-02-02 / D64 / Q5)
 * 允许在阶段流转或主-子 Agent 唤醒时，临时将工作区写锁转移给下游/子实例，
 * 上游挂起等待，下游完成后返还。整个工作区全程确保仅有一个活跃写者。
 */
export class LockDelegator {
  private readonly lock: WorkspaceWriteLock;
  /** 维护调用栈链：workspace -> [parent, child, grandChild] */
  private readonly delegationChains = new Map<string, string[]>();

  constructor(lock: WorkspaceWriteLock) {
    this.lock = lock;
  }

  /**
   * 将当前持有的写锁租约转移给目标受让者。
   * @param workspacePath 工作区绝对路径
   * @param currentHolder 当前持有者 session/stage id
   * @param targetHolder 受让者 session/stage id
   * @returns 是否让渡成功（fail-closed：非当前持有者一律拒绝）
   */
  public delegate(workspacePath: string, currentHolder: string, targetHolder: string): boolean {
    const active = this.lock.holder(workspacePath);
    if (active !== currentHolder) {
      return false;
    }

    let chain = this.delegationChains.get(workspacePath);
    if (!chain) {
      chain = [currentHolder];
      this.delegationChains.set(workspacePath, chain);
    }
    chain.push(targetHolder);

    // 强行把底层的锁所有权让给受让者
    this.lock.release(workspacePath, currentHolder);
    return this.lock.tryAcquire(workspacePath, targetHolder);
  }

  /**
   * 子阶段完毕，归还写锁所有权给上游父级。
   * @param workspacePath 工作区路径
   * @param currentHolder 当前归还者
   * @returns 是否归还成功
   */
  public reclaim(workspacePath: string, currentHolder: string): boolean {
    const active = this.lock.holder(workspacePath);
    if (active !== currentHolder) {
      return false;
    }

    const chain = this.delegationChains.get(workspacePath);
    if (!chain || chain.length <= 1) {
      return false;
    }

    // 弹出当前受让者，回到上一级持有者
    chain.pop();
    const parentHolder = chain[chain.length - 1];

    this.lock.release(workspacePath, currentHolder);
    const ok = this.lock.tryAcquire(workspacePath, parentHolder);

    if (chain.length <= 1) {
      this.delegationChains.delete(workspacePath);
    }
    return ok;
  }
}
