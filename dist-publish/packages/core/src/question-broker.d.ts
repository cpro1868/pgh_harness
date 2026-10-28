export interface QuestionOption {
    label: string;
    description?: string;
}
export interface QuestionPrompt {
    id: string;
    question: string;
    header: string;
    options: QuestionOption[];
    multiple?: boolean;
}
export declare class QuestionRejectedError extends Error {
    constructor(reason?: string);
}
export declare class QuestionTimeoutError extends Error {
    constructor(timeoutMs: number);
}
/**
 * 人机提问的挂起/唤醒注册表（落实 D53 / TC-01-04-006）。
 * 提问状态本身以 `question_asked` 事件持久化，本对象只负责进程内的等待与唤醒，
 * 因此客户端断线重连后仍可从事件流恢复卡片并回答。
 */
export declare class QuestionBroker {
    readonly timeoutMs: number;
    private readonly pending;
    /** @param timeoutMs - 等待上限；超时后以 QuestionTimeoutError 结束，避免回合永久挂起。 */
    constructor(timeoutMs?: number);
    /** @returns 形如 `que_<uuid>` 的独立请求标识。 */
    newRequestId(): string;
    /**
     * 注册一次等待。
     * @param requestId - 提问标识。
     * @returns 用户回答的答案文本。
     */
    register(requestId: string): Promise<string>;
    /**
     * 回答提问并唤醒等待方。
     * @param requestId - 提问标识。
     * @param answer - 已格式化的答案文本。
     * @returns 是否命中了等待中的提问。
     */
    reply(requestId: string, answer: string): boolean;
    /**
     * 驳回提问：以 QuestionRejectedError 唤醒等待方，交由模型自主兜底。
     * @param requestId - 提问标识。
     * @param reason - 可选的驳回说明。
     * @returns 是否命中了等待中的提问。
     */
    reject(requestId: string, reason?: string): boolean;
    hasPending(requestId: string): boolean;
    pendingRequestIds(): string[];
    /** 回合中止时清空挂起提问，防止等待泄漏。 */
    rejectAll(reason?: string): number;
    /**
     * 把用户选择格式化为回填给模型的工具结果文本。
     * @param prompt - 原提问。
     * @param answers - 用户选择的选项标签或自由输入。
     * @returns 模型可读的答案文本。
     */
    formatAnswer(prompt: QuestionPrompt, answers: string[]): string;
}
