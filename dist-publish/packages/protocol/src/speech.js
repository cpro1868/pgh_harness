/**
 * 语音播报文本清洗函数（纯 TS、零原生依赖、对齐 dsh-speak 规范）
 * 消除会让语音合成静默失败或阅读不顺畅的 Markdown 标记、代码块、Emoji 与复杂 URL。
 */
export function cleanSpeechText(text, options = {}) {
    if (!text || typeof text !== 'string')
        return '';
    let out = text;
    // 1. 去除代码围栏 (```...```)
    out = out.replace(/```[\s\S]*?```/g, ' [代码块已省略] ');
    // 2. 去除 HTML 标签 (<tag>...</tag> 或 <tag/>)
    out = out.replace(/<[^>]+>/g, ' ');
    // 3. 处理行内代码 `code`
    if (options.readInlineCode !== false) {
        out = out.replace(/`([^`]+)`/g, ' $1 ');
    }
    else {
        out = out.replace(/`([^`]+)`/g, ' ');
    }
    // 4. Markdown 链接 [text](url) -> 保留 text
    out = out.replace(/\[([^\]]+)\]\([^)]+\)/g, ' $1 ');
    // 5. 独立裸 URL
    out = out.replace(/https?:\/\/[^\s)]+/g, ' ');
    // 6. 移除常见 Emoji 与符号 (涵盖常用 Emoji Unicode 区间)
    out = out.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F100}-\u{1F1FF}]/gu, '');
    // 7. 移除 Markdown 粗体、斜体、删除线标记 (**, *, ~~)
    out = out.replace(/[*_~#>-]/g, ' ');
    // 8. 规范化空白字符与多行，收敛为单空格
    out = out.replace(/\r\n|\r|\n/g, ' ');
    out = out.replace(/\s+/g, ' ').trim();
    // 9. 超长文本截断防护
    const maxChars = options.maxChars ?? 300;
    if (maxChars > 0 && out.length > maxChars) {
        out = out.slice(0, maxChars).trim() + '...';
    }
    return out;
}
