/**
 * 无论预设与自定义规则如何，永远拒绝的操作（设计 §6.2「不可逆与越界操作仍 deny」）。
 * 这些是安全红线，不接受任何配置放宽。
 */
export const HARD_DENY_RULES = [
    { tool: 'bash', pattern: 'git push', label: '禁止向远端推送代码（D56 版本控制红线）' },
    { tool: 'bash', pattern: 'git push --force', label: '禁止强制推送' },
    { tool: 'bash', pattern: 'shutdown', label: '禁止关机/重启宿主' },
    { tool: 'bash', pattern: 'reboot', label: '禁止关机/重启宿主' },
    { tool: 'bash', pattern: 'diskpart', label: '禁止磁盘分区操作' },
    { tool: 'bash', pattern: 'mkfs', label: '禁止格式化文件系统' },
    { tool: 'bash', pattern: 'format ', label: '禁止格式化磁盘' },
    { tool: 'bash', pattern: 'rm -rf /', label: '禁止递归删除根路径' },
    { tool: 'read_file', pattern: '.env', label: '敏感凭据读取拦截（D48）' },
    { tool: 'read_file', pattern: '*.pem', label: '私钥证书读取拦截（D48）' },
    { tool: 'read_file', pattern: '*.key', label: '私钥证书读取拦截（D48）' },
    { tool: 'read_file', pattern: 'id_rsa', label: '私钥读取拦截（D48）' },
    { tool: 'write_file', pattern: '.env', label: '禁止写入敏感凭据文件（D48）' },
    { tool: 'edit_file', pattern: '.env', label: '禁止修改敏感凭据文件（D48）' },
];
const READ_TOOLS = new Set(['read_file', 'glob', 'grep']);
const WRITE_TOOLS = new Set(['write_file', 'edit_file']);
const PATH_TOOLS = new Set(['read_file', 'write_file', 'edit_file']);
/** 提问与任务清单只写 UI 状态、不产生文件/命令副作用，任何预设下都放行。 */
const ALWAYS_ALLOW_TOOLS = new Set(['ask_user', 'todo_write']);
// ponytail: 这里自带一个最小 glob 匹配，因为 packages/core 不应依赖 plugins/tools-coding
//（依赖方向反了）。规则集很小（仅 * 与 ?），不值得为此抽公共包。
function matchGlob(pattern, value) {
    let expression = '';
    for (const char of pattern) {
        if (char === '*')
            expression += '.*';
        else if (char === '?')
            expression += '.';
        else
            expression += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    try {
        return new RegExp(`^${expression}$`).test(value);
    }
    catch {
        return false;
    }
}
function matchTool(ruleTool, tool) {
    if (ruleTool === '*' || ruleTool === tool)
        return true;
    if (ruleTool.endsWith('*'))
        return tool.startsWith(ruleTool.slice(0, -1));
    return false;
}
function parameterCandidates(tool, args) {
    if (PATH_TOOLS.has(tool)) {
        const target = typeof args.path === 'string' ? args.path : '';
        const basename = target.split(/[\\/]/).pop() ?? '';
        return target === basename ? [target] : [target, basename];
    }
    if (typeof args.command === 'string')
        return [args.command];
    if (typeof args.pattern === 'string')
        return [args.pattern];
    return [JSON.stringify(args ?? {})];
}
function matchPattern(tool, pattern, args) {
    const candidates = parameterCandidates(tool, args);
    if (tool === 'bash') {
        // 命令语义：前缀/子串命中即为匹配（设计 D28 命令前缀白名单）
        return candidates.some((candidate) => candidate.includes(pattern) || matchGlob(pattern, candidate));
    }
    return candidates.some((candidate) => candidate === pattern || matchGlob(pattern, candidate));
}
const ACTION_PRIORITY = { deny: 3, ask: 2, allow: 1 };
/**
 * 工具执行前的权限闸门（设计 §6.1 / D7）。
 * 判定顺序：硬性红线 → 自定义规则（deny > ask > allow）→ 预设默认动作。
 * 无匹配且未知的工具一律落到 `ask`，不静默放行。
 */
export class PermissionGate {
    preset;
    rules;
    constructor(options) {
        this.preset = options.preset;
        this.rules = options.rules ?? [];
    }
    setPreset(preset) {
        this.preset = preset;
    }
    setRules(rules) {
        this.rules = rules;
    }
    /**
     * 判定一次工具调用。
     * @param request - 工具名与其入参。
     * @returns 决策、可读原因与被命中的规则（若有）。
     */
    evaluate(request) {
        const { tool, args } = request;
        for (const hard of HARD_DENY_RULES) {
            if (matchTool(hard.tool, tool) && matchPattern(tool, hard.pattern, args)) {
                return {
                    action: 'deny',
                    reason: `硬性红线拒绝：${hard.label}`,
                    rule: { tool: hard.tool, pattern: hard.pattern, action: 'deny', reason: hard.label },
                };
            }
        }
        const matched = this.rules.filter(
        // 省略 pattern 表示该工具的全部调用，而不是"匹配空字符串"
        (rule) => matchTool(rule.tool, tool)
            && (rule.pattern === undefined || matchPattern(tool, rule.pattern, args)));
        if (matched.length > 0) {
            const winner = matched.reduce((best, current) => ACTION_PRIORITY[current.action] > ACTION_PRIORITY[best.action] ? current : best);
            return {
                action: winner.action,
                reason: winner.reason
                    ?? `规则命中：${winner.tool}${winner.pattern ? ` / ${winner.pattern}` : ''} → ${winner.action}`,
                rule: winner,
            };
        }
        const action = this.presetAction(tool);
        return {
            action,
            reason: `预设 ${this.preset} 对工具 ${tool} 的默认动作：${action}`,
        };
    }
    /** @returns 当前预设下某工具的默认动作。 */
    presetAction(tool) {
        if (ALWAYS_ALLOW_TOOLS.has(tool) || READ_TOOLS.has(tool))
            return 'allow';
        if (this.preset === 'readonly')
            return 'deny';
        if (this.preset === 'full')
            return tool === 'bash' || WRITE_TOOLS.has(tool) ? 'allow' : 'ask';
        // edit 预设：写文件与命令一律进审批，未知工具同样不静默放行
        return 'ask';
    }
    /** @returns 当前生效的预设、自定义规则与硬性红线，供设置页如实展示。 */
    describe() {
        return { preset: this.preset, rules: this.rules, hardDenies: HARD_DENY_RULES };
    }
}
