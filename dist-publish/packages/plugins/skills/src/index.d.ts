/** 单个 Skill 的元数据（只含用于系统提示注入的部分） */
export interface SkillMeta {
    /** 技能名（目录名，kebab-case） */
    name: string;
    /** 人类可读描述 */
    description: string;
    /** 版本号（缺省 0.0.0） */
    version: string;
    /** 触发时机说明（可选） */
    trigger?: string;
    /** 技能目录绝对路径 */
    dirPath: string;
    /** SKILL.md 绝对路径 */
    skillMdPath: string;
    /** 是否为项目级技能（反之是用户级） */
    scope: 'project' | 'global';
}
/** SKILL.md 完整文件内容（供按需热加载） */
export interface SkillContent {
    meta: SkillMeta;
    /** YAML Front-matter 之外的 Markdown 正文 */
    body: string;
    /** 完整原始文本（含 front-matter） */
    raw: string;
}
/** YAML front-matter 的最小解析器（本项目不做复杂 YAML，只提取顶层字段） */
export declare function parseYamlFrontMatter(content: string): {
    meta: Record<string, string>;
    body: string;
} | null;
/** 校验 SKILL.md 是否为合法技能文件：有 front-matter 且含 name + description */
export declare function validateSkillMd(content: string): {
    valid: boolean;
    errors: string[];
};
/**
 * 从 SKILL.md 内容提取元数据。
 * @param dirPath 技能目录（SKILL.md 所在目录）
 * @param content SKILL.md 原始文本
 * @param scope 作用域标记
 */
export declare function extractSkillMeta(dirPath: string, content: string, scope: 'project' | 'global'): SkillMeta | null;
/**
 * 项目级技能发现路径（优先级从高到低）：
 * 1. <project>/.agents/skills/
 * 2. <project>/.skills/
 * 3. <project>/.harness/skills/
 * 4. <project>/.pg_harness/skills/
 */
export declare function projectSkillDirs(projectRoot: string): string[];
/** 用户级技能发现路径（~/.agents/skills、~/.config/agents/skills 与 ~/.pg_harness/skills） */
export declare function globalSkillDirs(): string[];
/**
 * 在一个技能根目录下扫描所有合法技能。
 * 技能目录形态：<root>/<name>/SKILL.md
 */
export declare function scanSkillRoot(rootDir: string, scope: 'project' | 'global'): SkillMeta[];
/**
 * 扫描并返回工作区可用全部技能（项目级优先，全局补充）。
 * @param workspacePath 工作区根目录
 */
export declare function scanAllSkills(workspacePath: string): SkillMeta[];
/**
 * 从 skill 元数据拼装系统提示中注入的技能描述片段。
 * 只注入 name + description，正文由模型调用 skill 工具按需加载。
 * @param skills 待注入技能列表
 * @param disabledSkills 被用户禁用的技能名集合（被禁用的不会注入系统提示，且不可被模型加载）
 */
export declare function buildSkillsPromptFragment(skills: SkillMeta[], disabledSkills?: Set<string>): string;
/**
 * 从指定目录加载完整 SKILL.md 内容（渐进披露，模型按需触发）。
 */
export declare function loadSkillContent(meta: SkillMeta): SkillContent;
/**
 * 将本地技能目录完整拷贝（或软链接）到目标 skill 根目录下。
 * 用于在 config-workspace 设置页手动添加本地技能包。
 * @param sourceDir 技能源目录（必须包含 SKILL.md）
 * @param targetRoot 目标 skill 根目录（如 <project>/.pg_harness/skills/）
 * @param copyMode 'copy' 完整拷贝 | 'link' 创建目录联接
 */
export declare function installSkill(sourceDir: string, targetRoot: string, copyMode?: 'copy' | 'link'): {
    skillName: string;
    destPath: string;
};
/**
 * 校验技能名是否合法。非法一律拒绝，不做静默清洗。
 * @param name 未校验入参
 * @returns 合法返回 true
 */
export declare function isValidSkillName(name: unknown): name is string;
/**
 * 按禁用清单过滤技能（供系统提示注入前使用）。
 * @param skills 已扫描技能
 * @param disabled 被禁用的技能名列表
 */
export declare function filterEnabledSkills(skills: SkillMeta[], disabled: readonly string[]): SkillMeta[];
/**
 * 解析输入框中显式指定的技能调用 `/skill <name> [其余指令]`。
 * 仅识别消息开头的前缀，避免误伤正文中出现的斜杠片段。
 * @param message 用户原始输入
 * @returns 命中返回技能名与剩余指令；未命中返回 null
 */
export declare function parseExplicitSkillInvocation(message: string): {
    skillName: string;
    rest: string;
} | null;
/**
 * 将技能正文包装为带明确边界的注入块（提示注入缓解，对齐设计 §10.2）。
 * 技能由用户本地安装，但仍以显式边界标注写入上下文，声明来源与范围。
 */
export declare function skillContextBlock(meta: SkillMeta, body: string): string;
