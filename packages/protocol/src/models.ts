export interface SessionModel {
  id: string;
  title: string;
  workspacePath: string;
  preset: 'readonly' | 'edit' | 'full';
  activeModelId: string;
  createdAt: number;
  updatedAt: number;
  isArchived: boolean;
}

export interface WorkspaceLockStatus {
  workspacePath: string;
  isLocked: boolean;
  holderSessionId?: string;
  rootSessionId?: string;
  waitingCount: number;
}

export interface PipelineStage {
  id: string;
  pipelineId: string;
  order: number;
  roleName: string;
  promptTemplate: string;
  modelId?: string;
  toolsAllowed: string[];
  /** 阶段工件交付路径清单（选填，留空表示走 Git 增量追踪） */
  artifactPaths: string[];
  /** 是否需要人类 Gatekeeper 审核通过才流转到下一阶段 */
  gatekeeperRequired: boolean;
}

export interface PipelineTemplate {
  id: string;
  name: string;
  description: string;
  stages: PipelineStage[];
  createdAt: number;
  updatedAt: number;
}

