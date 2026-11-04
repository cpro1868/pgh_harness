import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { recomputeSuggestions } from '../src/requirements/diagnostics.ts';
import type { DiagnosticSnapshot } from '../src/requirements/diagnostics.ts';

function makeSnapshot(overrides?: Partial<DiagnosticSnapshot>): DiagnosticSnapshot {
  return {
    messages: [],
    chunks: [
      {
        id: 'ch1', parentId: null, title: '支付方式校验', description: '支持 card/paypal',
        status: 'approved', priority: 'P1', tags: [], children: [], tasks: [
          { id: 'tk1', title: '白名单规则', acceptanceCriteria: '', status: 'todo', priority: 'P0', sortOrder: 0 },
        ],
        discussionRounds: 3,
      },
    ],
    suggestions: [],
    ...overrides,
  };
}

describe('MOD-17 WP-04: 四维诊断器', () => {
  // TS-DG-01
  it('TS-DG-01: 覆盖度零命中产出 coverage 建议', () => {
    const items = recomputeSuggestions(makeSnapshot());
    const cov = items.find((i) => i.sourceType === 'coverage');
    assert.ok(cov, '应产出覆盖度建议');
    assert.ok(cov!.sourceReason.includes('0 次') || cov!.sourceReason.includes('缺失'), '来源依据应量化');
  });

  // TS-DG-02
  it('TS-DG-02: 冲突对命中产出 conflict 且排序第一', () => {
    const items = recomputeSuggestions(
      makeSnapshot({
        messages: [{ role: 'user', content: '我们要求零外部依赖，同时要支持第三方库扩展' }],
      })
    );
    const conflict = items.find((i) => i.sourceType === 'conflict');
    assert.ok(conflict, '应产出冲突建议');
    assert.equal(items[0].sourceType, 'conflict', 'conflict 优先级最高排第一');
  });

  // TS-DG-03
  it('TS-DG-03: draft 停留 2 轮以上催办', () => {
    const items = recomputeSuggestions(
      makeSnapshot({
        chunks: [
          { id: 'ch2', parentId: null, title: '金额边界', description: '', status: 'draft', priority: 'P1', children: [], tasks: [], discussionRounds: 2 },
        ],
      })
    );
    const status = items.find((i) => i.sourceType === 'status');
    assert.ok(status, '应产出状态推进建议');
    assert.ok(status!.content.includes('金额边界'));
  });

  // TS-DG-04
  it('TS-DG-04: approved 占比达标且有任务时产出 readiness', () => {
    const items = recomputeSuggestions(makeSnapshot());
    const ready = items.find((i) => i.sourceType === 'readiness');
    assert.ok(ready, 'approved 100% 且有任务应推荐生成 PRD');
  });

  // TS-DG-05
  it('TS-DG-05: dismissed 状态在重算后按内容保留', () => {
    const prev = [
      { id: 'sg1', sessionId: 's', content: '补充非功能需求', sourceType: 'coverage' as const, sourceReason: 'r', isDismissed: true },
    ];
    const items = recomputeSuggestions(makeSnapshot({ suggestions: prev }));
    const cov = items.find((i) => i.sourceType === 'coverage');
    assert.ok(cov);
    assert.equal(cov!.isDismissed, true, '同内容建议重算后延续 dismissed');
  });

  // TS-DG-06
  it('TS-DG-06: 上限 8 条且按 conflict>coverage>status>readiness 排序', () => {
    const chunks = Array.from({ length: 10 }, (_, i) => ({
      id: `ch${i}`, sessionId: 's', parentId: null, title: `draft分块${i}`, description: '',
      status: 'draft' as const, priority: 'P1' as const, tags: [], children: [], tasks: [], discussionRounds: 5,
    }));
    const items = recomputeSuggestions(makeSnapshot({ chunks }));
    assert.ok(items.length <= 8, '上限 8 条');
    const order = ['conflict', 'coverage', 'status', 'readiness'];
    const types = items.map((i) => i.sourceType);
    const firstIdx = types.map((t) => order.indexOf(t));
    const sorted = [...firstIdx].sort((a, b) => a - b);
    assert.deepEqual(firstIdx, sorted, 'source_type 优先级排序正确');
  });

  it('无建议场景（覆盖已齐 + 无 draft + 分块不足）不产噪音', () => {
    const items = recomputeSuggestions(
      makeSnapshot({
        chunks: [
          { id: 'ch1', parentId: null, title: 'A', description: '性能 并发 安全 异常 重试都已讨论', status: 'draft', priority: 'P1', tags: [], children: [], tasks: [], discussionRounds: 1 },
        ],
        messages: [{ role: 'user', content: '性能 并发 安全 异常 重试 全部覆盖' }],
      })
    );
    assert.equal(items.length, 0, '覆盖齐 + 仅 1 轮 + 无任务 → 零建议');
  });
});
