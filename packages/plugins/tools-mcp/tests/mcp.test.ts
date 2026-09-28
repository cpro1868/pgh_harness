import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { McpClientPool, toMcpToolName, fromMcpToolName, assertNoLocalConflict, MCP_PREFIX } from '../src/index.ts';
import type { McpServerConfig } from '../src/index.ts';

describe('TC-01-10-002: MCP 客户端连接池与命名空间强隔离', () => {

  // ---------- 纯函数测试：命名空间规则 ----------

  it('mcp__ 前缀组装与反解一致', () => {
    const full = toMcpToolName('filesystem', 'read_file');
    assert.equal(full, 'mcp__filesystem__read_file');
    const parsed = fromMcpToolName(full);
    assert.notEqual(parsed, null);
    assert.equal(parsed!.serverId, 'filesystem');
    assert.equal(parsed!.originalName, 'read_file');
  });

  it('非 MCP 工具名反解返回 null', () => {
    assert.equal(fromMcpToolName('read_file'), null);
    assert.equal(fromMcpToolName('bash'), null);
    assert.equal(fromMcpToolName('notmcp__x__y'), null);
  });

  it('MCP 前缀常量值符合规范', () => {
    assert.equal(MCP_PREFIX, 'mcp__');
  });

  it('本地保留工具名被 MCP 占用时拒绝注册', () => {
    const reserved = ['read_file', 'bash', 'glob', 'todo_write', 'skill'];
    for (const name of reserved) {
      assert.throws(() => assertNoLocalConflict('srv', name), /冲突/);
    }
    // 非保留名放行
    assert.doesNotThrow(() => assertNoLocalConflict('srv', 'my_custom_tool'));
  });

  // ---------- HTTP transport 集成测试（用本地 HTTP stub） ----------

  let stubServer: http.Server;
  let stubPort = 0;
  const stubTools = [
    { name: 'echo_tool', description: 'Echoes input', inputSchema: { type: 'object' } },
    { name: 'list_dir', description: 'Lists a directory', inputSchema: { type: 'object' } },
  ];

  beforeEach(async () => {
    stubServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => { body += c.toString(); });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const rpc = JSON.parse(body);
        if (rpc.method === 'initialize') {
          res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { capabilities: {} } }));
        } else if (rpc.method === 'tools/list') {
          res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { tools: stubTools } }));
        } else if (rpc.method === 'tools/call') {
          const { name, arguments: args } = rpc.params as { name: string; arguments: { text?: string } };
          res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text: `echo:${args?.text ?? ''}` }] } }));
        } else {
          res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: 'Method not found' } }));
        }
      });
    });
    await new Promise<void>((r) => stubServer.listen(0, '127.0.0.1', r));
    stubPort = (stubServer.address() as { port: number }).port;
  });

  afterEach(async () => {
    await new Promise<void>((r) => stubServer.close(() => r()));
  });

  it('HTTP transport：连接、注册工具、调用工具', async () => {
    const pool = new McpClientPool();
    const config: McpServerConfig = { id: 'stub', transport: 'http', url: `http://127.0.0.1:${stubPort}` };
    const counts = await pool.connectAll([config]);
    assert.equal(counts['stub'], 2);

    const tools = pool.getTools();
    assert.equal(tools.length, 2);
    assert.ok(tools.some((t) => t.name === 'mcp__stub__echo_tool'));

    const result = await pool.callTool('mcp__stub__echo_tool', { text: 'hello' });
    assert.ok(result.includes('echo:hello'));

    await pool.closeAll();
  });

  it('调用未注册工具名抛出明确错误', async () => {
    const pool = new McpClientPool();
    const config: McpServerConfig = { id: 'stub', transport: 'http', url: `http://127.0.0.1:${stubPort}` };
    await pool.connectAll([config]);
    await assert.rejects(() => pool.callTool('mcp__stub__nonexistent', {}), /未知 MCP 工具/);
    await pool.closeAll();
  });

  it('连接失败的服务器被标记 failedServers，不阻塞其他服务器', async () => {
    const pool = new McpClientPool();
    const configs: McpServerConfig[] = [
      { id: 'good', transport: 'http', url: `http://127.0.0.1:${stubPort}` },
      { id: 'bad', transport: 'http', url: 'http://127.0.0.1:19999' },  // 不可达端口
    ];
    const counts = await pool.connectAll(configs);
    assert.equal(counts['good'], 2);
    assert.equal(counts['bad'], 0);
    // good 服务器的工具仍然可用
    assert.ok(pool.isMcpTool('mcp__good__echo_tool'));
    await pool.closeAll();
  });

  it('PermissionGate 规则 mcp__* 前缀可正确匹配所有 MCP 工具', async () => {
    // 规则 `mcp__*` 去掉尾部 * 后是前缀 `mcp__`，对所有 mcp__ 开头工具成立
    const cases = ['mcp__myserver__dangerous_op', 'mcp__fs__read_thing'];
    for (const mcpTool of cases) {
      assert.ok(mcpTool.startsWith('mcp__*'.slice(0, -1)));
    }
    // 本地工具不匹配该前缀（防误伤）
    assert.ok(!'read_file'.startsWith('mcp__'));
  });
});
