import type { SqliteDatabase } from './database.ts';
import type { PipelineStage, PipelineTemplate, PipelineInstanceModel, PipelineInstanceStatus, PipelineRoleActivityLog, PipelineArtifactItem } from '@harness/protocol';
export type { PipelineStage, PipelineTemplate, PipelineInstanceModel, PipelineInstanceStatus, PipelineRoleActivityLog, PipelineArtifactItem, };
/** 内置标准研发 4 阶段流水线模板（WBS-02-01-01 / D36） */
export declare const PIPELINE_DEFAULT_TEMPLATE: PipelineTemplate;
export declare class PipelineStore {
    private readonly db;
    constructor(db: SqliteDatabase);
    private ensureSchema;
    create(template: PipelineTemplate): PipelineTemplate;
    get(id: string): PipelineTemplate | undefined;
    list(): PipelineTemplate[];
    update(id: string, patch: Partial<Omit<PipelineTemplate, 'id' | 'createdAt'>>): boolean;
    delete(id: string): boolean;
    /**
     * 在指定阶段后插入新阶段，并自动维护 1..N 连续单调顺序（步骤双向插入定制工作台基座，WBS-02-01-03）。
     */
    insertStageAfter(pipelineId: string, afterStageId: string | null, stage: Omit<PipelineStage, 'pipelineId' | 'order'>): boolean;
    saveInstance(inst: PipelineInstanceModel): void;
    getInstance(instanceId: string): PipelineInstanceModel | undefined;
    listInstances(): PipelineInstanceModel[];
    deleteInstance(instanceId: string): boolean;
}
