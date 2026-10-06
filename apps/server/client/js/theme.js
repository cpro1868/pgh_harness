(function () {
  const KEY = 'pgh_theme';
  const VALID = ['dark-geek', 'slate-blue', 'oled-black', 'light-clean'];

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function persist(a) {
    try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (_) {}
  }

  function apply(appearance) {
    if (!appearance || typeof appearance !== 'object') return;
    const style = VALID.indexOf(appearance.themeStyle) >= 0 ? appearance.themeStyle : 'dark-geek';
    document.documentElement.setAttribute('data-theme', style);
    if (appearance.editorFontFamily) {
      document.documentElement.style.setProperty('--font-mono', appearance.editorFontFamily + ', monospace');
    }
    if (appearance.uiDensity === 'default') {
      document.documentElement.setAttribute('data-density', 'default');
    } else {
      document.documentElement.removeAttribute('data-density');
    }
  }

  const cached = read();
  if (cached) apply(cached);

  window.PGHTheme = {
    apply: apply,
    persist: persist,
    valid: function (v) { return VALID.indexOf(v) >= 0; },
  };

  window.addEventListener('storage', function (e) {
    if (e.key === KEY) {
      const next = read();
      if (next) apply(next);
    }
  });

  window.addEventListener('DOMContentLoaded', function () {
    fetch('/api/settings/all')
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.code === 0 && res.data && res.data.appearance) {
          apply(res.data.appearance);
          persist(res.data.appearance);
        }
      })
      .catch(function () {});
  });
})();
