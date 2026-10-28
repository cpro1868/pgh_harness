import { randomUUID } from 'node:crypto';
/**
 * 「注册等待 → 外部唤醒」的通用挂起注册表骨架。
 * 人机提问（QuestionBroker）与操作审批（ApprovalBroker）共用它，避免两套超时与清理逻辑漂移。
 */
export class PendingBroker {
    timeoutMs;
    entries = new Map();
    makeTimeoutError;
    makeFailureError;
    constructor(options) {
        this.timeoutMs = options.timeoutMs;
        this.makeTimeoutError = options.makeTimeoutError;
        this.makeFailureError = options.makeFailureError;
    }
    /** @returns 形如 `<prefix>_<uuid>` 的唯一标识。 */
    newId(prefix) {
        return `${prefix}_${randomUUID()}`;
    }
    register(id) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.entries.delete(id);
                reject(this.makeTimeoutError(this.timeoutMs));
            }, this.timeoutMs);
            // ponytail: 定时器保持 ref，超时必须真实触发（unref 会让事件循环提前排空、超时永不结算）。
            // 代价是一次挂起会持有引用最长 timeoutMs；由 failAll() 在回合结束/中止时主动清理。
            this.entries.set(id, { resolve, reject, timer });
        });
    }
    settle(id, value) {
        const entry = this.entries.get(id);
        if (!entry)
            return false;
        clearTimeout(entry.timer);
        this.entries.delete(id);
        entry.resolve(value);
        return true;
    }
    fail(id, reason) {
        const entry = this.entries.get(id);
        if (!entry)
            return false;
        clearTimeout(entry.timer);
        this.entries.delete(id);
        entry.reject(this.makeFailureError(reason));
        return true;
    }
    has(id) {
        return this.entries.has(id);
    }
    ids() {
        return [...this.entries.keys()];
    }
    failAll(reason) {
        const ids = this.ids();
        for (const id of ids)
            this.fail(id, reason);
        return ids.length;
    }
}
