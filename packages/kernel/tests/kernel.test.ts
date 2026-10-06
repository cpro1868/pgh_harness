import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, PluginDependencyMissingError } from '../src/index.ts';


test('TC-01-01-001: 微内核生命周期与 Fail-Fast 依赖缺失回滚验证', async (t) => {
  await t.test('插件A正常注册与启动', async () => {
    const ctx = new Context();
    
    ctx.plugin({
      name: 'plugin-a',
      provides: ['service.auth'],
      apply(c) {
        c.provide('service.auth', { token: 'mock-token-123' });
      },
    });

    await ctx.start();
    assert.equal(ctx.getService<{ token: string }>('service.auth')?.token, 'mock-token-123');
  });

  await t.test('插件B因缺少依赖触发 Fail-Fast 并原子回滚', async () => {
    const ctx = new Context();

    ctx.plugin({
      name: 'plugin-b',
      inject: ['service.database'],
      apply(c) {
        c.provide('service.repo', { ok: true });
      },
    });

    await assert.rejects(
      async () => {
        await ctx.start();
      },
      (err: unknown) => {
        assert.ok(err instanceof PluginDependencyMissingError);
        assert.equal((err as PluginDependencyMissingError).missingService, 'service.database');
        return true;
      }
    );

    // 验证回滚后脏服务未被污染
    assert.equal(ctx.getService('service.repo'), undefined);
  });
});
