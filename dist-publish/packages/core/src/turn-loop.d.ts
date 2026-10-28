import type { MessageItem } from './context-governor.ts';
export type { MessageItem };
export interface ToolCallRequest {
    id: string;
    name: string;
    args: Record<string, unknown>;
}
export interface ChatTurnResult {
    content: string;
    reasoning?: string;
    toolCalls: ToolCallRequest[];
    inputTokens?: number;
    outputTokens?: number;
    /** 缓存命中的 prompt token 数（usage.prompt_tokens_details.cached_tokens，上游支持时才有值） */
    cachedTokens?: number;
    /** 推理消耗 token 数（usage.completion_tokens_details.reasoning_tokens） */
    reasoningTokens?: number;
    /** 本次 LLM 调用耗时（毫秒），用于 tok/s 统计 */
    durationMs?: number;
}
export type ChatFn = (messages: MessageItem[], tools: unknown[], onDelta?: (kind: 'reasoning' | 'content', text: string) => void) => Promise<ChatTurnResult>;
export interface ToolExecutionResult {
    output: string;
    /** 附加元数据（如行级 diff），随 tool/result 事件落盘，供前端审阅与回放。 */
    meta?: Record<string, unknown>;
}
export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<string | ToolExecutionResult>;
export type TurnEvent = {
    type: string;
    data: unknown;
};
export type AppendEventFn = (type: string, payload: unknown) => void;
export interface TurnLoopOptions {
    sessionId: string;
    turnId: string;
    workspacePath: string;
    systemPrompt: string;
    history: MessageItem[];
    userMessage: string;
    /**
     * 可选的回合步数预算。未指定时**不设上限**（D50 修订），
     * 死循环防护由同参工具连续 3 次熔断与上下文压缩承担。
     */
    maxSteps?: number;
    model?: string;
    /**
     * 本轮附带的参考材料块（如用户上传的 Markdown 附件）。
     * 仅注入本轮请求上下文，不写入会话历史，避免后续每轮重复计入 token。
     */
    userAttachments?: string[];
    chat: ChatFn;
    executeTool: ToolExecutor;
    /**
     * 运行中的人类干预指令抽取器：每个推理步开始前调用一次，
     * 返回的每条指令作为独立 user 消息注入本轮上下文（流水线人机协同，WBS-02-04-02）。
     */
    drainUserMessages?: () => string[];
    signal?: AbortSignal;
    onEvent?: (event: TurnEvent) => void;
    onDelta?: (kind: 'reasoning' | 'content', text: string) => void;
    appendEvent?: AppendEventFn;
}
export interface TurnLoopResult {
    finalContent: string;
    stepsUsed: number;
    stoppedReason: 'completed' | 'max-steps' | 'repeat-loop' | 'aborted';
    inputTokens: number;
    outputTokens: number;
}
export declare class TurnLoop {
    private readonly options;
    constructor(options: TurnLoopOptions);
    run(): Promise<TurnLoopResult>;
    static toolSchemas(): unknown[];
}
