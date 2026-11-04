import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { routeTurn, COORDINATOR_SYSTEM_PROMPT, RULED_FALLBACK_KEYWORDS } from '../src/requirements/coordinator.ts';
import type { CoordinatorDecision, CoordinatorAgentEntry, ChatFnLite } from '../src/requirements/coordinator.ts';

function agent(id: string, name: string, enabled = true): CoordinatorAgentEntry {
  return { id, name, roleTitle: name, isEnabled: enabled };
}

const NAME = { pm: '产品分析师', arch: '技术架构师', qa: '质检与安全专家' };

describe('MOD-17 WP-02: Coordinator 协调器', () => {
  const roster: CoordinatorAgentEntry[] = [
    agent('ag_pm', NAME.pm),
    agent('ag_arch', NAME.arch),
    agent('ag_qa', NAME.qa),
  ];

  // TS-CO-01
  it('TS-CO-01: 正常路由——LLM 返回合法 JSON', async () => {
    const chat: ChatFnLite = async () =>
      JSON.stringify({ primaryAgentId: 'ag_arch', secondaryAgentId: null, topic: '存储模型', reason: '涉及数据库' });
    const decision: CoordinatorDecision = await routeTurn({
      userMessage: '数据应该怎么存？',
      agents: roster,
      chat,
    });
    assert.equal(decision.primaryAgentId, 'ag_arch');
    assert.ok(decision.topic.length > 0);
  });

  // TS-CO-02
  it('TS-CO-02: @点名强制覆盖 LLM 结果', async () => {
    const chat: ChatFnLite = async () =>
      JSON.stringify({ primaryAgentId: 'ag_arch', secondaryAgentId: null, topic: 'x', reason: 'y' });
    const decision = await routeTurn({
      userMessage: `@${NAME.pm} 请梳理支付边界场景`,
      agents: roster,
      chat,
    });
    assert.equal(decision.primaryAgentId, 'ag_pm', '@点名必须覆盖 LLM 裁决');
  });

  // TS-CO-03
  it('TS-CO-03: 畸形 JSON → 关键词规则兜底且不抛异常', async () => {
    const chat: ChatFnLite = async () => '这不是 JSON，抱歉我无法输出结构化内容';
    const decision = await routeTurn({
      userMessage: '数据库表要怎么设计才能支持高并发存储？',
      agents: roster,
      chat,
    });
    assert.equal(decision.primaryAgentId, 'ag_arch', '含「数据库/存储」应走规则命中 arch');
  });

  // TS-CO-04
  it('TS-CO-04: 超时降级（mock 挂起）', async () => {
    const chat: ChatFnLite = () => new Promise(() => undefined); // 永不 resolve
    const decision = await routeTurn({
      userMessage: '帮我看看测试覆盖够不够',
      agents: roster,
      chat,
      timeoutMs: 50,
    });
    assert.equal(decision.primaryAgentId, 'ag_qa', '超时后关键词「测试」命中 qa');
  });

  // TS-CO-05
  it('TS-CO-05: 禁用 Agent 不可被选中', async () => {
    const chat: ChatFnLite = async () =>
      JSON.stringify({ primaryAgentId: 'ag_pm', secondaryAgentId: null, topic: 'x', reason: 'y' });
    const decision = await routeTurn({
      userMessage: '普通业务讨论',
      agents: [agent('ag_pm', NAME.pm, false), ...roster.slice(1)],
      chat,
    });
    assert.notEqual(decision.primaryAgentId, 'ag_pm', 'disabled 角色必须被过滤');
    assert.ok(['ag_arch', 'ag_qa'].includes(decision.primaryAgentId));
  });

  // TS-CO-06
  it('TS-CO-06: @不存在的角色 → 降级不抛错', async () => {
    const chat: ChatFnLite = async () =>
      JSON.stringify({ primaryAgentId: 'ag_arch', secondaryAgentId: null, topic: 'x', reason: 'y' });
    const decision = await routeTurn({
      userMessage: '@不存在的角色 你好',
      agents: roster,
      chat,
    });
    assert.ok(roster.some((a) => a.id === decision.primaryAgentId && a.isEnabled));
  });

  // TS-CO-07
  it('TS-CO-07: 关键词路由全覆盖（qa/arch/兜底 pm）', async () => {
    const neverChat: ChatFnLite = async () => 'bad json';
    const qa = await routeTurn({ userMessage: '异常和重试策略怎么定？', agents: roster, chat: neverChat });
    assert.equal(qa.primaryAgentId, 'ag_qa');

    const arch = await routeTurn({ userMessage: '接口协议与性能指标', agents: roster, chat: neverChat });
    assert.equal(arch.primaryAgentId, 'ag_arch');

    const pm = await routeTurn({ userMessage: '用户流程是什么', agents: roster, chat: neverChat });
    assert.equal(pm.primaryAgentId, 'ag_pm', '无关键词命中时兜底首个 enabled');
  });

  it('降级规则表必须非空且可解释', () => {
    assert.ok(Object.keys(RULED_FALLBACK_KEYWORDS).length >= 3);
    assert.ok(COORDINATOR_SYSTEM_PROMPT.includes('<chunks>'));
    assert.ok(COORDINATOR_SYSTEM_PROMPT.includes('仅输出 JSON'));
  });
});
