import fs from 'node:fs';
import path from 'node:path';
import type { PipelineStage } from '@harness/protocol';

export interface StageArtifactSnapshot {
  stageId: string;
  roleName: string;
  artifactPaths: string[];
  summary: string;
}

/**
 * 阶段交付工件捕获、上下文契约注入与上游审定工件只读守护 (WBS-02-03-01 / WBS-02-03-02 / D54)
 */
export class ArtifactManager {
  private readonly workspaceRoot: string;
  /** 已被 Gatekeeper 审定放行的工件路径（绝对路径集合，在下游阶段强制只读） */
  private readonly approvedArtifacts = new Map<string, Set<string>>();

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  /**
   * 按声明的模式列表捕获阶段产出的物理文件清单。
   * @param patterns 相对工作区路径或 glob 通配（如 docs/PRD.md 或 docs/**）
   */
  public capture(patterns: string[]): string[] {
    if (!Array.isArray(patterns) || patterns.length === 0) {
      return [];
    }

    const matched: string[] = [];
    for (const pattern of patterns) {
      const cleanPattern = pattern.trim().replace(/^[\\/]+/, '');
      if (!cleanPattern) continue;

      if (cleanPattern.endsWith('**')) {
        const baseDir = path.resolve(this.workspaceRoot, cleanPattern.slice(0, -2).replace(/[\\/]+$/, ''));
        if (fs.existsSync(baseDir) && fs.statSync(baseDir).isDirectory()) {
          this.walkDir(baseDir, matched);
        }
      } else {
        const fullPath = path.resolve(this.workspaceRoot, cleanPattern);
        if (fs.existsSync(fullPath) && !fs.statSync(fullPath).isDirectory()) {
          if (!matched.includes(fullPath)) matched.push(fullPath);
        }
      }
    }
    return matched;
  }

  private walkDir(dir: string, result: string[]): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          this.walkDir(full, result);
        } else if (entry.isFile()) {
          if (!result.includes(full)) result.push(full);
        }
      }
    } catch {
      // 忽略不可读目录
    }
  }

  /**
   * 将阶段产出工件标记为「已审定」（上游放行后在后续所有下游阶段中只读保护）。
   */
  public approve(stageId: string, fullPaths: string[]): void {
    const set = this.approvedArtifacts.get(stageId) ?? new Set<string>();
    for (const p of fullPaths) {
      set.add(path.resolve(p));
    }
    this.approvedArtifacts.set(stageId, set);
  }

  /**
   * 回收或释放某阶段的工件守护。
   */
  public release(stageId: string): void {
    this.approvedArtifacts.delete(stageId);
  }

  /**
   * 判定目标文件当前是否可写。
   * 只要命中任何上游已审定工件，即判定不可修改（守护 D54）。
   */
  public canEdit(filePath: string): boolean {
    const target = path.resolve(filePath);
    for (const set of this.approvedArtifacts.values()) {
      if (set.has(target)) {
        return false;
      }
    }
    return true;
  }

  /**
   * 结构化构建下游阶段的输入上下文提示词块（WBS-02-03-01）。
   * 提取上游各阶段的总结、交付工件正文，拼装成严谨的输入提示词。
   */
  public buildStageInputContext(
    stages: PipelineStage[],
    currentStageIndex: number,
    previousSnapshots: StageArtifactSnapshot[],
  ): string {
    const current = stages[currentStageIndex];
    const sections: string[] = [
      `### [流水线协同上下文 · 当前阶段: ${current.roleName} (步骤 ${currentStageIndex + 1}/${stages.length})]`,
      `当前阶段目标：${current.promptTemplate}`,
      '',
    ];

    if (previousSnapshots.length === 0) {
      sections.push('当前为流水线首发阶段，请根据初始任务需求开工。');
      return sections.join('\n');
    }

    sections.push('#### 上游阶段交付成果与接口契约：');
    for (const snap of previousSnapshots) {
      sections.push(`\n- **上游角色**：${snap.roleName}`);
      sections.push(`- **阶段总结**：${snap.summary}`);
      if (snap.artifactPaths.length > 0) {
        sections.push(`- **审定交付工件 (${snap.artifactPaths.length} 份 · 强制只读)**：`);
        for (const file of snap.artifactPaths) {
          const rel = path.relative(this.workspaceRoot, file);
          let preview = '';
          try {
            if (fs.existsSync(file)) {
              preview = fs.readFileSync(file, 'utf8').slice(0, 4000);
            }
          } catch {
            preview = '(无法读取文件)';
          }
          sections.push(`\n\`\`\`file:${rel}\n${preview}\n\`\`\``);
        }
      }
    }

    return sections.join('\n');
  }
}
