import fs from 'node:fs';
import path from 'node:path';

export class FileNotObservedError extends Error {
  constructor(filePath: string) {
    super(`[FileTools] File "${filePath}" must be read with read_file before it can be edited (先读后写原则)`);
    this.name = 'FileNotObservedError';
  }
}

export class EditMismatchError extends Error {
  public readonly isDoomLoop: boolean;

  constructor(filePath: string, message: string, isDoomLoop = false) {
    super(`[FileTools] Edit failed on "${filePath}": ${message}${isDoomLoop ? ' (连续失败3次触发熔断刹车，请向人类求援)' : ''}`);
    this.name = 'EditMismatchError';
    this.isDoomLoop = isDoomLoop;
  }
}

export interface EditFileResult {
  filePath: string;
  replacements: number;
}

export class FileTools {
  public readonly workspacePath: string;
  private observedFiles = new Set<string>();
  private failureCounts = new Map<string, number>();

  constructor(workspacePath: string) {
    this.workspacePath = path.resolve(workspacePath);
  }

  private resolveSafePath(relPath: string): string {
    const resolved = path.resolve(this.workspacePath, relPath);
    // 强制路径在工作区之内
    if (!resolved.startsWith(this.workspacePath)) {
      throw new Error(`[SandBox] Path escape rejected: "${relPath}" is outside workspace root`);
    }
    return resolved;
  }

  public readFile(relPath: string): string {
    const fullPath = this.resolveSafePath(relPath);
    const content = fs.readFileSync(fullPath, 'utf8');
    this.observedFiles.add(relPath);
    return content;
  }

  public writeFile(relPath: string, content: string): void {
    const fullPath = this.resolveSafePath(relPath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, 'utf8');
    this.observedFiles.add(relPath);
  }

  /**
   * 吸收 OpenCode 的 CRLF/LF 换行符精确容错替换算法：
   * reference/opencode/packages/core/src/tool/edit.ts:42-65
   */
  public editFile(relPath: string, oldString: string, newString: string, replaceAll = false): EditFileResult {
    if (!this.observedFiles.has(relPath)) {
      throw new FileNotObservedError(relPath);
    }

    const fullPath = this.resolveSafePath(relPath);
    const rawContent = fs.readFileSync(fullPath, 'utf8');

    // 1. 换行符探测与归一化
    const hasCrlf = rawContent.includes('\r\n');
    const ending = hasCrlf ? '\r\n' : '\n';

    const normalizedContent = rawContent.replaceAll('\r\n', '\n');
    const normalizedOld = oldString.replaceAll('\r\n', '\n');
    const normalizedNew = newString.replaceAll('\r\n', '\n');

    // 2. 匹配次数校验
    let matchCount = 0;
    let offset = 0;
    while ((offset = normalizedContent.indexOf(normalizedOld, offset)) !== -1) {
      matchCount++;
      offset += normalizedOld.length;
    }

    if (matchCount === 0) {
      const currentFailures = (this.failureCounts.get(relPath) ?? 0) + 1;
      this.failureCounts.set(relPath, currentFailures);
      const isDoomLoop = currentFailures >= 3;
      throw new EditMismatchError(relPath, 'oldString not found in content. Ensure exact line and spacing matching.', isDoomLoop);
    }

    if (matchCount > 1 && !replaceAll) {
      const currentFailures = (this.failureCounts.get(relPath) ?? 0) + 1;
      this.failureCounts.set(relPath, currentFailures);
      const isDoomLoop = currentFailures >= 3;
      throw new EditMismatchError(relPath, `Found multiple matches (${matchCount}) for oldString. Provide more surrounding context lines or use replaceAll: true.`, isDoomLoop);
    }

    // 3. 执行替换并恢复原有的换行符体系
    let updatedNormalized: string;
    if (replaceAll) {
      updatedNormalized = normalizedContent.replaceAll(normalizedOld, normalizedNew);
    } else {
      updatedNormalized = normalizedContent.replace(normalizedOld, normalizedNew);
    }

    // 恢复文件原有的换行风格 (保持 CRLF 或 LF)
    const finalContent = ending === '\r\n' ? updatedNormalized.replaceAll('\n', '\r\n') : updatedNormalized;

    fs.writeFileSync(fullPath, finalContent, 'utf8');
    // 成功替换后重置失败计数
    this.failureCounts.delete(relPath);

    return {
      filePath: relPath,
      replacements: matchCount,
    };
  }
}
