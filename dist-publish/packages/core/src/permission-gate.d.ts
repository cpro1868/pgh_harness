export type PermissionAction = 'allow' | 'ask' | 'deny';
export type PermissionPreset = 'readonly' | 'edit' | 'full';
export interface PermissionRule {
    /** 工具名：精确匹配、`*` 通配，或前缀通配如 `mcp:*`。 */
    tool: string;
    /** 参数模式：命令子串（bash）或路径 glob（文件工具）。省略表示该工具全部活动。 */
    pattern?: string;
    action: PermissionAction;
    reason?: string;
}
export interface PermissionRequest {
    tool: string;
    args: Record<string, unknown>;
}
export interface PermissionDecision {
    action: PermissionAction;
    reason: string;
    rule?: PermissionRule;
}
export interface HardDenyRule {
    tool: string;
    pattern: string;
    label: string;
}
/**
 * 无论预设与自定义规则如何，永远拒绝的操作（设计 §6.2「不可逆与越界操作仍 deny」）。
 * 这些是安全红线，不接受任何配置放宽。
 */
export declare const HARD_DENY_RULES: readonly HardDenyRule[];
/**
 * 工具执行前的权限闸门（设计 §6.1 / D7）。
 * 判定顺序：硬性红线 → 自定义规则（deny > ask > allow）→ 预设默认动作。
 * 无匹配且未知的工具一律落到 `ask`，不静默放行。
 */
export declare class PermissionGate {
    private preset;
    private rules;
    constructor(options: {
        preset: PermissionPreset;
        rules?: PermissionRule[];
    });
    setPreset(preset: PermissionPreset): void;
    setRules(rules: PermissionRule[]): void;
    /**
     * 判定一次工具调用。
     * @param request - 工具名与其入参。
     * @returns 决策、可读原因与被命中的规则（若有）。
     */
    evaluate(request: PermissionRequest): PermissionDecision;
    /** @returns 当前预设下某工具的默认动作。 */
    presetAction(tool: string): PermissionAction;
    /** @returns 当前生效的预设、自定义规则与硬性红线，供设置页如实展示。 */
    describe(): {
        preset: PermissionPreset;
        rules: readonly PermissionRule[];
        hardDenies: readonly HardDenyRule[];
    };
}
