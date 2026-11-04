import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SqliteDatabase } from '../src/database.ts';
import {
  RequirementsStore,
  BUILTIN_PRD_TEMPLATE,
  assertOnlyLeafHasTasks,
} from '../src/requirements-schema.ts';
import type { DetectedChunkProposal, DetectedTaskProposal } from '../src/requirements-schema.ts';

describe('MOD-17 WP-01: requirements-store 存储层', () => {
  let tmpDir: string;
  let db: SqliteDatabase;
  let store: RequirementsStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-req-test-'));
    db = new SqliteDatabase(path.join(tmpDir, 'test.db'));
    db.initialize();
    store = new RequirementsStore(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  // ═══ TS-ST-01 建表完整性 ═══
  describe('TS-ST-01: 9 张表 DDL 完整创建', () => {
    it('req_* 7 张表与 prd_* 2 张表全部存在', () => {
      const names = db.raw
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'req_%' OR name LIKE 'prd_%'"
        )
        .all() as Array<{ name: string }>;
      const set = new Set(names.map((n) => n.name));
      for (const t of [
        'req_sessions',
        'req_agents',
        'req_chunks',
        'req_tasks',
        'req_messages',
        'req_suggestions',
        'req_prds',
        'prd_templates',
        'prd_template_sections',
      ]) {
        assert.ok(set.has(t), `缺少表 ${t}`);
      }
    });
  });

  // ═══ TS-ST-02 会话 CRUD ═══
  describe('TS-ST-02: 会话 CRUD 与列表排序', () => {
    it('create → get → updateStatus → list 往返一致', () => {
      const s1 = store.createSession({
        title: '在线支付校验模块',
        initialPrompt: '我想做一个在线支付校验的东西',
      });
      assert.ok(s1.id.startsWith('req_'));
      assert.equal(s1.status, 'discussing');

      const got = store.getSession(s1.id);
      assert.equal(got?.title, '在线支付校验模块');

      const s2 = store.createSession({ title: '更早的会话', initialPrompt: 'x' });
      db.raw
        .prepare('UPDATE req_sessions SET updated_at = ? WHERE id = ?')
        .run(Date.now() - 10000, s2.id);

      store.updateSessionStatus(s1.id, 'prd_ready');
      assert.equal(store.getSession(s1.id)?.status, 'prd_ready');

      const list = store.listSessions();
      assert.equal(list.length, 2);
      assert.equal(list[0].id, s1.id, 'list 按 updated_at DESC');
    });
  });

  // ═══ TS-ST-03 级联删除 ═══
  describe('TS-ST-03: 删除会话级联清空 7 张表', () => {
    it('删除后 req_* 全空', () => {
      const s = store.createSession({ title: 't', initialPrompt: 'p' });
      store.insertAgent({ sessionId: s.id, name: 'PM', roleTitle: '产品分析师', modelId: 'm1', providerId: 'p1', systemPrompt: 'sp' });
      const chunk = store.insertChunk({ sessionId: s.id, parentId: null, title: '支付方式校验' });
      store.insertTask({ sessionId: s.id, chunkId: chunk.id, title: '边界测试' });
      store.insertMessage({ sessionId: s.id, role: 'user', content: 'hello' });
      store.replaceSuggestions(s.id, [{ content: '建议', sourceType: 'coverage', sourceReason: 'r' }]);
      store.insertPrd(s.id, '# PRD', 'tpl_1');

      store.deleteSession(s.id);
      const tables = ['req_agents', 'req_chunks', 'req_tasks', 'req_messages', 'req_suggestions', 'req_prds'];
      for (const t of tables) {
        const row = db.raw.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE session_id = ?`).get(s.id) as { c: number };
        assert.equal(row.c, 0, `${t} 应为空`);
      }
      assert.equal(store.getSession(s.id), undefined);
    });
  });

  // ═══ TS-ST-04 提议状态机非法流转 ═══
  describe('TS-ST-04: proposal_state 非法流转被拒', () => {
    it('accepted 后再 dismiss 抛错且状态不变', () => {
      const s = store.createSession({ title: 't', initialPrompt: 'p' });
      const msg = store.insertMessage({
        sessionId: s.id,
        role: 'assistant',
        content: '回复',
        proposalJson: { kind: 'chunk', title: 'A', parentId: null, description: '', priority: 'P1', tags: [] },
      });
      store.updateProposalState(msg.id, 'accepted');
      assert.throws(() => store.updateProposalState(msg.id, 'dismissed'));
      const row = db.raw.prepare('SELECT proposal_state FROM req_messages WHERE id = ?').get(msg.id) as { proposal_state: string };
      assert.equal(row.proposal_state, 'accepted');
    });
  });

  // ═══ TS-ST-05 分块树查询 ═══
  describe('TS-ST-05: listChunksTree 三层嵌套与任务挂载', () => {
    it('root→sub→leaf 嵌套正确，tasks 仅在 leaf', () => {
      const s = store.createSession({ title: 't', initialPrompt: 'p' });
      const root = store.insertChunk({ sessionId: s.id, parentId: null, title: '支付网关' });
      const sub = store.insertChunk({ sessionId: s.id, parentId: root.id, title: '校验规则' });
      const leaf = store.insertChunk({ sessionId: s.id, parentId: sub.id, title: '银行卡白名单' });
      store.insertTask({ sessionId: s.id, chunkId: leaf.id, title: '白名单规则设计' });

      const tree = store.listChunksTree(s.id);
      assert.equal(tree.length, 1);
      assert.equal(tree[0].title, '支付网关');
      assert.equal(tree[0].children.length, 1);
      assert.equal(tree[0].children[0].children.length, 1);
      assert.equal(tree[0].children[0].children[0].title, '银行卡白名单');
      assert.equal(tree[0].children[0].children[0].tasks.length, 1);
      assert.equal(tree[0].tasks.length, 0, '父分块不挂任务');
    });
  });

  // ═══ TS-ST-10 PRD 版本递增 ═══
  describe('TS-ST-10: PRD 版本严格递增', () => {
    it('连续 insertPrd 版本 1,2,3', () => {
      const s = store.createSession({ title: 't', initialPrompt: 'p' });
      assert.equal(store.insertPrd(s.id, 'v1', 'tpl_1').version, 1);
      assert.equal(store.insertPrd(s.id, 'v2', 'tpl_1').version, 2);
      assert.equal(store.insertPrd(s.id, 'v3', 'tpl_1').version, 3);
    });
  });
});

// ═══ prd-template-store ═══
describe('MOD-17 WP-01: PRD 模板存储', () => {
  let tmpDir: string;
  let db: SqliteDatabase;
  let store: RequirementsStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-req-tpl-test-'));
    db = new SqliteDatabase(path.join(tmpDir, 'test.db'));
    db.initialize();
    store = new RequirementsStore(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  // TS-TP-01
  it('TS-TP-01: 全新库种子写入「完整 PRD 标准模板」12 章节', () => {
    const tpl = store.getPrdTemplate(BUILTIN_PRD_TEMPLATE.id);
    assert.ok(tpl, '种子模板应存在');
    assert.equal(tpl.isBuiltin, true);
    assert.equal(tpl.isDefault, true);
    assert.equal(tpl.sections.length, 12);
    assert.ok(tpl.sections.every((sec) => sec.promptTemplate.length > 0));
  });

  // TS-TP-02
  it('TS-TP-02: 非内置模板 CRUD 往返一致', () => {
    const tpl = store.createPrdTemplate({ name: '轻量精简', description: '5 章节' });
    const got = store.getPrdTemplate(tpl.id);
    assert.equal(got?.name, '轻量精简');

    store.updatePrdTemplate(tpl.id, { name: '轻量精简 v2', description: '描述更新', sections: tpl.sections });
    assert.equal(store.getPrdTemplate(tpl.id)?.name, '轻量精简 v2');

    store.deletePrdTemplate(tpl.id);
    assert.equal(store.getPrdTemplate(tpl.id), undefined);
  });

  // TS-TP-03 默认唯一
  it('TS-TP-03: setDefault 后全表仅 1 个默认', () => {
    const a = store.createPrdTemplate({ name: 'A', description: '' });
    const b = store.createPrdTemplate({ name: 'B', description: '' });
    store.setDefaultPrdTemplate(a.id);
    assert.equal(store.getPrdTemplate(a.id)?.isDefault, true);
    store.setDefaultPrdTemplate(b.id);
    const list = store.listPrdTemplates();
    const defaults = list.filter((t) => t.isDefault);
    assert.equal(defaults.length, 1);
    assert.equal(defaults[0].id, b.id);
  });

  // TS-TP-04 内置删除拒绝
  it('TS-TP-04: 内置模板删除被拒', () => {
    assert.throws(() => store.deletePrdTemplate(BUILTIN_PRD_TEMPLATE.id));
    assert.ok(store.getPrdTemplate(BUILTIN_PRD_TEMPLATE.id), '删除后仍存在');
  });

  // TS-TP-05 导入导出往返
  it('TS-TP-05: export → import 内容一致', () => {
    const builtin = store.getPrdTemplate(BUILTIN_PRD_TEMPLATE.id)!;
    const json = store.exportPrdTemplate(builtin.id);
    const imported = store.importPrdTemplate({ ...json, name: '内置副本' });
    assert.notEqual(imported.id, builtin.id);
    assert.equal(imported.isBuiltin, false);
    assert.equal(imported.sections.length, builtin.sections.length);
    assert.deepEqual(imported.sections.map((s) => s.title), builtin.sections.map((s) => s.title));
  });

  // TS-ST-08 章节事务替换
  it('TS-ST-08: updatePrdTemplate 事务性全量替换章节', () => {
    const tpl = store.createPrdTemplate({ name: 'X', description: '' });
    const newSections = [
      { title: 'S1', guidance: '', promptTemplate: 'p1', contextSources: ['messages' as const], minWords: null, enabled: true },
      { title: 'S2', guidance: '', promptTemplate: 'p2', contextSources: [], minWords: 100, enabled: false },
    ];
    store.updatePrdTemplate(tpl.id, { name: 'X', description: '', sections: newSections });
    const got = store.getPrdTemplate(tpl.id)!;
    assert.equal(got.sections.length, 2);
    assert.deepEqual(got.sections.map((s) => s.title), ['S1', 'S2']);
    assert.equal(got.sections[0].sortOrder, 1);
    assert.equal(got.sections[1].minWords, 100);
  });

  // TS-ST-09 导入非法 schema
  it('TS-ST-09: 导入缺 promptTemplate 字段拒绝', () => {
    assert.throws(() =>
      store.importPrdTemplate({
        name: 'bad',
        description: '',
        sections: [{ title: 'A', guidance: '', contextSources: [], minWords: null, enabled: true } as never],
      })
    );
  });
});

// ═══ 引擎共用不变量守护函数 ═══
describe('MOD-17 WP-01: assertOnlyLeafHasTasks 不变量', () => {
  let tmpDir: string;
  let db: SqliteDatabase;
  let store: RequirementsStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-req-inv-test-'));
    db = new SqliteDatabase(path.join(tmpDir, 'test.db'));
    db.initialize();
    store = new RequirementsStore(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('合法：任务在叶子分块 → 通过', () => {
    const s = store.createSession({ title: 't', initialPrompt: 'p' });
    const leaf = store.insertChunk({ sessionId: s.id, parentId: null, title: 'leaf' });
    store.insertTask({ sessionId: s.id, chunkId: leaf.id, title: 'task' });
    assert.doesNotThrow(() => assertOnlyLeafHasTasks(db, s.id));
  });

  it('非法：任务挂在父分块 → 抛错', () => {
    const s = store.createSession({ title: 't', initialPrompt: 'p' });
    const parent = store.insertChunk({ sessionId: s.id, parentId: null, title: 'parent' });
    store.insertChunk({ sessionId: s.id, parentId: parent.id, title: 'child' });
    store.insertTask({ sessionId: s.id, chunkId: parent.id, title: 'bad task' });
    assert.throws(() => assertOnlyLeafHasTasks(db, s.id));
  });
});

// 类型编译参考（防止类型漂移）
const _typeProbe: DetectedChunkProposal | DetectedTaskProposal = {
  kind: 'chunk',
  title: 't',
  parentId: null,
  description: '',
  priority: 'P1',
  tags: [],
};
void _typeProbe;
