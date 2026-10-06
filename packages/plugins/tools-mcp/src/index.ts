import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';

/**
 * MCP 服务器配置项（与 mcp.json / harness.yml 配置对齐）
 */
export interface McpServerConfig {
  /** 服务器标识名（用作 mcp__ 前缀分隔符，不含前缀本身） */
  id: string;
  /** 传输方式 */
  transport: 'stdio' | 'http';
  /** stdio 模式：命令 + 参数 */
  command?: string;
  args?: string[];
  /** http 模式：端点 */
  url?: string;
  /** 环境变量注入 */
  env?: Record<string, string>;
  /** 请求超时（毫秒，默认 30s） */
  timeoutMs?: number;
}

export interface McpToolInfo {
  /** 带前缀的工具完整名，如 mcp__filesystem__read_file */
  name: string;
  /** 所属服务器 ID */
  serverId: string;
  /** 原始工具名 */
  originalName: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/** JSON-RPC 2.0 请求/响应 */
interface JsonRpcRequest { jsonrpc: '2.0'; id: number; method: string; params?: unknown }
interface JsonRpcResponse { jsonrpc: '2.0'; id: number; result?: unknown; error?: { code: number; message: string } }

/** MCP 工具命名空间前缀（强制隔离，本地工具保留字独占） */
export const MCP_PREFIX = 'mcp__';
const LOCAL_RESERVED = new Set(['read_file', 'write_file', 'edit_file', 'glob', 'grep', 'bash', 'todo_write', 'ask_user', 'skill']);

/**
 * 将 MCP 工具名组装为带命名空间前缀的安全名：mcp__<serverId>__<originalName>
 */
export function toMcpToolName(serverId: string, originalName: string): string {
  return `${MCP_PREFIX}${serverId}__${originalName}`;
}

/**
 * 从工具名反解出 (serverId, originalName)。
 * @returns null 表示不是 MCP 工具名
 */
export function fromMcpToolName(fullName: string): { serverId: string; originalName: string } | null {
  if (!fullName.startsWith(MCP_PREFIX)) return null;
  const rest = fullName.slice(MCP_PREFIX.length);
  const sepIdx = rest.indexOf('__');
  if (sepIdx < 0) return null;
  return { serverId: rest.slice(0, sepIdx), originalName: rest.slice(sepIdx + 2) };
}

/**
 * 校验 MCP 工具名不与本地保留字冲突。
 * 若冲突则抛出明确错误，不静默放行。
 */
export function assertNoLocalConflict(serverId: string, originalName: string): void {
  if (LOCAL_RESERVED.has(originalName)) {
    throw new Error(`MCP 工具 "${toMcpToolName(serverId, originalName)}" 与本地保留工具名冲突，已拒绝注册`);
  }
}

/** 单个 MCP 服务器连接（stdio 或 HTTP/SSE） */
class McpConnection {
  private idCounter = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private buffer = '';
  private child: ChildProcess | null = null;
  private httpAgent: http.Agent | null = null;
  private config: McpServerConfig;

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  /** 启动 stdio 子进程（仅 transport=stdio） */
  private startStdio(): void {
    if (this.config.transport !== 'stdio' || !this.config.command) return;
    this.child = spawn(this.config.command, this.config.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(this.config.env ?? {}) },
      cwd: process.cwd(),
    });
    this.child.stdout?.on('data', (chunk: Buffer) => this.handleRaw(chunk.toString()));
    this.child.on('error', (err) => this.failAll(err));
    this.child.on('exit', () => this.failAll(new Error('MCP stdio 子进程退出')));
  }

  /** 处理 stdio 输入缓冲（按行分割 JSON-RPC） */
  private handleRaw(raw: string): void {
    this.buffer += raw;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as JsonRpcResponse;
        const slot = this.pending.get(msg.id);
        if (slot) {
          clearTimeout(slot.timer);
          this.pending.delete(msg.id);
          if (msg.error) slot.reject(new Error(msg.error.message));
          else slot.resolve(msg.result);
        }
      } catch { /* 忽略非 JSON 行 */ }
    }
  }

  /** 发送 JSON-RPC 请求并等待响应 */
  public async rpc(method: string, params?: unknown): Promise<unknown> {
    const id = ++this.idCounter;
    const timeoutMs = this.config.timeoutMs ?? 30_000;

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP 请求超时 (${timeoutMs}ms): ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      if (this.config.transport === 'stdio') {
        if (!this.child) this.startStdio();
        const payload: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
        this.child?.stdin?.write(JSON.stringify(payload) + '\n');
      } else if (this.config.transport === 'http' && this.config.url) {
        const url = new URL(this.config.url);
        const payload: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
        const bodyStr = JSON.stringify(payload);
        const req = http.request(
          { hostname: url.hostname, port: url.port || 80, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } },
          (res) => {
            let data = '';
            res.on('data', (c: Buffer) => { data += c.toString(); });
            res.on('end', () => {
              try {
                const parsed = JSON.parse(data) as JsonRpcResponse;
                if (parsed.error) { clearTimeout(timer); this.pending.delete(id); reject(new Error(parsed.error.message)); }
                else { clearTimeout(timer); this.pending.delete(id); resolve(parsed.result); }
              } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e as Error); }
            });
          },
        );
        req.on('error', (e) => { clearTimeout(timer); this.pending.delete(id); reject(e); });
        req.write(bodyStr);
        req.end();
      } else {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(`不支持的 transport: ${this.config.transport}`));
      }
    });
  }

  private failAll(err: Error): void {
    for (const [id, slot] of this.pending) {
      clearTimeout(slot.timer);
      slot.reject(err);
      this.pending.delete(id);
    }
  }

  /** 断开连接，释放子进程 */
  public async close(): Promise<void> {
    if (this.child) {
      this.child.stdin?.end();
      this.child.kill('SIGTERM');
      this.child = null;
    }
    this.failAll(new Error('MCP 连接已关闭'));
    this.httpAgent?.destroy();
  }
}

/**
 * MCP 客户端连接池：管理多个 MCP 服务器的生命周期与工具路由
 */
export class McpClientPool {
  private connections = new Map<string, McpConnection>();
  private toolMap = new Map<string, McpToolInfo>();   // 完整工具名 → 信息
  private failedServers = new Set<string>();

  /**
   * 初始化一批 MCP 服务器，拉取 tools/list 并注册到工具映射表。
   * @returns 每个服务器成功注册的工具数
   */
  public async connectAll(configs: McpServerConfig[]): Promise<Record<string, number>> {
    const results: Record<string, number> = {};
    for (const cfg of configs) {
      try {
        results[cfg.id] = await this.connect(cfg);
      } catch (err) {
        this.failedServers.add(cfg.id);
        console.warn(`[MCP] 服务器 "${cfg.id}" 连接失败: ${(err as Error).message}`);
        results[cfg.id] = 0;
      }
    }
    return results;
  }

  /** 连接单个服务器并注册工具 */
  private async connect(config: McpServerConfig): Promise<number> {
    const conn = new McpConnection(config);
    this.connections.set(config.id, conn);

    // initialize handshake
    await conn.rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'pgh', version: '0.1.0' },
    });

    // 拉取工具清单
    const result = await conn.rpc('tools/list') as { tools?: { name: string; description?: string; inputSchema?: Record<string, unknown> }[] };
    const tools = result?.tools ?? [];
    for (const tool of tools) {
      assertNoLocalConflict(config.id, tool.name);
      const fullName = toMcpToolName(config.id, tool.name);
      if (this.toolMap.has(fullName)) throw new Error(`MCP 工具名冲突: ${fullName} 已被其他服务器注册`);
      this.toolMap.set(fullName, { name: fullName, serverId: config.id, originalName: tool.name, description: tool.description, inputSchema: tool.inputSchema });
    }
    return tools.length;
  }

  /** 调用 MCP 工具（通过完整名路由到对应服务器） */
  public async callTool(fullName: string, args: Record<string, unknown>): Promise<string> {
    const info = this.toolMap.get(fullName);
    if (!info) throw new Error(`未知 MCP 工具: ${fullName}`);
    const conn = this.connections.get(info.serverId);
    if (!conn) throw new Error(`MCP 服务器 "${info.serverId}" 未连接`);
    const result = await conn.rpc('tools/call', { name: info.originalName, arguments: args });
    // MCP 标准返回 { content: [{type,text},...] }；拍平为纯文本
    if (typeof result === 'object' && result !== null) {
      const content = (result as { content?: { type: string; text?: string }[] }).content;
      if (Array.isArray(content)) return content.map((c) => c.text ?? '').join('\n');
    }
    return typeof result === 'string' ? result : JSON.stringify(result);
  }

  /** 获取已注册的全部 MCP 工具（带前缀名） */
  public getTools(): McpToolInfo[] {
    return [...this.toolMap.values()];
  }

  /** 查询某工具是否为 MCP 工具 */
  public isMcpTool(name: string): boolean {
    return this.toolMap.has(name);
  }

  /** 断开全部连接 */
  public async closeAll(): Promise<void> {
    for (const conn of this.connections.values()) await conn.close();
    this.connections.clear();
    this.toolMap.clear();
  }
}
