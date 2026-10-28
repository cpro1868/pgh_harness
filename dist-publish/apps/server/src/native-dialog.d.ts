/** 在文件管理器中打开目录所需的外部依赖（可注入以便测试，避免真的弹出窗口）。 */
export interface RevealDeps {
    /** 替换 `process.platform` 做确定性测试。 */
    platform?: NodeJS.Platform;
    /** 替换真实 spawn。 */
    spawnFn?: (command: string, args: string[]) => {
        unref?: () => void;
    };
}
/**
 * 在系统文件管理器中打开指定目录（Windows 资源管理器 / macOS Finder / Linux 文件管理器）。
 * @param targetPath - 已由调用方校验过的绝对目录路径。
 * @param deps - 平台与 spawn 注入点（测试用）。
 * @returns 实际使用的启动命令，便于断言与日志。
 */
export declare function revealInFileManager(targetPath: string, deps?: RevealDeps): string;
export interface DirectoryEntry {
    name: string;
    path: string;
    hidden: boolean;
}
export interface DirectoryListing {
    current: string;
    crumbs: DirectoryEntry[];
    entries: DirectoryEntry[];
    home: string;
}
/**
 * 列出指定绝对路径下的目录子项，并计算面包屑导航 (参考 deepseek-harness browse 架构)
 */
export declare function listDirectory(targetPath?: string): Promise<DirectoryListing>;
/**
 * 在目标目录下创建新子目录
 */
export declare function createDirectory(parentPath: string, name: string): Promise<string>;
/**
 * 唤起 Windows 原生高集成度现代对话框：
 * 采用 C# STA 脚本编译执行 FolderBrowserDialog，确保在最前激活并返回绝对路径
 */
export declare function openNativeFolderDialog(): string;
