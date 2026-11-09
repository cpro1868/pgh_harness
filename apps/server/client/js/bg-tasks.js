/* 后台任务中心：跨页面任务状态汇总与跳转（localStorage 持久化 + 轮询刷新） */
(function () {
  'use strict';

  const STORE_KEY = 'pgh_bg_tasks';
  const PAGE_MAP = {
    pipeline: 'run-pipeline.html',
    workflow: 'run-workflow.html',
    chat: 'run-chat.html',
    requirements: 'run-requirements-workbench.html',
    prd: 'run-requirements-workbench.html',
    terminal: 'run-terminal.html',
  };

  function loadTasks() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { return []; }
  }
  function saveTasks(tasks) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(tasks)); } catch { /* ignore */ }
  }

  /** 供其他页面注册/更新后台任务（挂到 window 供跨页脚本调用） */
  window.bgTaskUpsert = function (task) {
    if (!task || !task.id || !task.type) return;
    const tasks = loadTasks();
    const idx = tasks.findIndex((t) => t.id === task.id);
    const now = Date.now();
    if (idx >= 0) {
      tasks[idx] = { ...tasks[idx], ...task, updatedAt: now };
    } else {
      tasks.unshift({ status: 'running', createdAt: now, updatedAt: now, ...task });
    }
    // 上限 30 条，过期的 completed/failed 3 小时后清除
    const cleaned = tasks.filter((t) => {
      if (t.status === 'running') return true;
      return now - (t.updatedAt || 0) < 3 * 3600 * 1000;
    }).slice(0, 30);
    saveTasks(cleaned);
    render();
  };

  window.bgTaskRemove = function (id) {
    saveTasks(loadTasks().filter((t) => t.id !== id));
    render();
  };

  function statusBadge(status) {
    if (status === 'running') return '<span class="pill flex items-center" style="background:rgba(59,130,246,.15);color:#93c5fd"><span class="running-dot w-1.5 h-1.5 rounded-full bg-blue-400 mr-1"></span>运行中</span>';
    if (status === 'completed') return '<span class="pill" style="background:rgba(16,185,129,.15);color:#6ee7b7">✓ 已完成</span>';
    if (status === 'failed') return '<span class="pill" style="background:rgba(244,63,94,.15);color:#fda4af">✕ 失败</span>';
    return `<span class="pill" style="background:rgba(100,116,139,.2);color:#cbd5e1">${status}</span>`;
  }

  function render() {
    const listEl = document.getElementById('bg-task-list');
    const badge = document.getElementById('bg-task-badge');
    if (!listEl) return;
    const tasks = loadTasks();
    const running = tasks.filter((t) => t.status === 'running').length;
    if (badge) {
      badge.textContent = String(running);
      badge.classList.toggle('hidden', running === 0);
    }
    if (tasks.length === 0) {
      listEl.innerHTML = '<div class="text-center py-6 text-[11px] text-slate-600">暂无后台任务<br><span class="text-[10px]">流水线、PRD 生成等长任务会自动出现在这里</span></div>';
      return;
    }
    listEl.innerHTML = tasks.map((t) => {
      const page = PAGE_MAP[t.type] || 'run-chat.html';
      const duration = Math.max(0, Math.round(((t.updatedAt || Date.now()) - (t.createdAt || Date.now())) / 1000));
      const durText = duration > 60 ? `${Math.floor(duration / 60)}m${duration % 60}s` : `${duration}s`;
      return `<div class="bg-task-item rounded-lg bg-[#0c1220] border border-slate-800 p-2.5" onclick="location.href='${page}?id=${t.sessionId || ''}'">
        <div class="flex items-center justify-between mb-1">
          <span class="text-[11px] font-semibold text-slate-200 truncate">${t.title || t.id}</span>
          ${statusBadge(t.status)}
        </div>
        ${t.detail ? `<div class="text-[10px] text-slate-500 truncate mb-1">${t.detail}</div>` : ''}
        <div class="flex items-center justify-between text-[9px] text-slate-600 font-mono">
          <span>${t.type} · ${durText}</span>
          ${t.status !== 'running' ? `<button onclick="event.stopPropagation(); bgTaskRemove('${t.id}')" class="hover:text-slate-400">✕ 清除</button>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  function toggle() {
    const popup = document.getElementById('bg-task-popup');
    if (!popup) return;
    popup.classList.toggle('hidden');
    if (!popup.classList.contains('hidden')) render();
  }
  window.toggleBgTasks = toggle;
  window.renderBgTasks = render;

  // 定时刷新运行时长
  setInterval(() => {
    const popup = document.getElementById('bg-task-popup');
    if (popup && !popup.classList.contains('hidden')) render();
  }, 5000);

  document.addEventListener('DOMContentLoaded', render);
})();
