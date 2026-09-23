import fs from 'node:fs';
import path from 'node:path';

export interface TurnCheckpoint {
  turnId: string;
  createdAt: number;
  userUntrackedFiles: string[];
  fileSnapshots: Map<string, string>;
}

export interface RevertResult {
  success: boolean;
  revertedFiles: string[];
}

export class GitRollbackManager {
  public readonly workspacePath: string;
  private currentCheckpoint: TurnCheckpoint | null = null;

  constructor(workspacePath: string) {
    this.workspacePath = path.resolve(workspacePath);
  }

  private scanWorkspaceRelativeFiles(): string[] {
    const list: string[] = [];
    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else {
          list.push(path.relative(this.workspacePath, full));
        }
      }
    };
    if (fs.existsSync(this.workspacePath)) {
      walk(this.workspacePath);
    }
    return list;
  }

  /**
   * 落实 Q1 & D59：回合开始前轻量捕获用户既有的未提交手写状态
   */
  public createTurnCheckpoint(turnId: string): TurnCheckpoint {
    // 落实 Q4：新回合开启，前一回合快照自动静默释放，绝不污染系统
    this.currentCheckpoint = null;

    const existingFiles = this.scanWorkspaceRelativeFiles();
    const fileSnapshots = new Map<string, string>();

    for (const file of existingFiles) {
      const full = path.join(this.workspacePath, file);
      try {
        fileSnapshots.set(file, fs.readFileSync(full, 'utf8'));
      } catch {}
    }

    this.currentCheckpoint = {
      turnId,
      createdAt: Date.now(),
      userUntrackedFiles: existingFiles,
      fileSnapshots,
    };

    return this.currentCheckpoint;
  }

  public hasCheckpoint(turnId: string): boolean {
    return this.currentCheckpoint !== null && this.currentCheckpoint.turnId === turnId;
  }

  /**
   * 执行一键撤销本回合修改 (Revert Turn)
   */
  public revertTurn(turnId: string): RevertResult {
    if (!this.currentCheckpoint || this.currentCheckpoint.turnId !== turnId) {
      return { success: false, revertedFiles: [] };
    }

    const currentFiles = this.scanWorkspaceRelativeFiles();
    const revertedFiles: string[] = [];

    // 1. 删除本回合 Agent 新增的文件 (不在 baseline 中的文件)
    for (const file of currentFiles) {
      if (!this.currentCheckpoint.fileSnapshots.has(file)) {
        const full = path.join(this.workspacePath, file);
        try {
          fs.unlinkSync(full);
          revertedFiles.push(file);
        } catch {}
      }
    }

    // 2. 将本回合被 Agent 修改的文件原子恢复为 baseline 快照
    for (const [file, originalContent] of this.currentCheckpoint.fileSnapshots.entries()) {
      const full = path.join(this.workspacePath, file);
      try {
        const currentContent = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
        if (currentContent !== originalContent) {
          fs.writeFileSync(full, originalContent, 'utf8');
          revertedFiles.push(file);
        }
      } catch {}
    }

    return {
      success: true,
      revertedFiles,
    };
  }
}
