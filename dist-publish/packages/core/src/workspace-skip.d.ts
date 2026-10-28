/**
 * 统一工作区屏蔽清单（单一事实来源）：
 * GitRollbackManager（撤销快照）/ SearchTools（glob/grep）/ workspace files 端点共享。
 * 这些目录是工具缓存或依赖产物，Agent 不触碰、统计不纳入、搜索不返回。
 */
export declare const WORKSPACE_SKIP_DIRS: ReadonlySet<string>;
