export class ContextGovernor {
    maxContextTokens;
    thresholdRatio;
    tailTurns;
    constructor(options = {}) {
        this.maxContextTokens = options.maxContextTokens ?? 65536;
        this.thresholdRatio = options.thresholdRatio ?? 0.8;
        this.tailTurns = options.tailTurns ?? 3;
    }
    estimateTokens(text) {
        // 粗略字符估算法：英文字符约 4 字符/token，中文字符约 1.5 字符/token
        return Math.ceil(text.length * 0.7);
    }
    /**
     * 落实 D58：组装历史消息时，剥离旧思维链，仅持久化层留痕
     */
    deriveMessages(items) {
        return items.map((item) => {
            const { reasoning, ...rest } = item;
            return rest;
        });
    }
    shouldCompact(items) {
        let totalChars = 0;
        for (const it of items) {
            totalChars += it.content.length;
        }
        const estimated = this.estimateTokens(' '.repeat(totalChars));
        return estimated >= this.maxContextTokens * this.thresholdRatio;
    }
    /**
     * 吸收 OpenCode 的 SessionCompaction 滚动摘要算法：
     * reference/opencode/packages/core/src/session/compaction.ts
     */
    compact(items, summaryGenerator) {
        // 保护尾部 tailTurns 轮 (1轮 = user + assistant = 2 items)
        const preserveCount = this.tailTurns * 2;
        if (items.length <= preserveCount) {
            return items;
        }
        const splitIndex = items.length - preserveCount;
        const oldHead = items.slice(0, splitIndex);
        const recentTail = items.slice(splitIndex);
        const summaryText = summaryGenerator(oldHead);
        const summaryItem = {
            role: 'system',
            content: summaryText,
        };
        return [summaryItem, ...this.deriveMessages(recentTail)];
    }
    /**
     * 落实 Q7 & TC-01-06-003: 大模型超长溢出时就地紧急恢复
     */
    compactAfterOverflow(items) {
        // 紧急恢复模式：强制保留最近 1 轮（2条消息），前序全部紧急摘要
        const preserveCount = 2;
        const splitIndex = Math.max(0, items.length - preserveCount);
        const oldHead = items.slice(0, splitIndex);
        const recentTail = items.slice(splitIndex);
        const fileRefs = oldHead.map((i) => i.content.slice(0, 30)).join('; ');
        const summaryItem = {
            role: 'system',
            content: `[溢出紧急恢复摘要: 前序任务涉及: ${fileRefs || '初始上下文'}]`,
        };
        return [summaryItem, ...this.deriveMessages(recentTail)];
    }
}
