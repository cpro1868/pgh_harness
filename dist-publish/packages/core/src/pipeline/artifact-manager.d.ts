import type { PipelineStage } from '@harness/protocol';
export interface StageArtifactSnapshot {
    stageId: string;
    roleName: string;
    artifactPaths: string[];
    summary: string;
}
/**
 * 阶段交付工件捕获、上下文契约注入与上游审定工件只读守护 (WBS-02-03-01 / WBS-02-03-02 / D54)
 */
export declare class ArtifactManager {
    private readonly workspaceRoot;
    /** 已被 Gatekeeper 审定放行的工件路径（绝对路径集合，在下游阶段强制只读） */
    private readonly approvedArtifacts;
    constructor(workspaceRoot: string);
    /**
     * 按声明的模式列表捕获阶段产出的物理文件清单。
     * @param patterns 相对工作区路径或 glob 通配（如 docs/PRD.md 或 docs/**）
     */
    capture(patterns: string[]): string[];
    private walkDir;
    /**
     * 将阶段产出工件标记为「已审定」（上游放行后在后续所有下游阶段中只读保护）。
     */
    approve(stageId: string, fullPaths: string[]): void;
    /**
     * 回收或释放某阶段的工件守护。
     */
    release(stageId: string): void;
    /**
     * 判定目标文件当前是否可写。
     * 只要命中任何上游已审定工件，即判定不可修改（守护 D54）。
     */
    canEdit(filePath: string): boolean;
    /**
     * 结构化构建下游阶段的输入上下文提示词块（WBS-02-03-01）。
     * 提取上游各阶段的总结、交付工件正文，拼装成严谨的输入提示词。
     */
    buildStageInputContext(stages: PipelineStage[], currentStageIndex: number, previousSnapshots: StageArtifactSnapshot[]): string;
}
