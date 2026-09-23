import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { GitRollbackManager } from '../src/git-rollback.ts';

test('TC-01-05-001 & TC-01-05-002: 单回合 Git Checkpoint 隔离手写未提交代码与 Revert Turn 原子撤销', async (t) => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-git-test-'));
  const userFile = path.join(tmpBase, 'user_manual.ts');
  const agentFile = path.join(tmpBase, 'agent_created.ts');

  t.after(() => {
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {}
  });

  const manager = new GitRollbackManager(tmpBase);

  await t.test('TC-01-05-001: 捕获检查点并保护用户已存在的手写未提交代码', () => {
    // 模拟回合开始前，用户已有的未提交手写修改
    fs.writeFileSync(userFile, 'const userCode = "DO_NOT_TOUCH";\n', 'utf8');

    // 1. 回合启动前捕获检查点快照
    const cp = manager.createTurnCheckpoint('turn_01');
    assert.equal(cp.turnId, 'turn_01');
    assert.ok(cp.userUntrackedFiles.includes('user_manual.ts'));

    // 2. 模拟 Agent 在本回合创建新文件并修改代码
    fs.writeFileSync(agentFile, 'const agentCode = "BUGGY_CODE";\n', 'utf8');

    // 3. 用户触发一键撤销本回合修改 (Revert Turn)
    const result = manager.revertTurn('turn_01');
    assert.equal(result.success, true);
    assert.ok(result.revertedFiles.includes('agent_created.ts'));

    // 4. 验证断言：Agent 新建的文件被彻底 clean 移除，但用户原本的手写代码 100% 完好无损！
    assert.equal(fs.existsSync(agentFile), false, 'Agent产生的新文件必须被删除');
    assert.equal(fs.existsSync(userFile), true, '用户手写未提交文件坚决不能被误删');
    assert.equal(fs.readFileSync(userFile, 'utf8'), 'const userCode = "DO_NOT_TOUCH";\n');
  });

  await t.test('TC-01-05-002: 开启新回合时，前一回合快照自动静默销毁', () => {
    manager.createTurnCheckpoint('turn_02');
    assert.ok(manager.hasCheckpoint('turn_02'));

    // 开启新回合 turn_03
    manager.createTurnCheckpoint('turn_03');
    assert.equal(manager.hasCheckpoint('turn_02'), false, '前一回合快照必须静默释放');
    assert.equal(manager.hasCheckpoint('turn_03'), true);
  });
});
