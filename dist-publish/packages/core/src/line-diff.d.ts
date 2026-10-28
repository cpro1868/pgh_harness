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
/**
 * 计算两段文本的行级差异（LCS 回溯），供 Diff 审阅卡红绿对比使用。
 * @param before - 变更前文本。
 * @param after - 变更后文本。
 * @param maxLines - 规模上限；任一侧超过即降级为 truncated。
 * @returns 逐行差异（含上下文行）与增删计数。
 */
export declare function computeLineDiff(before: string, after: string, maxLines?: number): LineDiffResult;
