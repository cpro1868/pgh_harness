import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SqliteDatabase } from '../../plugins/storage-sqlite/src/database.ts';
import { RequirementsStore, assertOnlyLeafHasTasks } from '../../plugins/storage-sqlite/src/requirements-schema.ts';
import { parseProposals, runTurn, acceptProposal, detectEditDivergence } from '../src/requirements/engine.ts';
import type { StreamEvent } from '../src/requirements/engine.ts';
import type { DetectedProposal } from '../../plugins/storage-sqlite/src/requirements-schema.ts';

describe('MOD-17 WP-03: 研讨引擎——提议解析与采纳', () => {
  let tmpDir: string;
  let db: SqliteDatabase;
  let store: RequirementsStore;
  let sessionId: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-eng-test-'));
    db = new SqliteDatabase(path.join(tmpDir, 'test.db'));
    db.initialize();
    store = new RequirementsStore(db);
    sessionId = store.createSession({ title: '支付模块', initialPrompt: '我想做支付校验' }).id;
    store.insertAgent({ sessionId, name: '产品分析师', roleTitle: '产品分析师', modelId: 'm', providerId: 'p', systemPrompt: 'sp' });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  // TS-EP-01
  it('TS-EP-01: 合法提议解析', () => {
    const reply = '建议拆分支付方式校验分块。\n```proposal\n[{"kind":"chunk","title":"支付方式校验","parentId":null,"description":"支持 card/paypal","priority":"P0","tags":["功能"]}]\n```';
    const proposals = parseProposals(reply);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].kind, 'chunk');
    assert.equal((proposals[0] as { title: string }).title, '支付方式校验');
  });

  // TS-EP-02
  it('TS-EP-02: 非法提议被丢弃（超长 title / 非法 priority），合法项保留', () => {
    const reply = '```proposal\n['
      + '{"kind":"chunk","title":"' + 'x'.repeat(80) + '","parentId":null,"description":"","priority":"P1","tags":[]},'
      + '{"kind":"chunk","title":"非法优先级","parentId":null,"description":"","priority":"P9","tags":[]},'
      + '{"kind":"chunk","title":"合法分块","parentId":null,"description":"","priority":"P1","tags":[]}'
      + ']\n```';
    const proposals = parseProposals(reply);
    assert.equal(proposals.length, 1);
    assert.equal((proposals[0] as { title: string }).title, '合法分块');
  });

  // TS-EP-03
  it('TS-EP-03: 无围栏纯文本返回空数组', () => {
    assert.deepEqual(parseProposals('这只是普通回复，没有提议。'), []);
  });

  // TS-EP-04
  it('TS-EP-04: 采纳 chunk 提议事务落盘 + SSE 事件', async () => {
    const proposal: DetectedProposal = {
      kind: 'chunk', title: '支付方式校验', parentId: null, description: 'card/paypal', priority: 'P0', tags: ['功能'],
    };
    const events: StreamEvent[] = [];
    const result = await acceptProposal({ store, db, sessionId, messageId: null, proposal, onEvent: (e) => events.push(e) });
    const tree = store.listChunksTree(sessionId);
    assert.equal(tree.length, 1);
    assert.equal(tree[0].status, 'draft');
    assert.ok(events.some((e) => e.type === 'chunk_created'));
    void result;
  });

  // TS-EP-05 变异验证锚点：父分块挂任务自动包裹
  it('TS-EP-05: 父分块挂任务 → 自动创建子分块包裹（不变量保持）', async () => {
    const parent = store.insertChunk({ sessionId, parentId: null, title: '支付网关' });
    store.insertChunk({ sessionId, parentId: parent.id, title: '占位子块' });
    const proposal: DetectedProposal = {
      kind: 'task', chunkTitle: '支付网关', title: '金额边界测试', acceptanceCriteria: '金额<0 拒绝', priority: 'P0',
    };
    const events: StreamEvent[] = [];
    await acceptProposal({ store, db, sessionId, messageId: null, proposal, onEvent: (e) => events.push(e) });
    const tree = store.listChunksTree(sessionId);
    const parentNode = tree.find((c) => c.id === parent.id)!;
    assert.equal(parentNode.tasks.length, 0, '父分块仍无任务');
    const wrapper = parentNode.children.find((c) => c.title === '支付网关');
    assert.ok(wrapper, '应自动创建同名子分块');
    assert.equal(wrapper!.tasks.length, 1);
    assert.equal(wrapper!.tasks[0].title, '金额边界测试');
    assert.ok(events.some((e) => e.type === 'task_created'));
    assert.doesNotThrow(() => assertOnlyLeafHasTasks(db, sessionId));
  });

  // TS-EP-06
  it('TS-EP-06: 直接挂叶子正常路径不新建分块', async () => {
    const leaf = store.insertChunk({ sessionId, parentId: null, title: '金额边界' });
    const proposal: DetectedProposal = {
      kind: 'task', chunkTitle: '金额边界', title: '负数校验', acceptanceCriteria: '', priority: 'P1',
    };
    await acceptProposal({ store, db, sessionId, messageId: null, proposal, onEvent: () => undefined });
    const tree = store.listChunksTree(sessionId);
    assert.equal(tree.length, 1, '不应新建分块');
    assert.equal(tree[0].id, leaf.id);
    assert.equal(tree[0].tasks.length, 1);
  });

  // TS-EP-07
  it('TS-EP-07: chunkTitle 无匹配拒绝且不落库', async () => {
    const before = store.listChunksTree(sessionId);
    const proposal: DetectedProposal = {
      kind: 'task', chunkTitle: '不存在的分块', title: 'x', acceptanceCriteria: '', priority: 'P1',
    };
    await assert.rejects(() => acceptProposal({ store, db, sessionId, messageId: null, proposal, onEvent: () => undefined }));
    assert.deepEqual(store.listChunksTree(sessionId), before);
  });

  // TS-EP-08
  it('TS-EP-08: parentId 环校验（parent 必须属于本会话）', async () => {
    const proposal: DetectedProposal = {
      kind: 'chunk', title: 'A', parentId: 'ch_not_exist', description: '', priority: 'P1', tags: [],
    };
    await assert.rejects(() => acceptProposal({ store, db, sessionId, messageId: null, proposal, onEvent: () => undefined }));
  });

  // TS-EP-10
  it('TS-EP-10: runTurn 全流程——提议落库刷新后可恢复', async () => {
    const replyWithProposal = '分析如下。\n```proposal\n[{"kind":"chunk","title":"错误码体系","parentId":null,"description":"","priority":"P1","tags":[]}]\n```';
    const events: StreamEvent[] = [];
    await runTurn({
      store,
      sessionId,
      userMessage: '我们要定义错误码',
      agents: store.listAgents(sessionId),
      chat: async () => replyWithProposal,
      db,
      onEvent: (e) => events.push(e),
    });
    const msgs = store.listMessages(sessionId);
    assert.equal(msgs.length, 2, 'user + assistant');
    const assistant = msgs.find((m) => m.role === 'assistant') as { proposal_json: string; proposal_state: string };
    assert.equal(assistant.proposal_state, 'pending');
    assert.ok(JSON.parse(assistant.proposal_json));
    assert.ok(events.some((e) => e.type === 'proposal'));
    assert.ok(events.some((e) => e.type === 'delta'));
    assert.ok(events.some((e) => e.type === 'done'));
  });

  // TS-EP-09
  it('TS-EP-09: dismiss 提议状态更新', async () => {
    const ins = store.insertMessage({
      sessionId, role: 'assistant', content: 'r',
      proposalJson: { kind: 'chunk', title: 'A', parentId: null, description: '', priority: 'P1', tags: [] },
    });
    const events: StreamEvent[] = [];
    await acceptProposal({ store, db, sessionId, messageId: ins.id, proposal: null, onEvent: (e) => events.push(e), dismiss: true });
    const msgs = store.listMessages(sessionId);
    assert.equal((msgs[0] as { proposal_state: string }).proposal_state, 'dismissed');
    assert.ok(events.some((e) => e.type === 'proposal_state' && e.state === 'dismissed'));
  });
});

describe('MOD-17 WP-03: 历史编辑差异检测', () => {
  let tmpDir: string;
  let db: SqliteDatabase;
  let store: RequirementsStore;
  let sessionId: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-div-test-'));
    db = new SqliteDatabase(path.join(tmpDir, 'test.db'));
    db.initialize();
    store = new RequirementsStore(db);
    sessionId = store.createSession({ title: 't', initialPrompt: 'p' }).id;
    store.insertChunk({ sessionId, parentId: null, title: '支付方式校验' });
    store.insertChunk({ sessionId, parentId: null, title: '金额边界' });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  // TS-DV-01 + TS-DV-02
  it('TS-DV-01/02: 编辑后产出 notice 且分块树逐字段不变', async () => {
    const treeBefore = JSON.stringify(store.listChunksTree(sessionId));
    const updatedAtBefore = (db.raw.prepare('SELECT updated_at FROM req_chunks').all() as Array<{ updated_at: number }>).map((r) => r.updated_at);

    const events: StreamEvent[] = [];
    await detectEditDivergence({
      store,
      sessionId,
      editedMessage: '改为只支持 paypal（原来还支持 card）',
      recomputeTitles: async () => ['支付方式校验（仅 paypal）'],
      onEvent: (e) => events.push(e),
    });

    // 树完全不变
    assert.equal(JSON.stringify(store.listChunksTree(sessionId)), treeBefore);
    const updatedAtAfter = (db.raw.prepare('SELECT updated_at FROM req_chunks').all() as Array<{ updated_at: number }>).map((r) => r.updated_at);
    assert.deepEqual(updatedAtAfter, updatedAtBefore);

    // notice 落库
    const msgs = store.listMessages(sessionId);
    const notice = msgs.find((m) => m.role === 'system') as { content: string } | undefined;
    assert.ok(notice, '应追加 system notice');
    assert.ok(notice.content.includes('支付方式校验'), 'notice 指出受影响分块');
    assert.ok(events.some((e) => e.type === 'notice' && e.level === 'warn'));
  });

  // TS-DV-03
  it('TS-DV-03: 无差异不追加 notice', async () => {
    const events: StreamEvent[] = [];
    await detectEditDivergence({
      store, sessionId,
      editedMessage: '同一句话',
      recomputeTitles: async () => ['支付方式校验', '金额边界'],
      onEvent: (e) => events.push(e),
    });
    assert.equal(store.listMessages(sessionId).length, 0, '无 notice 落库');
    assert.ok(!events.some((e) => e.type === 'notice'));
  });

  // TS-DV-04
  it('TS-DV-04: 新增候选分块提示', async () => {
    const events: StreamEvent[] = [];
    await detectEditDivergence({
      store, sessionId,
      editedMessage: '新增退款场景',
      recomputeTitles: async () => ['支付方式校验', '金额边界', '退款流程'],
      onEvent: (e) => events.push(e),
    });
    const msgs = store.listMessages(sessionId);
    const notice = msgs.find((m) => m.role === 'system') as { content: string };
    assert.ok(notice.content.includes('退款流程'), 'notice 指出新增候选');
  });
});
