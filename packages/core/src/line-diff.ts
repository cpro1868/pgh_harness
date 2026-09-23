export interface DiffLine {
  type: 'add' | 'del' | 'ctx';
  text: string;
}

export interface LineDiffResult {
  lines: DiffLine[];
  added: number;
  removed: number;
  /** 输入超过规模上限时降级为空结果，前端应提示"变更过大，请查看文件本身"。 */
  truncated: boolean;
}

/** 默认规模上限：超过此行数的对比降级（见下方 ponytail 说明）。 */
const DEFAULT_MAX_LINES = 2000;

function splitLines(content: string): string[] {
  // 统一换行风格：避免 CRLF/LF 差异被误判为整篇变更
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return normalized.length === 0 ? [] : normalized.split('\n');
}

/**
 * 计算两段文本的行级差异（LCS 回溯），供 Diff 审阅卡红绿对比使用。
 * @param before - 变更前文本。
 * @param after - 变更后文本。
 * @param maxLines - 规模上限；任一侧超过即降级为 truncated。
 * @returns 逐行差异（含上下文行）与增删计数。
 */
export function computeLineDiff(before: string, after: string, maxLines: number = DEFAULT_MAX_LINES): LineDiffResult {
  const left = splitLines(before);
  const right = splitLines(after);

  // ponytail: LCS 为 O(n·m) 时间与空间。编辑类工具的实际改动文件远小于上限；
  // 超过 maxLines 直接降级而不是硬算，避免大文件把内存打满。
  // 天花板：若将来需要对比超大文件，应换成 Myers 差分或按块哈希，而不是调大上限。
  if (left.length > maxLines || right.length > maxLines) {
    return { lines: [], added: 0, removed: 0, truncated: true };
  }

  const table: number[][] = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i]![j] = left[i] === right[j]
        ? (table[i + 1]![j + 1] ?? 0) + 1
        : Math.max(table[i + 1]![j] ?? 0, table[i]![j + 1] ?? 0);
    }
  }

  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      lines.push({ type: 'ctx', text: left[i] as string });
      i += 1;
      j += 1;
      continue;
    }
    if ((table[i + 1]![j] ?? 0) >= (table[i]![j + 1] ?? 0)) {
      lines.push({ type: 'del', text: left[i] as string });
      removed += 1;
      i += 1;
      continue;
    }
    lines.push({ type: 'add', text: right[j] as string });
    added += 1;
    j += 1;
  }
  while (i < left.length) {
    lines.push({ type: 'del', text: left[i] as string });
    removed += 1;
    i += 1;
  }
  while (j < right.length) {
    lines.push({ type: 'add', text: right[j] as string });
    added += 1;
    j += 1;
  }

  return { lines, added, removed, truncated: false };
}
