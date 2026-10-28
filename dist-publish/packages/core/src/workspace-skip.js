/**
 * 统一工作区屏蔽清单（单一事实来源）：
 * GitRollbackManager（撤销快照）/ SearchTools（glob/grep）/ workspace files 端点共享。
 * 这些目录是工具缓存或依赖产物，Agent 不触碰、统计不纳入、搜索不返回。
 */
export const WORKSPACE_SKIP_DIRS = new Set([
    '.git', 'node_modules', 'dist', 'build', '.next', 'coverage',
    '.obsidian', '.smart-env', '.smart-composer', '.aionrs', '.trash',
    '.harness', // PGH 自身画像/记忆目录，自屏蔽
]);
