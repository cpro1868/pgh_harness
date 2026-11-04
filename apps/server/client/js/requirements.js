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
      // 工作区下拉接真实数据（GET /api/workspaces）
      const wsSel = document.getElementById('new-req-workspace');
      if (wsSel) {
        wsSel.innerHTML = '<option value="">不绑定（后续可在工作区管理中选择）</option>';
        fetch('/api/workspaces').then((r) => r.json()).then((d) => {
          const list = d.data || [];
          for (const w of list) {
            const opt = document.createElement('option');
            opt.value = w.id;
            opt.textContent = `${w.name}（${w.path}）`;
            wsSel.appendChild(opt);
          }
          if (list.length === 0) {
            wsSel.innerHTML = '<option value="">暂无工作区——请先在【工作区管理与规则】中登记</option>';
          }
        }).catch(() => { wsSel.innerHTML = '<option value="">工作区加载失败</option>'; });
      }
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
        if (workspace) body.workspaceId = workspace;
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
            <button class="op-btn text-blue-400" title="编辑 Agent" onclick="reqEditAgent('${a.id}')">⚙️</button>
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

  // ═══ 模型资产下拉（GET /api/providers → 全部可用模型，option 携带 providerId） ═══
  async function loadModelOptions(selectedModelId) {
    const sel = document.getElementById('f-agent-model');
    if (!sel) return;
    sel.innerHTML = '<option value="">加载中…</option>';
    try {
      const d = await api.get('/api/providers');
      const providers = d.data || [];
      const options = [];
      for (const p of providers) {
        for (const m of p.models || []) {
          options.push({ providerId: p.id, providerName: p.name, modelId: m.id, label: `${m.id}（${p.name}）` });
        }
      }
      if (options.length === 0) {
        sel.innerHTML = '<option value="">暂无模型——请先在【模型与 Provider 资产池】配置并导入模型</option>';
        return;
      }
      sel.innerHTML = options.map((o) => `<option value="${escapeHtml(o.modelId)}" data-provider-id="${escapeHtml(o.providerId)}">${escapeHtml(o.label)}</option>`).join('');
      if (selectedModelId && selectedModelId !== 'default') {
        const hit = options.find((o) => o.modelId === selectedModelId);
        if (hit) sel.value = selectedModelId;
      }
      sel.dataset.loaded = '1';
    } catch (err) {
      sel.innerHTML = `<option value="">模型资产加载失败：${escapeHtml(err.message)}</option>`;
    }
  }

  window.reqToggleAgent = async function (id) {
    const agent = state.agents.find((a) => a.id === id);
    if (!agent) return;
    try {
      const resp = await api.send(`/api/requirements/${state.sessionId}/agents/${id}`, 'PATCH', { isEnabled: !agent.isEnabled });
      agent.isEnabled = resp.data.agent.isEnabled;
      renderAgents();
      toast(agent.isEnabled ? `「${agent.name}」已启用` : `「${agent.name}」已停用`);
    } catch (err) { toast(err.message, true); }
  };

  let editingAgentId = null;
  window.reqEditAgent = function (id) {
    const agent = state.agents.find((a) => a.id === id);
    if (!agent) return;
    editingAgentId = id;
    document.getElementById('agent-modal-title').textContent = '编辑 Agent';
    document.getElementById('f-agent-name').value = agent.name;
    document.getElementById('f-agent-role').value = agent.roleTitle;
    document.getElementById('f-agent-prompt').value = agent.systemPrompt || '';
    loadModelOptions(agent.modelId);
    document.getElementById('modal-agent').classList.remove('hidden');
  };
  window.reqNewAgent = function () {
    editingAgentId = null;
    document.getElementById('agent-modal-title').textContent = '新建 Agent';
    document.getElementById('f-agent-name').value = '';
    document.getElementById('f-agent-role').value = '';
    document.getElementById('f-agent-prompt').value = '';
    loadModelOptions('');
    document.getElementById('modal-agent').classList.remove('hidden');
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
    state.messages = resp.data.messages.map((m) => ({
      ...m,
      proposal_json: typeof m.proposal_json === 'string' && m.proposal_json ? JSON.parse(m.proposal_json) : (m.proposal_json || null),
      agent_name: (state.agents.find((a) => a.id === m.agent_id) || {}).name,
    }));
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

  // ═══ 弹窗保存与导出（真实现） ═══
  window.reqSaveAgent = async function () {
    const name = document.getElementById('f-agent-name')?.value.trim();
    const role = document.getElementById('f-agent-role')?.value.trim() || name;
    const modelSel = document.getElementById('f-agent-model');
    const modelId = modelSel?.value || '';
    const providerId = modelSel?.selectedOptions?.[0]?.getAttribute('data-provider-id') || 'default';
    const prompt = document.getElementById('f-agent-prompt')?.value || '';
    if (!name) { toast('请填写 Agent 名称', true); return; }
    if (!modelId) { toast('请选择模型——若列表为空请先在【模型与 Provider 资产池】配置', true); return; }
    try {
      if (editingAgentId) {
        await api.send(`/api/requirements/${state.sessionId}/agents/${editingAgentId}`, 'PATCH', { name, roleTitle: role, modelId, providerId, systemPrompt: prompt });
        toast('Agent 已更新');
      } else {
        await api.send(`/api/requirements/${state.sessionId}/agents`, 'POST', { name, roleTitle: role, modelId, providerId, systemPrompt: prompt });
        toast('Agent 已创建');
      }
      state.agents = (await api.get(`/api/requirements/${state.sessionId}`)).data.agents;
      renderAgents();
    } catch (err) { toast(err.message, true); }
  };
  window.reqDeleteCurrentAgent = function () {
    const card = document.querySelector('#agent-list .agent-card');
    const aid = card?.getAttribute('data-agent-id');
    if (aid) reqDelAgent(aid);
  };
  window.reqDelCurrentAgent = window.reqDeleteCurrentAgent;
  window.reqSaveChunk = async function () {
    const title = document.getElementById('f-chunk-name')?.value.trim();
    const desc = document.getElementById('f-chunk-desc')?.value.trim() || '';
    const priority = document.getElementById('f-chunk-priority')?.value || 'P1';
    if (!title) { toast('请填写分块名称', true); return; }
    try {
      await api.send(`/api/requirements/${state.sessionId}/chunks`, 'POST', { title, description: desc, priority });
      await refreshSnapshot();
      toast('分块已创建');
    } catch (err) { toast(err.message, true); }
  };
  window.reqDeleteCurrentChunk = function () { toast('请在分块树上使用 🗑 按钮删除目标分块', true); };
  window.reqDelCurrentChunk = window.reqDeleteCurrentChunk;
  window.reqSaveTask = async function () {
    toast('任务由 Agent 提议采纳自动生成（保证仅叶子分块挂任务的约束）', true);
  };
  window.reqDeleteCurrentTask = function () { /* 任务删除按钮直接处理 */ };

  window.reqExportChunks = function () {
    try {
      const lines = ['# 需求分块树导出', ''];
      const walk = (nodes, depth) => nodes.forEach((n) => {
        lines.push(`${'  '.repeat(depth)}- [${n.status}/${n.priority}] ${n.title}${n.description ? ' — ' + n.description : ''}`);
        n.tasks.forEach((t) => lines.push(`${'  '.repeat(depth + 1)}· 任务: ${t.title}${t.acceptanceCriteria ? '（验收: ' + t.acceptanceCriteria + '）' : ''}`));
        walk(n.children, depth + 1);
      });
      walk(state.chunkTree, 0);
      const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'requirements-chunks.md';
      a.click();
      URL.revokeObjectURL(a.href);
      toast('分块树已导出');
    } catch (err) { toast(err.message, true); }
  };

  window.downloadPrd = async function () {
    try {
      const resp = await api.get(`/api/requirements/${state.sessionId}/prd`);
      const blob = new Blob([resp.data.markdownContent], { type: 'text/markdown' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `PRD-v${resp.data.version}.md`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('PRD 已导出');
    } catch (err) { toast(err.message, true); }
  };
  window.prdRetryFailed = function () { toast('失败章节可在生成完成后于结果列表中重试', true); };

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
