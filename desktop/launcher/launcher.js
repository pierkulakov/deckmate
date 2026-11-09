// Deckmate desktop launcher: picks a project folder and hands it to the main process over window.deckmateDesktop.
'use strict';

const texts = {
  en: {
    tagline: 'A project board over the Markdown files in your repository.',
    openFolder: 'Open folder…',
    openHint: 'Pick a project folder on this computer.',
    createProject: 'Create project',
    createHint: 'Creates a sample project in an empty folder, ready to explore.',
    recent: 'Recent projects',
    recentEmpty: 'Nothing opened yet. Projects you open appear here.',
    recentAllPinned: 'All recent projects are in your workspace.',
    workspace: 'Workspace',
    addProject: 'Add project',
    workspaceEmpty: 'Pin the projects you work on and switch between them in one click.',
    addToWorkspace: 'Add to workspace',
    removeFromWorkspace: 'Remove from workspace',
    folderMissing: 'Folder not found',
    reorderHint: 'Move with Alt+Arrow Up or Down',
    remove: 'Remove from the list',
    statusIdle: 'Choose a project to begin.',
    starting: name => `Starting ${name}…`,
    ready: name => `Opening ${name}…`,
    creating: name => `Creating ${name}…`,
    retry: 'Try again',
    errorNotEmpty: 'That folder is not empty. Pick an empty or new folder for a project.',
    errorMissing: 'That folder no longer exists.',
    errorInvalidPath: 'That path cannot be opened as a project.',
    errorNotInWorkspace: 'That project is no longer in the workspace.',
    errorNotRecent: 'That project is no longer in the recent list.',
    errorForbidden: 'That operation is not allowed.',
    errorStart: 'Deckmate could not start in that folder.',
    errorGeneric: 'Deckmate could not start.',
    justNow: 'just now',
    themeToLight: 'Switch to the light theme',
    themeToDark: 'Switch to the dark theme',
    // 2026-11-09: the shell and the server ship as one release with one version; two numbers show only when they drift.
    version: (desktop, server) => (desktop === server ? `Deckmate ${server}` : `Deckmate ${server} · Desktop ${desktop}`),
  },
  ru: {
    tagline: 'Доска проекта над Markdown-файлами вашего репозитория.',
    openFolder: 'Открыть папку…',
    openHint: 'Выберите папку проекта на этом компьютере.',
    createProject: 'Создать проект',
    createHint: 'Создаёт в пустой папке пример проекта, чтобы сразу всё попробовать.',
    recent: 'Недавние проекты',
    recentEmpty: 'Пока ничего не открыто. Открытые проекты появятся здесь.',
    recentAllPinned: 'Все недавние проекты уже в рабочем пространстве.',
    workspace: 'Рабочее пространство',
    addProject: 'Добавить проект',
    workspaceEmpty: 'Закрепите проекты, с которыми работаете, — переключаться между ними можно в один клик.',
    addToWorkspace: 'Добавить в пространство',
    removeFromWorkspace: 'Убрать из пространства',
    folderMissing: 'Папка не найдена',
    reorderHint: 'Переместить: Alt+стрелка вверх или вниз',
    remove: 'Убрать из списка',
    statusIdle: 'Выберите проект, чтобы начать.',
    starting: name => `Запускаю ${name}…`,
    ready: name => `Открываю ${name}…`,
    creating: name => `Создаю ${name}…`,
    retry: 'Повторить',
    errorNotEmpty: 'Папка не пуста. Для проекта нужна пустая или новая папка.',
    errorMissing: 'Этой папки больше нет.',
    errorInvalidPath: 'Этот путь нельзя открыть как проект.',
    errorNotInWorkspace: 'Этого проекта больше нет в рабочем пространстве.',
    errorNotRecent: 'Этого проекта больше нет в списке недавних.',
    errorForbidden: 'Это действие недоступно.',
    errorStart: 'Deckmate не удалось запустить в этой папке.',
    errorGeneric: 'Deckmate не удалось запустить.',
    justNow: 'только что',
    themeToLight: 'Включить светлую тему',
    themeToDark: 'Включить тёмную тему',
    version: (desktop, server) => (desktop === server ? `Deckmate ${server}` : `Deckmate ${server} · Desktop ${desktop}`),
  },
};

// 2026-11-08: a plain browser (design review) has no bridge; the mock keeps the page working with sample data.
const bridge = window.deckmateDesktop ?? mockBridge();

const page = {
  list: document.getElementById('recent-list'),
  empty: document.getElementById('recent-empty'),
  count: document.getElementById('recent-count'),
  workspaceList: document.getElementById('workspace-list'),
  workspace: document.getElementById('workspace'),
  workspaceHint: document.getElementById('workspace-hint'),
  workspaceEmpty: document.getElementById('workspace-empty'),
  workspaceCount: document.getElementById('workspace-count'),
  workspaceAdd: document.getElementById('workspace-add'),
  status: document.getElementById('status'),
  statusText: document.getElementById('status-text'),
  retry: document.getElementById('status-retry'),
  version: document.getElementById('version'),
  openFolder: document.getElementById('open-folder'),
  createProject: document.getElementById('create-project'),
  themeToggle: document.getElementById('theme-toggle'),
  root: document.getElementById('launcher'),
};

let lang = readSetting('deckmate-language') === 'ru' ? 'ru' : 'en';
let state = { recent: [], workspace: [], lastProject: null, version: '', deckmateVersion: '' };
let lastAction = null;
let busy = false;

function text(key, ...args) {
  const value = texts[lang][key];
  return typeof value === 'function' ? value(...args) : value;
}

function readSetting(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeSetting(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

function projectName(folder) {
  return folder.replace(/[\\/]+$/u, '').split(/[\\/]/u).pop() || folder;
}

// Deck colors of the board: a stable pick per project name so the tile matches across launches.
const tilePalette = ['#7a52d6', '#3f8f7c', '#b2742a', '#4d6fb8', '#a84a6e', '#5f8a3a', '#8a5bb0', '#2f7f99'];
function tileColor(name) {
  let hash = 0;
  for (const char of String(name ?? '')) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return tilePalette[hash % tilePalette.length];
}

function relativeTime(iso) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const seconds = Math.round((then - Date.now()) / 1000);
  if (Math.abs(seconds) < 60) return text('justNow');
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  const format = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return text('justNow');
}

function applyTexts() {
  document.documentElement.lang = lang;
  for (const node of document.querySelectorAll('[data-text]')) {
    if (node.id === 'status-text' && page.status.dataset.phase) continue;
    node.textContent = text(node.dataset.text);
  }
  for (const button of document.querySelectorAll('[data-lang]')) {
    button.setAttribute('aria-pressed', String(button.dataset.lang === lang));
  }
  labelThemeToggle();
  renderWorkspace();
  renderRecent();
}

function labelThemeToggle() {
  const dark = document.documentElement.classList.contains('dark');
  page.themeToggle.setAttribute('aria-pressed', String(dark));
  page.themeToggle.setAttribute('aria-label', text(dark ? 'themeToLight' : 'themeToDark'));
  page.themeToggle.title = text(dark ? 'themeToLight' : 'themeToDark');
}

function renderRecent() {
  const recent = visibleRecent();
  page.list.replaceChildren(...recent.map(entry => renderRecentItem(entry)));
  page.empty.hidden = recent.length > 0;
  page.empty.textContent = text(state.recent.length ? 'recentAllPinned' : 'recentEmpty');
  page.count.hidden = recent.length === 0;
  page.count.textContent = String(recent.length);
}

function visibleRecent() {
  return state.recent.filter(entry => !state.workspace.some(candidate => samePath(candidate.path, entry.path)));
}

function samePath(a, b) {
  return a.replace(/\//g, '\\').replace(/[\\]+$/u, '').toLowerCase() === b.replace(/\//g, '\\').replace(/[\\]+$/u, '').toLowerCase();
}

function renderWorkspace() {
  page.workspace.hidden = state.workspace.length === 0 && state.recent.length === 0;
  page.workspaceHint.hidden = state.workspace.length === 0;
  page.workspaceList.replaceChildren(...state.workspace.map((entry, index) => renderRecentItem(entry, index)));
  page.workspaceEmpty.hidden = state.workspace.length > 0;
  page.workspaceCount.hidden = state.workspace.length === 0;
  page.workspaceCount.textContent = String(state.workspace.length);
}

function renderRecentItem(entry, workspaceIndex) {
  const workspace = workspaceIndex !== undefined;
  const item = document.createElement('li');
  item.className = 'recent-item';
  if (workspace && entry.missing) item.classList.add('is-missing');
  if (!workspace) item.classList.add('has-pin');
  if (entry.path === state.lastProject) item.classList.add('is-current');

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'recent-open';
  open.addEventListener('click', () => entry.missing ? remove.focus() : openProject(entry.path));
  open.addEventListener('keydown', event => {
    if (workspace && event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      moveWorkspace(entry.path, workspaceIndex + (event.key === 'ArrowUp' ? -1 : 1));
      return;
    }
    if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      const rows = [...document.querySelectorAll('.project-sections .recent-open')];
      const index = rows.indexOf(open);
      let target = index;
      if (event.key === 'ArrowUp') target = Math.max(0, index - 1);
      if (event.key === 'ArrowDown') target = Math.min(rows.length - 1, index + 1);
      if (event.key === 'Home') target = 0;
      if (event.key === 'End') target = rows.length - 1;
      event.preventDefault();
      rows[target]?.focus();
      return;
    }
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    event.preventDefault();
    if (workspace) changeWorkspace(() => bridge.removeFromWorkspace(entry.path), { index: workspaceIndex, refocus: true });
    else removeRecent(entry.path, { refocus: true });
  });

  const tile = document.createElement('span');
  tile.className = 'recent-tile';
  tile.style.setProperty('--tile', tileColor(entry.name || projectName(entry.path)));
  tile.dataset.initials = (entry.name || projectName(entry.path)).trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 2).map(word => Array.from(word)[0]).join('').toLocaleUpperCase();
  tile.setAttribute('aria-hidden', 'true');

  const name = document.createElement('span');
  name.className = 'recent-name';
  name.textContent = entry.name || projectName(entry.path);

  const when = document.createElement('span');
  when.className = 'recent-when';
  if (workspace && workspaceIndex < 9) {
    const shortcut = document.createElement('kbd');
    shortcut.className = 'shortcut';
    shortcut.textContent = `Ctrl+${workspaceIndex + 1}`;
    when.append(shortcut);
  } else if (!workspace) when.textContent = relativeTime(entry.lastOpened);

  const path = document.createElement('span');
  path.className = 'recent-path';
  const bdi = document.createElement('bdi');
  bdi.textContent = entry.path;
  path.append(bdi);
  path.title = entry.path;

  open.append(tile, name, when, path);
  if (workspace && entry.missing) {
    const missing = document.createElement('span');
    missing.className = 'recent-missing';
    missing.textContent = text('folderMissing');
    open.append(missing);
  }

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'recent-remove';
  remove.setAttribute('aria-label', text(workspace ? 'removeFromWorkspace' : 'remove'));
  remove.title = text(workspace ? 'removeFromWorkspace' : 'remove');
  remove.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  remove.addEventListener('click', event => {
    event.stopPropagation();
    // detail 0 means the button was pressed from the keyboard; focus then follows to the next row.
    if (workspace) changeWorkspace(() => bridge.removeFromWorkspace(entry.path), { index: workspaceIndex, refocus: event.detail === 0 });
    else removeRecent(entry.path, { refocus: event.detail === 0 });
  });

  item.append(open);
  if (!workspace) {
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'recent-remove recent-pin';
    pin.setAttribute('aria-label', text('addToWorkspace'));
    pin.title = text('addToWorkspace');
    pin.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m16 3 5 5-3 1-3 4v4l-2 2-3-5-5-3 2-2h4l4-3z"/><path d="m10 14-6 6"/></svg>';
    pin.addEventListener('click', () => changeWorkspace(
      () => bridge.addToWorkspace(entry.path),
      { recentIndex: visibleRecent().findIndex(candidate => samePath(candidate.path, entry.path)) },
    ));
    item.append(pin);
  }
  item.append(remove);
  return item;
}

async function changeWorkspace(action, { index = 0, refocus = false, recentIndex = null } = {}) {
  if (busy) return;
  setBusy(true);
  try {
    const result = await action();
    if (!result?.ok) {
      if (result?.code !== 'cancelled') setStatus('error', describeError(result));
      return;
    }
    state.workspace = result.workspace;
    renderWorkspace();
    renderRecent();
    setStatus(null);
    setBusy(false);
    if (refocus) {
      const rows = page.workspaceList.querySelectorAll('.recent-open');
      (rows[Math.min(Math.max(index, 0), rows.length - 1)] ?? (page.workspace.hidden ? page.openFolder : page.workspaceAdd)).focus();
    }
    if (recentIndex !== null) {
      const rows = page.list.querySelectorAll('.recent-open');
      (rows[Math.min(recentIndex, rows.length - 1)] ?? page.openFolder).focus();
    }
  } catch (error) {
    setStatus('error', describeError({ message: error?.message }));
  } finally {
    setBusy(false);
  }
}

function moveWorkspace(folder, index) {
  const target = Math.min(Math.max(index, 0), state.workspace.length - 1);
  if (samePath(state.workspace[target].path, folder)) return;
  return changeWorkspace(() => bridge.moveInWorkspace(folder, target), { index: target, refocus: true });
}

async function chooseAndAdd() {
  if (busy) return;
  try {
    const folder = await bridge.chooseFolder();
    if (folder) await changeWorkspace(() => bridge.addToWorkspace(folder));
  } catch (error) {
    setStatus('error', describeError({ message: error?.message }));
  }
}

async function removeRecent(folder, { refocus = false } = {}) {
  if (busy) return;
  const index = visibleRecent().findIndex(candidate => samePath(candidate.path, folder));
  setBusy(true);
  try {
    const result = await bridge.removeRecent(folder);
    if (!result?.ok) { setStatus('error', describeError(result)); return; }
    state.recent = state.recent.filter(candidate => candidate.path !== folder);
    renderWorkspace();
    renderRecent();
    setStatus(null);
    setBusy(false);
    if (!refocus) return;
    const rows = page.list.querySelectorAll('.recent-open');
    const next = rows[Math.min(Math.max(index, 0), rows.length - 1)];
    (next ?? page.openFolder).focus();
  } catch (error) {
    setStatus('error', describeError({ message: error?.message }));
  } finally {
    setBusy(false);
  }
}

function setStatus(phase, message, retry = null) {
  if (phase) page.status.dataset.phase = phase; else delete page.status.dataset.phase;
  page.statusText.textContent = message ?? text('statusIdle');
  lastAction = retry;
  page.retry.hidden = retry === null;
  if (phase === 'error' && retry && document.activeElement === document.body) page.retry.focus();
}

function setBusy(value) {
  busy = value;
  page.openFolder.disabled = value;
  page.createProject.disabled = value;
  page.workspaceAdd.disabled = value;
  for (const button of document.querySelectorAll('.project-sections .recent-list button')) button.disabled = value;
}

const errorTexts = { 'not-empty': 'errorNotEmpty', missing: 'errorMissing', 'invalid-path': 'errorInvalidPath', 'not-in-workspace': 'errorNotInWorkspace', 'not-recent': 'errorNotRecent', forbidden: 'errorForbidden', 'start-failed': 'errorStart', 'load-failed': 'errorStart', timeout: 'errorStart' };

function describeError(result) {
  if (result?.code === 'save-failed' && result.message) return result.message;
  const key = errorTexts[result?.code];
  if (key && !result?.message) return text(key);
  if (key) return `${text(key)} ${result.message}`;
  return result?.message ? `${text('errorGeneric')} ${result.message}` : text('errorGeneric');
}

async function run(label, action, retry) {
  if (busy) return;
  setBusy(true);
  setStatus('starting', label);
  try {
    const result = await action();
    if (result && result.ok === false) {
      setStatus('error', describeError(result), retry);
      setBusy(false);
    }
  } catch (error) {
    setStatus('error', describeError({ message: error?.message }), retry);
    setBusy(false);
  }
}

function openProject(folder) {
  const name = projectName(folder);
  return run(text('starting', name), () => bridge.openProject(folder), () => openProject(folder));
}

async function chooseAndOpen() {
  if (busy) return;
  const folder = await bridge.chooseFolder();
  if (folder) await openProject(folder);
}

async function chooseAndCreate() {
  if (busy) return;
  const folder = await bridge.chooseFolder();
  if (!folder) return;
  const name = projectName(folder);
  await run(text('creating', name), () => bridge.createProject({ folder }), () => chooseAndCreate());
}

function handleStatus(event) {
  const name = event.path ? projectName(event.path) : '';
  if (event.phase === 'starting') { setBusy(true); setStatus('starting', event.message ?? text('starting', name)); }
  else if (event.phase === 'ready') { setStatus('ready', event.message ?? text('ready', name)); }
  else if (event.phase === 'error') {
    setStatus('error', event.message ?? text('errorGeneric'), event.path ? () => openProject(event.path) : null);
    setBusy(false);
  }
}

function setTheme(theme) {
  document.documentElement.classList.toggle('dark', theme !== 'light');
  writeSetting('deckmate-theme', theme);
  labelThemeToggle();
}

page.openFolder.addEventListener('click', chooseAndOpen);
page.createProject.addEventListener('click', chooseAndCreate);
page.workspaceAdd.addEventListener('click', chooseAndAdd);
page.retry.addEventListener('click', () => { if (lastAction) lastAction(); });
page.themeToggle.addEventListener('click', () => setTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark'));
for (const button of document.querySelectorAll('[data-lang]')) {
  button.addEventListener('click', async () => {
    try {
      const next = button.dataset.lang;
      const result = await bridge.setLanguage?.(next);
      if (result?.ok === false) { setStatus('error', describeError(result)); return; }
      lang = next;
      writeSetting('deckmate-language', lang);
      applyTexts();
      setStatus(null);
    } catch (error) {
      setStatus('error', describeError({ message: error?.message }));
    }
  });
}
// Ctrl+O belongs to the application menu in main; a page-level handler would open a second dialog.

bridge.onStatus?.(handleStatus);

(async () => {
  try {
    state = { ...state, ...(await bridge.getState()) };
    // Language priority: the page's own saved choice, then the shell's setting, then the system locale.
    if (!readSetting('deckmate-language')) {
      if (state.language === 'en' || state.language === 'ru') lang = state.language;
      else if (typeof state.locale === 'string' && state.locale.toLowerCase().startsWith('ru')) lang = 'ru';
    }
  } catch {
    // The page still works without state: an empty list and the default texts.
  }
  page.version.textContent = text('version', state.version || '—', state.deckmateVersion || '—');
  applyTexts();
  page.root.removeAttribute('aria-busy');
  (document.querySelector('.project-sections .recent-open') ?? page.openFolder).focus();
})();

function mockBridge() {
  const now = Date.now();
  const recent = [
    { path: 'D:\\Projects\\Hollow Signal', name: 'Hollow Signal', lastOpened: new Date(now - 90e3).toISOString() },
    { path: 'D:\\Projects\\demo', name: 'demo', lastOpened: new Date(now - 5 * 3600e3).toISOString() },
    { path: 'C:\\Users\\Someone\\Documents\\Долгий путь к релизу', name: 'Долгий путь к релизу', lastOpened: new Date(now - 3 * 86400e3).toISOString() },
  ];
  let workspace = [
    { path: recent[0].path, name: recent[0].name, missing: false },
    { path: recent[2].path, name: recent[2].name, missing: false },
    { path: 'D:\\Projects\\Old project', name: 'Old project', missing: true },
  ];
  return {
    async getState() { return { recent, workspace, lastProject: recent[0].path, version: '0.3.0', deckmateVersion: '0.3.0', locale: 'en-US' }; },
    async chooseFolder() { return 'D:\\Projects\\New Deck'; },
    async openProject() { await new Promise(resolve => setTimeout(resolve, 1200)); return { ok: false, code: 'missing' }; },
    async createProject() { await new Promise(resolve => setTimeout(resolve, 900)); return { ok: false, code: 'not-empty' }; },
    async removeRecent() { return { ok: true }; },
    async addToWorkspace(folder) { if (!workspace.some(entry => samePath(entry.path, folder))) workspace = [...workspace, { path: folder, name: projectName(folder), missing: false }]; return { ok: true, workspace }; },
    async removeFromWorkspace(folder) { workspace = workspace.filter(entry => !samePath(entry.path, folder)); return { ok: true, workspace }; },
    async moveInWorkspace(folder, index) { const from = workspace.findIndex(entry => samePath(entry.path, folder)); if (from < 0) return { ok: false, code: 'not-in-workspace' }; const [entry] = workspace.splice(from, 1); workspace.splice(Math.max(0, Math.min(index, workspace.length)), 0, entry); return { ok: true, workspace }; },
    async setLanguage() { return { ok: true }; },
    async revealInFolder() { return { ok: true }; },
    onStatus() { return () => {}; },
  };
}

// The deal plays once the window is actually on screen; two frames let the paused first frame paint before it runs.
const deal = () => requestAnimationFrame(() => requestAnimationFrame(() => page.root.classList.add('is-shown')));
if (document.visibilityState === 'visible') deal(); else document.addEventListener('visibilitychange', deal, { once: true });
