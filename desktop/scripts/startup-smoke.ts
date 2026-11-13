// 2026-11-12: the real WebView2/CDP path measures painted data, not just an HTTP response or an empty React shell.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, watch, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { freePort } from '../../tools/free-port.ts';
import { tileColor, tileInitials } from '../../client/project-tile.ts';
import { connectToHeadlessBrowser, type HeadlessPage } from '../../tools/layout-capture.ts';
import { selectPageTheme } from './smoke-controls.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1] ?? '';
}
const profile = option('--profile', 'debug');
if (!['debug', 'release'].includes(profile)) throw new Error('--profile must be debug or release');
const exe = path.resolve(option('--exe', path.join(root, 'desktop/src-tauri/target', profile, 'Deckmate.exe')));
const baseline = option('--baseline-exe', '');
const fixture = path.resolve(option('--fixture', path.join(root, 'desktop/.cache', `startup-${profile}`)));
const label = option('--label', 'startup');
if (!/^[a-z0-9-]+$/u.test(label)) throw new Error('--label must contain lowercase letters, digits or hyphens');
const runs = Number(option('--runs', '3'));
const windowBudget = option('--max-window-ms', '');
const maxWindowMs = windowBudget ? Number(windowBudget) : undefined;
const expectSplash = process.argv.includes('--expect-splash');
const launcherComparison = process.argv.includes('--launcher');
if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error('--runs must be 1..20');
if (maxWindowMs !== undefined && (!Number.isFinite(maxWindowMs) || maxWindowMs <= 0)) throw new Error('--max-window-ms must be positive');
if (!existsSync(exe)) throw new Error(`Build the shell first: ${exe}`);
if (baseline && !existsSync(baseline)) throw new Error(`Baseline binary is missing: ${baseline}`);

const project = path.join(fixture, launcherComparison ? 'Подготовка первого публичного релиза — Очень длинное русское название' : 'demo');
const settings = path.join(fixture, 'appdata/Deckmate');
mkdirSync(settings, { recursive: true });
if (!existsSync(project)) {
  const init = spawnSync(process.execPath, [path.join(root, 'bin/deckmate.mjs'), 'init', project], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (init.status !== 0) throw new Error(`demo init failed: ${init.stderr || init.stdout}`);
}

type Sample = { windowMs: number; nodeMs: number; serverMs: number; dataMs: number; nodeToReadyMs: number };
function launchShell(directory: string, cdpPort: number, server = path.join(root, 'dist/server/main.js'), binary = exe): ChildProcess {
  return spawn(binary, [], {
    cwd: path.dirname(binary), windowsHide: true, stdio: 'ignore',
    env: {
      ...process.env,
      APPDATA: path.join(directory, 'appdata'),
      LOCALAPPDATA: path.join(directory, 'localappdata'),
      // 2026-11-12: WebView2's own overrides also isolate a release without enabling Rust debug hooks.
      WEBVIEW2_USER_DATA_FOLDER: path.join(directory, 'webview'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`,
      DECKMATE_DESKTOP_SETTINGS_DIR: path.join(directory, 'appdata/Deckmate'),
      DECKMATE_DESKTOP_CDP_PORT: String(cdpPort),
      DECKMATE_DESKTOP_SERVER: server,
    },
  });
}

async function waitFor(page: HeadlessPage, expression: string, description: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await page.evaluate(expression)) return; } catch { /* 2026-11-12: navigation can replace the CDP context. */ }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

type OpeningGeometry = {
  brand: number[];
  tile: number[];
  color: string;
  initials: string;
  project: string;
  composition: number[];
  recovery: number[];
  recoveryStyle: Record<string, string>;
};

async function openingGeometry(page: HeadlessPage, root: string): Promise<OpeningGeometry> {
  return page.evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(root)});
    const rect = selector => {
      const box = root.querySelector(selector).getBoundingClientRect();
      return [box.x, box.y, box.width, box.height];
    };
    const tile = root.querySelector('.opening-tile');
    const recovery = root.querySelector('.opening-recovery');
    const recoveryStyle = getComputedStyle(recovery);
    return { brand: rect('.opening-brand'), tile: rect('.opening-tile'),
      color: getComputedStyle(tile).getPropertyValue('--tile').trim(), initials: tile.dataset.initials,
      project: root.querySelector('.opening-name').textContent, composition: rect('.opening-composition'), recovery: rect('.opening-recovery'),
      recoveryStyle: { height: recoveryStyle.height, minHeight: recoveryStyle.minHeight, marginTop: recoveryStyle.marginTop,
        lineHeight: recoveryStyle.lineHeight, fontSize: recoveryStyle.fontSize, display: recoveryStyle.display } };
  })()`);
}

function assertSameOpening(before: OpeningGeometry, after: OpeningGeometry): void {
  for (const part of ['brand', 'tile'] as const) {
    for (const axis of [0, 1]) {
      const delta = Math.abs(before[part][axis] - after[part][axis]);
      if (delta > 1) throw new Error(`Opening ${part} moved by ${delta} px on axis ${axis}: ${JSON.stringify({ before, after })}`);
    }
  }
  if (before.color !== after.color || before.initials !== after.initials || before.project !== after.project) {
    throw new Error(`Opening project identity changed: ${JSON.stringify({ before, after })}`);
  }
}

async function terminate(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  // 2026-11-12: the shell's Job Object must reap its own sidecar without touching unrelated Node processes.
  child.kill();
  await exited;
}

async function closeShell(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  // 2026-11-12: normal close releases WebView2's profile before the next sample; TerminateProcess races that cleanup.
  const closed = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class StartupClose {
      [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr hwnd, uint message, UIntPtr wparam, IntPtr lparam);
    }';
    $window = (Get-Process -Id ${child.pid}).MainWindowHandle;
    $browsers = @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe' AND ParentProcessId=${child.pid}");
    if ($window -eq 0 -or -not [StartupClose]::PostMessageW($window, 0x10, [UIntPtr]::Zero, [IntPtr]::Zero)) { throw 'Could not close the measured window'; }
    foreach ($browser in $browsers) {
      $process = Get-Process -Id $browser.ProcessId -ErrorAction SilentlyContinue;
      if ($process -and -not $process.WaitForExit(10000)) { throw 'WebView2 did not release the measured profile'; }
    }
  `], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  if (closed.status !== 0) throw new Error(`Native close failed: ${closed.stderr}`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([exited, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Shell did not close within 5 s')), 5000); })]);
  } finally {
    clearTimeout(timer);
  }
}

type LauncherSample = { firstWindowMs: number; returnPaintMs: number; documentReadyMs: number };
async function measureLauncher(index: number, binary: string, sampleLabel: string): Promise<LauncherSample> {
  const directory = path.join(fixture, sampleLabel);
  const config = path.join(directory, 'appdata/Deckmate');
  mkdirSync(config, { recursive: true });
  writeFileSync(path.join(config, 'desktop.json'), JSON.stringify({ lastProject: null, language: 'ru', theme: 'dark', updates: { autoCheck: false } }));
  const logFile = path.join(config, 'server.log');
  writeFileSync(logFile, '');
  const port = await freePort();
  const started = Date.now();
  const child = launchShell(directory, port, undefined, binary);
  let page: HeadlessPage | undefined;
  const ready = `document.visibilityState === 'visible' && !!window.deckmateDesktop && !!document.querySelector('#launcher:not([aria-busy])')`;
  try {
    page = await connectToHeadlessBrowser(port);
    await waitFor(page, ready, 'first-run launcher');
    const log = readFileSync(logFile, 'utf8');
    const visible = log.split(/\r?\n/u).find(line => line.includes('[startup] window-visible'));
    if (!visible || log.includes('node-spawned')) throw new Error('First run must show the launcher without starting Node');
    const firstWindowMs = Date.parse(visible.split(' ')[0]) - started;
    const documentReadyMs = await page.evaluate(`performance.getEntriesByName('deckmate-local-page-prepared')[0].startTime`);
    // 2026-11-13: document-local timestamps avoid CDP polling latency in the return-to-start budget.
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      const observer = new MutationObserver(() => {
        if (!document.querySelector('#launcher:not([aria-busy])')) return;
        observer.disconnect();
        requestAnimationFrame(() => requestAnimationFrame(() => { window.__launcherPaint = performance.timeOrigin + performance.now(); }));
      });
      observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-busy'] });
    ` });
    await page.callFunction(`folder => { void window.deckmateDesktop.openProject(folder); }`, project);
    await waitFor(page, `!!window.deckmateBoard && document.querySelector('.first-screen')?.dataset.state === 'ready'`, 'comparison board');
    const returned = await page.evaluate(`(() => { const time = performance.timeOrigin + performance.now(); void window.deckmateBoard.showStartScreen(); return time; })()`);
    await waitFor(page, `(${ready}) && !!window.__launcherPaint`, 'painted return to launcher');
    const returnPaintMs = (await page.evaluate('window.__launcherPaint')) - returned;
    if (index === 0) {
      for (const theme of ['dark', 'light']) {
        await page.callFunction(`theme => window.deckmateDesktop.setTheme(theme)`, theme);
        await page.evaluate('window.__previousLauncherDocument = true');
        await page.send('Page.reload');
        await waitFor(page, `!window.__previousLauncherDocument && (${ready}) && document.documentElement.classList.contains('dark') === ${theme === 'dark'}`, 'comparison theme');
        for (const width of [1280, 375]) {
          await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
          await page.evaluate(`document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))`);
          if (await page.evaluate('document.documentElement.scrollWidth > innerWidth')) throw new Error('Launcher overflows horizontally');
          const shot = await page.send('Page.captureScreenshot', { format: 'png' });
          writeFileSync(path.join(fixture, `${sampleLabel}-${theme}-${width}.png`), Buffer.from(shot.result.data, 'base64'));
          if (width === 375) {
            await page.evaluate(`document.querySelector('.project-sections').scrollIntoView()`);
            const rows = await page.send('Page.captureScreenshot', { format: 'png' });
            writeFileSync(path.join(fixture, `${sampleLabel}-${theme}-${width}-rows.png`), Buffer.from(rows.result.data, 'base64'));
            await page.evaluate('scrollTo(0,0)');
          }
        }
      }
    }
    const sample = { firstWindowMs, returnPaintMs, documentReadyMs };
    writeFileSync(path.join(fixture, `${sampleLabel}-${index}.log`), readFileSync(logFile));
    console.log(`ok ${sampleLabel}-${index} ${JSON.stringify(sample)}`);
    await closeShell(child);
    return sample;
  } finally {
    await page?.close();
    await terminate(child);
  }
}

if (launcherComparison) {
  if (!baseline || profile !== 'debug') throw new Error('--launcher needs --baseline-exe and debug builds');
  const groups = [
    { binary: path.resolve(baseline), name: `${label}-before`, samples: [] as LauncherSample[] },
    { binary: exe, name: `${label}-after`, samples: [] as LauncherSample[] },
  ];
  for (const group of groups) await measureLauncher(0, group.binary, group.name);
  for (let run = 1; run <= runs; run++) for (const group of run % 2 ? groups : [...groups].reverse()) {
    group.samples.push(await measureLauncher(run, group.binary, group.name));
  }
  const results = groups.map(group => ({ ...group, median: Object.fromEntries(Object.keys(group.samples[0]).map(key => {
    const values = group.samples.map(sample => sample[key as keyof LauncherSample]).sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    return [key, values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2];
  })) }));
  const delta = Object.fromEntries(Object.keys(results[0].median).map(key => [key, results[1].median[key] - results[0].median[key]]));
  writeFileSync(path.join(fixture, `${label}-comparison.json`), JSON.stringify({ results, delta, budgetMs: 100 }, null, 2));
  console.log(`launcher comparison ${JSON.stringify({ medians: results.map(result => result.median), delta })}; artifacts: ${fixture}`);
  if (delta.firstWindowMs > 100 || delta.returnPaintMs > 100) throw new Error(`Launcher exceeded the +100 ms budget: ${JSON.stringify(delta)}`);
}

async function measure(index: number, binary = exe, sampleLabel = label, splashRequired = expectSplash): Promise<Sample> {
  const cdpPort = await freePort();
  const settingsFile = path.join(settings, 'desktop.json');
  const saved = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, 'utf8')) : {};
  writeFileSync(settingsFile, JSON.stringify({ ...saved, lastProject: project, language: 'en', updates: { ...saved.updates, autoCheck: false } }));
  const logFile = path.join(settings, 'server.log');
  const offset = existsSync(logFile) ? readFileSync(logFile).length : 0;
  let child: ChildProcess | undefined;
  let page: HeadlessPage | undefined;
  let launched = 0;
  let cancel = () => {};
  const painted = new Promise<string>((resolve, reject) => {
    let finished = false;
    const finish = (error?: Error, log = '') => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      watcher.close();
      child?.off('exit', onExit);
      if (error) reject(error); else resolve(log);
    };
    const onExit = (code: number | null) => finish(new Error(`Shell exited before painting data: ${code}`));
    const check = () => {
      if (!existsSync(logFile)) return;
      const log = readFileSync(logFile).subarray(offset).toString('utf8');
      if (log.includes('[startup] board-data-painted')) finish(undefined, log);
    };
    const watcher = watch(settings, check);
    const deadline = setTimeout(() => finish(new Error(`No painted board within 30 s; see ${logFile}`)), 30_000);
    cancel = () => finish(new Error('Measurement cancelled'));
    launched = Date.now();
    child = launchShell(fixture, cdpPort, undefined, binary);
    child.once('error', finish);
    child.once('exit', onExit);
    check();
  });
  // 2026-11-12: a launch failure can arrive while the CDP connection is still being established.
  painted.catch(() => {});
  try {
    page = await connectToHeadlessBrowser(cdpPort);
    const log = await painted;
    const board = await page.evaluate(`({
      visible: document.visibilityState,
      covers: document.querySelectorAll('[data-deck-cover]').length,
      updated: Number(document.querySelector('.app-shell')?.dataset.updatedAt),
      paints: performance.getEntriesByName('deckmate-board-data-painted').length,
      background: getComputedStyle(document.body).backgroundColor
    })`);
    if (board.visible !== 'visible' || !board.covers || !board.updated || board.paints !== 1) {
      throw new Error(`Not a visible board with demo data: ${JSON.stringify(board)}`);
    }
    const stage = (name: string) => {
      const line = log.split(/\r?\n/u).find(value => value.includes(`[startup] ${name}`));
      if (!line) throw new Error(`Missing startup stage ${name}`);
      return Date.parse(line.split(' ')[0]) - launched;
    };
    const sample = { windowMs: stage('window-visible'), nodeMs: stage('node-spawned'), serverMs: stage('server-ready'), dataMs: stage('board-data-painted'), nodeToReadyMs: 0 };
    if (splashRequired && !log.split(/\r?\n/u).some(line => line.includes('main first show: http://tauri.localhost/startup.html'))) {
      throw new Error('The first visible document was not the local splash');
    }
    sample.nodeToReadyMs = sample.serverMs - sample.nodeMs;
    writeFileSync(path.join(fixture, `${sampleLabel}-${index}.log`), log);
    console.log(`ok ${sampleLabel}-${index} ${JSON.stringify(sample)}`);
    return sample;
  } finally {
    cancel();
    try {
      if (page && child?.exitCode === null && child.signalCode === null) {
        await page.evaluate('void window.deckmateBoard?.showStartScreen()');
        await waitFor(page, `typeof window.deckmateDesktop === 'object' && document.readyState === 'complete'`, 'server shutdown through the board bridge', 10_000);
        await closeShell(child);
      }
    } finally {
      await page?.close();
      if (child) await terminate(child);
    }
  }
}

async function checkFallback(name: string, lastProject: string | null, error: string | null, server?: string): Promise<void> {
  const directory = path.join(fixture, 'fallbacks', name);
  const config = path.join(directory, 'appdata/Deckmate');
  mkdirSync(config, { recursive: true });
  writeFileSync(path.join(config, 'desktop.json'), JSON.stringify({ lastProject, language: 'en', updates: { autoCheck: false } }));
  const logFile = path.join(config, 'server.log');
  writeFileSync(logFile, '');
  const cdpPort = await freePort();
  const child = launchShell(directory, cdpPort, server);
  let page: HeadlessPage | undefined;
  try {
    page = await connectToHeadlessBrowser(cdpPort);
    await waitFor(page, `document.visibilityState === 'visible' && !!document.getElementById('launcher') && !document.getElementById('launcher').hasAttribute('aria-busy')`, `visible fallback launcher: ${name}`, 20_000);
    const result = await page.callFunction(`async () => ({ state: await window.deckmateDesktop.getState(), phase: document.getElementById('status').dataset.phase, technical: document.getElementById('status-technical').textContent })`);
    if (error && (result.phase !== 'error' || !result.technical.includes(error))) throw new Error(`${name}: lost startup error: ${JSON.stringify(result)}`);
    if (name === 'missing' && result.state.lastProject !== null) throw new Error('Missing last project was not cleared');
    if (!server && readFileSync(logFile, 'utf8').includes('node-spawned')) throw new Error(`${name}: started an unwanted sidecar`);
    console.log(`ok fallback-${name} — visible launcher, startup policy and error preserved`);
    await closeShell(child);
  } finally {
    await page?.close();
    await terminate(child);
  }
}

async function checkSplash(theme: 'light' | 'dark'): Promise<void> {
  const directory = path.join(fixture, `gated-server-${theme}`);
  const config = path.join(directory, 'appdata/Deckmate');
  mkdirSync(config, { recursive: true });
  const gate = path.join(directory, 'continue');
  rmSync(gate, { force: true });
  writeFileSync(path.join(config, 'desktop.json'), JSON.stringify({ lastProject: project, theme, language: 'en', updates: { autoCheck: false } }));
  const logFile = path.join(config, 'server.log');
  writeFileSync(logFile, '');
  const server = path.join(directory, 'server.cjs');
  // 2026-11-12: a file event holds readiness until the splash is inspected, avoiding timing-dependent skips.
  writeFileSync(server, `
    const fs = require('node:fs');
    const gate = ${JSON.stringify(gate)};
    const watcher = fs.watch(__dirname, check);
    function check() {
      if (!fs.existsSync(gate)) return;
      watcher.close();
      import(${JSON.stringify(pathToFileURL(path.join(root, 'dist/server/main.js')).href)});
    }
    check();
  `);
  const port = await freePort();
  let child = launchShell(directory, port, server);
  let page: HeadlessPage | undefined;
  try {
    page = await connectToHeadlessBrowser(port);
    await waitFor(page, `location.pathname === '/startup.html' && document.visibilityState === 'visible' && document.readyState === 'complete'`, 'the loaded visible splash');
    await page.callFunction(`() => new Promise(resolve => {
      const visible = () => {
        if (document.visibilityState !== 'visible' || document.readyState !== 'complete') return;
        document.removeEventListener('visibilitychange', visible);
        removeEventListener('load', visible);
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      };
      document.addEventListener('visibilitychange', visible);
      addEventListener('load', visible);
      visible();
    })`);
    const splash = await page.callFunction(`async () => {
      const refused = async (command, args) => {
        try { return (await window.__TAURI_INTERNALS__.invoke(command, args))?.ok === false; }
        catch { return true; }
      };
      return {
        url: location.href, visibility: document.visibilityState,
        background: getComputedStyle(document.documentElement).backgroundColor,
        firstLoad: window.__deckmateFirstLoadVisibility,
        desktop: typeof window.deckmateDesktop, board: typeof window.deckmateBoard,
        launcherDenied: await refused('desktop_get_state'),
        boardDenied: await refused('board_set_dirty', { dirty: true }),
        themeDenied: await refused('board_set_theme', { theme: 'dark' }),
        project: document.getElementById('project-name').textContent,
        opening: document.getElementById('opening-label').textContent,
        fonts: document.fonts.status,
        painted: performance.getEntriesByName('deckmate-local-page-prepared').length,
        csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]').content,
      };
    }`);
    if (new URL(splash.url).pathname !== '/startup.html' || splash.visibility !== 'visible'
      || splash.background !== (theme === 'light' ? 'rgb(240, 236, 244)' : 'rgb(50, 47, 64)')
      || splash.desktop !== 'undefined' || splash.board !== 'undefined' || !splash.launcherDenied || !splash.boardDenied || !splash.themeDenied) {
      throw new Error(`Invalid startup frame or bridge isolation: ${JSON.stringify(splash)}`);
    }
    if (splash.project !== 'demo' || splash.opening !== 'Opening project…' || splash.fonts !== 'loaded' || splash.painted !== 1) {
      throw new Error(`Startup text or first paint is incomplete: ${JSON.stringify(splash)}`);
    }
    const configCsp = JSON.parse(readFileSync(path.join(root, 'desktop/src-tauri/tauri.conf.json'), 'utf8')).app.security.csp;
    const directives = (value: string) => value.split(';').map(part => part.trim()).sort().join(';');
    if (directives(splash.csp) !== directives(configCsp.replace("style-src 'self' 'unsafe-inline'", "style-src 'self'"))) throw new Error('Startup CSP differs from the stricter splash policy');
    const beforeReady = readFileSync(logFile, 'utf8');
    if (!beforeReady.includes('main local loaded: native-visible=false')) throw new Error('The native window was shown before its first local load');
    if (!beforeReady.includes('node-spawned') || !beforeReady.includes('window-visible') || beforeReady.includes('server-ready')) {
      throw new Error(`Window did not appear while Node was waiting for readiness: ${beforeReady}`);
    }
    const splashOpening = await openingGeometry(page, '#startup');
    if (splashOpening.color !== tileColor('demo') || splashOpening.initials !== tileInitials('demo')) {
      throw new Error(`Startup tile does not use the shared project palette: ${JSON.stringify(splashOpening)}`);
    }
    const screenshot = await page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(fixture, `${label}-splash-${theme}.png`), Buffer.from(screenshot.result.data, 'base64'));
    // 2026-11-13: hold only the board snapshot so the middle frame is measurable without changing server startup.
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      const nativeFetch = window.fetch.bind(window);
      let releaseSnapshot;
      const snapshotGate = new Promise(resolve => { releaseSnapshot = resolve; });
      window.__releaseDeckmateSnapshot = () => releaseSnapshot();
      window.fetch = async (input, init) => {
        const request = typeof input === 'string' || input instanceof URL ? input : input.url;
        const url = new URL(request, location.href);
        if (url.pathname === '/api/snapshot') await snapshotGate;
        return nativeFetch(input, init);
      };
    ` });
    writeFileSync(gate, 'ready');
    await waitFor(page, `location.origin.startsWith('http://127.0.0.1:') && document.querySelector('.first-screen-status .opening-screen') && document.querySelector('.first-screen')?.dataset.state === 'loading'`, 'the board opening scene');
    await page.evaluate('document.fonts.ready');
    const boardOpening = await openingGeometry(page, '.first-screen-status');
    assertSameOpening(splashOpening, boardOpening);
    const loadingScreenshot = await page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(fixture, `${label}-board-loading-${theme}.png`), Buffer.from(loadingScreenshot.result.data, 'base64'));
    writeFileSync(path.join(fixture, `${label}-sequence-${theme}.json`), JSON.stringify({ splash: splashOpening, boardLoading: boardOpening }, null, 2));
    await page.evaluate('window.__releaseDeckmateSnapshot()');
    const deadline = Date.now() + 30_000;
    while (!readFileSync(logFile, 'utf8').includes('board-data-painted')) {
      if (Date.now() >= deadline) throw new Error('The ready event did not open the gated board');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await waitFor(page, `document.querySelector('.first-screen')?.dataset.state === 'ready' && getComputedStyle(document.querySelector('.first-screen-status')).visibility === 'hidden'`, 'the revealed board');
    const readyScreenshot = await page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(fixture, `${label}-board-ready-${theme}.png`), Buffer.from(readyScreenshot.result.data, 'base64'));
    const board = await page.evaluate(`({ origin: location.origin, bridge: typeof window.deckmateBoard, covers: document.querySelectorAll('[data-deck-cover]').length })`);
    if (!board.origin.startsWith('http://127.0.0.1:') || board.bridge !== 'object' || !board.covers) {
      throw new Error(`No board after releasing readiness: ${JSON.stringify(board)}`);
    }
    const invalid = await page.callFunction(`() => window.deckmateBoard.setTheme('invalid')`);
    if (invalid.ok !== false || invalid.code !== 'invalid-theme') throw new Error('Invalid theme was accepted');
    let selected: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const opposite = await page.evaluate(`document.documentElement.classList.contains('dark') ? 'light' : 'dark'`);
      await page.evaluate(`window.__themeBeforeToggle = document.documentElement.classList.contains('dark')`);
      await selectPageTheme(page, opposite);
      await waitFor(page, `document.documentElement.classList.contains('dark') !== window.__themeBeforeToggle`, 'the saved theme to apply');
      selected = await page.evaluate(`document.documentElement.classList.contains('dark') ? 'dark' : 'light'`);
      const savedDeadline = Date.now() + 5000;
      while (JSON.parse(readFileSync(path.join(config, 'desktop.json'), 'utf8')).theme !== selected) {
        if (Date.now() >= savedDeadline) throw new Error('Board theme was not persisted');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (selected === theme) break;
    }
    if (selected !== theme) throw new Error(`Board did not select ${theme}`);
    await closeShell(child);
    await page.close();
    rmSync(gate, { force: true });
    child = launchShell(directory, port, server);
    page = await connectToHeadlessBrowser(port);
    await waitFor(page, `location.pathname === '/startup.html' && document.visibilityState === 'visible' && document.readyState === 'complete'`, 'the splash after a board theme change');
    const restored = await page.evaluate(`({ theme: document.documentElement.getAttribute('data-shell-theme'), background: getComputedStyle(document.documentElement).backgroundColor })`);
    if (restored.theme !== selected || restored.background !== (selected === 'light' ? 'rgb(240, 236, 244)' : 'rgb(50, 47, 64)')) {
      throw new Error(`Board theme did not reach the next splash: ${JSON.stringify(restored)}`);
    }
    await waitFor(page, `!document.getElementById('return-to-start').hidden`, 'the delayed recovery action');
    await page.evaluate(`document.getElementById('return-to-start').click()`);
    await waitFor(page, `location.pathname === '/index.html' && !document.getElementById('launcher')?.hasAttribute('aria-busy')`, 'cancel startup and return to the launcher');
    writeFileSync(gate, 'ready');
    await new Promise(resolve => setTimeout(resolve, 500));
    if ((await page.evaluate('location.pathname')) !== '/index.html') throw new Error('Cancelled startup still opened the board');
    console.log(`ok gated-startup-${theme} — stable splash/board scene; real project tile; denied splash IPC; stricter CSP; board toggle saved ${selected}; delayed return cancelled startup`);
    await closeShell(child);
  } finally {
    await page?.close();
    await terminate(child);
  }
}

if (!launcherComparison && !process.argv.includes('--checks-only')) {
  const groups = [{ binary: exe, name: label, splash: expectSplash, samples: [] as Sample[] }];
  if (baseline) groups.unshift({ binary: path.resolve(baseline), name: `${label}-before`, splash: false, samples: [] });
  // 2026-11-12: warm both binaries equally, then alternate their order to reduce drift between batches.
  for (const group of groups) await measure(0, group.binary, group.name, group.splash);
  for (let run = 1; run <= runs; run++) {
    for (const group of run % 2 ? groups : [...groups].reverse()) {
      group.samples.push(await measure(run, group.binary, group.name, group.splash));
    }
  }
  for (const { binary, name, samples } of groups) {
    const median = Object.fromEntries(Object.keys(samples[0]).map(key => {
      const values = samples.map(sample => sample[key as keyof Sample]).sort((a, b) => a - b);
      const middle = Math.floor(values.length / 2);
      return [key, values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2];
    }));
    writeFileSync(path.join(fixture, `${name}.json`), JSON.stringify({ exe: binary, profile, samples, median }, null, 2));
    console.log(`median ${name} ${JSON.stringify(median)}; logs: ${fixture}`);
    // 2026-11-13: an explicit budget turns a local before/after measurement into a failing regression check.
    if (binary === exe && maxWindowMs !== undefined && median.windowMs > maxWindowMs) {
      throw new Error(`First-window median ${median.windowMs} ms exceeds the ${maxWindowMs} ms budget`);
    }
  }
}

if (expectSplash && profile === 'debug') {
  for (const theme of ['light', 'dark'] as const) await checkSplash(theme);
}

if (process.argv.includes('--check-fallbacks')) {
  if (profile !== 'debug') throw new Error('--check-fallbacks requires debug server overrides');
  await checkFallback('empty', null, null);
  await checkFallback('missing', path.join(fixture, 'missing-project'), 'missing-project');
  await checkFallback('network', '\\\\deckmate-startup-invalid\\share', null);
  const failed = path.join(fixture, 'failed-server.cjs');
  writeFileSync(failed, "process.stderr.write('startup fixture refused'); process.exitCode = 7;");
  await checkFallback('failed-server', project, 'startup fixture refused', failed);
  // 2026-11-13: both deferred initialization and first data reads can fail after HTTP readiness and board navigation.
  const rejected = path.join(fixture, 'rejected-project');
  const outside = path.join(fixture, 'outside-tools');
  mkdirSync(rejected, { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(path.join(outside, 'board.py'), '');
  const tools = path.join(rejected, 'Tools');
  if (!existsSync(tools)) symlinkSync(realpathSync(outside), tools, 'junction');
  const server = path.join(root, 'dist/server/main.js');
  await checkFallback('deferred-initialize', rejected, 'The path is outside the project.', server);
  const unreadable = path.join(fixture, 'unreadable-project');
  mkdirSync(path.join(unreadable, 'tasks/iterations.md'), { recursive: true });
  await checkFallback('deferred-snapshot', unreadable, 'EISDIR', server);
}
