import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  PipelineRunner,
  LockDelegator,
  ArtifactManager,
} from '../src/index.ts';
import type { PipelineStage, StageRunResult } from '../src/index.ts';
import { PIPELINE_DEFAULT_TEMPLATE } from '../../plugins/storage-sqlite/src/pipeline-schema.ts';
import { WorkspaceWriteLock } from '../src/workspace-lock.ts';

function makeStages(): PipelineStage[] {
  return PIPELINE_DEFAULT_TEMPLATE.stages.map((s) => ({ ...s }));
}

describe('TC-02-01-002: 多阶段泳道执行状态机与父子写锁租约让渡 (WBS-02-02-01 / WBS-02-02-02)', () => {
  let runner: PipelineRunner;
  let stages: PipelineStage[];

  beforeEach(() => {
    runner = new PipelineRunner();
    stages = makeStages();
  });

  it('顺序执行：无 Gatekeeper 阶段时 idle → running → completed，阶段严格按 order 依次唤醒', async () => {
    const order: string[] = [];
    const testStages = makeStages().map((s) => ({ ...s, gatekeeperRequired: false }));

    const outcome = await runner.run({
      instanceId: 'inst_seq',
      stages: testStages,
      executeStage: async ({ stage }) => {
        order.push(stage.id);
        return { summary: `${stage.roleName} done` };
      },
    });

    assert.equal(order.length, 4);
    assert.deepEqual(order, ['stg_prd', 'stg_arch', 'stg_code', 'stg_qa'], '必须按 1..4 阶段顺序执行');
    assert.equal(outcome.status, 'completed');
    assert.equal(runner.statusOf('inst_seq'), 'completed');
    assert.equal(outcome.stageResults.length, 4);
  });

  it('Gatekeeper 卡点：等待放行期间状态为 waiting_gate，绝不提前唤醒下一阶段', async () => {
    const started: string[] = [];
    const abortCtrl = new AbortController();

    const running = runner.run({
      instanceId: 'inst_gate',
      stages,
      signal: abortCtrl.signal,
      executeStage: async ({ stage }) => {
        started.push(stage.id);
        return { summary: `stage ${stage.roleName}`, artifactPaths: [] };
      },
    });

    // 等待第一阶段触发 Gatekeeper
    await waitFor(() => runner.statusOf('inst_gate') === 'waiting_gate');
    assert.deepEqual(started, ['stg_prd'], '第一阶段完成后必须挂起，第二阶段不得启动');
    assert.equal(runner.currentStageId('inst_gate'), 'stg_prd');

    // 放行第一阶段
    assert.equal(runner.resolveGate('inst_gate', { action: 'approve' }), true);
    await waitFor(() => runner.statusOf('inst_gate') === 'waiting_gate' && started.length >= 2);
    assert.equal(runner.currentStageId('inst_gate'), 'stg_arch');

    // 放行第二阶段（第三阶段无 Gatekeeper，跑完直接进第四阶段 Gatekeeper）
    runner.resolveGate('inst_gate', { action: 'approve' });
    await waitFor(() => started.length >= 4 && runner.statusOf('inst_gate') === 'waiting_gate');
    assert.equal(runner.currentStageId('inst_gate'), 'stg_qa');

    runner.resolveGate('inst_gate', { action: 'approve' });
    const outcome = await running;
    assert.equal(outcome.status, 'completed');
    assert.equal(started.length, 4);
  });

  it('打回修改：Gatekeeper reject 后同阶段带原因重跑，不跳过也不越权', async () => {
    const attempts: Array<{ id: string; reason: string | undefined }> = [];
    const outcome = await runWithAutoGates(runner, {
      instanceId: 'inst_rework',
      stages,
      gateResolutions: [
        { action: 'reject', reason: 'PRD 缺少验收标准章节' },
        { action: 'approve' },
        { action: 'approve' },
        { action: 'approve' },
      ],
      executeStage: async ({ stage, reworkReason }) => {
        attempts.push({ id: stage.id, reason: reworkReason });
        return { summary: 'done' };
      },
    });

    assert.equal(outcome.status, 'completed');
    // 第一阶段执行了两次：首次 + 被打回后带着原因重做
    assert.deepEqual(attempts.map((a) => a.id), ['stg_prd', 'stg_prd', 'stg_arch', 'stg_code', 'stg_qa']);
    assert.equal(attempts[0].reason, undefined, '首次执行无打回原因');
    assert.equal(attempts[1].reason, 'PRD 缺少验收标准章节', '重跑必须携带打回原因供 Agent 修正');
    const gateRecords = outcome.gateRecords;
    assert.equal(gateRecords.filter((g) => g.action === 'reject').length, 1);
    assert.ok(gateRecords.some((g) => g.action === 'approve' && g.stageId === 'stg_prd'));
  });

  it('打回次数超限 fail-closed：连续超限即判失败，绝不无限循环', async () => {
    const outcome = await runWithAutoGates(runner, {
      instanceId: 'inst_rework_max',
      stages,
      // 每次都打回，超过最大重试上限
      gateResolutions: Array.from({ length: 20 }, () => ({ action: 'reject' as const })),
      maxReworks: 3,
      executeStage: async () => ({ summary: 'done' }),
    });

    assert.equal(outcome.status, 'failed');
    assert.ok(outcome.stageResults.length <= 1, '仅完成第一阶段');
  });

  it('阶段执行异常时状态 failed 且安全保全已完成上下文', async () => {
    const outcome = await runWithAutoGates(runner, {
      instanceId: 'inst_error',
      stages,
      gateResolutions: [{ action: 'approve' }, { action: 'approve' }],
      executeStage: async ({ stage }) => {
        if (stage.id === 'stg_code') throw new Error('阶段执行器异常崩溃');
        return { summary: `${stage.roleName} ok` };
      },
    });

    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.error, '阶段执行器异常崩溃');
    assert.equal(outcome.stageResults.length, 2, '前两个成功阶段的结果必须保留');
    assert.equal(runner.currentStageId('inst_error'), 'stg_code', '失败时定位到出错阶段');
  });

  it('Abort 中断：状态为 aborted 且已产出结果保留', async () => {
    const ctrl = new AbortController();
    const abortStages = makeStages().map((s) => ({ ...s, gatekeeperRequired: false }));
    const running = runner.run({
      instanceId: 'inst_abort',
      stages: abortStages,
      signal: ctrl.signal,
      executeStage: async ({ stage }) => {
        if (stage.id === 'stg_arch') {
          ctrl.abort();
          throw new Error('aborted');
        }
        return { summary: `${stage.roleName} ok` };
      },
    });
    const outcome = await running;
    assert.equal(outcome.status, 'aborted');
    assert.ok(outcome.stageResults.length >= 1, '已完成阶段结果不丢失');
  });

  it('未审核的阶段（gatekeeperRequired=false）不进入等待卡点', async () => {
    const codes = stages.map((s) => ({ ...s, gatekeeperRequired: false }));
    const outcome = await runWithAutoGates(runner, {
      instanceId: 'inst_no_gate',
      stages: codes,
      gateResolutions: [],
      executeStage: async () => ({ summary: 'ok' }),
    });
    assert.equal(outcome.status, 'completed');
    assert.equal(outcome.gateRecords.length, 0, '无 Gatekeeper 阶段不得产生审批记录');
  });
});

describe('父子工作区写锁租约让渡 (LockDelegator / D64)', () => {
  it('delegate：父持有写锁时向子代理让渡，子成为唯一写者', () => {
    const lock = new WorkspaceWriteLock();
    const delegator = new LockDelegator(lock);
    const ws = '/workspace/demo';

    assert.equal(lock.tryAcquire(ws, 'parent'), true);
    assert.equal(delegator.delegate(ws, 'parent', 'child'), true);

    assert.equal(lock.holder(ws), 'child', '让渡后子会话必须成为唯一写者');
    // 父不得再写
    assert.equal(lock.tryAcquire(ws, 'parent'), false, '父挂起期间不得写入');
  });

  it('reclaim：子阶段完毕返还写锁，父恢复持有', () => {
    const lock = new WorkspaceWriteLock();
    const delegator = new LockDelegator(lock);
    const ws = '/workspace/demo';

    lock.tryAcquire(ws, 'parent');
    delegator.delegate(ws, 'parent', 'child');
    assert.equal(delegator.reclaim(ws, 'child'), true);

    assert.equal(lock.holder(ws), 'parent', '子归还后父恢复持有');
    assert.equal(lock.tryAcquire(ws, 'parent'), true);
  });

  it('阶段流转无缝转移：子上下一段又把锁交还，全程唯一写者不空白、无死锁', () => {
    const lock = new WorkspaceWriteLock();
    const delegator = new LockDelegator(lock);
    const ws = '/workspace/demo';

    lock.tryAcquire(ws, 'main_session');
    assert.equal(lock.holder(ws), 'main_session');

    delegator.delegate(ws, 'main_session', 'stage_2');
    assert.equal(lock.holder(ws), 'stage_2');

    delegator.delegate(ws, 'stage_2', 'stage_3');
    assert.equal(lock.holder(ws), 'stage_3', '下游之间继续让渡');

    delegator.reclaim(ws, 'stage_3');
    // stage_3 归还后回到上一层（stage_2），再归还给 main_session
    assert.ok(['stage_2', 'main_session'].includes(lock.holder(ws) as string));
    if (lock.holder(ws) === 'stage_2') delegator.reclaim(ws, 'stage_2');
    assert.equal(lock.holder(ws), 'main_session');
  });

  it('fail-closed：非持有者尝试 delegate 直接拒绝', () => {
    const lock = new WorkspaceWriteLock();
    const delegator = new LockDelegator(lock);
    const ws = '/workspace/demo';
    lock.tryAcquire(ws, 'owner');
    assert.equal(delegator.delegate(ws, 'not_owner', 'child'), false, '非持有者无权让渡');
    assert.equal(lock.holder(ws), 'owner');
  });

  it('reclaim：非当前持有者归还被拒绝', () => {
    const lock = new WorkspaceWriteLock();
    const delegator = new LockDelegator(lock);
    const ws = '/workspace/demo';
    lock.tryAcquire(ws, 'parent');
    delegator.delegate(ws, 'parent', 'child');
    assert.equal(delegator.reclaim(ws, 'stranger'), false);
    assert.equal(lock.holder(ws), 'child');
  });
});

describe('阶段工件捕获与上游只读守护 (ArtifactManager / WBS-02-03-01 / WBS-02-03-02)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-artifact-'));
    fs.mkdirSync(path.join(tmpDir, 'docs', 'design'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'docs', 'PRD.md'), '# PRD content');
    fs.writeFileSync(path.join(tmpDir, 'docs', 'design', 'arch.md'), '# Architecture');
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"demo"}');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('按 artifactPaths 捕获阶段产出的物理文件（支持精确路径与 ** 通配）', () => {
    const mgr = new ArtifactManager(tmpDir);
    const captured = mgr.capture(['docs/PRD.md', 'docs/design/**']);
    assert.ok(captured.includes(path.join(tmpDir, 'docs', 'PRD.md')), '精确路径必须捕获');
    assert.ok(captured.includes(path.join(tmpDir, 'docs', 'design', 'arch.md')), '** 必须匹配子目录文件');
    assert.ok(!captured.includes(path.join(tmpDir, 'package.json')), '未声明的文件不得捕获');
  });

  it('留空 artifactPaths 时按 Git 增量追踪（返回空清单交由调用方注入 diff）', () => {
    const mgr = new ArtifactManager(tmpDir);
    assert.deepEqual(mgr.capture([]), [], '未声明工件目录时应返回空清单，表示走 Git 增量');
  });

  it('结构化构建下游阶段输入上下文（含上游角色、阶段名与工件正文）', () => {
    const mgr = new ArtifactManager(tmpDir);
    mgr.approve('stg_prd', mgr.capture(['docs/PRD.md']));

    const ctx = mgr.buildStageInputContext(makeStages(), 1, [
      { stageId: 'stg_prd', roleName: '需求分析师 (Product Manager)', artifactPaths: [path.join(tmpDir, 'docs', 'PRD.md')], summary: 'PRD 已产出' },
    ]);

    assert.ok(ctx.includes('需求分析师'), '必须注入上游角色身份');
    assert.ok(ctx.includes('PRD.md'), '必须注入工件文件名');
    assert.ok(ctx.includes('# PRD content'), '必须注入工件正文供下游 Agent 消费');
    assert.ok(ctx.includes('当前阶段'), '必须标注当前下游阶段');
  });

  it('上游审定工件只读守护：后续所有下游阶段 edit_file 被拦截', () => {
    const mgr = new ArtifactManager(tmpDir);
    const approved = mgr.capture(['docs/PRD.md']);
    mgr.approve('stg_prd', approved);

    // 上游已审定的工件在下游任何阶段都只读
    assert.equal(mgr.canEdit(path.join(tmpDir, 'docs', 'PRD.md')), false, '上游审定工件必须只读');
    // 未被审定的文件仍可编辑
    assert.equal(mgr.canEdit(path.join(tmpDir, 'docs', 'design', 'arch.md')), true, '未审定工件不受守护');
    assert.equal(mgr.canEdit(path.join(tmpDir, 'package.json')), true);
  });

  it('releaseStage 不再守护该阶段已回收的工件（仅下游阶段生效）', () => {
    const mgr = new ArtifactManager(tmpDir);
    mgr.approve('stg_prd', mgr.capture(['docs/PRD.md']));
    assert.equal(mgr.canEdit(path.join(tmpDir, 'docs', 'PRD.md')), false);
    mgr.release('stg_prd');
    assert.equal(mgr.canEdit(path.join(tmpDir, 'docs', 'PRD.md')), true);
  });
});

/** 等待条件满足（轮询式，避免引入额外时钟依赖）。 */
async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('waitFor timeout');
}

/** 自动按预设裁决回应 Gatekeeper，用于端到端串跑状态机。 */
async function runWithAutoGates(
  runner: PipelineRunner,
  opts: {
    instanceId: string;
    stages: PipelineStage[];
    gateResolutions: Array<{ action: 'approve' | 'reject'; reason?: string }>;
    maxReworks?: number;
    executeStage: (ctx: { stage: PipelineStage; reworkReason?: string }) => Promise<StageRunResult>;
  },
) {
  const gateQueue = [...opts.gateResolutions];
  const watcher = (async () => {
    for (;;) {
      const status = runner.statusOf(opts.instanceId);
      if (status === 'waiting_gate') {
        const next = gateQueue.shift() ?? { action: 'approve' as const };
        runner.resolveGate(opts.instanceId, next);
      } else if (status === 'completed' || status === 'failed' || status === 'aborted') {
        return;
      }
      await new Promise((r) => setTimeout(r, 5));
    }
  })();

  const outcome = await runner.run({
    instanceId: opts.instanceId,
    stages: opts.stages,
    maxReworks: opts.maxReworks ?? 2,
    executeStage: opts.executeStage,
  });
  await watcher;
  return outcome;
}
