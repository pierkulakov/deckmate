// Deckmate desktop launcher: picks a project folder and hands it to the main process over window.deckmateDesktop.
'use strict';

const texts = {
  en: {
    tagline: 'A project board for your Markdown files.',
    ownership: 'Your files stay yours: plain Markdown in your folder. No account or cloud required.',
    openFolder: 'Open folder…',
    openHint: 'Choose an existing folder. Network folders must be selected in the folder dialog.',
    createProject: 'Create project…',
    createHint: 'Choose a new or empty folder for a demo project. Existing files are never replaced.',
    welcomeTitle: 'Start with a project',
    welcomeIntro: 'Keep tasks, design notes and team work together, in files you can read and edit outside Deckmate.',
    welcomeFolder: 'Choose an empty folder with “Create project”.',
    welcomeDemo: 'Explore the demo: decks group cards, cards describe the work.',
    welcomeWork: 'Open a card to edit it, or add your first task in a deck.',
    templateTitle: 'Want a project template?',
    templateHelp: 'On the board, open the project menu → Start from template. Choose Games (Platformer, RPG, Strategy and more) or Software (Web app, CLI tool and more), preview the structure and choose whether to add sample cards. Creating here always starts with the demo.',
    createTitle: 'Create a demo project',
    createSummary: 'Deckmate will add example Markdown files and open the board in this folder:',
    createNext: 'The folder must be new or empty. Start by opening a sample card; project templates and their optional samples are available later in the board’s project menu.',
    createConfirm: 'Create and open',
    back: 'Back',
    lastProject: 'Last project',
    moveUp: 'Move up',
    moveDown: 'Move down',
    removed: 'Removed from the list. Project files were not deleted.',
    workspaceUpdated: 'Workspace updated.',
    details: 'Technical details',
    waitingOpen: 'The local server may take up to 20 seconds. You can open another project instead.',
    waitingCreate: 'Creating the demo may take up to a minute. You can open another project instead.',
    recent: 'Recent projects',
    recentEmpty: 'Nothing opened yet. Projects you open appear here.',
    recentEmptyOther: 'No other recent projects. Open another folder to add it here.',
    workspace: 'Workspace',
    addProject: 'Add project…',
    workspaceEmpty: 'Pin the projects you work on and switch between them in one click.',
    addToWorkspace: 'Add to workspace',
    removeFromWorkspace: 'Remove from workspace',
    folderMissing: 'Folder not found',
    reorderHint: 'Move with Alt+Arrow Up or Down',
    remove: 'Remove from the list',
    languageGroup: 'Language',
    statusIdle: 'Choose a project to begin.',
    starting: name => `Starting ${name}…`,
    ready: name => `Opening ${name}…`,
    creating: name => `Creating ${name}…`,
    retry: 'Try again',
    chooseFolder: 'Choose folder…',
    errorNotEmpty: 'The folder is not empty. Choose a new or empty folder, or use “Open folder” to open its existing files.',
    errorMissing: 'The folder was not found. Reconnect the drive or network, or choose its new location with “Open folder”.',
    errorInvalidPath: 'This path is not available. Choose a readable folder in the folder dialog (required for network folders). If the path is too long, try a shorter location.',
    errorNotInWorkspace: 'That project is no longer in the workspace. Add it again with “Add project”.',
    errorNotRecent: 'That project is no longer in the recent list. Select it with “Open folder”.',
    errorForbidden: 'This action is not allowed from this window. Return to the start screen and try again.',
    errorStart: 'The local server could not start. Try again; if it fails again, open Help → Open logs folder.',
    errorCreate: 'The project could not be created. Check write access and free disk space, then choose an empty folder. Some files may have been created; check them before retrying.',
    errorTimeout: 'The server did not respond within 20 seconds. Reconnect the drive if needed, then try again or open another project.',
    errorLoad: 'The project window could not load. Try opening it again. If this repeats, open Help → Open logs folder.',
    errorSave: 'Settings could not be saved. Check free disk space and access to the Deckmate settings folder, then repeat the action. Project files were not deleted.',
    errorGeneric: 'The action could not be completed. Try again or choose another folder. Technical details may help diagnose the problem.',
    justNow: 'just now',
    themeToLight: 'Switch to the light theme',
    themeToDark: 'Switch to the dark theme',
    // 2026-11-09: the shell and the server ship as one release with one version; two numbers show only when they drift.
    version: (desktop, server) => (desktop === server ? `Deckmate ${server}` : `Deckmate ${server} · Desktop ${desktop}`),
  },
  ru: {
    tagline: 'Доска задач и заметок на ваших Markdown-файлах.',
    ownership: 'Файлы остаются вашими: обычный Markdown в вашей папке. Без аккаунта и облака.',
    openFolder: 'Открыть папку…',
    openHint: 'Выберите существующую папку. Сетевые папки нужно выбирать через диалог.',
    createProject: 'Создать проект…',
    createHint: 'Выберите новую или пустую папку для демо-проекта. Существующие файлы не заменяются.',
    welcomeTitle: 'Начните с проекта',
    welcomeIntro: 'Задачи, заметки о дизайне и работа команды — в файлах, которые можно читать и менять без Deckmate.',
    welcomeFolder: 'Нажмите «Создать проект» и выберите пустую папку.',
    welcomeDemo: 'Изучите демо: колоды объединяют карточки, карточки описывают работу.',
    welcomeWork: 'Откройте карточку для редактирования или добавьте в колоду свою первую задачу.',
    templateTitle: 'Нужен шаблон проекта?',
    templateHelp: 'На доске откройте меню проекта → «Начать с шаблона». Выберите «Игры» (платформер, RPG, стратегия и другие) или «Софт» (веб-приложение, CLI-инструмент и другие), посмотрите структуру и решите, добавлять ли примеры карточек. Здесь всегда создаётся демо-проект.',
    createTitle: 'Создание демо-проекта',
    createSummary: 'Deckmate добавит примеры Markdown-файлов и откроет доску в этой папке:',
    createNext: 'Нужна новая или пустая папка. Начните с открытия примера карточки; шаблоны проектов и их необязательные примеры доступны затем в меню проекта на доске.',
    createConfirm: 'Создать и открыть',
    back: 'Назад',
    lastProject: 'Последний проект',
    moveUp: 'Переместить выше',
    moveDown: 'Переместить ниже',
    removed: 'Убрано из списка. Файлы проекта не удалены.',
    workspaceUpdated: 'Рабочее пространство обновлено.',
    details: 'Технические подробности',
    waitingOpen: 'Запуск локального сервера может занять до 20 секунд. Можно открыть другой проект.',
    waitingCreate: 'Создание демо может занять до минуты. Можно открыть другой проект.',
    recent: 'Недавние проекты',
    recentEmpty: 'Пока ничего не открыто. Открытые проекты появятся здесь.',
    recentEmptyOther: 'Других недавних проектов пока нет. Откройте другую папку, чтобы добавить её сюда.',
    workspace: 'Рабочее пространство',
    addProject: 'Добавить проект…',
    workspaceEmpty: 'Закрепите проекты, с которыми работаете, — переключаться между ними можно в один клик.',
    addToWorkspace: 'Добавить в пространство',
    removeFromWorkspace: 'Убрать из пространства',
    folderMissing: 'Папка не найдена',
    reorderHint: 'Переместить: Alt+стрелка вверх или вниз',
    remove: 'Убрать из списка',
    languageGroup: 'Язык',
    statusIdle: 'Выберите проект, чтобы начать.',
    starting: name => `Запускаем ${name}…`,
    ready: name => `Открываем ${name}…`,
    creating: name => `Создаём ${name}…`,
    retry: 'Повторить',
    chooseFolder: 'Выбрать папку…',
    errorNotEmpty: 'Папка не пуста. Выберите новую или пустую папку либо нажмите «Открыть папку», чтобы открыть существующие файлы.',
    errorMissing: 'Папка не найдена. Подключите диск или сеть либо выберите её новое расположение через «Открыть папку».',
    errorInvalidPath: 'Этот путь недоступен. Выберите папку с доступом на чтение через диалог (для сетевых папок это обязательно). Если путь слишком длинный, попробуйте более короткий.',
    errorNotInWorkspace: 'Этого проекта больше нет в рабочем пространстве. Добавьте его заново через «Добавить проект».',
    errorNotRecent: 'Этого проекта больше нет в списке недавних. Выберите его через «Открыть папку».',
    errorForbidden: 'Это действие недоступно из текущего окна. Вернитесь на стартовый экран и повторите попытку.',
    errorStart: 'Не удалось запустить локальный сервер. Повторите попытку; если ошибка повторится, откройте «Справка → Открыть папку журналов».',
    errorCreate: 'Не удалось создать проект. Проверьте права на запись и свободное место, затем выберите пустую папку. Часть файлов могла быть создана — проверьте их перед повтором.',
    errorTimeout: 'Сервер не ответил за 20 секунд. При необходимости подключите диск, затем повторите попытку или откройте другой проект.',
    errorLoad: 'Не удалось загрузить окно проекта. Откройте его ещё раз. Если ошибка повторится, откройте «Справка → Открыть папку журналов».',
    errorSave: 'Не удалось сохранить настройки. Проверьте свободное место и доступ к папке настроек Deckmate, затем повторите действие. Файлы проекта не удалены.',
    errorGeneric: 'Не удалось выполнить действие. Повторите попытку или выберите другую папку. Технические подробности помогут выяснить причину.',
    justNow: 'только что',
    themeToLight: 'Включить светлую тему',
    themeToDark: 'Включить тёмную тему',
    version: (desktop, server) => (desktop === server ? `Deckmate ${server}` : `Deckmate ${server} · Desktop ${desktop}`),
  },
};

// 2026-11-08: a plain browser has no bridge; the mock keeps the page working with sample data.
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
  lastProject: document.getElementById('last-project'),
  lastList: document.getElementById('last-list'),
  recent: document.getElementById('recent'),
  welcome: document.getElementById('welcome'),
  createPanel: document.getElementById('create-panel'),
  createFolder: document.getElementById('create-folder'),
  createConfirm: document.getElementById('create-confirm'),
  createBack: document.getElementById('create-back'),
  details: document.getElementById('status-details'),
  technical: document.getElementById('status-technical'),
};

let lang = readSetting('deckmate-language') === 'ru' ? 'ru' : 'en';
let state = { recent: [], workspace: [], lastProject: null, version: '', deckmateVersion: '' };
let lastAction = null;
let busy = false;
let opening = false;
let activeFolder = null;
let launchId = 0;
let chosenFolder = null;
let statusModel = { phase: null, message: null, retry: null };

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
  document.querySelector('.segment')?.setAttribute('aria-label', text('languageGroup'));
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
  renderStatus();
}

function labelThemeToggle() {
  const dark = document.documentElement.classList.contains('dark');
  page.themeToggle.setAttribute('aria-pressed', String(dark));
  page.themeToggle.setAttribute('aria-label', text(dark ? 'themeToLight' : 'themeToDark'));
  page.themeToggle.title = text(dark ? 'themeToLight' : 'themeToDark');
}

function renderRecent() {
  const last = lastEntry();
  page.lastProject.hidden = !last;
  page.lastList.replaceChildren(...(last ? [renderRecentItem(last)] : []));
  const recent = visibleRecent();
  page.list.replaceChildren(...recent.map(entry => renderRecentItem(entry)));
  page.empty.hidden = recent.length > 0;
  page.empty.textContent = text(state.recent.length ? 'recentEmptyOther' : 'recentEmpty');
  page.count.hidden = recent.length === 0;
  page.count.textContent = String(recent.length);
  const firstRun = state.recent.length === 0 && state.workspace.length === 0;
  page.welcome.hidden = !firstRun || !page.createPanel.hidden;
  page.recent.hidden = firstRun;
  page.root.classList.toggle('is-first-run', firstRun);
  page.openFolder.classList.toggle('button-primary', !firstRun);
  page.openFolder.classList.toggle('button-secondary', firstRun);
  page.createProject.classList.toggle('button-primary', firstRun);
  page.createProject.classList.toggle('button-secondary', !firstRun);
  const actions = document.getElementById('actions');
  const firstAction = firstRun ? page.createProject.parentElement : page.openFolder.parentElement;
  if (actions.firstElementChild !== firstAction) actions.prepend(firstAction);
  setBusy(busy, opening);
}

function lastEntry() {
  if (!state.lastProject) return null;
  const recent = state.recent.find(entry => samePath(entry.path, state.lastProject));
  const pinned = state.workspace.find(entry => samePath(entry.path, state.lastProject));
  if (recent) return { ...recent, missing: recent.missing || pinned?.missing };
  return pinned ?? null;
}

function visibleRecent() {
  return state.recent.filter(entry => !samePath(entry.path, state.lastProject || '')
    && !state.workspace.some(candidate => samePath(candidate.path, entry.path)));
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
  const canPin = !workspace && !state.workspace.some(candidate => samePath(candidate.path, entry.path));
  const item = document.createElement('li');
  item.className = 'recent-item';
  if (entry.missing) item.classList.add('is-missing');
  if (canPin) item.classList.add('has-pin');

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'recent-open';
  open.title = `${entry.name || projectName(entry.path)}\n${entry.path}`;
  open.setAttribute('aria-label', `${entry.name || projectName(entry.path)}: ${entry.path}${entry.missing ? ` — ${text('folderMissing')}` : ''}`);
  open.dataset.path = entry.path;
  if (entry.missing) open.setAttribute('aria-disabled', 'true');
  open.addEventListener('click', () => {
    if (entry.missing) { setStatus('error', { code: 'missing' }); return; }
    openProject(entry.path);
  });
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
  name.title = name.textContent;

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
  if (entry.missing) {
    const missing = document.createElement('span');
    missing.className = 'recent-missing';
    missing.textContent = text('folderMissing');
    open.append(missing);
  }

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'recent-remove';
  remove.setAttribute('aria-label', `${text(workspace ? 'removeFromWorkspace' : 'remove')}: ${name.textContent}`);
  remove.title = text(workspace ? 'removeFromWorkspace' : 'remove');
  remove.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  remove.addEventListener('click', event => {
    event.stopPropagation();
    // detail 0 means the button was pressed from the keyboard; focus then follows to the next row.
    if (workspace) changeWorkspace(() => bridge.removeFromWorkspace(entry.path), { index: workspaceIndex, refocus: event.detail === 0 });
    else removeRecent(entry.path, { refocus: event.detail === 0 });
  });

  item.append(open);
  if (canPin) {
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'recent-remove recent-pin';
    pin.setAttribute('aria-label', `${text('addToWorkspace')}: ${name.textContent}`);
    pin.title = text('addToWorkspace');
    pin.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m16 3 5 5-3 1-3 4v4l-2 2-3-5-5-3 2-2h4l4-3z"/><path d="m10 14-6 6"/></svg>';
    pin.addEventListener('click', () => changeWorkspace(
      () => bridge.addToWorkspace(entry.path),
      { recentIndex: visibleRecent().findIndex(candidate => samePath(candidate.path, entry.path)) },
    ));
    item.append(pin);
  }
  if (workspace) {
    item.classList.add('has-order');
    for (const direction of [-1, 1]) {
      const move = document.createElement('button');
      move.type = 'button';
      move.className = `recent-remove recent-move ${direction < 0 ? 'move-up' : 'move-down'}`;
      const label = text(direction < 0 ? 'moveUp' : 'moveDown');
      move.setAttribute('aria-label', `${label}: ${name.textContent}`);
      move.title = label;
      move.dataset.edge = String(workspaceIndex + direction < 0 || workspaceIndex + direction >= state.workspace.length);
      move.disabled = move.dataset.edge === 'true';
      move.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${direction < 0 ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'}"/></svg>`;
      move.addEventListener('click', () => moveWorkspace(entry.path, workspaceIndex + direction));
      item.append(move);
    }
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
      if (result?.code !== 'cancelled') setStatus('error', result);
      return;
    }
    state.workspace = result.workspace;
    renderWorkspace();
    renderRecent();
    setStatus('success', { key: 'workspaceUpdated' });
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
    setStatus('error', { message: error?.message });
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
    setStatus('error', { message: error?.message });
  }
}

async function removeRecent(folder, { refocus = false } = {}) {
  if (busy) return;
  const index = visibleRecent().findIndex(candidate => samePath(candidate.path, folder));
  setBusy(true);
  try {
    const result = await bridge.removeRecent(folder);
    if (!result?.ok) { setStatus('error', result); return; }
    state.recent = state.recent.filter(candidate => !samePath(candidate.path, folder));
    if (samePath(state.lastProject || '', folder)) state.lastProject = null;
    renderWorkspace();
    renderRecent();
    setStatus('success', { key: 'removed' });
    setBusy(false);
    if (!refocus) return;
    const rows = page.list.querySelectorAll('.recent-open');
    const next = rows[Math.min(Math.max(index, 0), rows.length - 1)];
    (next ?? page.openFolder).focus();
  } catch (error) {
    setStatus('error', { message: error?.message });
  } finally {
    setBusy(false);
  }
}

function setStatus(phase, message, retry = null) {
  statusModel = { phase, message, retry };
  renderStatus();
  if (phase === 'error' && retry && document.activeElement === document.body) page.retry.focus();
}

function renderStatus() {
  const { phase, message, retry } = statusModel;
  if (phase) page.status.dataset.phase = phase; else delete page.status.dataset.phase;
  let label = message ?? text('statusIdle');
  if (message && typeof message === 'object') {
    label = message.key ? text(message.key, ...(message.args || [])) : describeError(message);
  }
  if (phase === 'starting') label += ` ${text(opening === 'creating' ? 'waitingCreate' : 'waitingOpen')}`;
  page.statusText.textContent = label;
  page.details.hidden = phase !== 'error' || !message?.message;
  page.technical.textContent = message?.message || '';
  if (page.details.hidden) page.details.open = false;
  lastAction = retry;
  page.retry.hidden = retry === null;
  page.retry.textContent = text('retry');
  if (retry && ['missing', 'invalid-path', 'not-empty', 'create-failed'].includes(message?.code)) {
    page.retry.textContent = text('chooseFolder');
    lastAction = ['not-empty', 'create-failed'].includes(message.code) ? chooseAndCreate : chooseAndOpen;
  }
}

function setBusy(value, launch = false) {
  busy = value;
  opening = value && launch;
  page.openFolder.disabled = value && !opening;
  page.createProject.disabled = value;
  page.workspaceAdd.disabled = value;
  page.createConfirm.disabled = value;
  for (const button of document.querySelectorAll('.project-sections .recent-list button')) {
    if (button.classList.contains('recent-open')) {
      const active = value && opening && samePath(button.dataset.path, activeFolder || '');
      button.disabled = value && !opening;
      button.setAttribute('aria-busy', String(Boolean(active)));
      button.classList.toggle('is-opening', Boolean(active));
    } else button.disabled = value || button.dataset.edge === 'true';
  }
}

const errorTexts = { 'not-empty': 'errorNotEmpty', missing: 'errorMissing', 'invalid-path': 'errorInvalidPath', 'not-in-workspace': 'errorNotInWorkspace', 'not-recent': 'errorNotRecent', forbidden: 'errorForbidden', 'create-failed': 'errorCreate', 'start-failed': 'errorStart', 'load-failed': 'errorLoad', timeout: 'errorTimeout', 'save-failed': 'errorSave' };

function describeError(result) {
  return text(errorTexts[result?.code] || 'errorGeneric');
}

async function run(label, action, retry, folder, kind = 'opening') {
  if (busy && !opening) return;
  const id = ++launchId;
  activeFolder = folder;
  setBusy(true, kind);
  setStatus('starting', label);
  try {
    const result = await action();
    // 2026-11-10: the shell supersedes launches; an older reply must not replace the new project's progress.
    if (id !== launchId) return;
    if (result && result.ok === false) {
      setBusy(false);
      if (['superseded', 'closed', 'cancelled'].includes(result.code)) { setStatus(null); return; }
      setStatus('error', result, retry);
    }
  } catch (error) {
    if (id !== launchId) return;
    setBusy(false);
    setStatus('error', { message: error?.message }, retry);
  }
}

function openProject(folder) {
  hideCreate();
  const name = projectName(folder);
  return run({ key: 'starting', args: [name] }, () => bridge.openProject(folder), () => openProject(folder), folder);
}

async function chooseAndOpen() {
  if (busy && !opening) return;
  try {
    const folder = await bridge.chooseFolder();
    if (folder) await openProject(folder);
  } catch (error) { setStatus('error', { message: error?.message }); }
}

async function chooseAndCreate() {
  if (busy) return;
  try {
    const folder = await bridge.chooseFolder();
    if (!folder) return;
    chosenFolder = folder;
    page.createFolder.textContent = folder;
    page.createPanel.hidden = false;
    page.welcome.hidden = true;
    document.getElementById('create-heading').focus();
  } catch (error) { setStatus('error', { message: error?.message }); }
}

function hideCreate() {
  chosenFolder = null;
  page.createPanel.hidden = true;
  page.welcome.hidden = state.recent.length > 0 || state.workspace.length > 0;
}

function confirmCreate() {
  if (!chosenFolder || busy) return;
  const folder = chosenFolder;
  hideCreate();
  return run({ key: 'creating', args: [projectName(folder)] }, () => bridge.createProject({ folder }), chooseAndCreate, folder, 'creating');
}

function handleStatus(event) {
  if (activeFolder && event.path && !samePath(activeFolder, event.path)) return;
  if (['superseded', 'closed', 'cancelled'].includes(event.code)) return;
  const name = event.path ? projectName(event.path) : '';
  if (event.phase === 'starting') {
    activeFolder = event.path;
    const kind = opening || 'opening';
    setBusy(true, kind);
    setStatus('starting', { key: kind === 'creating' ? 'creating' : 'starting', args: [name] });
  }
  else if (event.phase === 'ready') { setStatus('ready', { key: 'ready', args: [name] }); }
  else if (event.phase === 'error') {
    setBusy(false);
    setStatus('error', event, event.path ? () => openProject(event.path) : null);
  }
}

function setTheme(theme) {
  document.documentElement.classList.toggle('dark', theme !== 'light');
  writeSetting('deckmate-theme', theme);
  labelThemeToggle();
}

page.openFolder.addEventListener('click', chooseAndOpen);
page.createProject.addEventListener('click', chooseAndCreate);
page.createConfirm.addEventListener('click', confirmCreate);
page.createBack.addEventListener('click', () => { hideCreate(); page.createProject.focus(); });
page.createPanel.addEventListener('keydown', event => {
  if (event.key === 'Escape') { hideCreate(); page.createProject.focus(); }
});
page.workspaceAdd.addEventListener('click', chooseAndAdd);
page.retry.addEventListener('click', () => { if (lastAction) lastAction(); });
page.themeToggle.addEventListener('click', () => setTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark'));
for (const button of document.querySelectorAll('[data-lang]')) {
  button.addEventListener('click', async () => {
    try {
      const next = button.dataset.lang;
      const result = await bridge.setLanguage?.(next);
      if (result?.ok === false) { setStatus('error', result); return; }
      lang = next;
      writeSetting('deckmate-language', lang);
      applyTexts();
    } catch (error) {
      setStatus('error', { message: error?.message });
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
  } catch (error) {
    setStatus('error', { message: error?.message });
  }
  page.version.textContent = text('version', state.version || '—', state.deckmateVersion || '—');
  applyTexts();
  page.root.removeAttribute('aria-busy');
  (state.recent.length === 0 && state.workspace.length === 0 ? page.createProject : page.openFolder).focus();
})();

function mockBridge() {
  // 2026-11-10: URL fixtures stay inside the browser-only bridge; production IPC never reads fixture parameters.
  const params = new URLSearchParams(window.location.search);
  const scenario = params.get('scenario');
  const now = Date.now();
  let recent = [
    { path: 'D:\\Projects\\Hollow Signal', name: 'Hollow Signal', lastOpened: new Date(now - 90e3).toISOString() },
    { path: 'D:\\Projects\\demo', name: 'demo', lastOpened: new Date(now - 5 * 3600e3).toISOString() },
    { path: 'C:\\Users\\Someone\\Documents\\Долгий путь к релизу', name: 'Долгий путь к релизу', lastOpened: new Date(now - 3 * 86400e3).toISOString() },
  ];
  let workspace = [
    { path: recent[0].path, name: recent[0].name, missing: false },
    { path: recent[2].path, name: recent[2].name, missing: false },
    { path: 'D:\\Projects\\Old project', name: 'Old project', missing: true },
  ];
  if (scenario === 'many') {
    recent = Array.from({ length: 10 }, (_, index) => ({
      path: `D:\\Команда разработки\\Проекты с длинными названиями\\Подготовка первого публичного релиза\\Проект ${index + 1} — Очень длинное русское название с пробелами`,
      name: `Проект ${index + 1} — Очень длинное русское название с пробелами`,
      lastOpened: new Date(now - index * 86400e3).toISOString(),
    }));
    workspace = Array.from({ length: 30 }, (_, index) => ({
      path: `D:\\Рабочие проекты\\Закреплённый проект ${index + 1}`,
      name: `Закреплённый проект ${index + 1}`, missing: index === 2,
    }));
  }
  if (scenario === 'empty' || scenario === 'create') { recent = []; workspace = []; }
  if (scenario === 'missing') {
    recent = recent.map(entry => ({ ...entry, missing: true }));
    workspace = workspace.map(entry => ({ ...entry, missing: true }));
  }
  let listener = () => {};
  let mockLaunch = 0;
  return {
    async getState() {
      if (scenario === 'opening') setTimeout(() => openProject(recent[0].path), 50);
      if (scenario === 'create') setTimeout(chooseAndCreate, 50);
      if (scenario === 'error') setTimeout(() => listener({ phase: 'error', code: params.get('error') || 'missing', path: recent[0]?.path,
        message: 'Mock: diagnostic details from the local server.\nProject files are retained.' }), 50);
      return { recent, workspace, lastProject: recent[0]?.path || null, version: '0.5.0', deckmateVersion: '0.5.0', locale: 'en-US' };
    },
    async chooseFolder() { return 'D:\\Projects\\New Deck'; },
    async openProject() {
      const id = ++mockLaunch;
      await new Promise(resolve => setTimeout(resolve, scenario === 'opening' ? 20000 : 1200));
      if (id !== mockLaunch) return { ok: false, code: 'superseded' };
      return { ok: false, code: scenario === 'opening' ? 'timeout' : 'missing' };
    },
    async createProject() { await new Promise(resolve => setTimeout(resolve, 900)); return { ok: false, code: 'not-empty' }; },
    async removeRecent() { return { ok: true }; },
    async addToWorkspace(folder) { if (!workspace.some(entry => samePath(entry.path, folder))) workspace = [...workspace, { path: folder, name: projectName(folder), missing: false }]; return { ok: true, workspace }; },
    async removeFromWorkspace(folder) { workspace = workspace.filter(entry => !samePath(entry.path, folder)); return { ok: true, workspace }; },
    async moveInWorkspace(folder, index) { const from = workspace.findIndex(entry => samePath(entry.path, folder)); if (from < 0) return { ok: false, code: 'not-in-workspace' }; const [entry] = workspace.splice(from, 1); workspace.splice(Math.max(0, Math.min(index, workspace.length)), 0, entry); return { ok: true, workspace }; },
    async setLanguage() { return { ok: true }; },
    onStatus(callback) { listener = callback; return () => { listener = () => {}; }; },
  };
}
