import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.resolve(here, '../client/run-chat.html'), 'utf8');
const script = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');

describe('TC-01-13-003: 权限审批挂起醒目化（杜绝"卡在调度中"误判）', () => {
  it('收到 approval-request 时：调度 pulse 必须被替换为等待授权状态', () => {
    // approval-request 分支内必须调用 setWaitingApproval（替换"正在调度"脉冲文案）
    const branch = html.match(/eventType === 'approval-request'[\s\S]{0,400}/)?.[0] ?? '';
    assert.ok(branch.includes('setWaitingApproval'), 'approval-request 分支必须调用 setWaitingApproval 更新卡片状态');
    assert.ok(typeof html.match(/function setWaitingApproval/)?.[0] === 'string', '必须定义 setWaitingApproval');
  });

  it('顶栏必须有审批等待徽标（闪烁），审批解决后移除', () => {
    assert.ok(html.includes('id="approval-waiting-badge"'), '顶栏必须存在 approval-waiting-badge 徽标元素');
    assert.ok(script.includes('showApprovalWaitingBadge'), '必须定义 showApprovalWaitingBadge');
    assert.ok(script.includes('hideApprovalWaitingBadge'), '必须定义 hideApprovalWaitingBadge');
  });

  it('审批解决（resolved/超时）后徽标必须移除', () => {
    // 回合 finally + 重放 approval/resolved 两条路径都要 hide
    const resolvedCount = (script.match(/hideApprovalWaitingBadge\(\)/g) ?? []).length;
    assert.ok(resolvedCount >= 2, `审批解决路径必须移除徽标，实测 ${resolvedCount} 处`);
  });

  it('长期订阅收到新事件必须触发增量重放渲染（刷新后状态及时刷新）', () => {
    // openSessionStream 的事件循环内不得只更新 seq——必须有重放渲染调用（窗口法，避免脆弱的函数体正则）
    const start = html.indexOf('async function openSessionStream()');
    const streamFn = html.slice(start, start + 9000);
    assert.ok(streamFn.length > 100, 'openSessionStream 必须存在');
    assert.ok(
      /renderConversation|scheduleLiveReplay|refreshConversation/.test(streamFn),
      '长期订阅事件循环必须触发增量重放渲染（否则刷新后新事件 UI 全部丢失）',
    );
  });

  it('重放渲染必须联动审批徽标（groupTurns 后徽标与 pending 状态一致）', () => {
    const start = html.indexOf('function renderConversation(events)');
    const renderFn = html.slice(start, start + 8000);
    assert.ok(renderFn.length > 100, 'renderConversation 必须存在');
    assert.ok(
      renderFn.includes('showApprovalWaitingBadge') || renderFn.includes('hideApprovalWaitingBadge'),
      'renderConversation 必须按 pending 审批状态同步徽标',
    );
  });

  it('刷新/切会话时必须按服务端 state 恢复运行态 UI（Abort 按钮可用）', () => {
    // switchSession 必须读取会话 state，running 则 setRunningState(true)
    const start = html.indexOf('async function switchSession(sessionId)');
    const fn = html.slice(start, start + 4000);
    assert.ok(fn.length > 100, 'switchSession 必须存在');
    assert.ok(/state\s*===?\s*['"]running['"]|setRunningState/.test(fn), 'switchSession 必须按服务端 state 恢复运行态（否则刷新后无法停止后台回合）');
  });

  it('运行中回合的完成轮询：运行态恢复后必须轮询直至 idle 退回发送按钮', () => {
    assert.ok(script.includes('startRunningTurnPoller') && script.includes('stopRunningTurnPoller'), '必须存在运行中回合的完成轮询机制');
  });

  it('审批卡片渲染时必须自动滚动到可见（scrollMessagesToBottom）', () => {
    // 分支调用 setWaitingApproval(card)，滚动逻辑在该函数体内
    const fn = html.match(/function setWaitingApproval\(card\)[\s\S]*?\n {4}\}/)?.[0] ?? '';
    assert.ok(fn.includes('scrollMessagesToBottom(true)'), 'setWaitingApproval 必须强制滚动到审批卡可见');
  });

  it('审批超时拒绝的结果必须附带改道指引（勿反复撞墙）', () => {
    const src = fs.readFileSync(path.resolve(here, '../src/index.ts'), 'utf8');
    // 超时文案在 packages/core/src/approval-broker.ts，此处断言服务端引用链与指引文案存在
    const broker = fs.readFileSync(path.resolve(here, '../../../packages/core/src/approval-broker.ts'), 'utf8');
    assert.ok(broker.includes('审批超过'), '审批超时文案必须存在');
    assert.ok(broker.includes('改道指引'), '超时拒绝必须附带改道指引');
    assert.ok(broker.includes('请改用只读方式'), '指引必须建议改用只读方式');
    assert.ok(broker.includes('ask_user'), '指引必须建议 ask_user 询问用户');
    // 服务端确实挂载了 ApprovalBroker（超时拒绝生效路径）
    assert.ok(src.includes('ApprovalBroker'), '服务端必须挂载 ApprovalBroker');
  });
});


