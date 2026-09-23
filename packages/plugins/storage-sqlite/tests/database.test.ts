import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SqliteDatabase } from '../src/database.ts';
import { EventStore } from '../src/event-store.ts';


test('TC-01-02-001 & TC-01-02-002: Node 22 原生 node:sqlite WAL驱动与追加式 events 表事件存储引擎', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-sqlite-test-'));
  const dbPath = path.join(tmpDir, 'test.db');

  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test('TC-01-02-001: 数据库初始化并启用 WAL 模式与 NORMAL 同步', () => {
    const db = new SqliteDatabase(dbPath);
    db.initialize();

    const journalMode = db.pragma('journal_mode');
    assert.equal(journalMode, 'wal');

    const syncMode = db.pragma('synchronous');
    assert.equal(syncMode, 1); // 1 = NORMAL
    db.close();
  });

  await t.test('TC-01-02-002: events 表局部单调自增 seq 无空洞且支持按 seq 切片查询', () => {
    const db = new SqliteDatabase(dbPath);
    db.initialize();
    const eventStore = new EventStore(db);

    const sessionId = 'sess_test_01';

    // 连续追加 5 个事件
    const ev1 = eventStore.appendEvent({
      sessionId,
      turnId: 'turn_01',
      stepIndex: 0,
      type: 'message/user',
      payload: { content: '你好' },
    });
    assert.equal(ev1.seq, 1);

    const ev2 = eventStore.appendEvent({
      sessionId,
      turnId: 'turn_01',
      stepIndex: 1,
      type: 'tool/call',
      payload: { callId: 'c1', tool: 'read_file' },
    });
    assert.equal(ev2.seq, 2);

    const ev3 = eventStore.appendEvent({
      sessionId,
      turnId: 'turn_01',
      stepIndex: 2,
      type: 'tool/result',
      payload: { callId: 'c1', output: 'ok' },
    });
    assert.equal(ev3.seq, 3);

    // 另一个会话的事件独立从 seq 1 开始
    const otherEv = eventStore.appendEvent({
      sessionId: 'sess_other_99',
      turnId: 'turn_01',
      stepIndex: 0,
      type: 'message/user',
      payload: { content: '其他会话' },
    });
    assert.equal(otherEv.seq, 1);

    // 查询验证增量切片: afterSeq = 1
    const sliced = eventStore.getEventsAfter(sessionId, 1);
    assert.equal(sliced.length, 2);
    assert.equal(sliced[0].seq, 2);
    assert.equal(sliced[1].seq, 3);

    db.close();
  });
});
