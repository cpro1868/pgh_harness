import type { ProviderConfig } from '@harness/protocol';
export interface AnthropicUsageStats {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens?: number;
    cacheWriteTokens?: number;
    cacheReadTokens?: number;
    totalTokens: number;
}
export declare class AnthropicNativeProvider {
    readonly config: ProviderConfig;
    constructor(config: ProviderConfig);
    buildRequestPayload(options: {
        systemPrompt: string;
        messages: Array<{
            role: string;
            content: string;
        }>;
        enableCaching?: boolean;
    }): Record<string, unknown>;
    extractUsage(responseBody: {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
    }): AnthropicUsageStats;
}
