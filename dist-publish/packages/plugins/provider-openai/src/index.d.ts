import type { ModelMetadata, ProviderConfig } from '@harness/protocol';
export interface ParsedEvent {
    type: 'reasoning-start' | 'reasoning-delta' | 'reasoning-end' | 'content-start' | 'content-delta' | 'content-end';
    text: string;
}
export declare class OpenAICompatibleProvider {
    private isActiveReasoning;
    private isActiveContent;
    readonly config: ProviderConfig;
    constructor(config: ProviderConfig);
    /**
     * 吸收 OpenCode 的流式状态切分算法：
     * reference/opencode/packages/core/src/github-copilot/chat/openai-compatible-chat-language-model.ts:480
     */
    parseChunk(rawJson: string): ParsedEvent[];
    transformModels(responseBody: {
        data?: Array<{
            id: string;
        }>;
    }): ModelMetadata[];
}
