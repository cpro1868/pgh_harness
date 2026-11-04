/* MOD-17 PRD 模板库 —— 前端控制器（原生 JS，IIFE） */
(function () {
  'use strict';

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

  const tplState = { templates: [], current: null, dirty: false };

  function renderCards() {
    const list = document.getElementById('tpl-list');
    if (!list) return;
    list.innerHTML = tplState.templates.map((t) => `
      <div class="tpl-card p-5 rounded-xl bg-[#0f1523] ${t.isDefault ? 'border-2 border-blue-500/50 shadow-lg' : 'border border-slate-800 shadow'} space-y-3" data-tpl-id="${t.id}">
        <div class="flex items-start justify-between">
          <div class="space-y-1">
            <div class="flex items-center space-x-2">
              <span class="text-sm font-bold text-white">${escapeHtml(t.name)}</span>
              ${t.isBuiltin ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-950 border border-blue-800 text-blue-400 font-mono">📌 内置</span>' : '<span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 font-mono">自定义</span>'}
              ${t.isDefault ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-950 border border-amber-800 text-amber-300 font-mono">⭐ 默认</span>' : ''}
            </div>
            <p class="text-[11px] text-slate-400 leading-relaxed">${escapeHtml(t.description || '（无描述）')}</p>
          </div>
          <span class="text-[10px] text-slate-500 font-mono shrink-0">${t.sections.length} 章节</span>
        </div>
        <div class="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
          <span class="text-[10px] text-slate-600 font-mono">更新于 ${new Date(t.updatedAt).toLocaleDateString()}</span>
          <div class="flex items-center space-x-1.5">
            <button onclick="tplEdit('${t.id}')" class="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded font-semibold text-xs">编辑</button>
            <button onclick="tplCopy('${t.id}')" class="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded text-xs">复制</button>
            <button onclick="tplExport('${t.id}')" class="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded text-xs">导出</button>
            ${t.isDefault ? '' : `<button onclick="tplSetDefault('${t.id}')" class="px-2.5 py-1 bg-amber-800/60 hover:bg-amber-700 text-amber-200 rounded text-xs">设为默认</button>`}
            <button ${t.isBuiltin ? 'disabled title="内置模板不可删除"' : `onclick="tplDelete('${t.id}')"`} class="px-2.5 py-1 ${t.isBuiltin ? 'bg-slate-900 text-slate-600 border border-slate-800 cursor-not-allowed' : 'bg-rose-900/60 hover:bg-rose-800 text-rose-300 border border-rose-800/60'} rounded text-xs">删除</button>
          </div>
        </div>
      </div>`).join('');
  }

  window.tplEdit = async function (id) {
    const tpl = tplState.templates.find((t) => t.id === id);
    if (!tpl) return;
    tplState.current = JSON.parse(JSON.stringify(tpl));
    renderEditor();
    document.getElementById('tpl-editor')?.classList.remove('hidden');
    document.getElementById('tpl-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  function renderEditor() {
    const tpl = tplState.current;
    if (!tpl) return;
    document.getElementById('editor-tpl-name').textContent = tpl.name;
    const nameInput = document.getElementById('editor-name');
    const descInput = document.getElementById('editor-desc');
    if (nameInput) nameInput.value = tpl.name;
    if (descInput) descInput.value = tpl.description;
    const sectionList = document.getElementById('section-list');
    if (!sectionList) return;
    sectionList.innerHTML = tpl.sections.map((sec, i) => `
      <div class="section-row rounded-lg bg-[#0c1220] border border-slate-800" draggable="true" data-sec-id="${sec.id}">
        <div class="flex items-center space-x-2 px-3 py-2" onclick="tplToggleSection(this)">
          <span class="text-slate-600 text-xs cursor-grab" title="拖拽排序">⠿</span>
          <span class="sec-order text-xs font-mono text-slate-500">${String(i + 1).padStart(2, '0')}</span>
          <span class="text-xs font-semibold text-white flex-1">${escapeHtml(sec.title)}</span>
          <label class="flex items-center space-x-1 text-[10px] text-slate-500" onclick="event.stopPropagation()">
            <input type="checkbox" class="ctx-check sec-enabled" ${sec.enabled ? 'checked' : ''}> 启用
          </label>
          <span class="text-slate-500 text-[10px]">▾</span>
        </div>
        <div class="hidden px-3 pb-3 space-y-2.5 border-t border-slate-800/60 pt-2.5">
          <div>
            <label class="text-[10px] text-slate-500 block mb-1">章节标题</label>
            <input type="text" class="sec-title w-full bg-[#080d1a] border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200" value="${escapeHtml(sec.title)}">
          </div>
          <div>
            <label class="text-[10px] text-slate-500 block mb-1">撰写指导说明</label>
            <input type="text" class="sec-guidance w-full bg-[#080d1a] border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200" value="${escapeHtml(sec.guidance)}">
          </div>
          <div>
            <label class="text-[10px] text-slate-500 block mb-1">生成提示词（LLM 撰写指令）</label>
            <textarea rows="3" class="sec-prompt w-full bg-[#080d1a] border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-300 font-mono leading-relaxed">${escapeHtml(sec.promptTemplate)}</textarea>
          </div>
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-3 text-[10px] text-slate-500">
              <span>章节上下文注入：</span>
              ${['session_meta', 'messages', 'chunks', 'tasks', 'suggestions'].map((src) => `
                <label class="flex items-center space-x-1"><input type="checkbox" class="ctx-check sec-ctx" value="${src}" ${sec.contextSources.includes(src) ? 'checked' : ''}> ${src}</label>`).join('')}
            </div>
            <div class="flex items-center space-x-2">
              <span class="text-[10px] text-slate-600">字数下限</span>
              <input type="number" class="sec-minwords w-16 bg-[#080d1a] border border-slate-700 rounded px-2 py-1 text-xs text-slate-300" value="${sec.minWords ?? ''}">
            </div>
          </div>
        </div>
      </div>`).join('');
    bindDragSort();
  }

  window.tplToggleSection = function (header) {
    const body = header.nextElementSibling;
    if (!body) return;
    body.classList.toggle('hidden');
    const arrow = header.querySelector('span:last-child');
    if (arrow) arrow.textContent = body.classList.contains('hidden') ? '▾' : '▴';
  };

  window.insertVar = function (name) {
    const focused = document.querySelector('#tpl-editor textarea:focus');
    if (!focused) { toast('请先将光标置于某个章节的生成提示词输入框内', true); return; }
    const pos = focused.selectionStart || focused.value.length;
    const text = `{{${name}}}`;
    focused.value = focused.value.slice(0, pos) + text + focused.value.slice(pos);
    focused.focus();
    focused.selectionStart = focused.selectionEnd = pos + text.length;
  };

  function bindDragSort() {
    const list = document.getElementById('section-list');
    if (!list) return;
    let dragged = null;
    list.ondragstart = (e) => {
      dragged = e.target.closest('.section-row');
      if (dragged) dragged.classList.add('dragging');
    };
    list.ondragover = (e) => {
      e.preventDefault();
      const over = e.target.closest('.section-row');
      list.querySelectorAll('.section-row').forEach((r) => r.classList.remove('drag-over'));
      if (over && over !== dragged) over.classList.add('drag-over');
    };
    list.ondrop = (e) => {
      e.preventDefault();
      const over = e.target.closest('.section-row');
      if (over && dragged && over !== dragged) {
        list.insertBefore(dragged, over);
        renumber();
        toast('章节顺序已调整，保存时生效');
      }
      dragged?.classList.remove('dragging');
      list.querySelectorAll('.section-row').forEach((r) => r.classList.remove('drag-over'));
    };
    list.ondragend = () => {
      dragged?.classList.remove('dragging');
      list.querySelectorAll('.section-row').forEach((r) => r.classList.remove('drag-over'));
    };
  }

  function renumber() {
    document.querySelectorAll('#section-list .section-row').forEach((row, i) => {
      const order = row.querySelector('.sec-order');
      if (order) order.textContent = String(i + 1).padStart(2, '0');
    });
  }

  window.tplSave = async function () {
    const tpl = tplState.current;
    if (!tpl) return;
    const name = document.getElementById('editor-name')?.value.trim() || tpl.name;
    const description = document.getElementById('editor-desc')?.value.trim() || '';
    const sections = [];
    document.querySelectorAll('#section-list .section-row').forEach((row) => {
      sections.push({
        title: row.querySelector('.sec-title')?.value.trim() || '',
        guidance: row.querySelector('.sec-guidance')?.value.trim() || '',
        promptTemplate: row.querySelector('.sec-prompt')?.value || '',
        contextSources: [...row.querySelectorAll('.sec-ctx:checked')].map((c) => c.value),
        minWords: row.querySelector('.sec-minwords')?.value ? Number(row.querySelector('.sec-minwords').value) : null,
        enabled: row.querySelector('.sec-enabled')?.checked ?? true,
      });
    });
    try {
      await api.send(`/api/prd-templates/${tpl.id}`, 'PUT', { name, description, sections });
      toast('模板已保存');
      await loadTemplates();
      document.getElementById('tpl-editor')?.classList.add('hidden');
    } catch (err) { toast(err.message, true); }
  };

  window.tplCopy = async function (id) {
    try {
      await api.send('/api/prd-templates', 'POST', { copyFrom: id });
      await loadTemplates();
      toast('已复制为新模板');
    } catch (err) { toast(err.message, true); }
  };

  window.tplDelete = async function (id) {
    if (!confirm('确认删除该模板？')) return;
    try {
      await api.send(`/api/prd-templates/${id}`, 'DELETE');
      await loadTemplates();
      toast('模板已删除');
    } catch (err) { toast(err.message, true); }
  };

  window.tplSetDefault = async function (id) {
    try {
      await api.send(`/api/prd-templates/${id}/default`, 'POST', {});
      await loadTemplates();
      toast('已设为默认模板');
    } catch (err) { toast(err.message, true); }
  };

  window.tplExport = async function (id) {
    try {
      const resp = await api.get(`/api/prd-templates/${id}/export`);
      const blob = new Blob([JSON.stringify(resp.data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `prd-template-${id}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) { toast(err.message, true); }
  };

  window.tplImport = function () {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const payload = JSON.parse(await file.text());
        await api.send('/api/prd-templates', 'POST', { name: payload.name, description: payload.description, sections: payload.sections });
        await loadTemplates();
        toast('模板导入成功');
      } catch (err) { toast(`导入失败: ${err.message}`, true); }
    };
    input.click();
  };

  window.tplPreview = async function () {
    const tpl = tplState.current;
    if (!tpl) return;
    try {
      const sessions = await api.get('/api/requirements');
      const first = sessions.data.sessions[0];
      if (!first) { toast('暂无探索会话，无法 dry-run 预览', true); return; }
      const resp = await api.send(`/api/prd-templates/${tpl.id}/preview`, 'POST', { sessionId: first.id });
      const modal = document.createElement('div');
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:9998;display:flex;align-items:center;justify-content:center;padding:24px;';
      modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
      modal.innerHTML = `<div style="background:#0f172a;border:1px solid #334155;border-radius:12px;max-width:720px;width:100%;max-height:80vh;overflow:auto;padding:20px;">
        <h3 style="color:#fff;font-size:14px;margin-bottom:12px">👁 提示词 dry-run 预览（基于会话 ${escapeHtml(first.title)}）</h3>
        <pre style="font-size:11px;color:#cbd5e1;white-space:pre-wrap;font-family:ui-monospace,monospace">${escapeHtml(resp.data.rendered)}</pre></div>`;
      document.body.appendChild(modal);
    } catch (err) { toast(err.message, true); }
  };

  window.tplNew = function () {
    api.send('/api/prd-templates', 'POST', { name: '新模板', description: '' })
      .then(async (resp) => { await loadTemplates(); tplEdit(resp.data.template.id); })
      .catch((err) => toast(err.message, true));
  };

  window.tplClose = function () {
    document.getElementById('tpl-editor')?.classList.add('hidden');
  };

  async function loadTemplates() {
    const resp = await api.get('/api/prd-templates');
    tplState.templates = resp.data.templates;
    renderCards();
  }

  function renderVarToolbar() {
    const bar = document.getElementById('var-toolbar');
    if (!bar) return;
    const vars = ['project.title', 'project.initial_prompt', 'chunks.tree', 'tasks.by_chunk', 'messages.recent', 'suggestions.active'];
    bar.innerHTML = vars.map((v) => `<button class="var-btn bg-purple-950/60 border border-purple-800/40 text-purple-300" onclick="insertVar('${v}')">${v}</button>`).join('');
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('tpl-list')) return;
    renderVarToolbar();
    loadTemplates().catch((err) => toast(err.message, true));
  });
})();
