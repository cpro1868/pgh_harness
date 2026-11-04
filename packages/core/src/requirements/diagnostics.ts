// ═══════════════ 四维诊断器（MOD-17 详细设计 §5，纯本地规则零 LLM） ═══════════════

export interface DiagnosticTaskRef {
  id: string;
  title: string;
  status: string;
  acceptanceCriteria?: string;
  priority?: string;
  sortOrder?: number;
}

export interface DiagnosticChunkRef {
  id: string;
  parentId?: string | null;
  title: string;
  description: string;
  status: string;
  priority: string;
  tags?: string[];
  children: DiagnosticChunkRef[];
  tasks: DiagnosticTaskRef[];
  discussionRounds: number;
}

export interface DiagnosticMessageRef {
  role: string;
  content: string;
}

export interface DiagnosticSnapshot {
  messages: DiagnosticMessageRef[];
  chunks: DiagnosticChunkRef[];
  /** 上一轮建议（用于延续 dismissed 状态） */
  suggestions: Array<{ id: string; content: string; sourceType: SuggestionSource; isDismissed: boolean }>;
}

export type SuggestionSource = 'coverage' | 'conflict' | 'status' | 'readiness';

export interface DiagnosticSuggestion {
  content: string;
  sourceType: SuggestionSource;
  sourceReason: string;
  isDismissed: boolean;
}

const SOURCE_ORDER: Record<SuggestionSource, number> = { conflict: 0, coverage: 1, status: 2, readiness: 3 };
const MAX_SUGGESTIONS = 8;
const DRAFT_STALL_ROUNDS = 2;
const READINESS_APPROVED_RATIO = 0.8;

// 关键词族（详设 §5 覆盖度维度）
const COVERAGE_FAMILIES: Array<{ label: string; keywords: string[] }> = [
  { label: '性能', keywords: ['性能', '并发', '延迟', 'QPS', '吞吐'] },
  { label: '安全', keywords: ['安全', '鉴权', '加密', '越权', '漏洞'] },
  { label: '异常', keywords: ['异常', '报错', '重试', '幂等', '失败'] },
];

// 矛盾对（详设 §5 冲突维度）
const CONFLICT_PAIRS: Array<{ a: string; b: string; label: string }> = [
  { a: '零外部依赖', b: '第三方库', label: '零外部依赖 vs 第三方库扩展' },
  { a: '零外部依赖', b: '高性能', label: '性能要求 vs 零外部依赖' },
  { a: '不缓存', b: '高性能', label: '高性能 vs 不缓存约束' },
  { a: '实时', b: '离线', label: '实时性 vs 离线模式' },
];

function collectText(snapshot: DiagnosticSnapshot): string {
  const parts: string[] = [];
  for (const m of snapshot.messages) parts.push(m.content);
  const walk = (chunks: DiagnosticChunkRef[]) => {
    for (const c of chunks) {
      parts.push(c.title, c.description);
      for (const t of c.tasks) parts.push(t.title);
      walk(c.children);
    }
  };
  walk(snapshot.chunks);
  return parts.join('\n');
}

function collectTitles(chunks: DiagnosticChunkRef[]): string[] {
  const out: string[] = [];
  const walk = (list: DiagnosticChunkRef[]) => list.forEach((c) => { out.push(c.title); walk(c.children); });
  walk(chunks);
  return out;
}

function countAllChunks(chunks: DiagnosticChunkRef[]): { total: number; approved: number; withTasks: number } {
  let total = 0, approved = 0, withTasks = 0;
  const walk = (list: DiagnosticChunkRef[]) => {
    for (const c of list) {
      total += 1;
      if (c.status === 'approved') approved += 1;
      if (c.tasks.length > 0) withTasks += 1;
      walk(c.children);
    }
  };
  walk(chunks);
  return { total, approved, withTasks };
}

/** 稳定键：主干（括号前）匹配，避免参数化文案变化导致 dismissed 丢失 */
function stableKey(content: string): string {
  return content.split(/（|\(/)[0].trim();
}

/** 重算建议：全量替换策略由调用方（store.replaceSuggestions）执行 */
export function recomputeSuggestions(snapshot: DiagnosticSnapshot): DiagnosticSuggestion[] {
  const items: DiagnosticSuggestion[] = [];
  const text = collectText(snapshot);
  const titles = collectTitles(snapshot.chunks);
  const stats = countAllChunks(snapshot.chunks);

  // ① conflict 冲突诊断
  for (const pair of CONFLICT_PAIRS) {
    if (text.includes(pair.a) && text.includes(pair.b)) {
      items.push({
        content: `⚠️ 潜在冲突：${pair.label}`,
        sourceType: 'conflict',
        sourceReason: `文本同时出现「${pair.a}」与「${pair.b}」`,
        isDismissed: false,
      });
      break; // 每轮最多一条冲突，避免噪音
    }
  }

  // ② coverage 覆盖度分析（仅在有实际讨论内容时）
  if (snapshot.messages.length > 0 || stats.total > 0) {
    const missing = COVERAGE_FAMILIES.filter((f) => !f.keywords.some((kw) => text.includes(kw)));
    if (missing.length > 0 && stats.total > 0) {
      items.push({
        content: `补充非功能需求（${missing.map((m) => m.label).join('/')}）`,
        sourceType: 'coverage',
        sourceReason: `覆盖度分析 · ${missing.map((m) => `「${m.label}」出现 0 次`).join('，')}`,
        isDismissed: false,
      });
    }
  }

  // ③ status 状态推进（draft 停留催办）
  const stalled = snapshot.chunks.filter((c) => c.status === 'draft' && c.discussionRounds >= DRAFT_STALL_ROUNDS);
  for (const c of stalled) {
    items.push({
      content: `分块「${c.title}」仍为 draft——建议讨论确认`,
      sourceType: 'status',
      sourceReason: `分块状态分析 · draft 状态超过 ${DRAFT_STALL_ROUNDS} 轮讨论未更新`,
      isDismissed: false,
    });
  }

  // ④ readiness 就绪度评估
  const hasPendingProposalLikeState = stats.total === 0;
  if (!hasPendingProposalLikeState && stats.total > 0 && stats.approved / stats.total >= READINESS_APPROVED_RATIO && stats.withTasks > 0) {
    items.push({
      content: '讨论覆盖度已较高——可以生成 PRD 了',
      sourceType: 'readiness',
      sourceReason: `Agent 综合判断 · ${stats.approved}/${stats.total} 个分块已 approved 且含 ${stats.withTasks} 个带任务分块`,
      isDismissed: false,
    });
  }

  // dismissed 延续：稳定键（括号前主干）匹配上一轮已忽略项
  const dismissedKeys = new Set(snapshot.suggestions.filter((s) => s.isDismissed).map((s) => stableKey(s.content)));
  for (const item of items) {
    if (dismissedKeys.has(stableKey(item.content))) item.isDismissed = true;
  }

  // 排序 + 截断
  items.sort((a, b) => SOURCE_ORDER[a.sourceType] - SOURCE_ORDER[b.sourceType]);
  void titles;
  return items.slice(0, MAX_SUGGESTIONS);
}
