import fs from 'node:fs';
import path from 'node:path';
import { WORKSPACE_SKIP_DIRS } from './workspace-skip.ts';

export interface TurnCheckpoint {
  turnId: string;
  createdAt: number;
  userUntrackedFiles: string[];
  /** 原文快照以 Buffer 存储（禁止预解码，防大工作区字符串内存翻倍），撤销时逐字节还原 */
  fileSnapshots: Map<string, Buffer>;
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

  /**
   * 快照范围与 Agent 工具语义对齐：跳过隐藏目录（.obsidian/.smart-env 等工具缓存）
   * 与依赖目录。这些目录体积占比常超 95%（实测 180MB+），且 Agent 不会触碰、撤销无需恢复。
   * 清单来自 workspace-skip.ts 统一共享（SearchTools / files 端点同源）。
   */
  private static readonly SKIP_DIRS = WORKSPACE_SKIP_DIRS;

  private scanWorkspaceRelativeFiles(): string[] {
    const list: string[] = [];
    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (GitRollbackManager.SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
          walk(path.join(dir, entry.name));
        } else {
          list.push(path.relative(this.workspacePath, path.join(dir, entry.name)));
        }
      }
    };
    if (fs.existsSync(this.workspacePath)) {
      walk(this.workspacePath);
    }
    return list;
  }

  /**
   * 落实 Q1 & D59：回合开始前轻量捕获用户既有的未提交手写状态。
   * 性能约束（真机取证：OneDrive 同步盘 190MB 工作区曾致每次发消息延迟 1.9s）：
   * 1. 范围收窄——只快照真实工作内容（隐藏/缓存/依赖目录一律排除）；
   * 2. 以 Buffer 存储原文，**禁止预解码 UTF-8 字符串**（190MB 解码即浪费 450ms 且内存翻倍）。
   */
  public createTurnCheckpoint(turnId: string): TurnCheckpoint {
    // 落实 Q4：新回合开启，前一回合快照自动静默释放，绝不污染系统
    this.currentCheckpoint = null;

    const existingFiles = this.scanWorkspaceRelativeFiles();
    const fileSnapshots = new Map<string, Buffer>();

    for (const file of existingFiles) {
      const full = path.join(this.workspacePath, file);
      try {
        fileSnapshots.set(file, fs.readFileSync(full));
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

    // 2. 将本回合被 Agent 修改的文件原子恢复为 baseline 快照（Buffer 逐字节比对与还原）
    for (const [file, originalContent] of this.currentCheckpoint.fileSnapshots.entries()) {
      const full = path.join(this.workspacePath, file);
      try {
        const currentContent = fs.existsSync(full) ? fs.readFileSync(full) : null;
        if (!currentContent || !currentContent.equals(originalContent)) {
          fs.writeFileSync(full, originalContent);
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
