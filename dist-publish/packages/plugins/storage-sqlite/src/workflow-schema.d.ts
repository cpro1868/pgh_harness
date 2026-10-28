import type { SqliteDatabase } from './database.ts';
import type { WorkflowDefinition, WorkflowInstanceModel } from '@harness/protocol';
export type { WorkflowDefinition, WorkflowInstanceModel };
export declare const WORKFLOW_DEFAULT_TEMPLATE: WorkflowDefinition;
export declare class WorkflowStore {
    private readonly db;
    constructor(db: SqliteDatabase);
    private ensureSchema;
    private ensureDefaultTemplate;
    list(): WorkflowDefinition[];
    get(id: string): WorkflowDefinition | null;
    create(workflow: WorkflowDefinition): WorkflowDefinition;
    update(id: string, patch: Partial<Omit<WorkflowDefinition, 'id' | 'createdAt'>>): WorkflowDefinition | null;
    delete(id: string): boolean;
    saveInstance(inst: WorkflowInstanceModel): WorkflowInstanceModel;
    listInstances(): WorkflowInstanceModel[];
    getInstance(instanceId: string): WorkflowInstanceModel | null;
    deleteInstance(instanceId: string): boolean;
    private mapInstanceRow;
    private mapRow;
}
