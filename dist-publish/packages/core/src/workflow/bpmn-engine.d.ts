import type { BpmnProcessModel, BpmnNode } from './bpmn-parser.ts';
export type WorkflowExecutionStatus = 'idle' | 'running' | 'waiting' | 'completed' | 'failed' | 'aborted';
export interface WorkflowEngineState {
    status: WorkflowExecutionStatus;
    activeNodes: string[];
    completedNodes: string[];
    variables: Record<string, unknown>;
    error?: string;
    waitingUserTaskId?: string;
}
export interface NodeExecutionResult {
    ok: boolean;
    variables?: Record<string, unknown>;
    error?: string;
}
export interface EngineExecuteOptions {
    initialVariables?: Record<string, unknown>;
    maxSteps?: number;
    onNodeExecute?: (node: BpmnNode, variables: Record<string, unknown>) => Promise<NodeExecutionResult>;
}
export interface ResumeOptions {
    decision: 'approve' | 'reject';
    variables?: Record<string, unknown>;
    reason?: string;
    maxSteps?: number;
}
export interface HydrateSnapshot {
    completedNodes?: string[];
    activeNodes?: string[];
    variables?: Record<string, unknown>;
    onNodeExecute?: (node: BpmnNode, variables: Record<string, unknown>) => Promise<NodeExecutionResult>;
}
export declare class BpmnWorkflowEngine {
    private readonly model;
    private readonly nodeMap;
    private readonly flowMap;
    private readonly incomingFlows;
    private readonly outgoingFlows;
    private currentTokens;
    private completedNodes;
    private arrivedTokens;
    private variables;
    private onNodeExecute?;
    private waitingUserTaskId?;
    /** 每个任务节点的真实执行次数，用于向变量总线注入 <节点ID>_runs 计数，支撑有限次重试环路 */
    private runCounts;
    /** 跨 resume 累计的执行步数：人工放行不重置熔断计数，防止反复放行造成无限流转 */
    private totalSteps;
    constructor(model: BpmnProcessModel);
    private indexElements;
    execute(options?: EngineExecuteOptions): Promise<WorkflowEngineState>;
    resume(options: ResumeOptions): Promise<WorkflowEngineState>;
    /**
     * 从持久化实例快照重建挂起态（服务重启后 /decide 断点续接用）：
     * 仅恢复已完成节点与变量总线，定位 activeNodes 中的人工审查锚点，绝不重放已完成节点。
     */
    hydrate(snapshot: HydrateSnapshot): void;
    private stepLoop;
    /**
     * 零外部依赖安全判定条件表达式（仅支持形如 ${score >= 80} 或 ${coverage > 85}）
     */
    private evalCondition;
}
