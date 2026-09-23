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
  maxContextTokens?: number; // 默认 65536
  thresholdRatio?: number;   // 默认 0.8 (80%)
  tailTurns?: number;        // 默认保留最近 3 轮
}

export class ContextGovernor {
  public readonly maxContextTokens: number;
  public readonly thresholdRatio: number;
  public readonly tailTurns: number;

  constructor(options: GovernorOptions = {}) {
    this.maxContextTokens = options.maxContextTokens ?? 65536;
    this.thresholdRatio = options.thresholdRatio ?? 0.8;
    this.tailTurns = options.tailTurns ?? 3;
  }

  public estimateTokens(text: string): number {
    // 粗略字符估算法：英文字符约 4 字符/token，中文字符约 1.5 字符/token
    return Math.ceil(text.length * 0.7);
  }

  /**
   * 落实 D58：组装历史消息时，剥离旧思维链，仅持久化层留痕
   */
  public deriveMessages(items: MessageItem[]): MessageItem[] {
    return items.map((item) => {
      const { reasoning, ...rest } = item;
      return rest;
    });
  }

  public shouldCompact(items: MessageItem[]): boolean {
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
  public compact(
    items: MessageItem[],
    summaryGenerator: (oldItems: MessageItem[]) => string
  ): MessageItem[] {
    // 保护尾部 tailTurns 轮 (1轮 = user + assistant = 2 items)
    const preserveCount = this.tailTurns * 2;
    if (items.length <= preserveCount) {
      return items;
    }

    const splitIndex = items.length - preserveCount;
    const oldHead = items.slice(0, splitIndex);
    const recentTail = items.slice(splitIndex);

    const summaryText = summaryGenerator(oldHead);
    const summaryItem: MessageItem = {
      role: 'system',
      content: summaryText,
    };

    return [summaryItem, ...this.deriveMessages(recentTail)];
  }

  /**
   * 落实 Q7 & TC-01-06-003: 大模型超长溢出时就地紧急恢复
   */
  public compactAfterOverflow(items: MessageItem[]): MessageItem[] {
    // 紧急恢复模式：强制保留最近 1 轮（2条消息），前序全部紧急摘要
    const preserveCount = 2;
    const splitIndex = Math.max(0, items.length - preserveCount);
    const oldHead = items.slice(0, splitIndex);
    const recentTail = items.slice(splitIndex);

    const fileRefs = oldHead.map((i) => i.content.slice(0, 30)).join('; ');
    const summaryItem: MessageItem = {
      role: 'system',
      content: `[溢出紧急恢复摘要: 前序任务涉及: ${fileRefs || '初始上下文'}]`,
    };

    return [summaryItem, ...this.deriveMessages(recentTail)];
  }

}
