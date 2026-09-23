import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeLineDiff } from '../src/line-diff.ts';

describe('TC-01-08-006 行级 Diff：新增/删除统计与超限降级', () => {
  it('内容完全一致时无任何变更', () => {
    const diff = computeLineDiff('a\nb\nc', 'a\nb\nc');
    assert.equal(diff.added, 0);
    assert.equal(diff.removed, 0);
    assert.equal(diff.truncated, false);
    assert.ok(diff.lines.every((line) => line.type === 'ctx'));
  });

  it('单行替换记为 1 增 1 删，且保留上下文行', () => {
    const diff = computeLineDiff('a\nb\nc', 'a\nB\nc');
    assert.equal(diff.added, 1);
    assert.equal(diff.removed, 1);
    const added = diff.lines.filter((line) => line.type === 'add').map((line) => line.text);
    const removed = diff.lines.filter((line) => line.type === 'del').map((line) => line.text);
    assert.deepEqual(added, ['B']);
    assert.deepEqual(removed, ['b']);
    assert.ok(diff.lines.some((line) => line.type === 'ctx' && line.text === 'a'));
  });

  it('纯插入与纯删除分别只计入一侧', () => {
    const inserted = computeLineDiff('a\nc', 'a\nb\nc');
    assert.equal(inserted.added, 1);
    assert.equal(inserted.removed, 0);

    const deleted = computeLineDiff('a\nb\nc', 'a\nc');
    assert.equal(deleted.added, 0);
    assert.equal(deleted.removed, 1);
  });

  it('忽略 CRLF / LF 差异，避免换行风格造成满屏假变更', () => {
    const diff = computeLineDiff('a\r\nb\r\nc', 'a\nb\nc');
    assert.equal(diff.added, 0);
    assert.equal(diff.removed, 0);
  });

  it('全新文件视为整体新增', () => {
    const diff = computeLineDiff('', 'line1\nline2');
    assert.equal(diff.removed, 0);
    assert.ok(diff.added >= 2);
  });

  it('超过规模上限时降级为截断标记，绝不耗尽内存', () => {
    const hugeBefore = Array.from({ length: 3000 }, (_, i) => `old-${i}`).join('\n');
    const hugeAfter = Array.from({ length: 3000 }, (_, i) => `new-${i}`).join('\n');
    const diff = computeLineDiff(hugeBefore, hugeAfter, 500);
    assert.equal(diff.truncated, true, '超限必须标记截断');
    assert.deepEqual(diff.lines, [], '截断时不产出逐行结果');
    assert.equal(diff.added, 0);
    assert.equal(diff.removed, 0);
  });
});
