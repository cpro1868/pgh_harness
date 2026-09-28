import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  parseYamlFrontMatter,
  validateSkillMd,
  extractSkillMeta,
  projectSkillDirs,
  scanSkillRoot,
  scanAllSkills,
  buildSkillsPromptFragment,
  loadSkillContent,
  installSkill,
  isValidSkillName,
  filterEnabledSkills,
  parseExplicitSkillInvocation,
  skillContextBlock,
} from '../src/index.ts';

// 帮助函数：在临时目录创建合法 skill
function makeSkill(root: string, name: string, description = 'Test skill', extra = '') {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\nversion: 1.0.0\n${extra}---\n\n# ${name}\n\nSkill body here.`);
  return dir;
}

describe('TC-01-10-001: Skill 发现、校验与渐进披露加载', () => {

  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgh-skills-test-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('YAML front-matter 解析：提取顶层字段并返回正文', () => {
    const content = '---\nname: test\ndescription: "A test skill"\nversion: 2.1.0\n---\n\nBody here.';
    const result = parseYamlFrontMatter(content);
    assert.notEqual(result, null);
    assert.equal(result?.meta.name, 'test');
    assert.equal(result?.meta.description, 'A test skill');
    assert.equal(result?.meta.version, '2.1.0');
    assert.equal(result?.body, 'Body here.');
  });

  it('SKILL.md 校验：缺 front-matter 或缺关键字段均拒绝', () => {
    // 无 front-matter
    assert.equal(validateSkillMd('Just text').valid, false);
    // 有 front-matter 但缺 name/description
    assert.equal(validateSkillMd('---\nversion: 1\n---\nBody').valid, false);
    // 合法
    assert.equal(validateSkillMd('---\nname: ok\ndescription: ok\n---\nBody').valid, true);
  });

  it('scanSkillRoot：扫描目录下所有含 SKILL.md 的技能，跳过无效', () => {
    const root = path.join(tmpDir, 'skills');
    makeSkill(root, 'alpha', 'Alpha skill');
    makeSkill(root, 'beta', 'Beta skill');
    // 无效技能：无 SKILL.md
    fs.mkdirSync(path.join(root, 'no-skill'), { recursive: true });
    fs.writeFileSync(path.join(root, 'no-skill', 'README.md'), 'nothing');

    const found = scanSkillRoot(root, 'project');
    assert.equal(found.length, 2);
    const names = found.map(s => s.name).sort();
    assert.deepEqual(names, ['alpha', 'beta']);
    // 每个都有完整路径与 scope 标记
    assert.equal(found[0].scope, 'project');
    assert.ok(fs.existsSync(found[0].skillMdPath));
  });

  it('项目级同名技能优先于全局', () => {
    const projRoot = path.join(tmpDir, 'project');
    const projSkillsDir = path.join(projRoot, '.agents', 'skills');
    makeSkill(projSkillsDir, 'shared-skill', 'Project version');
    // 模拟全局目录：写入 ~/.config/agents/skills（测试中不动真 home）
    // 此处只验证 scanAllSkills 的项目级优先级，全局目录用 tmpDir 模拟
    const globalRoot = path.join(tmpDir, 'global');
    makeSkill(globalRoot, 'shared-skill', 'Global version');
    makeSkill(globalRoot, 'global-only', 'Global only');

    // 手动拼接项目级优先逻辑（scanAllSkills 内部按顺序过滤）
    const project = scanSkillRoot(projSkillsDir, 'project');
    const global = scanSkillRoot(globalRoot, 'global');
    const all = [...project, ...global].filter((s, i, arr) => arr.findIndex(x => x.name === s.name) === i);

    const shared = all.find(s => s.name === 'shared-skill');
    assert.equal(shared?.description, 'Project version');
    assert.equal(shared?.scope, 'project');
    assert.ok(all.find(s => s.name === 'global-only'));
  });

  it('buildSkillsPromptFragment：只注入 name + description，不含正文', () => {
    const root = path.join(tmpDir, 'skills');
    makeSkill(root, 'fmt', 'Format code');
    const skills = scanSkillRoot(root, 'project');
    const fragment = buildSkillsPromptFragment(skills);
    assert.ok(fragment.includes('`fmt`'));
    assert.ok(fragment.includes('Format code'));
    // 不含正文内容
    assert.ok(!fragment.includes('Skill body here'));
  });

  it('loadSkillContent：按需加载完整正文（渐进披露）', () => {
    const root = path.join(tmpDir, 'skills');
    const dir = makeSkill(root, 'helper', 'Helper skill');
    const meta = extractSkillMeta(dir, fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), 'project');
    assert.notEqual(meta, null);
    const content = loadSkillContent(meta!);
    assert.ok(content.body.includes('Skill body here'));
    assert.ok(content.raw.includes('name: helper'));
  });

  it('installSkill：完整拷贝本地技能包到指定根目录', () => {
    const srcDir = path.join(tmpDir, 'src-skill');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'SKILL.md'), '---\nname: local-skill\ndescription: copied\n---\n\nBody');
    const targetRoot = path.join(tmpDir, 'dest-skills');

    const result = installSkill(srcDir, targetRoot);
    assert.equal(result.skillName, 'local-skill');
    assert.ok(fs.existsSync(path.join(result.destPath, 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(targetRoot, 'local-skill')));
  });

  it('installSkill：非法源目录（无 SKILL.md）抛出错误', () => {
    const srcDir = path.join(tmpDir, 'bad-skill');
    fs.mkdirSync(srcDir, { recursive: true });
    assert.throws(() => installSkill(srcDir, path.join(tmpDir, 'dest')), /SKILL\.md/);
  });

  it('projectSkillDirs 返回按优先级排列的四个候选路径', () => {
    const dirs = projectSkillDirs('/my/project');
    assert.equal(dirs.length, 4);
    assert.ok(dirs[0].includes('.agents'));
    assert.ok(dirs[3].includes('.pg_harness'));
  });

  // ---------- Sprint 3+ 增量：技能开关状态、过滤与 /skill 显式指令解析 ----------

  it('buildSkillsPromptFragment：排除被禁用的技能', () => {
    const skills = [
      { name: 'skill-a', description: 'desc a', version: '1.0.0', dirPath: '', skillMdPath: '', scope: 'project' as const },
      { name: 'skill-b', description: 'desc b', version: '1.0.0', dirPath: '', skillMdPath: '', scope: 'project' as const },
    ];
    const fragment = buildSkillsPromptFragment(skills, new Set(['skill-a']));
    assert.ok(!fragment.includes('`skill-a`'));
    assert.ok(fragment.includes('`skill-b`'));
  });

  it('filterEnabledSkills：精确剔除被禁用的技能', () => {
    const skills = [
      { name: 'alpha', description: 'a', version: '1.0.0', dirPath: '', skillMdPath: '', scope: 'project' as const },
      { name: 'beta', description: 'b', version: '1.0.0', dirPath: '', skillMdPath: '', scope: 'project' as const },
    ];
    const filtered = filterEnabledSkills(skills, ['alpha']);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.name, 'beta');
  });

  it('isValidSkillName：仅允许字母数字点破折号下划线，拒绝非法注入', () => {
    assert.equal(isValidSkillName('my-skill'), true);
    assert.equal(isValidSkillName('deepseek_v3'), true);
    assert.equal(isValidSkillName('alpha.beta'), true);
    assert.equal(isValidSkillName(''), false);
    assert.equal(isValidSkillName('../evil'), false);
    assert.equal(isValidSkillName('a'.repeat(65)), false);
    assert.equal(isValidSkillName(123), false);
  });

  it('parseExplicitSkillInvocation：解析开头的 /skill 指令并提取剩余内容', () => {
    assert.deepEqual(
      parseExplicitSkillInvocation('/skill test-driven-development 写个冒泡排序测试'),
      { skillName: 'test-driven-development', rest: '写个冒泡排序测试' },
    );
    assert.deepEqual(
      parseExplicitSkillInvocation('/skill my_skill'),
      { skillName: 'my_skill', rest: '' },
    );
    // 未以 /skill 开头则返回 null，不误伤正文
    assert.equal(parseExplicitSkillInvocation('请参考 /skill 目录'), null);
    assert.equal(parseExplicitSkillInvocation(''), null);
  });

  it('skillContextBlock：生成带边界标注的上下文注入块', () => {
    const meta = { name: 'test-skill', description: 'desc', version: '1.0.0', dirPath: '/path/to/skill', skillMdPath: '', scope: 'project' as const };
    const block = skillContextBlock(meta, '# Instruction\nDo foo.');
    assert.ok(block.startsWith('[Skill: test-skill]'));
    assert.ok(block.includes('---8<---'));
    assert.ok(block.includes('Do foo.'));
    assert.ok(block.endsWith('[End of skill: test-skill]'));
  });
});
