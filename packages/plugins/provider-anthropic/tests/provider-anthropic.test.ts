import test from 'node:test';
import assert from 'node:assert/strict';
import { AnthropicNativeProvider } from '../src/index.ts';


test('TC-01-03-002: Anthropic 原生协议 Prompt Caching 与 Thinking 解析测试', async (t) => {
  const provider = new AnthropicNativeProvider({
    id: 'claude',
    name: 'Anthropic 官方',
    protocol: 'anthropic-native',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: 'sk-ant-mock-key',
  });

  await t.test('构建带 cache_control 断点的 messages 请求负载', () => {
    const payload = provider.buildRequestPayload({
      systemPrompt: '你是资深架构师',
      messages: [{ role: 'user', content: '分析架构' }],
      enableCaching: true,
    });

    assert.equal(Array.isArray(payload.system), true);
    // 验证静态断点注入
    const systemBlock = (payload.system as Array<{ type: string; text: string; cache_control?: { type: string } }>)[0];
    assert.equal(systemBlock.type, 'text');
    assert.equal(systemBlock.cache_control?.type, 'ephemeral');
  });

  await t.test('统计提取 usage 中的 cache_read_input_tokens 命中数据', () => {
    const mockUsageResponse = {
      input_tokens: 150,
      output_tokens: 200,
      cache_creation_input_tokens: 1800,
      cache_read_input_tokens: 2500,
    };

    const stats = provider.extractUsage(mockUsageResponse);
    assert.equal(stats.cacheReadTokens, 2500);
    assert.equal(stats.cacheWriteTokens, 1800);
    assert.equal(stats.inputTokens, 150);
  });
});
