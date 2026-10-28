export class OpenAICompatibleProvider {
    isActiveReasoning = false;
    isActiveContent = false;
    config;
    constructor(config) {
        this.config = config;
    }
    /**
     * 吸收 OpenCode 的流式状态切分算法：
     * reference/opencode/packages/core/src/github-copilot/chat/openai-compatible-chat-language-model.ts:480
     */
    parseChunk(rawJson) {
        const events = [];
        try {
            const data = JSON.parse(rawJson);
            const delta = data.choices?.[0]?.delta;
            if (!delta)
                return events;
            // 提取 reasoning_content (DeepSeek-R1 / OpenAI o1/o3)
            const reasoning = delta.reasoning_content || delta.reasoning || delta.reasoning_text;
            if (reasoning) {
                if (!this.isActiveReasoning) {
                    events.push({ type: 'reasoning-start', text: '' });
                    this.isActiveReasoning = true;
                }
                events.push({ type: 'reasoning-delta', text: reasoning });
            }
            // 提取正式回答 content
            if (delta.content) {
                // 如果思考链处于活跃状态，必须先闭合思考链
                if (this.isActiveReasoning) {
                    events.push({ type: 'reasoning-end', text: '' });
                    this.isActiveReasoning = false;
                }
                if (!this.isActiveContent) {
                    events.push({ type: 'content-start', text: '' });
                    this.isActiveContent = true;
                }
                events.push({ type: 'content-delta', text: delta.content });
            }
        }
        catch {
            // 忽略未完成的畸形 Chunk
        }
        return events;
    }
    transformModels(responseBody) {
        if (!responseBody?.data || !Array.isArray(responseBody.data)) {
            return [];
        }
        return responseBody.data.map((m) => {
            const isReasoner = m.id.includes('reasoner') || m.id.includes('r1') || m.id.includes('o1') || m.id.includes('o3');
            return {
                id: m.id,
                name: m.id,
                contextWindow: isReasoner ? 65536 : 65536,
                supportsTools: !m.id.includes('reasoner'), // 大多数R1不支持工具调用，V3支持
                supportsReasoning: isReasoner,
            };
        });
    }
}
