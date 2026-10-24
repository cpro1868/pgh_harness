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

  await t.test('TC-01-05-003: 快照范围收窄——隐藏目录（.obsidian/.smart-env 等）不入快照', () => {
    // 模拟 Obsidian 类工具缓存目录：体积大、与 Agent 工作完全无关
    const cacheDir = path.join(tmpBase, '.smart-env');
    const obsidianDir = path.join(tmpBase, '.obsidian');
    const pluginFile = path.join(cacheDir, 'temp_cache.ajson');
    const pluginJs = path.join(obsidianDir, 'main.js');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.mkdirSync(obsidianDir, { recursive: true });
    fs.writeFileSync(pluginFile, 'x'.repeat(1024), 'utf8');
    fs.writeFileSync(pluginJs, 'y'.repeat(1024), 'utf8');

    const cp = manager.createTurnCheckpoint('turn_04');
    assert.ok(!cp.userUntrackedFiles.some((f) => f.startsWith('.smart-env') || f.startsWith('.obsidian')), '隐藏目录不得进入快照清单');

    // 缓存文件即使被 Agent 新建/修改，撤销也只处理真实工作内容
    fs.writeFileSync(pluginFile, 'mutated', 'utf8');
    fs.writeFileSync(path.join(tmpBase, 'real_work.ts'), 'new by agent', 'utf8');
    const result = manager.revertTurn('turn_04');
    assert.ok(result.revertedFiles.includes('real_work.ts'), '真实工作区新文件必须被撤销');
    assert.ok(!result.revertedFiles.some((f) => f.startsWith('.smart-env')), '隐藏目录变更不属于撤销范围');
    assert.equal(fs.readFileSync(pluginFile, 'utf8'), 'mutated', '隐藏目录内容不被回滚（不属于快照范围）');

    // 清理本次注入，不影响后续用例
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(obsidianDir, { recursive: true, force: true });
  });

  await t.test('TC-01-05-004: 快照用 Buffer 存储，大文件不预解码（性能约束）', () => {
    const bigFile = path.join(tmpBase, 'big_binary.bin');
    const payload = Buffer.from(Array.from({ length: 2048 }, (_, i) => i % 256));
    fs.writeFileSync(bigFile, payload);

    const cp = manager.createTurnCheckpoint('turn_05');
    const snap = cp.fileSnapshots.get('big_binary.bin');
    assert.ok(Buffer.isBuffer(snap), '快照必须以 Buffer 存储（禁止预解码字符串膨胀内存）');
    assert.ok(snap.equals(payload), 'Buffer 内容必须与原文件一致');

    // 撤销后二进制内容逐字节还原
    fs.writeFileSync(bigFile, Buffer.from([1, 2, 3]));
    const result = manager.revertTurn('turn_05');
    assert.ok(result.revertedFiles.includes('big_binary.bin'));
    assert.ok(fs.readFileSync(bigFile).equals(payload), '二进制文件撤销后必须逐字节还原');
  });
});
