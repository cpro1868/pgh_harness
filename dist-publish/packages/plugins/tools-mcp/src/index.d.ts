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
/** MCP 工具命名空间前缀（强制隔离，本地工具保留字独占） */
export declare const MCP_PREFIX = "mcp__";
/**
 * 将 MCP 工具名组装为带命名空间前缀的安全名：mcp__<serverId>__<originalName>
 */
export declare function toMcpToolName(serverId: string, originalName: string): string;
/**
 * 从工具名反解出 (serverId, originalName)。
 * @returns null 表示不是 MCP 工具名
 */
export declare function fromMcpToolName(fullName: string): {
    serverId: string;
    originalName: string;
} | null;
/**
 * 校验 MCP 工具名不与本地保留字冲突。
 * 若冲突则抛出明确错误，不静默放行。
 */
export declare function assertNoLocalConflict(serverId: string, originalName: string): void;
/**
 * MCP 客户端连接池：管理多个 MCP 服务器的生命周期与工具路由
 */
export declare class McpClientPool {
    private connections;
    private toolMap;
    private failedServers;
    /**
     * 初始化一批 MCP 服务器，拉取 tools/list 并注册到工具映射表。
     * @returns 每个服务器成功注册的工具数
     */
    connectAll(configs: McpServerConfig[]): Promise<Record<string, number>>;
    /** 连接单个服务器并注册工具 */
    private connect;
    /** 调用 MCP 工具（通过完整名路由到对应服务器） */
    callTool(fullName: string, args: Record<string, unknown>): Promise<string>;
    /** 获取已注册的全部 MCP 工具（带前缀名） */
    getTools(): McpToolInfo[];
    /** 查询某工具是否为 MCP 工具 */
    isMcpTool(name: string): boolean;
    /** 断开全部连接 */
    closeAll(): Promise<void>;
}
