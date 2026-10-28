export class AnthropicNativeProvider {
    config;
    constructor(config) {
        this.config = config;
    }
    buildRequestPayload(options) {
        const { systemPrompt, messages, enableCaching = true } = options;
        // D61 决策：支持 Anthropic 原生 Prompt Caching (最多4个断点)
        const system = enableCaching
            ? [
                {
                    type: 'text',
                    text: systemPrompt,
                    cache_control: { type: 'ephemeral' },
                },
            ]
            : systemPrompt;
        return {
            model: 'claude-3-7-sonnet-20250219',
            max_tokens: 4096,
            system,
            messages,
        };
    }
    extractUsage(responseBody) {
        const inputTokens = responseBody.input_tokens ?? 0;
        const outputTokens = responseBody.output_tokens ?? 0;
        const cacheCreationTokens = responseBody.cache_creation_input_tokens ?? 0;
        const cacheReadTokens = responseBody.cache_read_input_tokens ?? 0;
        return {
            inputTokens,
            outputTokens,
            cacheCreationTokens,
            cacheWriteTokens: cacheCreationTokens,
            cacheReadTokens,
            totalTokens: inputTokens + outputTokens + cacheCreationTokens,
        };
    }
}
