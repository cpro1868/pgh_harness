import { PendingBroker } from "./pending-broker.js";
export class QuestionRejectedError extends Error {
    constructor(reason) {
        super(`[Question] ${reason && reason.trim() !== '' ? reason : '用户驳回了本次提问，请自行按合理默认继续'}`);
        this.name = 'QuestionRejectedError';
    }
}
export class QuestionTimeoutError extends Error {
    constructor(timeoutMs) {
        super(`[Question] 提问超过 ${Math.round(timeoutMs / 60000)} 分钟未获回答，请基于合理默认继续，不要再重复提问`);
        this.name = 'QuestionTimeoutError';
    }
}
/**
 * 人机提问的挂起/唤醒注册表（落实 D53 / TC-01-04-006）。
 * 提问状态本身以 `question_asked` 事件持久化，本对象只负责进程内的等待与唤醒，
 * 因此客户端断线重连后仍可从事件流恢复卡片并回答。
 */
export class QuestionBroker {
    timeoutMs;
    pending;
    /** @param timeoutMs - 等待上限；超时后以 QuestionTimeoutError 结束，避免回合永久挂起。 */
    constructor(timeoutMs = 30 * 60 * 1000) {
        this.timeoutMs = timeoutMs;
        this.pending = new PendingBroker({
            timeoutMs,
            makeTimeoutError: (ms) => new QuestionTimeoutError(ms),
            makeFailureError: (reason) => new QuestionRejectedError(reason),
        });
    }
    /** @returns 形如 `que_<uuid>` 的独立请求标识。 */
    newRequestId() {
        return this.pending.newId('que');
    }
    /**
     * 注册一次等待。
     * @param requestId - 提问标识。
     * @returns 用户回答的答案文本。
     */
    register(requestId) {
        return this.pending.register(requestId);
    }
    /**
     * 回答提问并唤醒等待方。
     * @param requestId - 提问标识。
     * @param answer - 已格式化的答案文本。
     * @returns 是否命中了等待中的提问。
     */
    reply(requestId, answer) {
        return this.pending.settle(requestId, answer);
    }
    /**
     * 驳回提问：以 QuestionRejectedError 唤醒等待方，交由模型自主兜底。
     * @param requestId - 提问标识。
     * @param reason - 可选的驳回说明。
     * @returns 是否命中了等待中的提问。
     */
    reject(requestId, reason) {
        return this.pending.fail(requestId, reason);
    }
    hasPending(requestId) {
        return this.pending.has(requestId);
    }
    pendingRequestIds() {
        return this.pending.ids();
    }
    /** 回合中止时清空挂起提问，防止等待泄漏。 */
    rejectAll(reason) {
        return this.pending.failAll(reason);
    }
    /**
     * 把用户选择格式化为回填给模型的工具结果文本。
     * @param prompt - 原提问。
     * @param answers - 用户选择的选项标签或自由输入。
     * @returns 模型可读的答案文本。
     */
    formatAnswer(prompt, answers) {
        const chosen = answers.filter((answer) => typeof answer === 'string' && answer.trim() !== '');
        return [
            `用户已回答「${prompt.header}」：${prompt.question}`,
            `用户选择：${chosen.join('、') || '(未提供内容)'}`,
        ].join('\n');
    }
}
