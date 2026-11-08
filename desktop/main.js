import { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell, utilityProcess } from 'electron';
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { appendFile, mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const appDir = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = require.resolve('deckmate/dist/server/main.js');
const demoEntry = require.resolve('deckmate/dist/server/demo.js');
const deckmateVersion = JSON.parse(await readFile(require.resolve('deckmate/package.json'), 'utf8')).version;
const READY_PATTERN = /Deckmate: (http:\/\/127\.0\.0\.1:\d+)/;
const START_TIMEOUT_MS = 20_000;
const MAX_RECENT = 10;
const SHUTDOWN_TIMEOUT_MS = 3000;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;
const BOUNDS_SAVE_DELAY_MS = 300;
const LANGUAGES = new Set(['en', 'ru']);

let mainWindow = null;
let server = null; // { child, path, url }
let starting = null; // the child that has not printed its ready line yet
let stopping = Promise.resolve();
let quitReady = false;
let launchCounter = 0;
let pendingStatus = null;
let settings = defaultSettings();
let saveQueue = Promise.resolve();
let settingsGeneration = 0;
let settingsTempCounter = 0;
let boundsTimer = null;

// ---------- settings ----------

const settingsFile = () => path.join(app.getPath('userData'), 'desktop.json');
const logFile = () => path.join(app.getPath('userData'), 'server.log');

function defaultSettings() {
  return { lastProject: null, recent: [], language: null, zoomFactor: 1, windowBounds: null, windowMaximized: false };
}

const localeLanguage = () => (/^ru/i.test(app.getLocale()) ? 'ru' : 'en');
const clampZoom = factor => Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, factor)) * 10) / 10;

function validBounds(value) {
  if (!value || typeof value !== 'object') return null;
  const { x, y, width, height } = value;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

function normalizeRecent(value) {
  const recent = [];
  if (!Array.isArray(value)) return recent;
  for (const entry of value) {
    if (typeof entry?.path !== 'string' || !path.isAbsolute(entry.path)) continue;
    if (recent.some(candidate => samePath(candidate.path, entry.path))) continue;
    const lastOpened = typeof entry.lastOpened === 'string' && !Number.isNaN(Date.parse(entry.lastOpened))
      ? entry.lastOpened : null;
    recent.push({
      path: entry.path,
      name: typeof entry.name === 'string' ? entry.name : path.basename(entry.path),
      lastOpened,
    });
    if (recent.length === MAX_RECENT) break;
  }
  return recent;
}

async function loadSettings() {
  settings = defaultSettings();
  try {
    // 2026-11-08: a hand edit in Notepad or PowerShell may add a BOM, which JSON.parse rejects.
    const parsed = JSON.parse((await readFile(settingsFile(), 'utf8')).replace(/^﻿/, ''));
    settings = {
      lastProject: typeof parsed.lastProject === 'string' && path.isAbsolute(parsed.lastProject) ? parsed.lastProject : null,
      recent: normalizeRecent(parsed.recent),
      language: LANGUAGES.has(parsed.language) ? parsed.language : null,
      zoomFactor: Number.isFinite(parsed.zoomFactor) ? clampZoom(parsed.zoomFactor) : 1,
      windowBounds: validBounds(parsed.windowBounds),
      windowMaximized: parsed.windowMaximized === true,
    };
  } catch { /* a missing or broken file falls back to defaults */ }
  if (!settings.language) settings.language = localeLanguage();
}

const settingsText = () => JSON.stringify(settings, null, 2) + '\n';

function settingsTempFile(file) {
  settingsTempCounter += 1;
  return `${file}.tmp-${process.pid}-${settingsTempCounter}`;
}

/** 2026-11-08: writes go through one queue so a debounced bounds save never interleaves with a project save. */
function saveSettings() {
  const write = async () => {
    const text = settingsText();
    const generation = settingsGeneration;
    const file = settingsFile();
    const temporary = settingsTempFile(file);
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(temporary, text);
      if (generation !== settingsGeneration) {
        await unlink(temporary);
        return;
      }
      // A synchronous close save cannot interleave between this generation check and the rename.
      renameSync(temporary, file);
    } catch (error) {
      try { await unlink(temporary); } catch { /* the original write error is more useful */ }
      throw error;
    }
  };
  saveQueue = saveQueue.then(write, write);
  return saveQueue.catch(error => log(`settings save failed: ${error.message}`));
}

/** The window is gone right after 'close', so its last bounds are written synchronously. */
function saveSettingsSync() {
  let temporary = null;
  try {
    const file = settingsFile();
    temporary = settingsTempFile(file);
    const text = settingsText();
    settingsGeneration += 1;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(temporary, text);
    renameSync(temporary, file);
  } catch (error) {
    if (temporary) {
      try { unlinkSync(temporary); } catch { /* the original write error is more useful */ }
    }
    void log(`settings save failed: ${error.message}`);
  }
}

function rememberProject(folder) {
  const others = settings.recent.filter(entry => !samePath(entry.path, folder));
  const entry = { path: folder, name: path.basename(folder), lastOpened: new Date().toISOString() };
  settings.recent = [entry, ...others].slice(0, MAX_RECENT);
  settings.lastProject = folder;
}

const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

const MAX_LOG_BYTES = 5 * 1024 * 1024;

async function log(line) {
  // 2026-11-08: the server prints its URL with an access token; the log file must not keep it.
  const safe = String(line).replace(/token=[0-9a-f]{16,}/gi, 'token=***');
  try { await appendFile(logFile(), `${new Date().toISOString()} ${safe}\n`); } catch { /* logging must never break a launch */ }
}

/** Called once at startup: the log only grows, so an oversized one is started over. */
async function trimLog() {
  try {
    if ((await stat(logFile())).size > MAX_LOG_BYTES) await writeFile(logFile(), '');
  } catch { /* a missing log needs no trimming */ }
}

/** 2026-11-08: UNC and device paths (\\server\share, \\?\, //host) are accepted only when the folder dialog just returned them. */
let dialogFolder = null;
const isNetworkPath = folder => /^[\\/]{2}/.test(folder);

function checkFolderInput(input) {
  if (typeof input !== 'string' || !path.isAbsolute(input)) return fail('invalid-path', 'An absolute folder path is required.');
  if (isNetworkPath(input) && !(dialogFolder && input === dialogFolder)) return fail('invalid-path', 'Network and device paths can be opened only through the folder dialog.');
  return null;
}

// ---------- file helpers ----------

async function isDirectory(folder) {
  try { return (await stat(folder)).isDirectory(); } catch { return false; }
}

async function folderState(folder) {
  try {
    const entry = await stat(folder);
    if (!entry.isDirectory()) return 'file';
    return (await readdir(folder)).length === 0 ? 'empty' : 'not-empty';
  } catch (error) {
    return error.code === 'ENOENT' ? 'missing' : 'error';
  }
}

const ok = () => ({ ok: true });
const fail = (code, message) => ({ ok: false, code, message });

// ---------- server process ----------

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** 2026-11-08: inherited DECKMATE_* or FREETION_* variables from a shell would override the chosen folder and port. */
function serverEnv(folder, port) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(DECKMATE|FREETION)_/i.test(key)));
  return {
    ...env, DECKMATE_DATA: folder, DECKMATE_PORT: String(port), DECKMATE_HOST: '127.0.0.1',
    // 2026-11-08: keeps the disposable SQLite index beside the app settings instead of ~/.cache/deckmate.
    DECKMATE_INDEX: path.join(app.getPath('userData'), 'index'),
  };
}

async function startServer(folder) {
  const port = await freePort();
  const child = utilityProcess.fork(serverEntry, [], {
    env: serverEnv(folder, port), stdio: 'pipe', serviceName: 'Deckmate server', cwd: folder,
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => void log(`[stdout] ${chunk.trimEnd()}`));
  child.stderr.on('data', chunk => void log(`[stderr] ${chunk.trimEnd()}`));
  void log(`start ${folder} on port ${port}`);
  starting = child;
  try {
    const url = await waitForReady(child);
    return { child, path: folder, url };
  } finally {
    if (starting === child) starting = null;
  }
}

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const onStdout = chunk => {
      stdout = (stdout + chunk).slice(-4000);
      const match = READY_PATTERN.exec(stdout);
      if (match) finish(null, match[1]);
    };
    const onStderr = chunk => { stderr = (stderr + chunk).slice(-4000); };
    const onExit = code => finish(startError('start-failed', `Server exited with code ${code}.\n${tail(stderr)}`));
    const timer = setTimeout(() => finish(startError('timeout', `Server did not start in ${START_TIMEOUT_MS / 1000} s.\n${tail(stderr)}`)), START_TIMEOUT_MS);
    // 2026-11-08: output is buffered only until the ready line; the log file keeps the rest.
    const finish = (error, url) => {
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      child.stdout.removeListener('data', onStdout);
      child.stderr.removeListener('data', onStderr);
      if (error) { child.kill(); reject(error); } else resolve(url);
    };
    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);
    child.on('exit', onExit);
  });
}

function startError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const tail = text => text.trim().split(/\r?\n/).slice(-12).join('\n');

/** 2026-11-08: asks the server to close its watcher and index first; kill is the fallback after SHUTDOWN_TIMEOUT_MS. */
function stopServer() {
  // 2026-11-08: a server still starting has nothing to save yet, so it is killed outright.
  if (starting) { starting.kill(); starting = null; }
  const current = server;
  server = null;
  if (!current) return stopping;
  stopping = new Promise(resolve => {
    const { child } = current;
    if (child.pid === undefined) { resolve(); return; }
    const timer = setTimeout(() => { child.kill(); resolve(); }, SHUTDOWN_TIMEOUT_MS);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    try {
      child.postMessage({ type: 'shutdown' });
    } catch {
      child.kill();
    }
    void log(`stop ${current.path}`);
  });
  return stopping;
}

function watchServerExit(current) {
  current.child.on('exit', code => {
    if (server !== current) return;
    server = null;
    void log(`server exited unexpectedly with code ${code}`);
    void showLauncher({ phase: 'error', path: current.path, code: 'start-failed', message: `The Deckmate server stopped (code ${code}).` });
  });
}

// ---------- window ----------

const launcherFile = path.join(appDir, 'launcher', 'index.html');
const launcherUrl = pathToFileURL(launcherFile).href;
const windowAlive = () => Boolean(mainWindow) && !mainWindow.isDestroyed();

function sendStatus(status) {
  pendingStatus = status;
  if (windowAlive() && !server) mainWindow.webContents.send('desktop:status', status);
}

async function showLauncher(status = null) {
  // 2026-11-08: a new counter value makes any launch still in flight discard its result.
  launchCounter += 1;
  await stopServer();
  pendingStatus = status;
  buildMenu();
  if (!windowAlive()) return;
  mainWindow.setTitle('Deckmate');
  await mainWindow.loadFile(launcherFile);
}

/** 2026-11-08: only main-process callers choose `trusted`; board IPC may open only a stored recent entry. */
async function openProject(input, trusted = false) {
  const invalid = trusted ? null : checkFolderInput(input);
  if (invalid) return invalid;
  const folder = path.resolve(input);
  if (!(await isDirectory(folder))) return fail('missing', `Folder not found: ${folder}`);
  const launch = ++launchCounter;
  await stopServer();
  sendStatus({ phase: 'starting', path: folder });
  let started;
  try {
    started = await startServer(folder);
  } catch (error) {
    if (launch !== launchCounter) return fail('superseded', 'Another action replaced this launch.');
    const code = error.code === 'timeout' ? 'timeout' : 'start-failed';
    await showLauncher({ phase: 'error', path: folder, code, message: error.message });
    return fail(code, error.message);
  }
  if (!windowAlive()) { started.child.kill(); return fail('closed', 'The window was closed.'); }
  if (launch !== launchCounter) { started.child.kill(); return fail('superseded', 'Another action replaced this launch.'); }
  sendStatus({ phase: 'ready', path: folder });
  server = started;
  watchServerExit(started);
  rememberProject(folder);
  buildMenu();
  await saveSettings();
  if (!windowAlive() || launch !== launchCounter || server !== started) {
    return fail('superseded', 'Another action replaced this launch.');
  }
  return loadBoard(started, folder);
}

async function loadBoard(started, folder) {
  if (!windowAlive()) return fail('closed', 'The window was closed.');
  mainWindow.setTitle(`Deckmate — ${path.basename(folder)}`);
  try {
    await mainWindow.loadURL(started.url);
  } catch (error) {
    if (server !== started) return ok();
    await showLauncher({ phase: 'error', path: folder, code: 'load-failed', message: error.message });
    return fail('load-failed', error.message);
  }
  return ok();
}

async function createProject(options) {
  const input = options?.folder;
  const invalid = checkFolderInput(input);
  if (invalid) return invalid;
  const folder = path.resolve(input);
  const state = await folderState(folder);
  if (state === 'not-empty' || state === 'file') return fail('not-empty', `The folder must be empty or not exist yet: ${folder}`);
  if (state === 'error') return fail('invalid-path', `Cannot read the folder: ${folder}`);
  try {
    const { initializeDemo } = await import(pathToFileURL(demoEntry).href);
    await initializeDemo(folder);
  } catch (error) {
    return fail('create-failed', error.message);
  }
  return openProject(folder, true);
}

async function chooseFolder() {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  dialogFolder = result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  return dialogFolder;
}

function isServerUrl(url) {
  if (!server) return false;
  return url === server.url || url.startsWith(`${server.url}/`);
}

const isLauncherUrl = url => url.split(/[?#]/)[0] === launcherUrl;

/** 2026-11-08: loadFile, loadURL and reload do not emit will-navigate, so page-initiated navigation may reach only the server. */
function guardNavigation(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !isServerUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (isServerUrl(url)) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });
  contents.on('will-frame-navigate', event => {
    if (!event.isMainFrame && !isServerUrl(event.url)) event.preventDefault();
  });
}

const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'notifications']);

const DEFAULT_SIZE = { width: 1280, height: 820 };
const MIN_SIZE = { width: 960, height: 600 };
const MIN_VISIBLE = { width: 120, height: 60 };

/** 2026-11-08: saved bounds are used only while enough of the window lands on a connected display. */
function initialBounds() {
  const saved = settings.windowBounds;
  if (!saved) return DEFAULT_SIZE;
  const area = screen.getDisplayMatching(saved).workArea;
  const overlapWidth = Math.min(saved.x + saved.width, area.x + area.width) - Math.max(saved.x, area.x);
  const overlapHeight = Math.min(saved.y + saved.height, area.y + area.height) - Math.max(saved.y, area.y);
  if (overlapWidth >= MIN_VISIBLE.width && overlapHeight >= MIN_VISIBLE.height) return saved;
  return { width: Math.min(saved.width, area.width), height: Math.min(saved.height, area.height) };
}

function captureBounds() {
  if (!windowAlive() || mainWindow.isMinimized() || mainWindow.isFullScreen()) return false;
  settings.windowBounds = mainWindow.getNormalBounds();
  settings.windowMaximized = mainWindow.isMaximized();
  return true;
}

function scheduleBoundsSave() {
  clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => { if (captureBounds()) void saveSettings(); }, BOUNDS_SAVE_DELAY_MS);
}

function applyZoom() {
  if (windowAlive()) mainWindow.webContents.setZoomFactor(settings.zoomFactor);
}

function setZoom(factor) {
  const next = clampZoom(factor);
  if (next === settings.zoomFactor) return;
  settings.zoomFactor = next;
  applyZoom();
  void saveSettings();
}

const changeZoom = delta => setZoom(settings.zoomFactor + delta);

/** 2026-11-08: Ctrl+Plus and the numpad keys cannot share the menu item's single accelerator. */
function handleZoomKeys(event, input) {
  if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return;
  if (input.code === 'NumpadAdd' || input.key === '+') { event.preventDefault(); changeZoom(ZOOM_STEP); }
  else if (input.code === 'NumpadSubtract') { event.preventDefault(); changeZoom(-ZOOM_STEP); }
  else if (input.code === 'Numpad0') { event.preventDefault(); setZoom(1); }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    ...initialBounds(), minWidth: MIN_SIZE.width, minHeight: MIN_SIZE.height, show: false, title: 'Deckmate',
    backgroundColor: '#17181b',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(appDir, 'preload.cjs') },
  });
  const { session } = mainWindow.webContents;
  session.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  session.setPermissionCheckHandler((_contents, permission) => ALLOWED_PERMISSIONS.has(permission));
  session.setDevicePermissionHandler(() => false);
  mainWindow.once('ready-to-show', () => {
    if (settings.windowMaximized) mainWindow.maximize();
    mainWindow.show();
  });
  for (const name of ['resize', 'move', 'maximize', 'unmaximize']) mainWindow.on(name, scheduleBoundsSave);
  mainWindow.on('close', () => {
    clearTimeout(boundsTimer);
    if (captureBounds()) saveSettingsSync();
  });
  // 2026-11-08: the board sets its own document title; the window keeps the project name instead.
  mainWindow.on('page-title-updated', event => event.preventDefault());
  mainWindow.webContents.on('did-finish-load', () => {
    // Chromium keeps zoom per origin, so the launcher (file://) and each server port get the same factor after every load.
    applyZoom();
    if (!server && pendingStatus) mainWindow.webContents.send('desktop:status', pendingStatus);
  });
  mainWindow.webContents.on('zoom-changed', (_event, direction) => changeZoom(direction === 'in' ? ZOOM_STEP : -ZOOM_STEP));
  mainWindow.webContents.on('before-input-event', handleZoomKeys);
  mainWindow.webContents.on('console-message', (event, level, message) => {
    const text = event.message ?? message;
    const severity = event.level ?? level;
    if (severity === 'error' || severity === 'warning' || severity >= 2) void log(`[renderer ${severity}] ${text}`);
  });
  mainWindow.on('closed', () => { mainWindow = null; void stopServer(); });
  // Navigation is guarded for every web contents, this window included, by the 'web-contents-created' handler.
}

// ---------- menu and IPC ----------

const MENU_TEXTS = {
  en: {
    file: 'File', openFolder: 'Open folder…', recentProjects: 'Recent projects', noRecent: 'No recent projects',
    clearRecent: 'Clear recent', revealProject: 'Reveal project folder', switchProject: 'Switch project',
    closeProject: 'Close project', reload: 'Reload', toggleDevTools: 'Toggle DevTools', quit: 'Quit',
    edit: 'Edit', undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select all',
    view: 'View', zoomIn: 'Zoom in', zoomOut: 'Zoom out', actualSize: 'Actual size', toggleFullScreen: 'Toggle full screen',
    help: 'Help', openLogs: 'Open logs folder', about: 'About Deckmate', ok: 'OK',
    openFailed: 'Cannot open the project',
  },
  ru: {
    file: 'Файл', openFolder: 'Открыть папку…', recentProjects: 'Недавние проекты', noRecent: 'Нет недавних проектов',
    clearRecent: 'Очистить список', revealProject: 'Показать папку проекта', switchProject: 'Сменить проект',
    closeProject: 'Закрыть проект', reload: 'Перезагрузить', toggleDevTools: 'Инструменты разработчика', quit: 'Выход',
    edit: 'Правка', undo: 'Отменить', redo: 'Повторить', cut: 'Вырезать', copy: 'Копировать', paste: 'Вставить', selectAll: 'Выделить всё',
    view: 'Вид', zoomIn: 'Увеличить', zoomOut: 'Уменьшить', actualSize: 'Исходный размер', toggleFullScreen: 'Полноэкранный режим',
    help: 'Справка', openLogs: 'Открыть папку журналов', about: 'О программе Deckmate', ok: 'ОК',
    openFailed: 'Не удалось открыть проект',
  },
};

const menuTexts = lang => MENU_TEXTS[lang] ?? MENU_TEXTS.en;
const menuLabel = text => text.replaceAll('&', '&&'); // '&' marks a mnemonic in Windows menus

/** Failures that end in the launcher already show their error there; the rest need a dialog. */
/** Menu folders come from the dialog or the recent list, so they skip the IPC path check. */
async function openFromMenu(folder) {
  const result = await openProject(folder, true);
  if (result.ok || !['missing', 'invalid-path'].includes(result.code)) return;
  await dialog.showMessageBox(mainWindow, { type: 'warning', message: menuTexts(settings.language).openFailed, detail: result.message });
}

async function openFolderFromMenu() {
  const folder = await chooseFolder();
  if (folder) await openFromMenu(folder);
}

async function clearRecent() {
  settings.recent = [];
  settings.lastProject = server ? server.path : null;
  buildMenu();
  await saveSettings();
  // 2026-11-08: the launcher reads the list on load, so a visible launcher reloads to drop it.
  if (windowAlive() && !server && isLauncherUrl(mainWindow.webContents.getURL())) mainWindow.webContents.reload();
}

function recentMenu(t) {
  if (settings.recent.length === 0) return [{ label: t.noRecent, enabled: false }];
  const entries = settings.recent.slice(0, MAX_RECENT).map(entry => ({
    label: menuLabel(`${entry.name ?? path.basename(entry.path)} — ${entry.path}`),
    click: () => void openFromMenu(entry.path),
  }));
  return [...entries, { type: 'separator' }, { label: t.clearRecent, click: () => void clearRecent() }];
}

function showAbout() {
  const t = menuTexts(settings.language);
  const detail = [
    `Deckmate ${deckmateVersion}`, `Desktop ${app.getVersion()}`,
    `Electron ${process.versions.electron}`, `Node ${process.versions.node}`,
  ].join('\n');
  return dialog.showMessageBox(mainWindow, { type: 'info', title: t.about, message: 'Deckmate', detail, buttons: [t.ok] });
}

function toggleFullScreen() {
  if (windowAlive()) mainWindow.setFullScreen(!mainWindow.isFullScreen());
}

function buildMenu() {
  const t = menuTexts(settings.language);
  const project = server?.path ?? null;
  const template = [
    { label: t.file, submenu: [
      { label: t.openFolder, accelerator: 'CmdOrCtrl+O', click: () => void openFolderFromMenu() },
      { label: t.recentProjects, submenu: recentMenu(t) },
      { label: t.revealProject, enabled: Boolean(project), click: () => { if (project) shell.showItemInFolder(project); } },
      { type: 'separator' },
      { label: t.switchProject, accelerator: 'CmdOrCtrl+Shift+O', click: () => void showLauncher() },
      { label: t.closeProject, enabled: Boolean(project), click: () => void showLauncher() },
      { type: 'separator' },
      { label: t.reload, accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.webContents.reload() },
      { label: t.toggleDevTools, accelerator: 'F12', click: () => mainWindow?.webContents.toggleDevTools() },
      { type: 'separator' },
      { label: t.quit, accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
    ] },
    { label: t.edit, submenu: [
      { role: 'undo', label: t.undo }, { role: 'redo', label: t.redo }, { type: 'separator' },
      { role: 'cut', label: t.cut }, { role: 'copy', label: t.copy }, { role: 'paste', label: t.paste },
      { role: 'selectAll', label: t.selectAll },
    ] },
    { label: t.view, submenu: [
      { label: t.zoomIn, accelerator: 'CmdOrCtrl+=', click: () => changeZoom(ZOOM_STEP) },
      { label: t.zoomOut, accelerator: 'CmdOrCtrl+-', click: () => changeZoom(-ZOOM_STEP) },
      { label: t.actualSize, accelerator: 'CmdOrCtrl+0', click: () => setZoom(1) },
      { type: 'separator' },
      { label: t.toggleFullScreen, accelerator: 'F11', click: toggleFullScreen },
    ] },
    { label: t.help, submenu: [
      { label: t.openLogs, click: () => void shell.openPath(app.getPath('userData')) },
      { type: 'separator' },
      { label: t.about, click: () => void showAbout() },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function setLanguage(lang) {
  if (!LANGUAGES.has(lang)) return fail('invalid-language', 'Language must be "en" or "ru".');
  if (settings.language !== lang) {
    settings.language = lang;
    buildMenu();
    await saveSettings();
  }
  return ok();
}

/** 2026-11-08: the preload also runs on the board page, so only the bundled launcher may call the bridge. */
function handleFromLauncher(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isLauncherUrl(event.senderFrame?.url ?? '')) return fail('forbidden', 'Only the launcher may call this.');
    return handler(...args);
  });
}

function boardSenderAllowed({ sender, mainWebContents, senderFrame, mainFrame, serverUrl }) {
  if (!mainWebContents || sender !== mainWebContents || !senderFrame || senderFrame !== mainFrame || !serverUrl) return false;
  try {
    return new URL(senderFrame.url).origin === new URL(serverUrl).origin;
  } catch {
    return false;
  }
}

function findRecent(recent, folder) {
  if (typeof folder !== 'string') return undefined;
  return recent.find(entry => samePath(entry.path, folder));
}

/** 2026-11-08: same-origin Vision iframes render project content and must not control the shell. */
function handleFromBoard(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!boardSenderAllowed({
      sender: event.sender, mainWebContents: mainWindow?.webContents,
      senderFrame: event.senderFrame, mainFrame: event.sender.mainFrame, serverUrl: server?.url,
    })) return fail('forbidden', 'Only the main board frame of the current project may call this.');
    return handler(...args);
  });
}

async function removeRecent(folder) {
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) return fail('invalid-path', 'An absolute folder path is required.');
  // A network folder in the list came from the dialog earlier, so only such a listed path may be named here.
  if (isNetworkPath(folder) && !settings.recent.some(entry => samePath(entry.path, folder))) return fail('invalid-path', 'Network and device paths can be opened only through the folder dialog.');
  settings.recent = settings.recent.filter(entry => !samePath(entry.path, folder));
  if (settings.lastProject && samePath(settings.lastProject, folder)) settings.lastProject = null;
  buildMenu();
  await saveSettings();
  return ok();
}

function registerIpc() {
  handleFromLauncher('desktop:getState', () => ({
    recent: settings.recent, lastProject: settings.lastProject,
    version: app.getVersion(), deckmateVersion, locale: app.getLocale(), language: settings.language,
  }));
  handleFromLauncher('desktop:setLanguage', setLanguage);
  handleFromLauncher('desktop:chooseFolder', chooseFolder);
  // One argument only: the renderer must never reach openProject's `trusted` flag.
  handleFromLauncher('desktop:openProject', folder => openProject(folder));
  handleFromLauncher('desktop:createProject', options => createProject(options));
  handleFromLauncher('desktop:removeRecent', folder => removeRecent(folder));
  handleFromBoard('board:recentProjects', () => settings.recent.map(entry => ({
    path: entry.path, name: entry.name, lastOpened: entry.lastOpened, current: samePath(entry.path, server.path),
  })));
  // 2026-11-08: one renderer argument only; trust the stored entry, never the supplied spelling or extra arguments.
  handleFromBoard('board:switchProject', folder => {
    const entry = findRecent(settings.recent, folder);
    if (!entry) return fail('not-recent', 'Only a recent project may be opened from the board.');
    if (samePath(entry.path, server.path)) return ok();
    return openProject(entry.path, true);
  });
  handleFromBoard('board:showStartScreen', async () => {
    await showLauncher();
    return ok();
  });
}

// ---------- startup ----------

async function start() {
  await trimLog();
  await loadSettings();
  buildMenu();
  registerIpc();
  createWindow();
  const last = settings.lastProject;
  if (!last) return showLauncher();
  if (!(await isDirectory(last))) {
    settings.lastProject = null;
    await saveSettings();
    return showLauncher({ phase: 'error', path: last, code: 'missing', message: `Folder not found: ${last}` });
  }
  await showLauncher();
  await openProject(last, true);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.on('web-contents-created', (_event, contents) => guardNavigation(contents));
  app.on('window-all-closed', () => app.quit());
  // 2026-11-08: quitting waits for the server's own shutdown (bounded by SHUTDOWN_TIMEOUT_MS) before the process exits.
  app.on('before-quit', event => {
    if (quitReady) return;
    event.preventDefault();
    void stopServer().finally(() => { quitReady = true; app.quit(); });
  });
  app.whenReady().then(start).catch(error => {
    dialog.showErrorBox('Deckmate', error.stack ?? String(error));
    app.quit();
  });
}
