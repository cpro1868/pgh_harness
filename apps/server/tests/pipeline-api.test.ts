import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { HarnessServer } from '../src/index.ts';

interface StubLlm {
  server: http.Server;
  port: number;
  calls: { count: number };
  bodies: string[];
  tool: { name: string; args: Record<string, unknown> };
  delay: { ms: number };
}

/** 最小 OpenAI 兼容 stub：若请求尚未含工具结果则发起一次工具调用，否则返回最终回答。 */
function startStubLlm(): Promise<StubLlm> {
  return new Promise((resolve) => {
    const calls = { count: 0 };
    const bodies: string[] = [];
    const tool = { name: 'read_file', args: { path: 'hello.txt' } as Record<string, unknown> };
    const delay = { ms: 0 };
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/chat/completions') {
        let raw = '';
        req.on('data', (chunk) => { raw += chunk; });
        req.on('end', () => {
          calls.count += 1;
          bodies.push(raw);
          let hasToolResult = false;
          try {
            const parsed = JSON.parse(raw) as { messages?: Array<{ role?: string }> };
            hasToolResult = Array.isArray(parsed.messages) && parsed.messages.some((m) => m.role === 'tool');
          } catch { /* ignore */ }
          const respond = (): void => {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            if (!hasToolResult) {
              const args = JSON.stringify(tool.args);
              res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: `call_${calls.count}`, type: 'function', function: { name: tool.name, arguments: args } }] } }] })}\n\n`);
              res.write('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n');
            } else {
              res.write('data: {"choices":[{"delta":{"role":"assistant","content":"阶段交付完成。"}}]}\n\n');
              res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
            }
            res.write('data: [DONE]\n\n');
            res.end();
          };
          if (delay.ms > 0) setTimeout(respond, delay.ms);
          else respond();
        });
        return;
      }
      res.writeHead(404);
      res.end('{}');
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port, calls, bodies, tool, delay });
    });
  });
}

describe('TC-02-01-003: 流水线服务端 REST 与运行调度 API 集成 (WBS-02-01 ~ WBS-02-04)', () => {
  let tmpDir: string;
  let server: HarnessServer;
  let stub: StubLlm;
  const testPort = 3325;
  const base = `http://127.0.0.1:${testPort}`;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-pipeline-api-'));
    stub = await startStubLlm();
    server = new HarnessServer({ port: testPort, dataDir: path.join(tmpDir, 'data') });
    await server.start();

    // 全量套件统一注册 stub Provider：阶段真实执行需要可用模型，缺失即 fail-closed
    const provRes = await fetch(`${base}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'pipeline-stub',
        name: 'Pipeline Stub',
        protocol: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${stub.port}`,
        apiKey: 'sk-live-key-for-pipeline-test',
        models: [{ id: 'pipeline-stub-model', name: 'pipeline-stub-model', contextWindow: 65536 }],
      }),
    });
    assert.equal(provRes.status, 200);
  });

  after(async () => {
    await server.stop();
    stub.server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('1. GET /api/pipelines：自动初始化并返回内置标准研发泳道模板', async () => {
    const res = await fetch(`${base}/api/pipelines`);
    assert.equal(res.status, 200);
    const json = (await res.json()) as { code: number; data: Array<{ id: string; name: string; stages: Array<{ roleName: string }> }> };
    assert.equal(json.code, 0);
    assert.ok(json.data.length >= 1);
    const std = json.data.find((p) => p.id === 'pipeline_std_rd');
    assert.ok(std, '必须包含内置标准研发流水线模板');
    assert.equal(std!.stages.length, 4, '标准流水线必须具备 4 个阶段');
  });

  it('2. POST /api/pipelines：创建自定义流水线模板', async () => {
    const res = await fetch(`${base}/api/pipelines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'pl_custom_test',
        name: '轻量修复流水线',
        description: '复现定位 -> 修复与验证',
        stages: [
          {
            id: 'st_repro',
            name: '复现缺陷定位',
            roleName: '复现工程师',
            promptTemplate: '编写最小复现测试',
            toolsAllowed: ['read_file', 'write_file', 'bash'],
            artifactPaths: ['tests/**'],
            gatekeeperRequired: true,
          },
          {
            id: 'st_fix',
            roleName: '修复工程师',
            promptTemplate: '修复缺陷使其绿灯',
            toolsAllowed: ['read_file', 'edit_file', 'bash'],
            artifactPaths: [],
            gatekeeperRequired: false,
          },
        ],
      }),
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { code: number; data: { id: string; stages: Array<{ order: number; name?: string }> } };
    assert.equal(json.code, 0);
    assert.equal(json.data.id, 'pl_custom_test');
    assert.deepEqual(json.data.stages.map((s) => s.order), [1, 2]);
    assert.equal(json.data.stages[0]!.name, '复现缺陷定位', 'stage.name 必须持久化透传');
    assert.equal(json.data.stages[1]!.name, undefined, '未提供 name 时为 undefined');
  });

  it('3. POST /api/pipelines/:id/stages/insert：双向插入定制阶段（步骤在指定位置后插入）', async () => {
    const res = await fetch(`${base}/api/pipelines/pl_custom_test/stages/insert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        afterStageId: 'st_repro',
        stage: {
          id: 'st_review',
          name: '复现审阅核查',
          roleName: '复现审阅员',
          promptTemplate: '人工核查复现用例真实性',
          toolsAllowed: ['read_file'],
          artifactPaths: [],
          gatekeeperRequired: true,
        },
      }),
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { code: number; data: { stages: Array<{ id: string; order: number; name?: string }> } };
    assert.equal(json.code, 0);
    assert.equal(json.data.stages.length, 3);
    assert.deepEqual(json.data.stages.map((s) => s.id), ['st_repro', 'st_review', 'st_fix']);
    assert.deepEqual(json.data.stages.map((s) => s.order), [1, 2, 3]);
    assert.equal(json.data.stages[1]!.name, '复现审阅核查', '插入阶段的 name 字段必须透传');
  });

  it('4. POST /api/pipeline-instances/start：启动流水线任务实例并进入初始阶段', async () => {
    // 登记物理工作区
    const ws = path.join(tmpDir, 'ws_pipe');
    fs.mkdirSync(ws, { recursive: true });
    fs.writeFileSync(path.join(ws, 'app.ts'), 'export const a = 1;\n');

    const startRes = await fetch(`${base}/api/pipeline-instances/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pipelineId: 'pipeline_std_rd',
        workspacePath: ws,
        taskPrompt: '重构认证模块并编写测试用例',
      }),
    });
    assert.equal(startRes.status, 200);
    const startJson = (await startRes.json()) as { code: number; data: { instanceId: string; status: string; currentStageId: string } };
    assert.equal(startJson.code, 0);
    assert.ok(startJson.data.instanceId.startsWith('inst_'));
    const instId = startJson.data.instanceId;

    // 实例列表可查
    const listRes = await fetch(`${base}/api/pipeline-instances`);
    const listJson = (await listRes.json()) as { code: number; data: Array<{ instanceId: string; currentStageId: string }> };
    assert.ok(listJson.data.some((inst) => inst.instanceId === instId));

    // Gatekeeper 决策接口：可查询或裁决
    const gateRes = await fetch(`${base}/api/pipeline-instances/${instId}/gate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    });
    assert.equal(gateRes.status, 200);
    const gateJson = (await gateRes.json()) as { code: number };
    assert.equal(gateJson.code, 0);
  });

  it('5. POST /api/pipeline-instances/draft：先设计任务规格保存草稿，再启动', async () => {
    const ws = path.join(tmpDir, 'ws_draft');
    fs.mkdirSync(ws, { recursive: true });

    // 1. 保存定制规格 (草稿)
    const draftRes = await fetch(`${base}/api/pipeline-instances/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '未启动任务规格草稿',
        pipelineId: 'pipeline_std_rd',
        workspacePath: ws,
        taskPrompt: '待启动的需求指令',
      }),
    });
    assert.equal(draftRes.status, 200);
    const draftJson = (await draftRes.json()) as { code: number; data: { instanceId: string; status: string } };
    assert.equal(draftJson.code, 0);
    assert.equal(draftJson.data.status, 'draft', '保存规格后状态必须为 draft，不自动跑取');
    const instId = draftJson.data.instanceId;

    // 2. 缺少明确用户指令时拒绝启动（第 3 条要求：必须接入明确用户指令才能开始跑）
    const badStartRes = await fetch(`${base}/api/pipeline-instances/${instId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: '   ' }),
    });
    assert.equal(badStartRes.status, 400, '空用户指令必须 400 拒绝启动');

    // 3. 传入明确指令后成功启动
    const runRes = await fetch(`${base}/api/pipeline-instances/${instId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: '确认启动：执行认证模块重构' }),
    });
    assert.equal(runRes.status, 200);
    const runJson = (await runRes.json()) as { code: number; data: { status: string } };
    assert.equal(runJson.code, 0);
    assert.ok(['running', 'waiting_gate'].includes(runJson.data.status));
  });

  it('6. 任务控制：停止 (abort) 与 删除 (delete) 操作', async () => {
    const ws = path.join(tmpDir, 'ws_ctrl');
    fs.mkdirSync(ws, { recursive: true });

    const startRes = await fetch(`${base}/api/pipeline-instances/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pipelineId: 'pipeline_std_rd',
        workspacePath: ws,
        taskPrompt: '待停止任务',
      }),
    });
    const { data: { instanceId: instId } } = (await startRes.json()) as { data: { instanceId: string } };

    // 停止操作
    const abortRes = await fetch(`${base}/api/pipeline-instances/${instId}/abort`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: '人类主管终止了此任务' }),
    });
    assert.equal(abortRes.status, 200);
    const abortJson = (await abortRes.json()) as { code: number; data: { status: string } };
    assert.equal(abortJson.code, 0);
    assert.equal(abortJson.data.status, 'aborted');

    // 删除操作
    const delRes = await fetch(`${base}/api/pipeline-instances/${instId}`, {
      method: 'DELETE',
    });
    assert.equal(delRes.status, 200);
    const delJson = (await delRes.json()) as { code: number };
    assert.equal(delJson.code, 0);

    // 详情返回 404
    const getRes = await fetch(`${base}/api/pipeline-instances/${instId}`);
    assert.equal(getRes.status, 404);
  });

  it('7. 实时监控：获取各角色详细活动日志 (logs) 与下达干预指令 (instruction)', async () => {
    const ws = path.join(tmpDir, 'ws_mon');
    fs.mkdirSync(ws, { recursive: true });

    const startRes = await fetch(`${base}/api/pipeline-instances/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pipelineId: 'pipeline_std_rd',
        workspacePath: ws,
        taskPrompt: '监控测试任务',
      }),
    });
    const { data: { instanceId: instId } } = (await startRes.json()) as { data: { instanceId: string } };

    // 下达干预指令
    const instructRes = await fetch(`${base}/api/pipeline-instances/${instId}/instruction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '注意重放窗口设定为 300 秒，不要过早引入 Redis' }),
    });
    assert.equal(instructRes.status, 200);
    const instructJson = (await instructRes.json()) as { code: number };
    assert.equal(instructJson.code, 0);

    // 查询实例详情（包含各角色 logs 追踪）
    const detailRes = await fetch(`${base}/api/pipeline-instances/${instId}`);
    assert.equal(detailRes.status, 200);
    const detailJson = (await detailRes.json()) as { code: number; data: { logs: Array<{ actor: string; content: string }> } };
    assert.equal(detailJson.code, 0);
    assert.ok(detailJson.data.logs.some((l) => l.actor === 'human' && l.content.includes('300 秒')));
  });

  it('8. 暂停与恢复：pause 置为 paused、resume 恢复 running，并留下审计日志', async () => {
    const ws = path.join(tmpDir, 'ws_pause');
    fs.mkdirSync(ws, { recursive: true });

    const startRes = await fetch(`${base}/api/pipeline-instances/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pipelineId: 'pipeline_std_rd', workspacePath: ws, taskPrompt: '暂停恢复测试' }),
    });
    const { data: { instanceId } } = (await startRes.json()) as { data: { instanceId: string } };

    const pauseRes = await fetch(`${base}/api/pipeline-instances/${instanceId}/pause`, { method: 'POST' });
    assert.equal(pauseRes.status, 200);
    const pauseJson = (await pauseRes.json()) as { code: number; data: { status: string } };
    assert.equal(pauseJson.code, 0);
    assert.equal(pauseJson.data.status, 'paused');

    const afterPause = (await (await fetch(`${base}/api/pipeline-instances/${instanceId}`)).json()) as {
      data: { status: string; logs: Array<{ actor: string; content: string }> };
    };
    assert.equal(afterPause.data.status, 'paused');
    assert.ok(afterPause.data.logs.some((l) => l.content.includes('暂停')), '暂停必须留痕');

    const resumeRes = await fetch(`${base}/api/pipeline-instances/${instanceId}/resume`, { method: 'POST' });
    assert.equal(resumeRes.status, 200);
    const resumeJson = (await resumeRes.json()) as { code: number; data: { status: string } };
    assert.equal(resumeJson.code, 0);
    assert.ok(['running', 'waiting_gate', 'completed'].includes(resumeJson.data.status));

    // 未知实例 fail-closed
    const badRes = await fetch(`${base}/api/pipeline-instances/inst_not_exists/pause`, { method: 'POST' });
    assert.equal(badRes.status, 404);
  });

  it('9. GET /api/pipeline-instances/:id/diff：返回工作区 Git 分支与改动摘要（只读）', async () => {
    const ws = path.join(tmpDir, 'ws_git');
    fs.mkdirSync(ws, { recursive: true });
    // 初始化一个真实 git 仓库
    const { execFileSync } = await import('node:child_process');
    const git = (args: string[]) => execFileSync('git', args, { cwd: ws, stdio: 'pipe' });
    git(['init', '-q']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(ws, 'app.ts'), 'export const a = 1;\n');
    git(['add', '.']);
    git(['commit', '-q', '-m', 'init']);
    // 制造一处改动
    fs.writeFileSync(path.join(ws, 'app.ts'), 'export const a = 2;\n');

    const startRes = await fetch(`${base}/api/pipeline-instances/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pipelineId: 'pipeline_std_rd', workspacePath: ws, taskPrompt: 'Diff 测试' }),
    });
    const { data: { instanceId } } = (await startRes.json()) as { data: { instanceId: string } };

    const diffRes = await fetch(`${base}/api/pipeline-instances/${instanceId}/diff`);
    assert.equal(diffRes.status, 200);
    const diffJson = (await diffRes.json()) as {
      code: number;
      data: { available: boolean; branch?: string; stat?: string; diff?: string };
    };
    assert.equal(diffJson.code, 0);
    assert.equal(diffJson.data.available, true, 'git 仓库必须可用');
    assert.ok(typeof diffJson.data.branch === 'string' && diffJson.data.branch.length > 0, '必须返回当前分支名');
    assert.ok((diffJson.data.stat || '').includes('app.ts'), '改动摘要必须包含被修改文件');
    assert.ok((diffJson.data.diff || '').includes('-export const a = 1;'), 'diff 必须包含被删除的旧行');
  });

  it('10. 真实执行：阶段经 TurnLoop 调用模型并真实执行工具，日志含工具调用与输出', async () => {
    const ws = path.join(tmpDir, 'ws_tools');
    fs.mkdirSync(ws, { recursive: true });
    fs.writeFileSync(path.join(ws, 'hello.txt'), 'hello world\n');

    const before = stub.calls.count;
    const startRes = await fetch(`${base}/api/pipeline-instances/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '真实执行轨迹测试',
        pipelineId: 'pipeline_std_rd',
        workspacePath: ws,
        taskPrompt: '读取 hello.txt 并汇报内容',
        stages: [
          {
            id: 'stg_stub_tools',
            name: '工具轨迹阶段',
            roleName: '工具执行角色',
            promptTemplate: '使用 read_file 读取 hello.txt 并总结。',
            modelId: 'pipeline-stub-model',
            toolsAllowed: ['read_file'],
            artifactPaths: [],
            gatekeeperRequired: false,
          },
        ],
      }),
    });
    assert.equal(startRes.status, 200);
    const { data: { instanceId } } = (await startRes.json()) as { data: { instanceId: string } };

    // 轮询等待异步阶段执行完成
    let detail: { data: { status: string; logs: Array<{ type: string; actor: string; content: string; toolName?: string }>; tokensUsed: number } } | undefined;
    for (let i = 0; i < 60; i += 1) {
      detail = (await (await fetch(`${base}/api/pipeline-instances/${instanceId}`)).json()) as typeof detail;
      if (detail && detail.data.status === 'completed') break;
      await new Promise((r) => setTimeout(r, 100));
    }

    assert.ok(detail, '必须能查询实例详情');
    assert.equal(detail!.data.status, 'completed', '无审批门阶段应执行完成');
    assert.ok(stub.calls.count > before, '阶段必须真实调用模型（stub 收到请求）');
    assert.ok(
      detail!.data.logs.some((l) => l.type === 'tool_call' && l.toolName === 'read_file'),
      '必须真实记录模型发起的工具调用及其工具名',
    );
    assert.ok(
      detail!.data.logs.some((l) => l.type === 'tool_result' && l.content.includes('hello world')),
      '必须记录工具真实执行输出',
    );
    assert.ok(detail!.data.tokensUsed >= 0, 'token 统计字段存在');
  });

  it('11. POST /api/pipelines 对已存在 id 执行 upsert 更新（不再 500），支持编辑模板名称与阶段', async () => {
    const res = await fetch(`${base}/api/pipelines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'pl_custom_test',
        name: '轻量修复流水线 (已改名)',
        description: '更新后的描述',
        stages: [
          {
            id: 'st_repro',
            name: '复现',
            roleName: '复现工程师',
            promptTemplate: '编写最小复现测试',
            toolsAllowed: ['read_file'],
            artifactPaths: [],
            gatekeeperRequired: true,
          },
        ],
      }),
    });
    assert.equal(res.status, 200, '对已存在模板保存必须成功（upsert），不得再触发 UNIQUE 约束 500');
    const json = (await res.json()) as { code: number; message: string; data: { id: string; name: string; stages: Array<{ order: number }> } };
    assert.equal(json.code, 0);
    assert.equal(json.data.id, 'pl_custom_test');
    assert.equal(json.data.name, '轻量修复流水线 (已改名)');
    assert.equal(json.data.stages.length, 1, '阶段应被整体替换为 1 个');

    // 内存无重影：列表中也应为更新后的状态
    const listJson = (await (await fetch(`${base}/api/pipelines`)).json()) as { data: Array<{ id: string; name: string }> };
    const found = listJson.data.find((p) => p.id === 'pl_custom_test');
    assert.equal(found?.name, '轻量修复流水线 (已改名)');
    assert.equal(listJson.data.filter((p) => p.id === 'pl_custom_test').length, 1, 'upsert 不得产生重复记录');
  });

  it('12. DELETE /api/pipelines/:id 删除自定义模板；内置模板受保护 403；不存在 404', async () => {
    // 内置模板禁止删除
    const builtinRes = await fetch(`${base}/api/pipelines/pipeline_std_rd`, { method: 'DELETE' });
    assert.equal(builtinRes.status, 403, '内置推荐模板必须拒绝删除');

    // 自定义模板可删除
    const delRes = await fetch(`${base}/api/pipelines/pl_custom_test`, { method: 'DELETE' });
    assert.equal(delRes.status, 200);
    const delJson = (await delRes.json()) as { code: number };
    assert.equal(delJson.code, 0);

    // 已删除后再查列表不再包含
    const listJson = (await (await fetch(`${base}/api/pipelines`)).json()) as { data: Array<{ id: string }> };
    assert.ok(!listJson.data.some((p) => p.id === 'pl_custom_test'), '删除后不得再出现在列表中');

    // 删除不存在 → 404
    const missingRes = await fetch(`${base}/api/pipelines/pl_not_exists`, { method: 'DELETE' });
    assert.equal(missingRes.status, 404);
  });

  it('13. 上游工件上下文注入：下游阶段请求携带上游交付成果与正文预览（WBS-02-03-01）', async () => {
    const ws = path.join(tmpDir, 'ws_ctx');
    fs.mkdirSync(ws, { recursive: true });
    fs.writeFileSync(path.join(ws, 'hello.txt'), 'hello world\n');

    stub.tool.name = 'read_file';
    stub.tool.args = { path: 'hello.txt' };
    const bodiesBefore = stub.bodies.length;

    const startRes = await fetch(`${base}/api/pipeline-instances/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '上下文注入测试',
        workspacePath: ws,
        taskPrompt: '两阶段上下文注入验证',
        stages: [
          { id: 'stg_up', name: '上游阶段', roleName: '上游角色', promptTemplate: '读取 hello.txt', modelId: 'pipeline-stub-model', toolsAllowed: ['read_file'], artifactPaths: ['hello.txt'], gatekeeperRequired: false },
          { id: 'stg_down', name: '下游阶段', roleName: '下游角色', promptTemplate: '消费上游工件', modelId: 'pipeline-stub-model', toolsAllowed: ['read_file'], artifactPaths: [], gatekeeperRequired: false },
        ],
      }),
    });
    const { data: { instanceId } } = (await startRes.json()) as { data: { instanceId: string } };

    let status = '';
    for (let i = 0; i < 80; i += 1) {
      const d = (await (await fetch(`${base}/api/pipeline-instances/${instanceId}`)).json()) as { data: { status: string } };
      status = d.data.status;
      if (status === 'completed') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(status, 'completed', '两阶段流水线应执行完成');

    const newBodies = stub.bodies.slice(bodiesBefore);
    assert.ok(
      newBodies.some((b) => b.includes('上游角色') && b.includes('hello world')),
      '下游阶段请求必须注入上游工件上下文与正文预览',
    );
    assert.ok(
      newBodies.some((b) => b.includes('流水线协同上下文')),
      '输入上下文必须带结构化标注块',
    );
  });

  it('14. 只读守护：下游阶段修改上游已审定工件被硬拦截（D54 / WBS-02-03-02）', async () => {
    const ws = path.join(tmpDir, 'ws_guard');
    fs.mkdirSync(ws, { recursive: true });
    const filePath = path.join(ws, 'hello.txt');
    fs.writeFileSync(filePath, 'hello world\n');

    stub.tool.name = 'read_file';
    stub.tool.args = { path: 'hello.txt' };

    const startRes = await fetch(`${base}/api/pipeline-instances/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '只读守护测试',
        workspacePath: ws,
        taskPrompt: '只读守护验证',
        stages: [
          { id: 'stg_prod', name: '上游产出', roleName: '上游角色', promptTemplate: '读取 hello.txt', modelId: 'pipeline-stub-model', toolsAllowed: ['read_file'], artifactPaths: ['hello.txt'], gatekeeperRequired: true },
          { id: 'stg_mut', name: '下游修改', roleName: '下游角色', promptTemplate: '修改上游工件', modelId: 'pipeline-stub-model', toolsAllowed: ['read_file', 'edit_file'], artifactPaths: [], gatekeeperRequired: false },
        ],
      }),
    });
    const { data: { instanceId } } = (await startRes.json()) as { data: { instanceId: string } };

    let status = '';
    for (let i = 0; i < 80; i += 1) {
      const d = (await (await fetch(`${base}/api/pipeline-instances/${instanceId}`)).json()) as { data: { status: string } };
      status = d.data.status;
      if (status === 'waiting_gate') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(status, 'waiting_gate', '首阶段应停在审批门');

    // 审批放行前把 stub 工具切换为 edit_file：下游将尝试篡改上游审定工件
    stub.tool.name = 'edit_file';
    stub.tool.args = { path: 'hello.txt', oldString: 'hello', newString: 'HACKED' };

    const approveRes = await fetch(`${base}/api/pipeline-instances/${instanceId}/gate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    });
    assert.equal(approveRes.status, 200);

    for (let i = 0; i < 80; i += 1) {
      const d = (await (await fetch(`${base}/api/pipeline-instances/${instanceId}`)).json()) as { data: { status: string } };
      status = d.data.status;
      if (status === 'completed') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(status, 'completed', '下游阶段应在守护拦截后仍能完成');

    const detail = (await (await fetch(`${base}/api/pipeline-instances/${instanceId}`)).json()) as {
      data: { logs: Array<{ type: string; content: string; isError?: boolean }> };
    };
    assert.ok(
      detail.data.logs.some((l) => l.type === 'tool_result' && l.isError === true && l.content.includes('只读守护拦截')),
      '下游修改上游审定工件必须被只读守护拦截',
    );
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'hello world\n', '上游工件不得被下游篡改');
  });

  it('15. 人机协同：运行中下发的人类指令被实时注入阶段上下文（WBS-02-04-02）', async () => {
    const ws = path.join(tmpDir, 'ws_human');
    fs.mkdirSync(ws, { recursive: true });
    fs.writeFileSync(path.join(ws, 'hello.txt'), 'hello world\n');

    stub.tool.name = 'read_file';
    stub.tool.args = { path: 'hello.txt' };
    stub.delay.ms = 400; // 拉长首轮，制造注入窗口
    const bodiesBefore = stub.bodies.length;

    const startRes = await fetch(`${base}/api/pipeline-instances/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '人机协同测试',
        workspacePath: ws,
        taskPrompt: '读取 hello.txt',
        stages: [
          { id: 'stg_human', name: '人机协同阶段', roleName: '协作角色', promptTemplate: '读取 hello.txt 并总结', modelId: 'pipeline-stub-model', toolsAllowed: ['read_file'], artifactPaths: [], gatekeeperRequired: false },
        ],
      }),
    });
    const { data: { instanceId } } = (await startRes.json()) as { data: { instanceId: string } };

    await new Promise((r) => setTimeout(r, 150)); // 阶段进入 running 后下发干预
    const instrRes = await fetch(`${base}/api/pipeline-instances/${instanceId}/instruction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '请务必把重放窗口设为 300 秒' }),
    });
    assert.equal(instrRes.status, 200);

    let status = '';
    for (let i = 0; i < 100; i += 1) {
      const d = (await (await fetch(`${base}/api/pipeline-instances/${instanceId}`)).json()) as { data: { status: string } };
      status = d.data.status;
      if (status === 'completed') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    stub.delay.ms = 0;
    assert.equal(status, 'completed');

    const newBodies = stub.bodies.slice(bodiesBefore);
    assert.ok(
      newBodies.some((b) => b.includes('人类实时干预指令') && b.includes('300 秒')),
      '运行中下发的人类指令必须在下一步推理前实时注入模型上下文',
    );
  });

  it('16. fail-closed：模型调用失败必须将实例标记为 failed，绝不伪装完成', async () => {
    // 注册一个指向不可达端口的坏 Provider
    const badRes = await fetch(`${base}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'bad-provider',
        name: 'Bad Provider',
        protocol: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:1',
        apiKey: 'sk-live-key-but-unreachable',
        models: [{ id: 'bad-model', name: 'bad-model', contextWindow: 1024 }],
      }),
    });
    assert.equal(badRes.status, 200);

    const ws = path.join(tmpDir, 'ws_bad');
    fs.mkdirSync(ws, { recursive: true });

    const startRes = await fetch(`${base}/api/pipeline-instances/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '失败必须 fail-closed',
        workspacePath: ws,
        taskPrompt: '必失败的阶段',
        stages: [
          { id: 'stg_bad', name: '坏阶段', roleName: '坏角色', promptTemplate: 'do work', modelId: 'bad-model', toolsAllowed: ['read_file'], artifactPaths: [], gatekeeperRequired: true },
        ],
      }),
    });
    const { data: { instanceId } } = (await startRes.json()) as { data: { instanceId: string } };

    let detail: { data: { status: string; error?: string } } | undefined;
    for (let i = 0; i < 80; i += 1) {
      detail = (await (await fetch(`${base}/api/pipeline-instances/${instanceId}`)).json()) as typeof detail;
      if (detail && ['failed', 'completed', 'aborted'].includes(detail.data.status)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(detail, '必须能查询实例详情');
    assert.equal(detail!.data.status, 'failed', '模型调用失败必须标记 failed，不得报 completed');
    assert.ok(
      (detail!.data.error || '').includes('调用模型失败') || (detail!.data.error || '').includes('无法执行'),
      '实例 error 必须如实记录模型调用失败原因',
    );
  });

  it('17. 打回重做闭环：拒批→意见回传→重做→放行，裁决实时留痕', async () => {
    const ws = path.join(tmpDir, 'ws_rework');
    fs.mkdirSync(ws, { recursive: true });
    fs.writeFileSync(path.join(ws, 'hello.txt'), 'hello world\n');
    const reason = '交付不达标，请补充边界处理';

    const startRes = await fetch(`${base}/api/pipeline-instances/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '打回重做闭环',
        workspacePath: ws,
        taskPrompt: '返工测试',
        stages: [
          { id: 'stg_rw', name: '返工阶段', roleName: '返工角色', promptTemplate: '执行任务', modelId: 'pipeline-stub-model', toolsAllowed: ['read_file'], artifactPaths: [], gatekeeperRequired: true },
        ],
      }),
    });
    const { data: { instanceId } } = (await startRes.json()) as { data: { instanceId: string } };

    const readDetail = async () => (await (await fetch(`${base}/api/pipeline-instances/${instanceId}`)).json()) as {
      data: { status: string; logs: Array<{ actor: string; type: string; content: string }>; gateRecords: Array<{ action: string }> };
    };

    // 等待首次审批门
    let d = await readDetail();
    for (let i = 0; i < 100 && d.data.status !== 'waiting_gate'; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
      d = await readDetail();
    }
    assert.equal(d.data.status, 'waiting_gate', '首轮应停在审批门');

    // 打回重做
    const rejRes = await fetch(`${base}/api/pipeline-instances/${instanceId}/gate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject', reason }),
    });
    assert.equal(rejRes.status, 200);

    // 等待重做完成并再次到达审批门（日志出现打回意见）
    d = await readDetail();
    for (let i = 0; i < 200; i += 1) {
      const reworked = d.data.logs.some((l) => l.content.includes('打回重做'));
      if (reworked && d.data.status === 'waiting_gate') break;
      await new Promise((r) => setTimeout(r, 50));
      d = await readDetail();
    }
    assert.ok(d.data.logs.some((l) => l.actor === 'human' && l.content.includes('打回阶段') && l.content.includes(reason)), '打回裁决必须实时留痕并含原因');
    assert.ok(d.data.logs.some((l) => l.content.includes('打回重做要求') && l.content.includes(reason)), '打回意见必须回传给当前 Agent');

    // 放行
    const appRes = await fetch(`${base}/api/pipeline-instances/${instanceId}/gate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    });
    assert.equal(appRes.status, 200);

    for (let i = 0; i < 100 && d.data.status !== 'completed'; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
      d = await readDetail();
    }
    assert.equal(d.data.status, 'completed', '放行后应完成');
    assert.equal(d.data.gateRecords.length, 2, '应记录 reject 与 approve 两次裁决');
    assert.deepEqual(d.data.gateRecords.map((g) => g.action), ['reject', 'approve']);
    assert.ok(d.data.logs.some((l) => l.actor === 'human' && l.content.includes('审批放行')), '放行裁决必须实时留痕');
  });
});
