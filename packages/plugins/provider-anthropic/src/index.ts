import type { ProviderConfig } from '@harness/protocol';

export interface AnthropicUsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
  totalTokens: number;
}

export class AnthropicNativeProvider {
  public readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }


  public buildRequestPayload(options: {
    systemPrompt: string;
    messages: Array<{ role: string; content: string }>;
    enableCaching?: boolean;
  }): Record<string, unknown> {
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

  public extractUsage(responseBody: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  }): AnthropicUsageStats {
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
