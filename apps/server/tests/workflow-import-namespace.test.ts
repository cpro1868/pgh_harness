import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { HarnessServer } from '../src/index.ts';
import { BpmnParser } from '../../../packages/core/src/workflow/bpmn-parser.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const designHtmlPath = path.join(here, '..', 'client', 'config-workflow-design.html');

function buildXml(prefix: string, nsAttr: string): string {
  const p = prefix ? `${prefix}:` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<${p}definitions ${nsAttr} id="Def_NS">
  <${p}process id="Proc_NS" isExecutable="true">
    <${p}startEvent id="S1"><${p}outgoing>F1</${p}outgoing></${p}startEvent>
    <${p}exclusiveGateway id="GW1" name="网关"><${p}incoming>F1</${p}incoming><${p}outgoing>F2</${p}outgoing><${p}outgoing>F3</${p}outgoing></${p}exclusiveGateway>
    <${p}task id="T1" name="任务一"><${p}incoming>F2</${p}incoming><${p}outgoing>F4</${p}outgoing></${p}task>
    <${p}endEvent id="E1"><${p}incoming>F3</${p}incoming></${p}endEvent>
    <${p}endEvent id="E2"><${p}incoming>F4</${p}incoming></${p}endEvent>
    <${p}sequenceFlow id="F1" sourceRef="S1" targetRef="GW1" />
    <${p}sequenceFlow id="F2" sourceRef="GW1" targetRef="T1" />
    <${p}sequenceFlow id="F3" sourceRef="GW1" targetRef="E1" />
    <${p}sequenceFlow id="F4" sourceRef="T1" targetRef="E2" />
  </${p}process>
</${p}definitions>`;
}

const NS_MATRIX: Array<{ label: string; prefix: string; nsAttr: string }> = [
  { label: 'bpmn: 前缀 (库内既有格式)', prefix: 'bpmn', nsAttr: 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"' },
  { label: 'bpmn2: 前缀 (Camunda 导出常见)', prefix: 'bpmn2', nsAttr: 'xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL"' },
  { label: '无前缀默认命名空间', prefix: '', nsAttr: 'xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"' },
];

function loadDesignerParseCurrentXml(): (xml: string) => Array<{ id: string; type: string }> {
  const html = fs.readFileSync(designHtmlPath, 'utf8');
  const source = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .join('\n;\n');
  const elements = new Map<string, { innerHTML: string; textContent: string; value: string; style: Record<string, string>; classList: { add(): void; remove(): void; toggle(): void } }>();
  const el = (id: string) => {
    if (!elements.has(id)) {
      elements.set(id, {
        innerHTML: '',
        textContent: '',
        value: '',
        style: {},
        classList: { add() {}, remove() {}, toggle() {} },
      });
    }
    return elements.get(id)!;
  };
  const documentStub = {
    getElementById: (id: string) => el(id),
    createElement: () => el(`dyn_${Math.random()}`),
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const windowStub = { addEventListener() {}, location: { href: 'http://127.0.0.1/config-workflow-design.html?id=probe' } };
  const factory = new Function(
    'document', 'window', 'fetch', 'URL', 'showToast',
    `${source}\n;return { extractNodes, loadWorkflow, setWf: (w) => { currentWorkflow = w; } };`,
  ) as (doc: unknown, win: unknown, f: unknown, u: unknown, s: unknown) => {
    extractNodes: (xml: string) => Array<{ id: string; type: string }>;
    loadWorkflow: () => Promise<void>;
    setWf: (w: { id: string; name: string; bpmnXml: string }) => void;
  };
  return (xml: string) => {
    const api = factory(documentStub, windowStub, async () => ({ ok: false, json: async () => ({}) }), URL, () => {});
    api.setWf({ id: 'probe', name: 'probe', bpmnXml: xml });
    return api.extractNodes(xml);
  };
}

describe('TC-03-01-004: BPMN 命名空间前缀矩阵与设计器空页面防线', () => {
  let tmpDir: string;
  let server: HarnessServer;
  const testPort = 3360;
  const base = `http://127.0.0.1:${testPort}`;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-wf-ns-'));
    server = new HarnessServer({ port: testPort, dataDir: path.join(tmpDir, 'data') });
    await server.start();
  });

  after(async () => {
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  async function importWorkflow(name: string, bpmnXml: string): Promise<{ status: number; json: { code: number; message?: string; data?: { id: string; nodeCount: number; gatewayCount: number } } }> {
    const res = await fetch(`${base}/api/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, bpmnXml }),
    });
    return { status: res.status, json: (await res.json()) as never };
  }

  it('服务端解析器 BpmnParser 对三种命名空间形态均解析出完整拓扑', () => {
    for (const { label, prefix, nsAttr } of NS_MATRIX) {
      const model = BpmnParser.parseXml(buildXml(prefix, nsAttr));
      assert.equal(model.nodes.length, 5, `${label} 应解析出 5 个节点`);
      assert.equal(model.flows.length, 4, `${label} 应解析出 4 条连线`);
    }
  });

  it('POST /api/workflows 导入三种命名空间形态均返回真实 nodeCount/gatewayCount（杜绝空页面数据源）', async () => {
    for (const { label, prefix, nsAttr } of NS_MATRIX) {
      const { status, json } = await importWorkflow(`ns-${prefix || 'plain'}`, buildXml(prefix, nsAttr));
      assert.equal(status, 200, `${label} 导入应成功`);
      assert.equal(json.code, 0, `${label} 导入应返回 code 0`);
      assert.ok(json.data, `${label} 应返回工作流数据`);
      assert.equal(json.data!.nodeCount, 4, `${label} nodeCount 必须为真实非网关节点数而非 0`);
      assert.equal(json.data!.gatewayCount, 1, `${label} gatewayCount 必须为真实网关数而非 0`);
    }
  });

  it('GET /api/workflows 列表对三种命名空间形态均回显非零节点规模', async () => {
    const res = await fetch(`${base}/api/workflows`);
    const json = (await res.json()) as { code: number; data: Array<{ id: string; nodeCount: number }> };
    const imported = json.data.filter((w) => w.id.startsWith('wf_') && w.id !== 'wf_std_feature_dev');
    assert.equal(imported.length, 3, '应有 3 条导入的命名空间测试工作流');
    for (const wf of imported) {
      assert.equal(wf.nodeCount, 4, `${wf.id} 列表 nodeCount 不得为 0`);
    }
  });

  it('PUT /api/workflows/:id 更新时同样重算真实节点规模', async () => {
    const { json } = await importWorkflow('ns-put-target', buildXml('bpmn2', 'xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL"'));
    const id = json.data!.id;
    const res = await fetch(`${base}/api/workflows/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ns-put-renamed', bpmnXml: buildXml('', 'xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"') }),
    });
    assert.equal(res.status, 200);
    const putJson = (await res.json()) as { code: number; data: { nodeCount: number; gatewayCount: number } };
    assert.equal(putJson.code, 0);
    assert.equal(putJson.data.nodeCount, 4, 'PUT 后 nodeCount 必须重算为真实值');
    assert.equal(putJson.data.gatewayCount, 1, 'PUT 后 gatewayCount 必须重算为真实值');
  });

  it('POST /api/workflows 对非法 XML 必须 fail-closed 拒绝，严禁静默入库制造空页面', async () => {
    const cases: Array<{ label: string; xml: string }> = [
      { label: '非 BPMN 标记', xml: '<html><body>not bpmn</body></html>' },
      { label: '缺 process 定义', xml: '<?xml version="1.0"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D"></bpmn:definitions>' },
      { label: '空内容', xml: '   ' },
    ];
    for (const { label, xml } of cases) {
      const { status, json } = await importWorkflow(`bad-${label}`, xml);
      assert.equal(status, 400, `${label} 必须被拒绝`);
      assert.notEqual(json.code, 0, `${label} 不得返回成功码`);
    }
  });

  it('设计器客户端 parseCurrentXml 对三种命名空间形态均解析出节点（空页面根因回归防线）', () => {
    const parse = loadDesignerParseCurrentXml();
    for (const { label, prefix, nsAttr } of NS_MATRIX) {
      const nodes = parse(buildXml(prefix, nsAttr));
      const ids = nodes.map((n) => n.id);
      assert.equal(nodes.length, 5, `${label} 设计器应解析出 5 个节点，实际 ${nodes.length}`);
      assert.ok(ids.includes('GW1'), `${label} 设计器应识别排他网关`);
      const gw = nodes.find((n) => n.id === 'GW1');
      assert.equal(gw!.type, 'exclusiveGateway', `${label} 网关类型映射应正确`);
    }
  });
});
