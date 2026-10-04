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
  /** 步骤语义化名称（如「需求分析与规格提炼」），可与 roleName 不同 */
  name?: string;
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

export type PipelineInstanceStatus = 'draft' | 'idle' | 'running' | 'waiting_gate' | 'paused' | 'completed' | 'failed' | 'aborted';

export interface PipelineRoleActivityLog {
  id: string;
  stageId: string;
  stageOrder: number;
  roleName: string;
  actor: 'agent' | 'human' | 'system';
  type: 'thought' | 'tool_call' | 'tool_result' | 'summary' | 'instruction' | 'gate';
  title?: string;
  content: string;
  toolName?: string;
  toolArgs?: string;
  isError?: boolean;
  timestamp: number;
}

export interface PipelineArtifactItem {
  stageId: string;
  roleName: string;
  path: string;
  sizeBytes?: number;
  description?: string;
  timestamp: number;
}

export interface PipelineInstanceModel {
  instanceId: string;
  name: string;
  pipelineId: string;
  pipelineName: string;
  workspacePath: string;
  taskPrompt: string;
  status: PipelineInstanceStatus;
  currentStageId?: string;
  currentStageOrder: number;
  stages: PipelineStage[];
  logs: PipelineRoleActivityLog[];
  artifacts: PipelineArtifactItem[];
  gateRecords: Array<{
    stageId: string;
    roleName: string;
    action: 'approve' | 'reject';
    reason?: string;
    timestamp: number;
  }>;
  tokensUsed: number;
  error?: string;
  createdAt: number;
  startedAt?: number;
  updatedAt: number;
}


