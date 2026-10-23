import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSpeechText } from '../../../packages/protocol/src/speech.ts';

describe('TC-01-13: 语音播报文本清洗规范测试 (WBS-Speech)', () => {
  it('去除常见 Markdown 标记、代码块与链接，保留可读文本', () => {
    const md = '你好！请查阅 [链接](https://example.com) 并执行 `npm test`。以下是代码：\n```bash\ngit status\n```\n祝工作顺利！';
    const cleaned = cleanSpeechText(md);
    assert.ok(!cleaned.includes('https://example.com'));
    assert.ok(!cleaned.includes('```'));
    assert.ok(cleaned.includes('你好'));
    assert.ok(cleaned.includes('请查阅 链接'));
    assert.ok(cleaned.includes('npm test'));
    assert.ok(cleaned.includes('祝工作顺利'));
  });

  it('清洗 Emoji 表情与特殊符号（避免合成器静默挂起或异常读法）', () => {
    const raw = '🎉 任务已完成！🚀 正在提交代码 🔧';
    const cleaned = cleanSpeechText(raw);
    assert.ok(!cleaned.includes('🎉'));
    assert.ok(!cleaned.includes('🚀'));
    assert.ok(!cleaned.includes('🔧'));
    assert.ok(cleaned.includes('任务已完成'));
    assert.ok(cleaned.includes('正在提交代码'));
  });

  it('多余空行与空白收敛为单空格或逗号停顿', () => {
    const raw = '第一行。\n\n\n第二行。   第三行。';
    const cleaned = cleanSpeechText(raw);
    assert.equal(cleaned, '第一行。 第二行。 第三行。');
  });

  it('超长文本适度平滑截断或分段，不产生乱码', () => {
    const long = '核心内容。' + '这是详细说明。'.repeat(50);
    const cleaned = cleanSpeechText(long, { maxChars: 100 });
    assert.ok(cleaned.length <= 115);
    assert.ok(cleaned.includes('...'));
  });
});
