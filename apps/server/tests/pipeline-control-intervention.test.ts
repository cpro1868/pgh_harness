import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { HarnessServer } from '../src/index.ts';

/**
 * 具有延迟控制和干预感知能力的 Mock LLM 服务
 */
function startInteractivePipelineLlm(): Promise<{
  server: http.Server;
  port: number;
  receivedPrompts: string[];
}> {
  return new Promise((resolve) => {
    const receivedPrompts: string[] = [];
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/chat/completions') {
        res.writeHead(404);
        res.end('{}');
        return;
      }
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        const parsed = JSON.parse(raw) as { messages?: Array<{ role?: string; content?: string }> };
        const messages = parsed.messages ?? [];
        const system = messages.find((m) => m.role === 'system')?.content ?? '';
        const userMessages = messages.filter((m) => m.role === 'user').map((m) => m.content ?? '');
        receivedPrompts.push(...userMessages);

        const hasToolResult = messages.some((m) => m.role === 'tool');
        const isStage1 = system.includes('第一阶段');
        const isStage2 = system.includes('第二阶段');

        const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
        let finalContent = '阶段完成。';

        if (!hasToolResult) {
          if (isStage1) {
            toolCalls.push({
              name: 'write_file',
              args: { path: 'stage1.txt', content: 'stage 1 initial content' },
            });
            finalContent = '阶段1已产出 stage1.txt。';
          } else if (isStage2) {
            // 检查是否有来自中途人机干预的提示指令
            const hasHumanInstruction = userMessages.some((msg) => msg.includes('【人类指令】请附加额外标记 [INTERVENTION-OK]'));
            const stage2Content = hasHumanInstruction
              ? 'stage 2 executed with [INTERVENTION-OK]'
              : 'stage 2 standard execution';

            toolCalls.push({
              name: 'write_file',
              args: { path: 'stage2.txt', content: stage2Content },
            });
            finalContent = `阶段2完成：${stage2Content}`;
          }
        }

        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        if (toolCalls.length > 0) {
          const deltaCalls = toolCalls.map((tc, i) => ({
            index: i,
            id: `call_${Date.now()}_${i}`,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          }));
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', tool_calls: deltaCalls } }] })}\n\n`);
          res.write('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n');
        } else {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: finalContent } }] })}\n\n`);
          res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });

    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        port: (server.address() as AddressInfo).port,
        receivedPrompts,
      });
    });
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('TC-02-E2E: 流水线中途控制 —— 暂停、中途插入指令与恢复执行', () => {
  let tmpDir: string;
  let ws: string;
  let server: HarnessServer;
  let stub: { server: http.Server; port: number; receivedPrompts: string[] };
  const testPort = 3328;
  const base = `http://127.0.0.1:${testPort}`;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-pipeline-control-'));
    ws = path.join(tmpDir, 'control-proj');
    fs.mkdirSync(ws, { recursive: true });
    stub = await startInteractivePipelineLlm();
    server = new HarnessServer({ port: testPort, dataDir: path.join(tmpDir, 'data') });
    await server.start();

    const provRes = await fetch(`${base}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'control-builder',
        name: 'Control Builder Stub',
        protocol: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${stub.port}`,
        apiKey: 'sk-mock-key-control',
        models: [{ id: 'control-model', name: 'control-model', contextWindow: 65536 }],
      }),
    });
    assert.equal(provRes.status, 200);
  });

  after(async () => {
    await server.stop();
    stub.server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('全链路：启动流水线 -> 请求暂停 -> 成功暂停在阶段边界 -> 发送人机干预指令 -> 恢复运行 -> 包含干预指令并成功产出', async () => {
    // 1. 启动两阶段流水线
    const startRes = await fetch(`${base}/api/pipeline-instances/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '暂停与人机干预测试',
        workspacePath: ws,
        taskPrompt: '测试暂停与恢复控制能力',
        stages: [
          {
            id: 'stg_1',
            name: '第一阶段',
            roleName: '调研员',
            promptTemplate: '第一阶段：收集资料并产出 stage1.txt',
            modelId: 'control-model',
            toolsAllowed: ['write_file', 'read_file'],
            artifactPaths: ['stage1.txt'],
            gatekeeperRequired: false,
          },
          {
            id: 'stg_2',
            name: '第二阶段',
            roleName: '执行员',
            promptTemplate: '第二阶段：依据前置成果继续工作，产出 stage2.txt',
            modelId: 'control-model',
            toolsAllowed: ['write_file', 'read_file'],
            artifactPaths: ['stage2.txt'],
            gatekeeperRequired: false,
          },
        ],
      }),
    });
    assert.equal(startRes.status, 200);
    const { data: { instanceId } } = (await startRes.json()) as { data: { instanceId: string } };

    // 2. 发起暂停请求 (POST /api/pipeline-instances/:id/pause)
    const pauseRes = await fetch(`${base}/api/pipeline-instances/${instanceId}/pause`, {
      method: 'POST',
    });
    assert.equal(pauseRes.status, 200);
    const pauseJson = (await pauseRes.json()) as { code: number };
    assert.equal(pauseJson.code, 0);

    // 3. 等待流水线进入 paused 状态
    let status = '';
    for (let i = 0; i < 80; i += 1) {
      const d = (await (await fetch(`${base}/api/pipeline-instances/${instanceId}`)).json()) as {
        data: { status: string; currentStageIndex: number };
      };
      status = d.data.status;
      if (status === 'paused') break;
      await sleep(50);
    }
    assert.equal(status, 'paused', '流水线必须成功在阶段边界转为 paused 状态');
    assert.ok(fs.existsSync(path.join(ws, 'stage1.txt')), '第一阶段产物应已产生');

    // 4. 发送人机干预指令 (POST /api/pipeline-instances/:id/instruction)
    const instRes = await fetch(`${base}/api/pipeline-instances/${instanceId}/instruction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: '【人类指令】请附加额外标记 [INTERVENTION-OK]' }),
    });
    assert.equal(instRes.status, 200);
    const instJson = (await instRes.json()) as { code: number };
    assert.equal(instJson.code, 0);

    // 5. 校验此时阶段2尚未执行
    assert.ok(!fs.existsSync(path.join(ws, 'stage2.txt')), '暂停期间第二阶段不得执行');

    // 6. 恢复执行 (POST /api/pipeline-instances/:id/resume)
    const resumeRes = await fetch(`${base}/api/pipeline-instances/${instanceId}/resume`, {
      method: 'POST',
    });
    assert.equal(resumeRes.status, 200);
    const resumeJson = (await resumeRes.json()) as { code: number };
    assert.equal(resumeJson.code, 0);

    // 7. 轮询直到流水线执行完成
    for (let i = 0; i < 80; i += 1) {
      const d = (await (await fetch(`${base}/api/pipeline-instances/${instanceId}`)).json()) as {
        data: { status: string };
      };
      status = d.data.status;
      if (status === 'completed') break;
      await sleep(50);
    }
    assert.equal(status, 'completed', '流水线恢复后应最终成功执行完毕');

    // 8. 校验第二阶段真实吸收了人机干预指令
    const stage2File = path.join(ws, 'stage2.txt');
    assert.ok(fs.existsSync(stage2File), '第二阶段产物 stage2.txt 必须落盘');
    const stage2Content = fs.readFileSync(stage2File, 'utf8');
    assert.ok(
      stage2Content.includes('[INTERVENTION-OK]'),
      `第二阶段必须体现人机干预指令，实际内容: ${stage2Content}`,
    );

    // 9. 校验轨迹中有人类干预记录
    const detail = (await (await fetch(`${base}/api/pipeline-instances/${instanceId}`)).json()) as {
      data: {
        logs: Array<{ type: string; actor: string; content: string }>;
      };
    };
    const hasInstructionLog = detail.data.logs.some(
      (l) => l.actor === 'human' && l.content.includes('【人类指令】'),
    );
    assert.ok(hasInstructionLog, '审计日志中必须记录人类干预指令');
  });
});
