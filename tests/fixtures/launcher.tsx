import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { createStartMock } from '../../client/desktop/start-mock.ts';
import type { DesktopResult, DesktopShell, DesktopState, DesktopStatus } from '../../client/desktop-bridge.ts';
import type { Lang } from '../../client/i18n.ts';
import '../../client/desktop/page-ready.js';
import '../../client/desktop/start.css';

window.deckmateDesktop = createStartMock();
const { StartScreen } = await import('../../client/desktop/StartScreen.tsx');
const { WorkspaceProjects } = await import('../../client/WorkspaceProjects.tsx');
const { setLang } = await import('../../client/i18n.ts');

const root = createRoot(document.getElementById('root')!);
const now = Date.parse('2026-11-13T10:00:00Z');
let clock = now;
Date.now = () => clock;
const realInterval = window.setInterval.bind(window), realClear = window.clearInterval.bind(window);
const timers = new Map<number, () => void>();
let timerId = -1;
window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
  if (timeout !== 60_000 || typeof handler !== 'function') return realInterval(handler, timeout, ...args);
  const id = timerId--; timers.set(id, () => handler(...args)); return id;
}) as typeof window.setInterval;
window.clearInterval = id => { if (typeof id === 'number' && timers.has(id)) timers.delete(id); else realClear(id); };
const project = (name: string, extra = {}) => ({ path: `D:\\Projects\\${name}`, name, lastOpened: new Date(now).toISOString(), current: false, missing: false, ...extra });
const initial: DesktopState = {
  ok: true, current: null, lastProject: project('Last').path, recent: [project('Last'), project('Other')],
  projects: [project('Pinned'), project('Missing', { missing: true })],
  version: '0.8.1', deckmateVersion: '0.8.1', language: 'en', theme: 'light', locale: 'en-US',
};
let snapshot = structuredClone(initial);
const calls: { method: string; args: unknown[] }[] = [];
const replies = new Map<string, unknown[]>();
const holds = new Set<string>();
const pending = new Map<string, ((value: unknown) => void)[]>();
let statusListener: (status: DesktopStatus) => void = () => {};
let prepare: (() => void) | undefined;
const pageReady = window.prepareDeckmatePage;
type Options = { snapshot?: Partial<DesktopState>; empty?: boolean; native?: boolean; delayState?: boolean; delayPrepare?: boolean; replay?: DesktopStatus; demo?: boolean; initialFocus?: string };

function render(options: Options = {}) {
  flushSync(() => root.render(null));
  calls.length = 0; replies.clear(); holds.clear(); pending.clear(); clock = now;
  snapshot = { ...structuredClone(initial), ...options.snapshot };
  if (options.empty) Object.assign(snapshot, { projects: [], recent: [], lastProject: null });
  if (options.delayState) holds.add('getState');
  window.deckmateBoard = undefined;
  window.prepareDeckmatePage = options.delayPrepare ? () => new Promise<void>(resolve => { prepare = resolve; }) : pageReady;
  async function invoke(method: string, args: unknown[], fallback: () => unknown) {
    calls.push({ method, args });
    if (holds.has(method)) return new Promise(resolve => { const queue = pending.get(method) ?? []; queue.push(resolve); pending.set(method, queue); });
    const queue = replies.get(method);
    const reply = queue?.length ? queue.shift() : await fallback();
    if (reply && typeof reply === 'object' && 'throw' in reply) throw new Error(String(reply.throw));
    return reply;
  }
  const workspace = () => ({ ok: true as const, projects: structuredClone(snapshot.projects), current: snapshot.current });
  let bridge: DesktopShell = {
    getState: options => invoke('getState', options ? [options] : [], () => {
      if (!options?.refresh && renderOptions.replay) statusListener(renderOptions.replay);
      return structuredClone(snapshot);
    }) as ReturnType<DesktopShell['getState']>,
    chooseFolder: () => invoke('chooseFolder', [], () => 'D:\\Projects\\New project') as ReturnType<DesktopShell['chooseFolder']>,
    openProject: folder => invoke('openProject', [folder], () => ({ ok: false, code: 'missing' })) as Promise<DesktopResult>,
    createProject: options => invoke('createProject', [options], () => ({ ok: false, code: 'not-empty' })) as Promise<DesktopResult>,
    removeRecent: folder => invoke('removeRecent', [folder], () => {
      snapshot.recent = snapshot.recent.filter(entry => entry.path !== folder);
      return { ok: true, projects: structuredClone(snapshot.recent), current: snapshot.current };
    }) as ReturnType<DesktopShell['removeRecent']>,
    addToWorkspace: folder => invoke('addToWorkspace', [folder], () => {
      if (!snapshot.projects.some(entry => entry.path === folder)) snapshot.projects.push(project(folder.split(/[\\/]/u).pop()!, { path: folder }));
      return workspace();
    }) as ReturnType<DesktopShell['addToWorkspace']>,
    removeFromWorkspace: folder => invoke('removeFromWorkspace', [folder], () => {
      snapshot.projects = snapshot.projects.filter(entry => entry.path !== folder); return workspace();
    }) as ReturnType<DesktopShell['removeFromWorkspace']>,
    moveInWorkspace: (folder, index) => invoke('moveInWorkspace', [folder, index], () => {
      const [entry] = snapshot.projects.splice(snapshot.projects.findIndex(entry => entry.path === folder), 1);
      snapshot.projects.splice(index, 0, entry); return workspace();
    }) as ReturnType<DesktopShell['moveInWorkspace']>,
    setTheme: theme => invoke('setTheme', [theme], () => ({ ok: true })) as Promise<DesktopResult>,
    setLanguage: lang => invoke('setLanguage', [lang], () => ({ ok: true })) as Promise<DesktopResult>,
    onStatus(callback) { calls.push({ method: 'onStatus', args: [] }); statusListener = callback; return () => { statusListener = () => {}; }; },
  };
  const renderOptions = options;
  if (options.demo) bridge = createStartMock();
  window.deckmateDesktop = bridge;
  if (!options.demo) {
    setLang(snapshot.language);
    document.documentElement.dataset.shellLang = snapshot.language;
    document.documentElement.dataset.shellTheme = snapshot.theme;
    document.documentElement.classList.toggle('dark', snapshot.theme === 'dark');
  } else {
    setLang(localStorage.getItem('deckmate-language') === 'ru' ? 'ru' : 'en');
    document.documentElement.classList.toggle('dark', localStorage.getItem('deckmate-theme') === 'dark');
  }
  if (options.initialFocus) {
    const button = document.createElement('button'); button.id = 'initial-focus'; document.body.append(button); button.focus();
  }
  flushSync(() => root.render(<StartScreen bridge={bridge} shortcuts={options.native ? 'native' : 'local'} />));
}

Object.assign(window, { launcherTest: {
  render, calls, initial, project, setLang,
  reply(method: string, value: unknown) { const queue = replies.get(method) ?? []; queue.push(value); replies.set(method, queue); },
  hold(method: string) { holds.add(method); },
  resolve(method: string, value: unknown) { pending.get(method)?.shift()?.(value); },
  releaseState() { holds.delete('getState'); pending.get('getState')?.shift()?.(structuredClone(snapshot)); },
  releasePrepare() { prepare?.(); },
  emit(event: DesktopStatus) { statusListener(event); },
  snapshot(value: Partial<DesktopState>) { Object.assign(snapshot, value); },
  advance(minutes: number) { clock += minutes * 60_000; for (const tick of timers.values()) tick(); },
  hidden(value: boolean) { Object.defineProperty(document, 'hidden', { configurable: true, value }); document.dispatchEvent(new Event('visibilitychange')); },
  get timers() { return timers.size; },
  mission(language: Lang) {
    flushSync(() => root.render(null)); setLang(language);
    window.deckmateBoard = {
      workspaceProjects: async () => ({ ok: true, projects: snapshot.projects, current: snapshot.current }),
      recentProjects: async () => ({ ok: true, projects: snapshot.recent, current: snapshot.current }),
      addToWorkspace: async () => ({ ok: true, projects: snapshot.projects, current: snapshot.current }),
      removeFromWorkspace: window.deckmateDesktop!.removeFromWorkspace, moveInWorkspace: window.deckmateDesktop!.moveInWorkspace,
      showStartScreen: async () => ({ ok: true }), switchProject: async () => ({ ok: true }),
    };
    flushSync(() => root.render(<WorkspaceProjects open disabled={false} />));
  },
} });
render({ demo: true });
