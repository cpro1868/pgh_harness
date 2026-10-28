export interface SpeechCleanOptions {
    maxChars?: number;
    readInlineCode?: boolean;
}
/**
 * 语音播报文本清洗函数（纯 TS、零原生依赖、对齐 dsh-speak 规范）
 * 消除会让语音合成静默失败或阅读不顺畅的 Markdown 标记、代码块、Emoji 与复杂 URL。
 */
export declare function cleanSpeechText(text: string, options?: SpeechCleanOptions): string;
