/**
 * PGH 语音播报模块 (PGHSpeech)
 * 基于原生 Web Speech API (speechSynthesis)，支持全自动朗读、逐条手动重播、全局静音切换与文本清洗。
 * 零后端原生进程依赖，无缝支持多平台浏览器。
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'pgh_speech_settings';

  const defaultSettings = {
    enabled: true,         // 总开关
    autoRead: true,        // 助手最终回复自动朗读
    rate: 1.0,             // 语速 (0.5 - 2.0)
    pitch: 1.0,            // 音调 (0.5 - 1.5)
    volume: 1.0,           // 音量 (0.0 - 1.0)
    readInlineCode: true,  // 是否读出行内代码
    maxChars: 300,         // 单次最大字符截断
  };

  let settings = { ...defaultSettings };

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) settings = { ...defaultSettings, ...JSON.parse(saved) };
  } catch {
    // ignore
  }

  function saveSettings(patch) {
    settings = { ...settings, ...patch };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // ignore
    }
    notifyState();
  }

  function cleanText(text, maxChars) {
    if (!text || typeof text !== 'string') return '';
    let out = text;
    out = out.replace(/```[\s\S]*?```/g, ' 代码块已省略 ');
    out = out.replace(/<[^>]+>/g, ' ');
    if (settings.readInlineCode) {
      out = out.replace(/`([^`]+)`/g, ' $1 ');
    } else {
      out = out.replace(/`([^`]+)`/g, ' ');
    }
    out = out.replace(/\[([^\]]+)\]\([^)]+\)/g, ' $1 ');
    out = out.replace(/https?:\/\/[^\s)]+/g, ' ');
    out = out.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F100}-\u{1F1FF}]/gu, '');
    out = out.replace(/[*_~#>-]/g, ' ');
    out = out.replace(/\r\n|\r|\n/g, ' ');
    out = out.replace(/\s+/g, ' ').trim();

    const limit = maxChars !== undefined ? maxChars : settings.maxChars;
    if (limit > 0 && out.length > limit) {
      out = out.slice(0, limit).trim() + '，后续内容请在屏幕中阅读。';
    }
    return out;
  }

  let _currentUtterance = null;
  let speakingMessageId = null;
  const listeners = new Set();

  function notifyState() {
    const isSpeaking = Boolean(window.speechSynthesis && window.speechSynthesis.speaking);
    listeners.forEach((fn) => fn({
      speaking: isSpeaking,
      speakingId: speakingMessageId,
      settings: { ...settings },
    }));
  }

  function stop() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    _currentUtterance = null;
    speakingMessageId = null;
    notifyState();
  }

  function speak(text, messageId, force) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance === 'undefined') return;
    if (!settings.enabled && !force) return;

    stop();

    const cleaned = cleanText(text);
    if (!cleaned) return;

    const utter = new window.SpeechSynthesisUtterance(cleaned);
    utter.rate = settings.rate;
    utter.pitch = settings.pitch;
    utter.volume = settings.volume;
    utter.lang = 'zh-CN';

    // 智能筛选普通话音色：严格过滤粤语(zh-HK, zh-MO, Cantonese)、台语(zh-TW)
    const voices = window.speechSynthesis.getVoices();
    let selectedVoice = null;

    if (settings.voiceURI) {
      selectedVoice = voices.find(v => v.voiceURI === settings.voiceURI);
    }

    if (!selectedVoice) {
      // 1. 优先普通话自然音色 (zh-CN Natural / Xiaoxiao / Yunxi / Huihui / Yaoyao / Kangkang)
      selectedVoice = voices.find(v => (v.lang === 'zh-CN' || v.lang === 'zh_CN') && (v.name.includes('Natural') || v.name.includes('Xiaoxiao') || v.name.includes('Yunxi') || v.name.includes('Huihui')));
    }

    if (!selectedVoice) {
      // 2. 次优匹配标准普通话 (zh-CN)，坚决避开 zh-HK/zh-MO/Cantonese/zh-TW
      selectedVoice = voices.find(v => (v.lang === 'zh-CN' || v.lang === 'zh_CN') && !v.lang.includes('HK') && !v.lang.includes('MO') && !v.name.toLowerCase().includes('cantonese'));
    }

    if (!selectedVoice) {
      // 3. 兜底匹配任意非粤语的中文音色
      selectedVoice = voices.find(v => v.lang.startsWith('zh') && !v.lang.includes('HK') && !v.lang.includes('MO') && !v.name.toLowerCase().includes('cantonese') && !v.name.includes('粤'));
    }

    if (!selectedVoice) {
      selectedVoice = voices.find(v => v.lang.startsWith('zh'));
    }

    if (selectedVoice) utter.voice = selectedVoice;

    speakingMessageId = messageId || null;
    _currentUtterance = utter;

    utter.onstart = () => notifyState();
    utter.onend = () => {
      _currentUtterance = null;
      speakingMessageId = null;
      notifyState();
    };
    utter.onerror = () => {
      _currentUtterance = null;
      speakingMessageId = null;
      notifyState();
    };

    window.speechSynthesis.speak(utter);
  }

  global.PGHSpeech = {
    getSettings: () => ({ ...settings }),
    saveSettings,
    speak,
    stop,
    cleanText,
    onStateChange: (fn) => {
      listeners.add(fn);
      fn({
        speaking: Boolean(window.speechSynthesis && window.speechSynthesis.speaking),
        speakingId: speakingMessageId,
        settings: { ...settings },
      });
      return () => listeners.delete(fn);
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
