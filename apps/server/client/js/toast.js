/**
 * PGH Web Toast 全局网页式通知管理器
 * 统一替换生硬的浏览器原生 alert() 弹窗，提供优雅的浮动提示与自动退场。
 */
(function (global) {
  let toastContainer = null;

  function ensureContainer() {
    if (!toastContainer || !document.body.contains(toastContainer)) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'pgh-toast-container';
      toastContainer.className = 'fixed top-4 right-4 z-[9999] flex flex-col space-y-2 pointer-events-none select-none max-w-sm w-full';
      document.body.appendChild(toastContainer);
    }
    return toastContainer;
  }

  /**
   * 弹出 Toast 提示框
   * @param {string} message - 提示消息文本
   * @param {'info' | 'success' | 'warning' | 'error'} [type='info'] - 消息类型
   * @param {number} [duration=3000] - 显示持续时长 (ms)
   */
  function showToast(message, type = 'info', duration = 3000) {
    if (typeof document === 'undefined') return;
    const container = ensureContainer();

    const toast = document.createElement('div');
    toast.className = 'pgh-toast pointer-events-auto flex items-start space-x-2.5 p-3.5 rounded-lg shadow-xl text-xs font-sans border backdrop-blur-md transition-all duration-300 transform translate-y-[-10px] opacity-0';

    let icon = 'ℹ️';
    let typeClass = 'bg-slate-900/95 border-slate-700 text-slate-100';

    if (type === 'success' || message.startsWith('✓') || message.includes('成功')) {
      icon = '✅';
      typeClass = 'bg-emerald-950/90 border-emerald-700 text-emerald-200';
    } else if (type === 'error' || message.includes('失败') || message.includes('异常') || message.includes('错误')) {
      icon = '❌';
      typeClass = 'bg-rose-950/90 border-rose-700 text-rose-200';
    } else if (type === 'warning' || message.includes('请') || message.includes('必须') || message.includes('注意')) {
      icon = '⚠️';
      typeClass = 'bg-amber-950/90 border-amber-700 text-amber-200';
    }

    toast.className += ` ${typeClass}`;
    toast.innerHTML = `
      <span class="flex-shrink-0 text-sm leading-none mt-0.5">${icon}</span>
      <div class="flex-1 leading-relaxed break-words whitespace-pre-wrap">${escapeHtml(message)}</div>
      <button type="button" class="text-slate-400 hover:text-white flex-shrink-0 ml-1 text-xs">✕</button>
    `;

    const closeBtn = toast.querySelector('button');
    const dismiss = () => {
      toast.classList.remove('opacity-100', 'translate-y-0');
      toast.classList.add('opacity-0', 'translate-y-[-10px]');
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    };

    closeBtn.onclick = dismiss;
    container.appendChild(toast);

    // 触发平滑淡入滑下动画
    requestAnimationFrame(() => {
      toast.classList.remove('opacity-0', 'translate-y-[-10px]');
      toast.classList.add('opacity-100', 'translate-y-0');
    });

    if (duration > 0) {
      setTimeout(dismiss, duration);
    }
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, s => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[s]));
  }

  // 挂载至全局，并优雅覆盖原生 alert
  global.showToast = showToast;
  global.alert = function (msg) {
    showToast(msg);
  };
})(typeof window !== 'undefined' ? window : globalThis);
