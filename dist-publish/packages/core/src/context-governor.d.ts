export interface MessageItem {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    reasoning?: string;
    tool_call_id?: string;
    tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
            name: string;
            arguments: string;
        };
    }>;
}
export interface GovernorOptions {
    maxContextTokens?: number;
    thresholdRatio?: number;
    tailTurns?: number;
}
export declare class ContextGovernor {
    readonly maxContextTokens: number;
    readonly thresholdRatio: number;
    readonly tailTurns: number;
    constructor(options?: GovernorOptions);
    estimateTokens(text: string): number;
    /**
     * 落实 D58：组装历史消息时，剥离旧思维链，仅持久化层留痕
     */
    deriveMessages(items: MessageItem[]): MessageItem[];
    shouldCompact(items: MessageItem[]): boolean;
    /**
     * 吸收 OpenCode 的 SessionCompaction 滚动摘要算法：
     * reference/opencode/packages/core/src/session/compaction.ts
     */
    compact(items: MessageItem[], summaryGenerator: (oldItems: MessageItem[]) => string): MessageItem[];
    /**
     * 落实 Q7 & TC-01-06-003: 大模型超长溢出时就地紧急恢复
     */
    compactAfterOverflow(items: MessageItem[]): MessageItem[];
}
