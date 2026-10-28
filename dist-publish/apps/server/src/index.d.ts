import { ProxyDispatcher } from './network/proxy-dispatcher.ts';
import { SqliteDatabase, SettingsStore, ProviderStore, WorkspaceStore, EventStore, SessionStore, PipelineStore, WorkflowStore } from '../../../packages/plugins/storage-sqlite/src/index.ts';
import { ContextGovernor, WorkspaceWriteLock, PipelineRunner, LockDelegator } from '../../../packages/core/src/index.ts';
import type { PermissionPreset } from '../../../packages/core/src/index.ts';
import { McpClientPool } from '../../../packages/plugins/tools-mcp/src/index.ts';
import type { MemoryStorageMode } from '../../../packages/plugins/memory/src/index.ts';
export interface ServerOptions {
    port?: number;
    dataDir?: string;
    staticDir?: string;
    /** SSE 心跳间隔（毫秒）。可注入以便用可控时钟验证心跳与半开断链重连。 */
    heartbeatMs?: number;
    /** 在系统文件管理器中打开目录的实现。可注入以便测试断言调用，而不真的弹出窗口。 */
    revealFn?: (targetPath: string) => void;
}
/** 会话运行态：等待人类回答提问或裁决审批时进入等待态（TC-01-04-006 / §6.3）。 */
export type SessionState = 'idle' | 'running' | 'waiting_user_input' | 'waiting_approval';
/** 单个工作区的记忆存储参数（settingsStore 'workspace.memoryConfigs' 的值类型）。 */
export interface MemoryWorkspaceConfig {
    mode?: MemoryStorageMode;
    filePath?: string;
    sqlitePath?: string;
    sqliteTable?: string;
    sqliteFts?: boolean;
    gitAutoAdd?: boolean;
    embeddingModel?: string;
    similarityThreshold?: number;
    updatedAt?: number;
    [key: string]: unknown;
}
/** workspacePath → MemoryWorkspaceConfig 的映射。 */
export type MemoryWorkspaceConfigs = Record<string, MemoryWorkspaceConfig>;
export interface ValidatedAttachment {
    filename: string;
    content: string;
    bytes: number;
}
/** 会话可选的权限预设（信任边界取值白名单）。 */
export declare const PERMISSION_PRESETS: readonly PermissionPreset[];
/**
 * 校验外部传入的权限预设。
 * @param value - 未校验的入参。
 * @returns 合法预设，或 undefined 表示非法（调用方应拒绝）。
 */
export declare function normalizePermissionPreset(value: unknown): PermissionPreset | undefined;
/**
 * 附件入参校验（信任边界）：仅接受单层文件名的 `.md`，拒绝路径分隔符与 `..`。
 * 文件名只作为展示标签使用，永不参与路径拼接。
 * @param input - 请求体中的 attachments 字段。
 * @returns 校验通过的文件列表，或失败原因。
 */
export declare function validateAttachments(input: unknown): {
    ok: true;
    list: ValidatedAttachment[];
} | {
    ok: false;
    message: string;
};
/**
 * 将附件包装为带 untrusted 边界的上下文块（提示注入缓解，见设计文档 10.2）。
 * @param attachment - 已校验的附件。
 * @returns 注入模型请求的正文块。
 */
export declare function attachmentContextBlock(attachment: ValidatedAttachment): string;
export declare class HarnessServer {
    private server;
    readonly port: number;
    readonly dataDir: string;
    readonly staticDir: string;
    db: SqliteDatabase;
    settingsStore: SettingsStore;
    readonly heartbeatMs: number;
    /** 在系统文件管理器中打开目录的实现（可注入）。 */
    readonly revealFn: (targetPath: string) => void;
    /** 应用主密钥（安全工程方法论 §4.1）：来自 env 或随机生成的 master.key，绝不硬编码。 */
    readonly masterKey: string;
    providerStore: ProviderStore;
    workspaceStore: WorkspaceStore;
    eventStore: EventStore;
    sessionStore: SessionStore;
    proxyDispatcher: ProxyDispatcher;
    governor: ContextGovernor;
    mcpPool: McpClientPool;
    pipelineStore: PipelineStore;
    workflowStore: WorkflowStore;
    pipelineRunner: PipelineRunner;
    lockDelegator: LockDelegator;
    private readonly pipelineInstances;
    readonly writeLocks: WorkspaceWriteLock;
    /**
     * 流水线运行时上下文：每个实例持有唯一的 ArtifactManager（守护状态需跨阶段保持）、
     * 上游阶段工件快照、以及运行中的人类干预指令队列。
     */
    private readonly pipelineContexts;
    /** 运行中的 BPMN 流程引擎实例池 (用于 UserTask 审查挂起与人工恢复) */
    private readonly workflowEngines;
    private readonly turnAborts;
    private readonly turnCheckpoints;
    private readonly questionBroker;
    private readonly askedQuestions;
    private readonly approvalBroker;
    private readonly askedApprovals;
    private readonly sessionStates;
    constructor(options?: ServerOptions);
    start(): Promise<void>;
    stop(): Promise<void>;
    /**
     * BPMN Task 节点真实 Agent 执行器工厂：/run 首次执行与 /decide 重启兜底续跑共用同一实现，
     * 保证两条路径的模型调用、权限闸门与执行日志语义完全一致。
     */
    private createWorkflowNodeExecutor;
    private handleRequest;
    /** 最新 compaction 事件的 seq（0 表示尚未压缩过），作为活跃消息的组装基线。 */
    private latestCompactionSeq;
    private latestCompaction;
    /**
     * 组装会话历史（落实 D50）：以最新 compaction 事件为基线，仅纳入基线之后的消息，
     * 并在头部注入压缩摘要；同时剥离历史思维链，避免上下文被过早撑爆。
     */
    private buildHistory;
    /**
     * 机械摘要（零模型消耗的确定性降级路径）：保留用户指令要点与涉及的物理文件，
     * 供压缩后作为新基线注入，符合设计文档 5.1「优雅降级为纯文本机械摘要」。
     */
    private buildMechanicalSummary;
    /** 一次性（非流式）补全调用：供 AI 优化等无需流式的场景复用代理与 Provider 配置。 */
    private completeOnce;
    /** 作废某会话所有挂起提问（回合中止/结束/会话删除时调用），避免等待泄漏。 */
    private cancelSessionQuestions;
    /** 作废某会话所有挂起审批（回合中止/结束/会话删除时调用），一律 fail-closed。 */
    private cancelSessionApprovals;
    /**
     * 挂起等待人工审批（设计 §6.3）：先落盘 `approval/requested` 再等待，
     * 因此客户端重连后可重新下发待批项；超时/拒绝均以错误结束（fail-closed）。
     */
    private requestApproval;
    private streamChatCompletion;
    private handleModelsDetect;
    /**
     * 运行时组件清单（如实反映代码现状）。
     * `Active` = 真实接入且在本进程生效；`NotWired` = 代码/设计已存在但未接入运行链路。
     * 严禁把未接入的组件标为 Active —— 那会向使用者传递虚假的"已生效"信号。
     */
    private getPluginsTopology;
    /** 掩码规则（安全工程方法论 §4.3）：保留前 7 与后 4 位，中间以 **** 取代。 */
    private maskSecret;
    /**
     * 真实执行单个流水线阶段（WBS-02-02-01 阶段唤醒 / 02-03-01 上游上下文注入 / 02-03-02 只读守护 / 02-04-02 人机协同）。
     * 解析 Provider/模型 → 组装角色 System Prompt 与上游上下文 → 驱动 TurnLoop 真实调用模型并执行受白名单/权限/守护约束的工具。
     * 无可用 Provider 时如实记录提示（fail-soft，不伪装成功），保持状态机可继续与可复盘。
     */
    private runPipelineStage;
    /**
     * 解密凭据并自动完成向独立主密钥的单向升级迁移（安全工程方法论 §4.1 / BL-07）。
     * 优先用本机 master.key 解密；若失败且能被历史固定密钥解密，立即用新密钥重新加密落盘。
     */
    private resolveProviderApiKey;
    /**
     * 凭据读路径的唯一出口（安全工程方法论 §4.2 / BL-08）：
     * **绝不回传 `apiKeyCipher`**（密文也是凭据工件），只回是否已配置、是否可解密与掩码。
     */
    private toPublicProvider;
    private json;
    private readJsonBody;
}
