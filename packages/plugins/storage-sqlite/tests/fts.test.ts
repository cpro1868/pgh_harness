import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteDatabase } from '../src/database.ts';
import { FtsSearchService } from '../src/fts-service.ts';


test('TC-01-02-004: FTS5 全文倒排索引虚拟表与毫秒级检索服务', async (t) => {
  const db = new SqliteDatabase(':memory:');
  db.initialize();

  const fts = new FtsSearchService(db);
  fts.initializeVirtualTable();

  t.after(() => {
    db.close();
  });

  await t.test('索引事件文本并支持分词精确毫秒级召回', () => {
    fts.indexEvent({
      sessionId: 'sess_fts_1',
      eventType: 'tool/result',
      content: '修复 BigInt 精度丢失与 MAX_SAFE_INTEGER 边界异常',
    });

    fts.indexEvent({
      sessionId: 'sess_fts_1',
      eventType: 'message/user',
      content: '请帮我写一个快速排序算法',
    });

    fts.indexEvent({
      sessionId: 'sess_fts_2',
      eventType: 'tool/result',
      content: '编译失败: TS2322 Type string is not assignable to type number',
    });

    // 关键词搜索 1
    const results1 = fts.search('MAX_SAFE_INTEGER', 'sess_fts_1');
    assert.equal(results1.length, 1);
    assert.ok(results1[0].content.includes('BigInt'));

    // 搜索不存在词
    const resultsEmpty = fts.search('Python', 'sess_fts_1');
    assert.equal(resultsEmpty.length, 0);

    // 会话级隔离搜索
    const resultsIsolated = fts.search('TS2322', 'sess_fts_1');
    assert.equal(resultsIsolated.length, 0);

    const resultsSession2 = fts.search('TS2322', 'sess_fts_2');
    assert.equal(resultsSession2.length, 1);
  });
});
