import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(here, '..', 'client', 'run-chat.html');

interface StubElement {
  value: string;
  textContent: string;
  innerHTML: string;
  className: string;
  title: string;
  disabled: boolean;
  type: string;
  style: Record<string, string>;
  dataset: Record<string, string>;
  options: StubElement[];
  children: StubElement[];
  classList: { add: (...cls: string[]) => void; remove: (...cls: string[]) => void; contains: (cls: string) => boolean };
  appendChild: (child: StubElement) => void;
  querySelector: (sel: string) => StubElement;
  addEventListener: (type: string, fn: () => void) => void;
  setAttribute: (k: string, v: string) => void;
  removeAttribute: (k: string) => void;
  focus: () => void;
}

interface FetchCall {
  url: string;
  method: string;
  body?: string;
}

interface ChatApi {
  switchSession: (sessionId: string) => Promise<void>;
  handlePermissionPresetChange: (value: string) => Promise<void>;
  confirmFullAuthPreset: () => Promise<void>;
  cancelFullAuthPreset: () => void;
  stopSessionWatch: () => void;
  getActiveWorkspacePath: () => string;
  getActivePermissionPreset: () => string;
  getActiveSessionId: () => string;
}

const WORKSPACE_MAIN = 'G:\\Projects\\Agent\\harness';
const WORKSPACE_OTHER = 'G:\\Projects\\Agent\\RealTestProject';
const WORKSPACE_UNREGISTERED = 'D:\\Unlisted\\proj-x';

function makeElement(): StubElement {
  const classes = new Set<string>();
  const el: Partial<StubElement> = {
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    title: '',
    disabled: false,
    type: '',
    style: {},
    dataset: {},
    options: [],
    children: [],
    classList: {
      add: (...cls: string[]) => cls.forEach((c) => classes.add(c)),
      remove: (...cls: string[]) => cls.forEach((c) => classes.delete(c)),
      contains: (cls: string) => classes.has(cls),
    },
    appendChild: (child: StubElement) => { el.options!.push(child); el.children!.push(child); },
    querySelector: () => makeElement(),
    addEventListener: () => {},
    setAttribute: () => {},
    removeAttribute: () => {},
    focus: () => {},
  };
  return el as StubElement;
}

function loadChatApi(opts: {
  sessions: Array<Record<string, unknown>>;
  workspaces: Array<Record<string, unknown>>;
}): { api: ChatApi; elements: Map<string, StubElement>; fetchCalls: FetchCall[] } {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const source = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .join('\n;\n');

  const elements = new Map<string, StubElement>();
  const seed = (id: string, hidden: boolean): StubElement => {
    const el = makeElement();
    if (hidden) el.classList.add('hidden');
    elements.set(id, el);
    return el;
  };
  seed('full-auth-modal', true);
  seed('delete-session-modal', true);
  seed('wizard-modal', true);
  seed('composer-error-banner', true);
  seed('permission-preset-select', false);
  seed('topbar-workspace-select', false);
  seed('session-list-container', false);
  seed('messages-stream-container', false);
  seed('chat-empty-state', false);

  const documentStub = {
    getElementById: (id: string) => {
      if (!elements.has(id)) elements.set(id, makeElement());
      return elements.get(id)!;
    },
    createElement: () => makeElement(),
    addEventListener: () => {},
    visibilityState: 'visible',
    body: makeElement(),
  };
  const windowStub = { addEventListener: () => {}, marked: undefined, hljs: undefined, DOMPurify: undefined };

  const fetchCalls: FetchCall[] = [];
  const fetchStub = async (url: string, init?: { method?: string; body?: string }) => {
    const method = (init?.method || 'GET').toUpperCase();
    fetchCalls.push({ url, method, body: init?.body });
    const json = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
    if (url.includes('/stream')) {
      return {
        ok: true,
        status: 200,
        body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }) }) },
      };
    }
    if (url.startsWith('/api/sessions/') && url.includes('/messages')) return json({ code: 0, data: [] });
    if (url.startsWith('/api/sessions/') && url.includes('/permission')) return json({ code: 0, message: 'ok' });
    if (url === '/api/sessions') return json({ code: 0, data: opts.sessions });
    if (url.startsWith('/api/workspaces')) return json({ code: 0, data: opts.workspaces });
    if (url.startsWith('/api/skills')) return json({ code: 0, data: [] });
    return json({ code: 0, data: [] });
  };

  const factory = new Function(
    'document', 'window', 'fetch', 'URL', 'AbortController', 'TextDecoder', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'console',
    `${source}\n;return {
      switchSession,
      handlePermissionPresetChange,
      confirmFullAuthPreset: typeof confirmFullAuthPreset === 'function' ? confirmFullAuthPreset : undefined,
      cancelFullAuthPreset: typeof cancelFullAuthPreset === 'function' ? cancelFullAuthPreset : undefined,
      stopSessionWatch,
      getActiveWorkspacePath: () => activeWorkspacePath,
      getActivePermissionPreset: () => activePermissionPreset,
      getActiveSessionId: () => activeSessionId,
    };`,
  ) as (...args: unknown[]) => ChatApi;

  const api = factory(
    documentStub,
    windowStub,
    fetchStub,
    URL,
    AbortController,
    TextDecoder,
    () => 0,
    () => {},
    () => 0,
    () => {},
    { warn: () => {}, error: () => {}, info: () => {} },
  );
  return { api, elements, fetchCalls };
}

const SESSIONS = [
  {
    id: 'sess_other_ws',
    title: '其他工作区会话',
    workspacePath: WORKSPACE_OTHER,
    preset: 'edit',
    activeModelId: 'deepseek-chat',
    usageBaselineSeq: 0,
    createdAt: 1,
    updatedAt: 1,
    isArchived: false,
  },
  {
    id: 'sess_unlisted_ws',
    title: '未登记工作区会话',
    workspacePath: WORKSPACE_UNREGISTERED,
    preset: 'edit',
    activeModelId: 'deepseek-chat',
    usageBaselineSeq: 0,
    createdAt: 2,
    updatedAt: 2,
    isArchived: false,
  },
];

const WORKSPACES = [
  { name: 'harness', path: WORKSPACE_MAIN },
  { name: 'RealTestProject', path: WORKSPACE_OTHER },
];

describe('TC-01-08-002 / TC-01-13-002: 会话切换顶栏联动与完全授权高危确认', () => {
  let harness: ReturnType<typeof loadChatApi>;

  before(() => {
    harness = loadChatApi({ sessions: SESSIONS, workspaces: WORKSPACES });
  });

  after(() => {
    harness.api.stopSessionWatch();
  });

  it('switchSession 后顶栏工作区必须切换为该会话绑定的工作区', async () => {
    harness.api.stopSessionWatch();
    await harness.api.switchSession('sess_other_ws');

    assert.equal(harness.api.getActiveSessionId(), 'sess_other_ws');
    assert.equal(harness.api.getActiveWorkspacePath(), WORKSPACE_OTHER, 'activeWorkspacePath 必须随会话切换');
    const select = harness.elements.get('topbar-workspace-select')!;
    assert.equal(select.value, WORKSPACE_OTHER, '顶栏工作区下拉框 value 必须指向会话绑定工作区');
    assert.ok(select.title.includes(WORKSPACE_OTHER), '顶栏 title 必须展示会话绑定工作区');
  });

  it('会话绑定工作区未登记时顶栏仍须展示该工作区（动态补建选项）', async () => {
    harness.api.stopSessionWatch();
    await harness.api.switchSession('sess_unlisted_ws');

    assert.equal(harness.api.getActiveWorkspacePath(), WORKSPACE_UNREGISTERED);
    const select = harness.elements.get('topbar-workspace-select')!;
    assert.equal(select.value, WORKSPACE_UNREGISTERED, '未登记工作区也必须被顶栏选中');
    assert.ok(
      select.options.some((opt) => opt.value === WORKSPACE_UNREGISTERED),
      '下拉列表必须补建未登记工作区选项',
    );
  });

  it('选择「完全授权」必须先弹高危确认框，确认前档位不变且不落盘', async () => {
    harness.api.stopSessionWatch();
    await harness.api.switchSession('sess_other_ws');
    const permSelect = harness.elements.get('permission-preset-select')!;
    const modal = harness.elements.get('full-auth-modal')!;
    const mark = harness.fetchCalls.length;
    const permPatches = () => harness.fetchCalls.slice(mark).filter((c) => c.url.includes('/permission') && c.method === 'PATCH');

    permSelect.value = 'full';
    await harness.api.handlePermissionPresetChange('full');

    assert.equal(modal.classList.contains('hidden'), false, '完全授权必须弹出高危确认框');
    assert.equal(harness.api.getActivePermissionPreset(), 'edit', '确认前档位不得改变');
    assert.equal(permSelect.value, 'edit', '确认前下拉框必须回退显示当前档位');
    assert.equal(permPatches().length, 0, '确认前严禁落盘');

    await harness.api.confirmFullAuthPreset();

    assert.equal(harness.api.getActivePermissionPreset(), 'full', '确认后档位必须切换为完全授权');
    assert.equal(modal.classList.contains('hidden'), true, '确认后确认框必须关闭');
    assert.equal(permPatches().length, 1, '确认后必须且只落盘一次');
    assert.deepEqual(JSON.parse(permPatches()[0].body!), { preset: 'full' });
  });

  it('取消「完全授权」确认则档位保持原值且不落盘', async () => {
    harness.api.stopSessionWatch();
    await harness.api.switchSession('sess_other_ws');
    const permSelect = harness.elements.get('permission-preset-select')!;
    const modal = harness.elements.get('full-auth-modal')!;
    const mark = harness.fetchCalls.length;
    const permPatches = () => harness.fetchCalls.slice(mark).filter((c) => c.url.includes('/permission') && c.method === 'PATCH');

    permSelect.value = 'full';
    await harness.api.handlePermissionPresetChange('full');
    harness.api.cancelFullAuthPreset();

    assert.equal(harness.api.getActivePermissionPreset(), 'edit', '取消后档位必须保持原值');
    assert.equal(permSelect.value, 'edit', '取消后下拉框必须回退');
    assert.equal(modal.classList.contains('hidden'), true, '取消后确认框必须关闭');
    assert.equal(permPatches().length, 0, '取消后严禁落盘');
  });

  it('只读/标准档位切换不弹确认框且立即落盘（回归防线）', async () => {
    harness.api.stopSessionWatch();
    await harness.api.switchSession('sess_other_ws');
    const modal = harness.elements.get('full-auth-modal')!;
    const mark = harness.fetchCalls.length;
    const permPatches = () => harness.fetchCalls.slice(mark).filter((c) => c.url.includes('/permission') && c.method === 'PATCH');

    await harness.api.handlePermissionPresetChange('readonly');

    assert.equal(modal.classList.contains('hidden'), true, '只读档位不得弹确认框');
    assert.equal(harness.api.getActivePermissionPreset(), 'readonly');
    assert.equal(permPatches().length, 1, '只读档位必须立即落盘');
    assert.deepEqual(JSON.parse(permPatches()[0].body!), { preset: 'readonly' });
  });
});
