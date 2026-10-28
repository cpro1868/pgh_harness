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
export declare class GitRollbackManager {
    readonly workspacePath: string;
    private currentCheckpoint;
    constructor(workspacePath: string);
    /**
     * 快照范围与 Agent 工具语义对齐：跳过隐藏目录（.obsidian/.smart-env 等工具缓存）
     * 与依赖目录。这些目录体积占比常超 95%（实测 180MB+），且 Agent 不会触碰、撤销无需恢复。
     * 清单来自 workspace-skip.ts 统一共享（SearchTools / files 端点同源）。
     */
    private static readonly SKIP_DIRS;
    private scanWorkspaceRelativeFiles;
    /**
     * 落实 Q1 & D59：回合开始前轻量捕获用户既有的未提交手写状态。
     * 性能约束（真机取证：OneDrive 同步盘 190MB 工作区曾致每次发消息延迟 1.9s）：
     * 1. 范围收窄——只快照真实工作内容（隐藏/缓存/依赖目录一律排除）；
     * 2. 以 Buffer 存储原文，**禁止预解码 UTF-8 字符串**（190MB 解码即浪费 450ms 且内存翻倍）。
     */
    createTurnCheckpoint(turnId: string): TurnCheckpoint;
    hasCheckpoint(turnId: string): boolean;
    /**
     * 执行一键撤销本回合修改 (Revert Turn)
     */
    revertTurn(turnId: string): RevertResult;
}
