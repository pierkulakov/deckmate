import type { DesktopShell, DesktopState, DesktopStatus } from '../desktop-bridge.ts';
import { projectPathKey } from '../project-path.ts';

/** 2026-11-13: only vite serve and explicit test fixtures import this module; production has no URL fixtures. */
export function createStartMock(params = new URLSearchParams(location.search)): DesktopShell {
  const scenario = params.get('scenario');
  const now = Date.now();
  let recent: DesktopState['recent'] = [
    { path: 'D:\\Projects\\Hollow Signal', name: 'Hollow Signal', lastOpened: new Date(now - 90e3).toISOString(), missing: false, current: false },
    { path: 'D:\\Projects\\demo', name: 'demo', lastOpened: new Date(now - 5 * 3600e3).toISOString(), missing: false, current: false },
    { path: 'C:\\Users\\Someone\\Documents\\Долгий путь к релизу', name: 'Долгий путь к релизу', lastOpened: new Date(now - 3 * 86400e3).toISOString(), missing: false, current: false },
  ];
  let projects = [recent[0], recent[2], { path: 'D:\\Projects\\Old project', name: 'Old project', missing: true, current: false }];
  if (scenario === 'many') {
    recent = Array.from({ length: 10 }, (_, index) => ({
      path: `D:\\Команда разработки\\Проекты с длинными названиями\\Подготовка первого публичного релиза\\Проект ${index + 1} — Очень длинное русское название с пробелами`,
      name: `Проект ${index + 1} — Очень длинное русское название с пробелами`,
      lastOpened: new Date(now - index * 86400e3).toISOString(), missing: false, current: false,
    }));
    projects = Array.from({ length: 30 }, (_, index) => ({
      path: `D:\\Рабочие проекты\\Закреплённый проект ${index + 1}`, name: `Закреплённый проект ${index + 1}`, missing: index === 2, current: false,
    }));
  }
  if (scenario === 'empty' || scenario === 'create') { recent = []; projects = []; }
  if (scenario === 'one') { recent = recent.slice(0, 1); projects = []; }
  if (scenario === 'missing') { recent = recent.map(entry => ({ ...entry, missing: true })); projects = projects.map(entry => ({ ...entry, missing: true })); }
  let listener: (status: DesktopStatus) => void = () => {};
  let generation = 0;
  let first = true;
  const matches = (a: string, b: string) => projectPathKey(a) === projectPathKey(b);
  const result = () => ({ ok: true as const, projects: [...projects], current: null });
  return {
    async getState() {
      if (first) {
        first = false;
        setTimeout(() => {
          if (scenario === 'opening') document.querySelector<HTMLButtonElement>('#last-list .mission-control-workspace-open')?.click();
          if (scenario === 'create') document.getElementById('create-project')?.click();
          if (scenario === 'error') listener({ phase: 'error', code: params.get('error') || 'missing', path: recent[0]?.path,
            message: 'Mock: diagnostic details from the local server.\nProject files are retained.' });
        }, 50);
      }
      return { ...result(), recent: [...recent], lastProject: recent[0]?.path ?? null, version: '0.8.0', deckmateVersion: '0.8.0', locale: 'en-US',
        language: document.documentElement.lang === 'ru' ? 'ru' : 'en', theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light' };
    },
    async chooseFolder() { return 'D:\\Projects\\New Deck'; },
    async openProject(path) {
      const id = ++generation;
      listener({ phase: 'starting', path });
      await new Promise(resolve => setTimeout(resolve, scenario === 'opening' ? 20000 : 1200));
      return { ok: false, code: id !== generation ? 'superseded' : (scenario === 'opening' ? 'timeout' : 'missing') };
    },
    async createProject() { await new Promise(resolve => setTimeout(resolve, 900)); return { ok: false, code: 'not-empty' }; },
    async removeRecent(path) { recent = recent.filter(entry => !matches(entry.path, path)); return { ok: true, projects: [...recent], current: null }; },
    async addToWorkspace(path) {
      if (!projects.some(entry => matches(entry.path, path))) projects = [...projects, { path, name: path.split(/[\\/]/u).pop() || path, missing: false, current: false }];
      return result();
    },
    async removeFromWorkspace(path) { projects = projects.filter(entry => !matches(entry.path, path)); return result(); },
    async moveInWorkspace(path, index) {
      const from = projects.findIndex(entry => matches(entry.path, path));
      if (from < 0) return { ok: false, code: 'not-in-workspace' };
      const [entry] = projects.splice(from, 1); projects.splice(Math.max(0, Math.min(index, projects.length)), 0, entry);
      return result();
    },
    async setLanguage() { return { ok: true }; },
    async setTheme() { return { ok: true }; },
    onStatus(callback) { listener = callback; return () => { listener = () => {}; }; },
  };
}

export function installStartMock(): DesktopShell {
  const bridge = createStartMock();
  window.deckmateDesktop = bridge;
  return bridge;
}
