import fs from 'node:fs';
import path from 'node:path';

export class PathEscapeError extends Error {
  public readonly attemptedPath: string;

  constructor(attemptedPath: string) {
    super(`[SandBox Security] Path escape attempt blocked: "${attemptedPath}" resolves outside workspace root`);
    this.name = 'PathEscapeError';
    this.attemptedPath = attemptedPath;
  }
}


export class SandboxGuard {
  public readonly canonicalWorkspace: string;

  constructor(workspacePath: string) {
    // 解析工作区的真实物理路径，消除软链干扰
    this.canonicalWorkspace = fs.realpathSync.native
      ? fs.realpathSync.native(path.resolve(workspacePath))
      : fs.realpathSync(path.resolve(workspacePath));
  }

  public assertSafePath(relOrAbsPath: string): string {
    const resolvedPath = path.resolve(this.canonicalWorkspace, relOrAbsPath);

    // 1. 基础路径前缀拦截
    if (!resolvedPath.startsWith(this.canonicalWorkspace)) {
      throw new PathEscapeError(relOrAbsPath);
    }

    // 2. realpath 物理符号链接逃逸拦截 (D52)
    if (fs.existsSync(resolvedPath)) {
      try {
        const realPhysical = fs.realpathSync.native
          ? fs.realpathSync.native(resolvedPath)
          : fs.realpathSync(resolvedPath);

        if (!realPhysical.startsWith(this.canonicalWorkspace)) {
          throw new PathEscapeError(relOrAbsPath);
        }
        return realPhysical;
      } catch {
        throw new PathEscapeError(relOrAbsPath);
      }
    }

    return resolvedPath;
  }
}
