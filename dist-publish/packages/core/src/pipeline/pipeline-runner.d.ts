import type { PipelineStage, PipelineInstanceStatus } from '@harness/protocol';
export type { PipelineInstanceStatus };
export interface StageRunResult {
    summary: string;
    artifactPaths?: string[];
    tokensUsed?: number;
}
export interface GateDecision {
    action: 'approve' | 'reject' | 'abort';
    reason?: string;
}
export interface GateRecord {
    stageId: string;
    roleName: string;
    action: 'approve' | 'reject';
    reason?: string;
    timestamp: number;
}
export interface PipelineExecutionOptions {
    instanceId: string;
    stages: PipelineStage[];
    maxReworks?: number;
    signal?: AbortSignal;
    executeStage: (context: {
        stage: PipelineStage;
        stageIndex: number;
        reworkReason?: string;
        signal?: AbortSignal;
    }) => Promise<StageRunResult>;
    onStatusChange?: (status: PipelineInstanceStatus, currentStageId?: string) => void;
    onGateRequired?: (stage: PipelineStage, artifacts: string[]) => void;
    /**
     * 审批门裁决回调：approve 时上游工件应被标记为「已审定」并在下游强制只读 (WBS-02-03-02)。
     * rework 重做时同样回调，便于上层释放/维护守护状态。
     */
    onGateResolved?: (stage: PipelineStage, decision: GateDecision, artifacts: string[]) => void;
}
export interface PipelineExecutionOutcome {
    instanceId: string;
    status: PipelineInstanceStatus;
    currentStageId?: string;
    stageResults: Array<{
        stageId: string;
        roleName: string;
        summary: string;
        artifactPaths: string[];
    }>;
    gateRecords: GateRecord[];
    error?: string;
}
/**
 * 多阶段泳道顺序执行状态机 (WBS-02-02-01 / WBS-02-03-03 / D36)
 */
export declare class PipelineRunner {
    private readonly statuses;
    private readonly currentStages;
    private readonly pendingGates;
    private readonly abortControllers;
    private readonly pausedInstances;
    statusOf(instanceId: string): PipelineInstanceStatus;
    currentStageId(instanceId: string): string | undefined;
    isPaused(instanceId: string): boolean;
    /**
     * 暂停流水线：已暂停的实例在进入下一阶段前会挂起等待，已完成的阶段结果完整保留。
     * @returns 是否成功暂停（终态实例与未知实例一律拒绝）
     */
    pause(instanceId: string): boolean;
    /**
     * 恢复流水线：解除暂停并回到运行态。
     * @returns 是否成功恢复
     */
    resume(instanceId: string): boolean;
    /** 暂停期间在阶段边界等待，直到恢复或收到中止信号。 */
    private waitWhilePaused;
    /**
     * 主动停止/中断正在运行或等待卡点的流水线实例。
     */
    abort(instanceId: string, reason?: string): boolean;
    /**
     * 响应 Gatekeeper 人工审批卡点。
     * @param instanceId 正在等待审批的流水线实例 ID
     * @param decision approve 放行 | reject 打回重做
     * @returns 是否成功处理该卡点
     */
    resolveGate(instanceId: string, decision: GateDecision): boolean;
    /**
     * 启动并驱动一条流水线实例完整执行。
     */
    run(options: PipelineExecutionOptions): Promise<PipelineExecutionOutcome>;
}
