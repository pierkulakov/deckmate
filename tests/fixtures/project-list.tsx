import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ProjectList, type ProjectListEntry } from '../../client/ProjectList.tsx';
import { ProjectListFeedback } from '../../client/ProjectListFeedback.tsx';
import { ThemeToggle } from '../../client/ThemeToggle.tsx';
import { LanguageToggle } from '../../client/LanguageToggle.tsx';
import { setLang, type Lang } from '../../client/i18n.ts';
import type { DesktopFailure, ThemePreference } from '../../client/desktop-bridge.ts';
import '../../client/tokens.css';
import '../../client/focus.css';
import './project-list.css';

const root = createRoot(document.getElementById('root')!);
const calls: { method: string; args: unknown[] }[] = [];
const now = Date.parse('2026-11-13T10:00:00Z');
let clock = now;
Date.now = () => clock;
const realInterval = window.setInterval.bind(window), realClear = window.clearInterval.bind(window);
const minuteTimers = new Map<number, () => void>();
let timerId = -1;
window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
  if (timeout !== 60_000 || typeof handler !== 'function') return realInterval(handler, timeout, ...args);
  const id = timerId--;
  minuteTimers.set(id, () => handler(...args));
  return id;
}) as typeof window.setInterval;
window.clearInterval = id => { if (typeof id === 'number' && minuteTimers.has(id)) minuteTimers.delete(id); else realClear(id); };

const initial: ProjectListEntry[] = Array.from({ length: 10 }, (_, index) => ({
  path: `C:/Projects/Project ${index + 1}`, name: `Project ${index + 1}`, current: index === 0, missing: index === 2,
}));
const recent: ProjectListEntry[] = [
  { path: 'D:/Очень длинное название папки/Другой проект', name: 'Другой проект', current: false, missing: false, lastOpened: new Date(now - 20_000).toISOString() },
  { path: 'D:/Old', name: 'Old', current: false, missing: true, lastOpened: new Date(now - 5 * 86400_000).toISOString() },
];
type Options = { lang?: Lang; theme?: ThemePreference; projects?: ProjectListEntry[]; recents?: ProjectListEntry[]; native?: boolean };
let controls: { setBusy(value: boolean): void; restore(path: string): void; setFailure(failure: DesktopFailure): void };
function Harness({ options }: { options: Options }) {
  const [projects, setProjects] = useState(options.projects ?? initial);
  const [recents, setRecents] = useState(options.recents ?? recent);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<DesktopFailure | null>(null);
  const scope = useRef<HTMLDivElement>(null);
  const fallback = useRef<HTMLButtonElement>(null);
  controls = { setBusy, setFailure, restore(path) {
    const restore = (entries: ProjectListEntry[]) => entries.map(entry => entry.path === path ? { ...entry, missing: false } : entry);
    setProjects(restore); setRecents(restore);
  } };
  const record = (method: string, ...args: unknown[]) => { calls.push({ method, args }); };
  const open = (path: string) => {
    record('open', path);
    if ([...projects, ...recents].find(entry => entry.path === path)?.missing) setFailure({ ok: false, code: 'missing', message: 'Folder unavailable <details>' });
    else setFailure(null);
  };
  return <div ref={scope} className="project-fixture">
    <nav className="fixture-controls"><LanguageToggle /><ThemeToggle variant="menu" /></nav>
    <button ref={fallback} className="fallback" type="button">Fallback</button><input aria-label="Editable field" />
    <ProjectList projects={projects} disabled={busy} onOpen={open} fallbackFocusRef={fallback} navigationRef={scope} shortcuts={options.native ? 'native' : 'local'}
      onRefresh={() => { record('refresh'); }}
      onRemove={path => { record('remove', path); setProjects(entries => entries.filter(entry => entry.path !== path)); return true; }}
      onMove={(path, index) => { record('move', path, index); setProjects(entries => {
        const next = [...entries]; const [moved] = next.splice(next.findIndex(entry => entry.path === path), 1); next.splice(index, 0, moved); return next;
      }); return true; }} />
    <ProjectList kind="recent" projects={recents} disabled={busy} onOpen={open} fallbackFocusRef={fallback} navigationRef={scope}
      onRemove={path => { record('remove-recent', path); setRecents(entries => entries.filter(entry => entry.path !== path)); return true; }}
      onPin={path => { record('pin', path); setProjects(entries => [...entries, recents.find(entry => entry.path === path)!]); setRecents(entries => entries.filter(entry => entry.path !== path)); return true; }} />
    <ProjectListFeedback failure={failure} disabled={busy} onRetry={() => { record('retry'); setFailure(null); }}
      onChooseFolder={() => { record('choose'); setFailure(null); }} />
  </div>;
}
function render(options: Options = {}) {
  flushSync(() => root.render(null));
  calls.length = 0; clock = now;
  setLang(options.lang ?? 'en');
  localStorage.setItem('deckmate-theme', options.theme ?? 'dark');
  document.documentElement.removeAttribute('data-shell-theme');
  const theme = options.theme ?? 'dark';
  document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches));
  flushSync(() => root.render(<Harness options={options} />));
}
Object.assign(window, { projectTest: {
  render, calls, setLang,
  advance(minutes: number) { clock += minutes * 60_000; for (const tick of minuteTimers.values()) tick(); },
  hidden(value: boolean) { Object.defineProperty(document, 'hidden', { configurable: true, value }); document.dispatchEvent(new Event('visibilitychange')); },
  get timers() { return minuteTimers.size; },
  setBusy(value: boolean) { controls.setBusy(value); },
  restore(path: string) { controls.restore(path); },
  fail(failure: DesktopFailure) { controls.setFailure(failure); },
} });
render();
