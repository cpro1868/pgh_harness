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
