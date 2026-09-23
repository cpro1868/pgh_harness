import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionGate } from '../src/permission-gate.ts';

describe('TC-01-05-003 权限闸门：规则优先级、预设与危险命令拦截', () => {
  it('readonly 预设：读取放行，一切写入与命令拒绝', () => {
    const gate = new PermissionGate({ preset: 'readonly' });
    assert.equal(gate.evaluate({ tool: 'read_file', args: { path: 'src/a.ts' } }).action, 'allow');
    assert.equal(gate.evaluate({ tool: 'glob', args: { pattern: '**/*.ts' } }).action, 'allow');
    assert.equal(gate.evaluate({ tool: 'grep', args: { pattern: 'foo' } }).action, 'allow');
    assert.equal(gate.evaluate({ tool: 'write_file', args: { path: 'a.ts' } }).action, 'deny');
    assert.equal(gate.evaluate({ tool: 'edit_file', args: { path: 'a.ts' } }).action, 'deny');
    assert.equal(gate.evaluate({ tool: 'bash', args: { command: 'ls' } }).action, 'deny');
  });

  it('edit 预设：读放行、写入与命令需审批', () => {
    const gate = new PermissionGate({ preset: 'edit' });
    assert.equal(gate.evaluate({ tool: 'read_file', args: { path: 'src/a.ts' } }).action, 'allow');
    assert.equal(gate.evaluate({ tool: 'write_file', args: { path: 'a.ts' } }).action, 'ask');
    assert.equal(gate.evaluate({ tool: 'edit_file', args: { path: 'a.ts' } }).action, 'ask');
    assert.equal(gate.evaluate({ tool: 'bash', args: { command: 'pnpm test' } }).action, 'ask');
  });

  it('full 预设：常规操作放行，但不可逆操作仍然拒绝', () => {
    const gate = new PermissionGate({ preset: 'full' });
    assert.equal(gate.evaluate({ tool: 'bash', args: { command: 'pnpm test' } }).action, 'allow');
    assert.equal(gate.evaluate({ tool: 'write_file', args: { path: 'a.ts' } }).action, 'allow');
    assert.equal(gate.evaluate({ tool: 'bash', args: { command: 'git push origin main' } }).action, 'deny');
    assert.equal(gate.evaluate({ tool: 'bash', args: { command: 'shutdown /s /t 0' } }).action, 'deny');
  });

  it('敏感凭据文件在任何预设下都被拒绝读取', () => {
    for (const preset of ['readonly', 'edit', 'full'] as const) {
      const gate = new PermissionGate({ preset });
      assert.equal(gate.evaluate({ tool: 'read_file', args: { path: '.env' } }).action, 'deny', `${preset} 应拒绝 .env`);
      assert.equal(gate.evaluate({ tool: 'read_file', args: { path: 'keys/server.pem' } }).action, 'deny', `${preset} 应拒绝 .pem`);
      assert.equal(gate.evaluate({ tool: 'read_file', args: { path: 'id_rsa' } }).action, 'deny', `${preset} 应拒绝私钥`);
    }
  });

  it('规则优先级：deny > ask > allow，与规则书写顺序无关', () => {
    const gate = new PermissionGate({
      preset: 'full',
      rules: [
        { tool: 'bash', pattern: 'git', action: 'allow' },
        { tool: 'bash', pattern: 'status', action: 'ask' },
        { tool: 'bash', pattern: 'git push', action: 'deny' },
      ],
    });
    // 同时命中 allow 与 deny → deny 胜出
    assert.equal(gate.evaluate({ tool: 'bash', args: { command: 'git push origin main' } }).action, 'deny');
    // 同时命中 allow 与 ask → ask 胜出
    assert.equal(gate.evaluate({ tool: 'bash', args: { command: 'git status' } }).action, 'ask');
    // 仅命中 allow
    assert.equal(gate.evaluate({ tool: 'bash', args: { command: 'git log' } }).action, 'allow');
    // 未命中任何规则 → 回落预设
    assert.equal(gate.evaluate({ tool: 'bash', args: { command: 'echo hi' } }).action, 'allow');
  });

  it('rules 可覆盖预设默认动作', () => {
    const gate = new PermissionGate({
      preset: 'edit',
      rules: [{ tool: 'bash', pattern: 'pnpm test', action: 'allow' }],
    });
    assert.equal(gate.evaluate({ tool: 'bash', args: { command: 'pnpm test' } }).action, 'allow');
    assert.equal(gate.evaluate({ tool: 'bash', args: { command: 'pnpm build' } }).action, 'ask');
  });

  it('工具名通配匹配（含 mcp__ 命名空间前缀，D66）', () => {
    const gate = new PermissionGate({
      preset: 'edit',
      rules: [{ tool: 'mcp__*', action: 'deny' }],
    });
    assert.equal(gate.evaluate({ tool: 'mcp__github__create_issue', args: {} }).action, 'deny');
    assert.equal(gate.evaluate({ tool: 'read_file', args: { path: 'a.ts' } }).action, 'allow');
  });

  it('决策携带可读原因与被命中的规则，便于审计与前端展示', () => {
    const gate = new PermissionGate({ preset: 'full' });
    const denied = gate.evaluate({ tool: 'bash', args: { command: 'git push' } });
    assert.equal(denied.action, 'deny');
    assert.ok(denied.reason.length > 0, '必须给出拒绝原因');
    assert.ok(denied.rule !== undefined, '应指出命中的规则');

    const allowed = gate.evaluate({ tool: 'read_file', args: { path: 'a.ts' } });
    assert.equal(allowed.action, 'allow');
    assert.ok(allowed.reason.includes('readonly') || allowed.reason.includes('edit') || allowed.reason.includes('full'));
  });

  it('未知工具默认需审批，不静默放行', () => {
    const gate = new PermissionGate({ preset: 'full' });
    assert.equal(gate.evaluate({ tool: 'unknown_tool', args: {} }).action, 'ask');
  });

  it('describe() 输出当前预设与生效规则，供设置页如实展示', () => {
    const gate = new PermissionGate({ preset: 'edit', rules: [{ tool: 'bash', pattern: 'ls', action: 'allow' }] });
    const described = gate.describe();
    assert.equal(described.preset, 'edit');
    assert.equal(described.rules.length, 1);
    assert.ok(described.hardDenies.length > 0, '必须暴露永远拒绝的危险操作清单');
  });
});
