import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAICompatibleProvider } from '../src/index.ts';


test('TC-01-03-001 & TC-01-03-003: OpenAI 兼容协议流式解析与自动探测', async (t) => {
  const provider = new OpenAICompatibleProvider({
    id: 'deepseek',
    name: 'DeepSeek 官方',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-mock-key',
  });

  await t.test('TC-01-03-001: 准确解析流式分块中的 reasoning 与 content 并状态切分', () => {
    const rawChunks = [
      JSON.stringify({
        choices: [
          {
            delta: { reasoning_content: '正在推演' },
          },
        ],
      }),
      JSON.stringify({
        choices: [
          {
            delta: { reasoning_content: '溢出边界...' },
          },
        ],
      }),
      JSON.stringify({
        choices: [
          {
            delta: { content: '已修复' },
          },
        ],
      }),
      JSON.stringify({
        choices: [
          {
            delta: { content: '完成！' },
          },
        ],
      }),
    ];

    const parsedEvents: Array<{ type: string; text: string }> = [];

    for (const chunk of rawChunks) {
      const events = provider.parseChunk(chunk);
      parsedEvents.push(...events);
    }

    // 断言切分结果
    assert.equal(parsedEvents[0].type, 'reasoning-start');
    assert.equal(parsedEvents[1].type, 'reasoning-delta');
    assert.equal(parsedEvents[1].text, '正在推演');
    assert.equal(parsedEvents[2].type, 'reasoning-delta');
    assert.equal(parsedEvents[2].text, '溢出边界...');

    // 遇到正式 content 时，必须先闭合 reasoning
    assert.equal(parsedEvents[3].type, 'reasoning-end');
    assert.equal(parsedEvents[4].type, 'content-start');
    assert.equal(parsedEvents[5].type, 'content-delta');
    assert.equal(parsedEvents[5].text, '已修复');
    assert.equal(parsedEvents[6].type, 'content-delta');
    assert.equal(parsedEvents[6].text, '完成！');
  });

  await t.test('TC-01-03-003: 规范化解析 /models 返回的模型列表', () => {
    const mockModelsResponse = {
      data: [
        { id: 'deepseek-chat', object: 'model' },
        { id: 'deepseek-reasoner', object: 'model' },
      ],
    };

    const models = provider.transformModels(mockModelsResponse);
    assert.equal(models.length, 2);
    assert.equal(models[0].id, 'deepseek-chat');
    assert.equal(models[0].contextWindow, 65536);
    assert.equal(models[1].id, 'deepseek-reasoner');
    assert.equal(models[1].supportsReasoning, true);
  });
});
