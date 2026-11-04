/* MOD-17 需求探索与分块管理 —— 前端共享控制器（原生 JS，IIFE） */
(function () {
  'use strict';

  // ═══ api ═══
  const api = {
    async get(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    async send(url, method, body) {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
      return data;
    },
  };

  // ═══ 安全渲染 ═══
  function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toast(msg, isError) {
    const box = document.createElement('div');
    box.textContent = msg;
    box.style.cssText = 'position:fixed;bottom:24px;right:24px;padding:10px 16px;border-radius:8px;font-size:12px;z-index:9999;'
      + (isError ? 'background:#7f1d1d;color:#fecaca;' : 'background:#064e3b;color:#a7f3d0;');
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 3200);
  }

  // ═══ 会话状态 ═══
  const state = {
    sessionId: null,
    session: null,
    agents: [],
    messages: [],
    chunkTree: [],
    suggestions: [],
  };

  // ═══ 列表页逻辑 ═══
  function initListPage() {
    const listEl = document.getElementById('session-list');
    if (!listEl) return;

    let currentFilter = 'all';

    function applyFilter() {
      const q = (document.getElementById('search-input')?.value || '').trim().toLowerCase();
      const clearBtn = document.getElementById('clear-search');
      if (clearBtn) clearBtn.classList.toggle('hidden', !q);
      let visible = 0;
      document.querySelectorAll('#session-list .req-card').forEach((card) => {
        const status = card.getAttribute('data-status');
        const text = card.textContent.toLowerCase();
        const ok = (currentFilter === 'all' || status === currentFilter) && (!q || text.includes(q));
        card.classList.toggle('hidden', !ok);
        if (ok) visible += 1;
      });
      const empty = document.getElementById('empty-state');
      if (empty) empty.classList.toggle('hidden', visible > 0);
      const count = document.getElementById('count-all');
      if (count) count.textContent = String(document.querySelectorAll('#session-list .req-card').length);
    }

    window.applyFilter = applyFilter;
    window.clearSearch = function () {
      const input = document.getElementById('search-input');
      if (input) input.value = '';
      applyFilter();
    };
    window.clearFilter = function () {
      window.clearSearch();
      const allBtn = document.querySelector('.filter-btn[data-status="all"]');
      if (allBtn) window.setStatusFilter('all', allBtn);
    };
    window.setStatusFilter = function (status, btn) {
      currentFilter = status;
      document.querySelectorAll('.filter-btn').forEach((b) => {
        b.classList.remove('active', 'bg-blue-600', 'text-white');
        b.classList.add('text-slate-400', 'bg-slate-800/60');
      });
      btn.classList.add('active', 'bg-blue-600', 'text-white');
      btn.classList.remove('text-slate-400', 'bg-slate-800/60');
      applyFilter();
    };

    window.openCreateModal = function () {
      document.getElementById('modal-create')?.classList.remove('hidden');
      const name = document.getElementById('new-req-name');
      if (name) name.focus();
    };
    window.closeCreateModal = function () {
      document.getElementById('modal-create')?.classList.add('hidden');
    };
    window.createSession = async function () {
      const name = document.getElementById('new-req-name')?.value.trim() || '';
      const prompt = document.getElementById('new-req-prompt')?.value.trim() || '';
      const workspace = document.getElementById('new-req-workspace')?.value || '';
      if (!prompt) { toast('请填写一句话想法/初始痛点描述', true); return; }
      try {
        const body = { initialPrompt: prompt };
        if (name) body.title = name;
        if (workspace && workspace !== 'default') body.workspaceId = workspace;
        const resp = await api.send('/api/requirements', 'POST', body);
        toast('会话已创建，正在进入工作台…');
        setTimeout(() => { window.location.href = `run-requirements-workbench.html?id=${resp.data.session.id}`; }, 500);
      } catch (err) {
        toast(err.message, true);
      }
    };

    // 加载真实会话渲染卡片
    (async function loadSessions() {
      try {
        const resp = await api.get('/api/requirements');
        const { sessions, stats } = resp.data;
        document.getElementById('stat-total').innerHTML = `${stats.total} <span class="text-xs text-slate-500 font-normal">个项目</span>`;
        document.getElementById('stat-discussing').innerHTML = `${stats.discussing} <span class="text-xs text-slate-500 font-normal">Active</span>`;
        document.getElementById('stat-done').innerHTML = `${stats.prdReady} <span class="text-xs text-slate-500 font-normal">PRD Ready</span>`;
        document.getElementById('stat-draft').innerHTML = `${stats.draft} <span class="text-xs text-slate-500 font-normal">Draft</span>`;

        const cards = sessions.map((s) => {
          const statusLabel = s.status === 'discussing' ? '<span class="phase-pill bg-blue-950/80 text-blue-300 border border-blue-800/60 flex items-center"><span class="w-1.5 h-1.5 rounded-full bg-blue-400 mr-1.5 animate-pulse"></span>讨论中</span>'
            : s.status === 'prd_ready' ? '<span class="phase-pill bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 flex items-center"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5"></span>✓ PRD 已就绪</span>'
              : s.status === 'transitioned' ? '<span class="phase-pill bg-violet-950/80 text-violet-400 border border-violet-800/60">🚀 已流转</span>'
                : '<span class="phase-pill bg-slate-800 text-slate-400 border border-slate-700">草稿</span>';
          return `<div class="req-card rounded-xl bg-[#0f1523] border border-slate-800 p-5 shadow-sm space-y-3" data-status="${s.status === 'transitioned' ? 'prd_ready' : s.status}" onclick="location.href='run-requirements-workbench.html?id=${s.id}'">
            <div class="flex items-start justify-between"><div class="space-y-1">
              <div class="flex items-center space-x-2.5"><span class="text-sm font-bold text-white">${escapeHtml(s.title)}</span>${statusLabel}<span class="text-[10px] text-slate-500 font-mono">${s.id}</span></div>
              <p class="text-xs text-slate-400 leading-relaxed max-w-3xl">${escapeHtml(s.initialPrompt)}</p>
            </div>
            <div class="flex items-center space-x-2 shrink-0"><span class="text-[10px] text-slate-500 font-mono">${new Date(s.updatedAt).toLocaleString()}</span>
            <button class="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow">进入工作台 →</button></div></div>
            <div class="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
              <div class="flex items-center space-x-4 font-mono text-[11px] text-slate-400"><span>状态: ${s.status}</span></div></div></div>`;
        });
        // 保留原型静态卡片之后追加真实会话（若原型卡片存在则替换整区）
        const existing = listEl.querySelectorAll('.req-card[data-static]');
        if (existing.length === 0) {
          listEl.innerHTML = cards.join('') || '';
        } else {
          listEl.insertAdjacentHTML('beforeend', cards.join(''));
        }
        applyFilter();
      } catch (err) {
        toast('加载会话列表失败: ' + err.message, true);
      }
    })();
  }

  // ═══ 工作台逻辑 ═══
  function renderAgents() {
    const el = document.getElementById('agent-list');
    if (!el) return;
    el.innerHTML = state.agents.map((a) => `
      <div class="agent-card ${a.isEnabled ? '' : 'off'} rounded-lg bg-[#0f1523] border border-slate-800 p-2.5" data-agent-id="${a.id}">
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-2 min-w-0">
            <span class="agent-avatar bg-blue-600/20 text-blue-300">${escapeHtml(a.name.slice(0, 1))}</span>
            <div class="min-w-0"><div class="text-[11px] font-semibold text-slate-200 truncate">${escapeHtml(a.name)}</div>
            <div class="text-[9px] text-slate-500 truncate">${escapeHtml(a.roleTitle)}</div></div>
          </div>
          <div class="flex items-center space-x-1">
            <button class="op-btn text-slate-500" title="删除 Agent" onclick="reqDelAgent('${a.id}')">🗑</button>
            <div class="agent-toggle ${a.isEnabled ? 'on' : 'off'}" onclick="reqToggleAgent('${a.id}')"><div class="knob"></div></div>
          </div>
        </div>
      </div>`).join('');
  }

  function renderMessages() {
    const el = document.getElementById('chat-messages');
    if (!el) return;
    el.innerHTML = state.messages.map((m) => {
      const isUser = m.role === 'user';
      const isSystem = m.role === 'system';
      const proposalCard = m.proposal_json && m.proposal_state === 'pending'
        ? `<div class="mt-2 rounded-lg bg-[#080d1a] border border-blue-800/50 p-2.5 text-[11px]">
            <div class="text-blue-300 font-semibold mb-1">💡 Agent 提议（待确认）</div>
            <pre class="text-[10px] text-slate-400 whitespace-pre-wrap">${escapeHtml(JSON.stringify(m.proposal_json, null, 2))}</pre>
            <div class="flex space-x-1.5 mt-2">
              <button class="px-2 py-1 rounded bg-blue-600 text-white text-[10px]" onclick="reqAcceptProposal('${m.id}')">✓ 采纳落盘</button>
              <button class="px-2 py-1 rounded bg-slate-800 text-slate-400 text-[10px]" onclick="reqDismissProposal('${m.id}')">✕ 忽略</button>
            </div></div>`
        : '';
      const noticeStyle = isSystem ? 'bg-amber-950/40 border-amber-800/50 text-amber-200' : isUser ? 'bg-blue-950/40 border-blue-800/40' : 'bg-[#0f1523] border-slate-800';
      return `<div class="chat-msg rounded-lg border ${noticeStyle} p-3">
        <div class="flex items-center space-x-1.5 mb-1.5">
          <span class="text-[10px] font-bold ${isUser ? 'text-blue-300' : isSystem ? 'text-amber-300' : 'text-emerald-300'}">${isUser ? '👤 我' : isSystem ? '⚙️ 系统' : `🤖 ${escapeHtml(m.agent_name || 'Agent')}`}</span>
          <span class="text-[9px] text-slate-600 font-mono">${new Date(m.created_at).toLocaleTimeString()}</span>
        </div>
        <div class="text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap">${escapeHtml(m.content)}</div>
        ${proposalCard}</div>`;
    }).join('');
    el.scrollTop = el.scrollHeight;
  }

  function renderChunkTree() {
    const el = document.getElementById('chunk-tree-live');
    if (!el) return;
    function renderNodes(nodes, depth) {
      return nodes.map((n) => {
        const statusColor = { draft: 'text-slate-400', discussed: 'text-blue-400', analyzed: 'text-violet-400', approved: 'text-emerald-400' }[n.status] || 'text-slate-400';
        const taskHtml = n.tasks.map((t) => `
          <div class="task-card ${t.status} rounded bg-[#080d1a] border border-slate-800 px-2 py-1.5" style="margin-left:12px">
            <div class="text-[10px] text-slate-300">${escapeHtml(t.title)}</div>
            ${t.acceptanceCriteria ? `<div class="text-[9px] text-slate-600 mt-0.5">验收: ${escapeHtml(t.acceptanceCriteria)}</div>` : ''}
          </div>`).join('');
        return `<div class="chunk-node rounded px-2 py-1" style="margin-left:${depth * 10}px">
          <div class="flex items-center justify-between">
            <span class="text-[11px] ${depth === 0 ? 'font-semibold text-slate-200' : 'text-slate-300'}">${escapeHtml(n.title)}</span>
            <span class="${statusColor} text-[9px]">${n.status} · ${n.priority}</span>
          </div>
          ${n.description ? `<div class="text-[9px] text-slate-600 mt-0.5">${escapeHtml(n.description)}</div>` : ''}
          ${renderNodes(n.children, depth + 1)}
          ${taskHtml}</div>`;
      }).join('');
    }
    el.innerHTML = renderNodes(state.chunkTree, 0) || '<div class="text-[10px] text-slate-600 text-center py-8">暂无分块——在讨论中采纳 Agent 提议后自动生成</div>';
  }

  function renderSuggestions() {
    const el = document.getElementById('suggestion-list');
    if (!el) return;
    const active = state.suggestions.filter((s) => !s.isDismissed);
    el.innerHTML = active.length === 0
      ? '<div class="text-[10px] text-slate-600 text-center py-6">暂无建议——继续讨论后 Agent 会主动推荐</div>'
      : active.map((s) => `
        <div class="next-step-card rounded-lg bg-[#0f1523] border border-slate-800 p-2.5" onclick="reqRunSuggestion(this)" data-content="${escapeHtml(s.content)}">
          <div class="text-[11px] text-slate-300 leading-snug">${escapeHtml(s.content)}</div>
          <div class="text-[9px] text-slate-600 mt-1">${escapeHtml(s.sourceReason)}</div>
        </div>`).join('');
  }

  window.reqRunSuggestion = function (card) {
    const input = document.getElementById('chat-input');
    if (!input) return;
    input.value = card.getAttribute('data-content');
    input.focus();
    card.style.opacity = '.4';
    window.reqSend();
  };

  window.reqToggleAgent = async function (id) {
    const agent = state.agents.find((a) => a.id === id);
    if (!agent) return;
    agent.isEnabled = !agent.isEnabled;
    renderAgents();
  };

  window.reqDelAgent = function (id) {
    if (!confirm('确认删除该 Agent？')) return;
    api.send(`/api/requirements/${state.sessionId}/agents/${id}`, 'DELETE')
      .then(() => { state.agents = state.agents.filter((a) => a.id !== id); renderAgents(); toast('Agent 已删除'); })
      .catch((err) => toast(err.message, true));
  };

  window.reqAcceptProposal = async function (messageId) {
    const msg = state.messages.find((m) => m.id === messageId);
    if (!msg || !msg.proposal_json) return;
    try {
      await api.send(`/api/requirements/${state.sessionId}/proposals/${messageId}/accept`, 'POST', { proposal: msg.proposal_json });
      msg.proposal_state = 'accepted';
      await refreshSnapshot();
      toast('提议已采纳落盘');
    } catch (err) { toast(err.message, true); }
  };

  window.reqDismissProposal = async function (messageId) {
    try {
      await api.send(`/api/requirements/${state.sessionId}/proposals/${messageId}/dismiss`, 'POST', {});
      const msg = state.messages.find((m) => m.id === messageId);
      if (msg) msg.proposal_state = 'dismissed';
      renderMessages();
      toast('已忽略该提议');
    } catch (err) { toast(err.message, true); }
  };

  async function refreshSnapshot() {
    const resp = await api.get(`/api/requirements/${state.sessionId}`);
    state.session = resp.data.session;
    state.agents = resp.data.agents;
    state.messages = resp.data.messages;
    state.chunkTree = resp.data.chunkTree;
    state.suggestions = resp.data.suggestions;
    renderAgents();
    renderMessages();
    renderChunkTree();
    renderSuggestions();
  }

  window.reqSend = async function () {
    const input = document.getElementById('chat-input');
    if (!input || !input.value.trim() || !state.sessionId) return;
    const content = input.value.trim();
    input.value = '';
    // 本地先渲染用户消息
    state.messages.push({ id: `local_${Date.now()}`, role: 'user', content, created_at: Date.now() });
    renderMessages();
    try {
      // SSE 读取研讨回合
      const resp = await fetch(`/api/requirements/${state.sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'done') continue;
          } catch { /* ignore parse error */ }
        }
      }
      await refreshSnapshot();
    } catch (err) {
      toast('研讨回合失败: ' + err.message, true);
      await refreshSnapshot();
    }
  };

  // ═══ PRD 生成弹层 ═══
  window.openPrdModal = async function () {
    document.getElementById('modal-prd')?.classList.remove('hidden');
    document.getElementById('prd-config')?.classList.remove('hidden');
    document.getElementById('prd-progress')?.classList.add('hidden');
    document.getElementById('prd-result')?.classList.add('hidden');
    try {
      const resp = await api.get('/api/prd-templates');
      const sel = document.getElementById('prd-template');
      if (sel) {
        sel.innerHTML = resp.data.templates
          .map((t) => `<option value="${t.id}">${t.isDefault ? '⭐' : ''}${t.isBuiltin ? ' 📌' : ''} ${escapeHtml(t.name)}（${t.sections.length} 章节）</option>`)
          .join('');
      }
      const chunkCount = (function c(nodes) { return nodes.reduce((a, n) => a + 1 + c(n.children), 0); })(state.chunkTree);
      const fastCard = document.getElementById('fast-mode-card');
      if (fastCard) {
        fastCard.classList.toggle('opacity-50', chunkCount > 5);
        const radio = fastCard.querySelector('input');
        if (radio) radio.disabled = chunkCount > 5;
      }
    } catch (err) { toast(err.message, true); }
  };

  window.startPrdGenerate = async function () {
    const templateId = document.getElementById('prd-template')?.value;
    const mode = document.querySelector('input[name="prd-mode"]:checked')?.value || 'section';
    document.getElementById('prd-config')?.classList.add('hidden');
    const progress = document.getElementById('prd-progress');
    progress?.classList.remove('hidden');
    const listEl = progress?.querySelector('.space-y-1\\.5') || progress;
    try {
      const resp = await fetch(`/api/requirements/${state.sessionId}/prd/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId, mode }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${resp.status}`);
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let lastVersion = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'section_start' && listEl) {
              listEl.insertAdjacentHTML('beforeend', `<div class="flex items-center space-x-2 px-3 py-2 rounded bg-[#0c1220] border border-blue-500/40 prd-row"><span class="progress-dot bg-blue-500 animate-pulse"></span><span class="text-xs text-blue-300 flex-1">${escapeHtml(evt.title)}</span><span class="text-[10px] text-blue-400">生成中…</span></div>`);
            } else if (evt.type === 'section_done') {
              const row = listEl?.querySelectorAll('.prd-row');
              if (row && row.length > 0) {
                const last = row[row.length - 1];
                last.querySelector('.progress-dot').className = 'progress-dot bg-emerald-500';
                last.querySelector('.text-\\[10px\\]').textContent = '✓ 完成';
              }
            } else if (evt.type === 'section_error') {
              const row = listEl?.querySelectorAll('.prd-row');
              if (row && row.length > 0) {
                const last = row[row.length - 1];
                last.querySelector('.progress-dot').className = 'progress-dot bg-rose-500';
                last.querySelector('.text-\\[10px\\]').textContent = '✕ 失败';
              }
            } else if (evt.type === 'prd_done') {
              lastVersion = evt.version;
            }
          } catch { /* ignore */ }
        }
      }
      toast(`PRD V${lastVersion} 已生成`);
      showPrdResult(lastVersion);
    } catch (err) {
      toast(err.message, true);
      document.getElementById('prd-config')?.classList.remove('hidden');
      progress?.classList.add('hidden');
    }
  };

  function showPrdResult(version) {
    document.getElementById('prd-progress')?.classList.add('hidden');
    const result = document.getElementById('prd-result');
    result?.classList.remove('hidden');
    const label = result?.querySelector('.text-emerald-400');
    if (label) label.textContent = `✓ PRD 已生成（V${version}）`;
  }
  window.showPrdResult = showPrdResult;

  window.copyPrd = async function () {
    try {
      const resp = await api.get(`/api/requirements/${state.sessionId}/prd`);
      await navigator.clipboard.writeText(resp.data.markdownContent);
      toast('PRD 全文已复制');
    } catch (err) { toast(err.message, true); }
  };

  // ═══ 启动 ═══
  document.addEventListener('DOMContentLoaded', () => {
    initListPage();
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('id');
    if (sessionId && document.getElementById('chat-messages')) {
      state.sessionId = sessionId;
      refreshSnapshot().catch((err) => toast('加载工作台失败: ' + err.message, true));
      const input = document.getElementById('chat-input');
      if (input) {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.reqSend(); }
        });
      }
    }
  });
})();
