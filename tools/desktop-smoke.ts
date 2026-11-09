// End-to-end smoke check of the real Deckmate desktop shell (desktop/src-tauri). It launches the
// debug Deckmate.exe with an isolated settings folder and a CDP port, then drives the launcher and
// the board through the real page bridges over CDP — the same path a person takes, without a
// person looking at the window. The CDP plumbing lives in tools/layout-capture.ts, the repository's
// only browser driver; the shell-side hooks are DECKMATE_DESKTOP_CDP_PORT and
// DECKMATE_DESKTOP_SETTINGS_DIR (desktop/src-tauri/src/window.rs and paths.rs, debug builds only).
//
// Run: npm run desktop:smoke — prints one "ok <step>" line per check and exits 1 on the first
// failure. Builds nothing itself: it points at cargo build / npm run build when an input is missing.
// 2026-11-09: added while moving the shell from Electron to Tauri (desktop/README.md, "Manual checks
// before a release"); it covers the items that need a real window (launcher, board, bridges, navigation
// guard, server lifetime). The native menu, dialogs and the installer stay human-checked.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectToHeadlessBrowser, type HeadlessPage } from './layout-capture.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const exe = path.join(root, 'desktop', 'src-tauri', 'target', 'debug', 'Deckmate.exe');
const serverEntry = path.join(root, 'dist', 'server', 'main.js');
// The board app's outermost rendered element (client/App.tsx); stable across views.
const boardSelector = '.app-shell';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const norm = (value: string) => value.replace(/\\/g, '/').toLowerCase();

class SmokeFailure extends Error {}

let currentStep = 'setup';
let page: HeadlessPage | undefined;

function pass(step: string, detail: string): void {
  console.log(`ok ${step} — ${detail}`);
}

async function poll(condition: () => Promise<boolean>, what: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await condition()) return;
    } catch {
      // The execution context can briefly disappear while the shell navigates the window.
    }
    await sleep(150);
  }
  throw new SmokeFailure(`${what} did not happen within ${Math.round(timeoutMs / 1000)} s`);
}

async function launcherLoaded(): Promise<boolean> {
  // 2026-11-09: WebView2 changes the URL before the new document's bridge is ready.
  return (await page!.evaluate(`document.readyState === 'complete' && !!document.getElementById('launcher') && typeof window.deckmateDesktop === 'object'`)) === true;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/** node.exe processes whose command line mentions the demo projects or the server entry. */
function serverProcesses(needles: string[]): { pid: number; commandLine: string }[] {
  const output = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ' +
    'Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress'],
    { encoding: 'utf8', timeout: 30000, windowsHide: true }).trim();
  if (!output) return [];
  const parsed = JSON.parse(output) as { ProcessId: number; CommandLine: string | null } | { ProcessId: number; CommandLine: string | null }[];
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const wanted = needles.map(needle => needle.toLowerCase());
  return rows
    .filter(row => row.CommandLine && wanted.some(needle => norm(row.CommandLine!).includes(needle)))
    .map(row => ({ pid: row.ProcessId, commandLine: row.CommandLine! }));
}

/** The shell's window title through PowerShell (Get-Process MainWindowTitle); '' when unreadable. */
function windowTitle(pid: number): string {
  try {
    const output = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; (Get-Process -Id ' + pid + ' -ErrorAction SilentlyContinue).MainWindowTitle'],
      { encoding: 'utf8', timeout: 15000, windowsHide: true }).trim();
    return output.replace(/[\r\n]+$/, '');
  } catch {
    return '';
  }
}

// A failed launch leaves an error status on the launcher and shell events in server.log; both
// end up in the failure line so a red smoke run points at the cause without rerunning manually.
async function diagnose(settings: string): Promise<string> {
  const hints: string[] = [];
  try {
    const status = await page!.evaluate(
      `(() => { const el = document.getElementById('status'); return el ? el.textContent : ''; })()`);
    if (status) hints.push(`launcher status: ${String(status).slice(0, 200)}`);
  } catch { /* the window may already be gone */ }
  try {
    const log = readFileSync(path.join(settings, 'server.log'), 'utf8').trim().split('\n');
    hints.push(`server.log tail: ${log.slice(-4).join(' | ').slice(0, 400)}`);
  } catch { /* no log yet */ }
  return hints.join('; ');
}

async function main(): Promise<number> {
  if (!existsSync(exe)) {
    console.error(`smoke: ${exe} is missing — build the debug shell first:`);
    console.error('  cargo build --manifest-path desktop/src-tauri/Cargo.toml');
    return 1;
  }
  if (!existsSync(serverEntry)) {
    console.error(`smoke: ${serverEntry} is missing — build the app first: npm run build`);
    return 1;
  }
  const temp = mkdtempSync(path.join(tmpdir(), 'deckmate-smoke-'));
  const settings = path.join(temp, 'settings');
  const demo = path.join(temp, 'demo');
  const created = path.join(temp, 'new-project');
  const externalLog = path.join(temp, 'external-links.log');
  const needles = [serverEntry, demo, created].map(norm);
  const cdpPort = await freePort();
  const launchShell = () => spawn(exe, [], {
    env: {
      ...process.env,
      DECKMATE_DESKTOP_CDP_PORT: String(cdpPort),
      DECKMATE_DESKTOP_SETTINGS_DIR: settings,
      DECKMATE_DESKTOP_SERVER: serverEntry,
      // 2026-11-09: external links are recorded here instead of opening the user's browser on every run.
      DECKMATE_DESKTOP_EXTERNAL_LOG: externalLog,
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  let shell = launchShell();
  const killShell = (tree: boolean) => {
    if (shell.exitCode !== null || shell.signalCode !== null) return;
    const args = ['/F'];
    if (tree) args.push('/T');
    if (process.platform === 'win32' && shell.pid) {
      spawn('taskkill', [...args, '/PID', String(shell.pid)], { stdio: 'ignore' });
    } else {
      shell.kill();
    }
  };
  try {
    const init = spawnSync(process.execPath, [path.join(root, 'bin', 'deckmate.mjs'), 'init', demo],
      { encoding: 'utf8', timeout: 120000, windowsHide: true });
    if (init.status !== 0) {
      throw new SmokeFailure(`deckmate init demo exited with code ${init.status}: ${(init.stderr || init.stdout || '').slice(-300)}`);
    }
    pass('setup', `demo project created at ${demo}`);

    try {
      page = await connectToHeadlessBrowser(cdpPort);
    } catch (error) {
      const hint = shell.exitCode !== null
        ? `the shell exited during startup with code ${shell.exitCode} (another Deckmate instance running?)`
        : (error instanceof Error ? error.message : String(error));
      throw new SmokeFailure(`cannot connect to the shell over CDP: ${hint}`);
    }
    pass('cdp', 'connected to the shell webview');

    // a. The launcher document is the bundled start screen with the full desktop bridge.
    currentStep = 'a';
    await poll(launcherLoaded,
      'the launcher page to load', 20000);
    const launcher = await page!.callFunction(`async () => {
      const bridge = window.deckmateDesktop;
      const wanted = ['getState', 'chooseFolder', 'openProject', 'createProject', 'removeRecent',
        'addToWorkspace', 'removeFromWorkspace', 'moveInWorkspace', 'setLanguage', 'onStatus'];
      return {
        missing: wanted.filter(name => !bridge || typeof bridge[name] !== 'function'),
        state: bridge ? await bridge.getState() : null,
      };
    }`);
    if (launcher.missing.length) throw new SmokeFailure(`window.deckmateDesktop is missing methods: ${launcher.missing.join(', ')}`);
    const state = launcher.state;
    if (!state || !Array.isArray(state.recent) || !Array.isArray(state.workspace) || state.workspace.length !== 0
      || (state.lastProject !== null && typeof state.lastProject !== 'string')
      || typeof state.version !== 'string' || typeof state.deckmateVersion !== 'string'
      || typeof state.locale !== 'string' || typeof state.language !== 'string') {
      throw new SmokeFailure(`getState() has an unexpected shape: ${JSON.stringify(state)}`);
    }
    pass('a', 'launcher loaded; deckmateDesktop has the 10 preload methods; getState has workspace/recent/lastProject/version/deckmateVersion/locale/language');
    const untrustedAddition = await page!.callFunction(`() => window.deckmateDesktop.addToWorkspace('C:\\\\not-trusted')`);
    if (untrustedAddition.ok !== false || untrustedAddition.code !== 'invalid-path') {
      throw new SmokeFailure(`launcher accepted an untrusted workspace path: ${JSON.stringify(untrustedAddition)}`);
    }
    // 2026-11-09: CDP attaches after the first load, so current window bounds cannot detect an
    // earlier flash. The debug initialization script samples visibility before page scripts and
    // in the load event, before native PageLoadEvent::Finished shows the window.
    const visibility = await page!.evaluate('window.__deckmateFirstLoadVisibility');
    if (visibility?.atLoad !== 'hidden') {
      throw new SmokeFailure(`window was visible before the launcher loaded: ${JSON.stringify(visibility)}`);
    }
    await poll(async () => (await page!.evaluate('document.visibilityState')) === 'visible',
      'the loaded launcher window to become visible', 10000);
    pass('a-visibility', 'first load event was hidden; loaded launcher became visible');

    // b. Opening the demo navigates to the local server and renders the board with only the board bridge.
    // A successful open resolves after the navigation, which destroys the execution context that
    // invoked it, so the result cannot be read back; success is the navigation itself.
    currentStep = 'b';
    await page!.callFunction(`folder => { void window.deckmateDesktop.openProject(folder); }`, demo);
    let boardOrigin = '';
    try {
      await poll(async () => {
        const at = String(await page!.evaluate('location.href'));
        if (!at.startsWith('http://127.0.0.1:')) return false;
        boardOrigin = new URL(at).origin;
        return true;
      }, `openProject(${demo}) to reach the board`, 30000);
      await poll(async () =>
        (await page!.evaluate(`!!document.querySelector('${boardSelector}')`)) === true,
        'the board app to render', 20000);
    } catch (error) {
      throw new SmokeFailure(`${(error as SmokeFailure).message} (${await diagnose(settings)})`);
    }
    const bridgeCheck = await page!.callFunction(`() => ({ board: typeof window.deckmateBoard, desktop: typeof window.deckmateDesktop })`);
    if (bridgeCheck.board !== 'object') throw new SmokeFailure('window.deckmateBoard is missing on the board page');
    if (bridgeCheck.desktop !== 'undefined') throw new SmokeFailure('window.deckmateDesktop leaked onto the board page');
    currentStep = 'b-clipboard';
    // 2026-11-09: writeText needs a focused document; when another window owns the desktop focus the
    // check failed with "Document is not focused", so the page is told it has focus for this step.
    await page!.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    const clipboard = await page!.callFunction(`async () => {
      try {
        await navigator.clipboard.writeText('deckmate-smoke');
        let readDenied = false;
        try { await navigator.clipboard.readText(); } catch { readDenied = true; }
        return { written: true, readDenied };
      } catch (error) { return { written: false, error: String(error) }; }
    }`);
    if (!clipboard.written || !clipboard.readDenied) {
      throw new SmokeFailure(`clipboard write/read policy failed: ${JSON.stringify(clipboard)}`);
    }
    pass('b-clipboard', 'clipboard.writeText resolved; clipboard.readText was denied');
    currentStep = 'b';
    // CDP exposes only the document title (Target.getTargetInfo), not the window title, so read
    // the title Win32-side through PowerShell; headless sessions without a window skip with a note.
    const title = shell.pid ? windowTitle(shell.pid) : '';
    if (!title) {
      pass('b', `board at ${boardOrigin}; deckmateBoard present, deckmateDesktop absent; window title not readable here — skipped with a note`);
    } else {
      const collapsed = title.replace(/\u2014/g, '-');
      if (!collapsed.startsWith('Deckmate -') || !collapsed.includes('demo')) {
        throw new SmokeFailure(`window title is "${title}", expected "Deckmate — demo"`);
      }
      pass('b', `board at ${boardOrigin}; deckmateBoard present, deckmateDesktop absent; window title "${title}"`);
    }

    // c. The board bridge lists the demo as current and refuses everything outside its narrow scope.
    currentStep = 'c';
    const guard = await page!.callFunction(`async notRecent => {
      const recent = await window.deckmateBoard.recentProjects();
      const refused = await window.deckmateBoard.switchProject(notRecent);
      let launcherCommand;
      try {
        launcherCommand = await window.__TAURI_INTERNALS__.invoke('desktop_open_project', { folder: notRecent });
      } catch (error) {
        launcherCommand = { ok: false, code: 'forbidden', message: String(error) };
      }
      return { recent, refused, launcherCommand };
    }`, 'C:\\not-in-recent') as {
      recent?: { path: string; current?: boolean }[];
      refused?: { ok?: boolean; code?: string };
      launcherCommand?: { ok?: boolean; code?: string };
    };
    const demoEntry = (guard.recent ?? []).find(entry => norm(String(entry.path)) === norm(demo));
    if (!demoEntry) throw new SmokeFailure(`recentProjects() does not list the demo: ${JSON.stringify(guard.recent)}`);
    if (demoEntry.current !== true) throw new SmokeFailure('recentProjects() does not mark the demo as current');
    if (!guard.refused || guard.refused.ok !== false || guard.refused.code !== 'not-recent') {
      throw new SmokeFailure(`switchProject outside the recent list was not refused: ${JSON.stringify(guard.refused)}`);
    }
    if (guard.launcherCommand && guard.launcherCommand.ok === true) {
      throw new SmokeFailure('a launcher command succeeded from the board page');
    }
    pass('c', `recent lists the demo as current; switchProject refused (${guard.refused?.code}); desktop_open_project from the board refused (${guard.launcherCommand?.code ?? 'rejected'})`);

    // d. The navigation guard keeps the window on the server origin; external links open in the system browser.
    currentStep = 'd';
    await page!.evaluate(`location.href = 'https://example.com/'`);
    await sleep(2000);
    const origin = String(await page!.evaluate('location.origin'));
    if (origin !== boardOrigin) {
      throw new SmokeFailure(`location.href to example.com left the server origin (now ${origin})`);
    }
    // One URL per line; an exact line match, not a substring, so another host cannot pass the check.
    const external = existsSync(externalLog) ? readFileSync(externalLog, 'utf8').split(/\r?\n/u) : [];
    if (!external.some(line => line.trim() === 'https://example.com/')) {
      throw new SmokeFailure('the blocked link was not handed to the system browser (no entry in the external-links log)');
    }
    pass('d', `location.href to https://example.com/ stayed on ${origin}; the link went to the external handler, not the user's browser`);

    // e. showStartScreen returns to the launcher and stops the server process.
    currentStep = 'e';
    await page!.callFunction(`() => { void window.deckmateBoard.showStartScreen(); }`);
    await poll(launcherLoaded,
      'showStartScreen to return to the launcher', 20000);
    await poll(async () => serverProcesses(needles).length === 0,
      'the demo server process to exit', 15000);
    pass('e', 'back on the launcher; no node.exe for the demo or the server entry remains');

    currentStep = 'e-workspace';
    const launcherWorkspace = await page!.callFunction(`async folder => {
      const bridge = window.deckmateDesktop;
      const added = await bridge.addToWorkspace(folder);
      const moved = await bridge.moveInWorkspace(folder, 99);
      const state = await bridge.getState();
      const removed = await bridge.removeFromWorkspace(folder);
      return { added, moved, state, removed };
    }`, demo);
    if (launcherWorkspace.added.ok !== true || launcherWorkspace.moved.ok !== true
      || launcherWorkspace.state.workspace.length !== 1
      || norm(launcherWorkspace.state.workspace[0].path) !== norm(demo)
      || launcherWorkspace.state.workspace[0].missing !== false
      || launcherWorkspace.removed.ok !== true || launcherWorkspace.removed.workspace.length !== 0) {
      throw new SmokeFailure(`launcher workspace contract failed: ${JSON.stringify(launcherWorkspace)}`);
    }
    pass('e-workspace', 'launcher added a recent folder, moved it, returned workspace state and removed it');

    // f. createProject initializes and opens a project; killing the shell must reap its server
    // through the Job Object, and the isolated settings must list both projects.
    currentStep = 'f';
    await page!.callFunction(`folder => { void window.deckmateDesktop.createProject({ folder }); }`, created);
    try {
      await poll(async () => {
        const at = String(await page!.evaluate('location.href'));
        return at.startsWith('http://127.0.0.1:') && (await page!.evaluate(`!!document.querySelector('${boardSelector}')`)) === true;
      }, `createProject(${created}) to open the board`, 45000);
    } catch (error) {
      throw new SmokeFailure(`${(error as SmokeFailure).message} (${await diagnose(settings)})`);
    }
    currentStep = 'f-workspace';
    const workspace = await page!.callFunction(`async recentPath => {
      const bridge = window.deckmateBoard;
      const before = await bridge.workspaceProjects();
      const current = await bridge.addToWorkspace({ kind: 'current' });
      const recent = await bridge.addToWorkspace({ kind: 'recent', path: recentPath });
      const listed = await bridge.workspaceProjects();
      const moved = await bridge.moveInWorkspace(recentPath, -10);
      const removed = await bridge.removeFromWorkspace(current.projects[0].path);
      const restored = await bridge.addToWorkspace({ kind: 'current' });
      const notRecent = await bridge.addToWorkspace({ kind: 'recent', path: 'C:\\\\not-recent' });
      const notWorkspace = await bridge.removeFromWorkspace('C:\\\\nope');
      return { before, current, recent, listed, moved, removed, restored, notRecent, notWorkspace };
    }`, demo);
    const workspaceOrder = (projects: { path: string }[]) => projects.map(project => norm(project.path));
    const equalOrder = (projects: { path: string }[], expected: string[]) =>
      JSON.stringify(workspaceOrder(projects)) === JSON.stringify(expected.map(norm));
    if (workspace.before.length !== 0 || workspace.current.ok !== true || workspace.recent.ok !== true
      || !equalOrder(workspace.listed, [created, demo])
      || workspace.listed[0].current !== true || workspace.listed[1].current !== false
      || workspace.listed.some((project: { missing: boolean }) => project.missing !== false)
      || workspace.moved.ok !== true || !equalOrder(workspace.moved.projects, [demo, created])
      || workspace.removed.ok !== true || !equalOrder(workspace.removed.projects, [demo])
      || workspace.restored.ok !== true || !equalOrder(workspace.restored.projects, [demo, created])
      || workspace.notRecent.ok !== false || workspace.notRecent.code !== 'not-recent'
      || workspace.notWorkspace.ok !== false || workspace.notWorkspace.code !== 'not-in-workspace') {
      throw new SmokeFailure(`board workspace contract failed: ${JSON.stringify(workspace)}`);
    }
    pass('f-workspace', 'board added current + recent in order; moved, removed and restored; unlisted recent and workspace removals refused');

    // Remove demo from recent so the following board switch can succeed only through workspace trust.
    await page!.callFunction(`() => { void window.deckmateBoard.showStartScreen(); }`);
    await poll(launcherLoaded,
      'workspace test to return to the launcher', 20000);
    const removedRecent = await page!.callFunction(`folder => window.deckmateDesktop.removeRecent(folder)`, demo);
    if (removedRecent.ok !== true) throw new SmokeFailure('could not remove the workspace target from recent');
    await page!.callFunction(`folder => { void window.deckmateDesktop.openProject(folder); }`, created);
    await poll(async () => (await page!.evaluate(`typeof window.deckmateBoard === 'object' && !!document.querySelector('${boardSelector}')`)) === true,
      'workspace test to reopen the board', 30000);
    const switchOrigin = String(await page!.evaluate('location.origin'));
    await page!.callFunction(`folder => { void window.deckmateBoard.switchProject(folder); }`, demo);
    await poll(async () => {
      if (String(await page!.evaluate('location.origin')) === switchOrigin) return false;
      return (await page!.callFunction(`async folder => {
        if (!window.deckmateBoard || !document.querySelector('${boardSelector}')) return false;
        const projects = await window.deckmateBoard.workspaceProjects();
        return projects.some(project => project.path.replace(/\\\\/g, '/').toLowerCase() === folder && project.current);
      }`, norm(demo))) === true;
    }, 'switchProject to the workspace-only project', 30000);
    pass('f-workspace-switch', 'switchProject opened a workspace entry absent from recent');
    shell.kill();
    await poll(async () => serverProcesses(needles).length === 0,
      'the Job Object to reap the server after killing the shell', 15000);
    const saved = JSON.parse(readFileSync(path.join(settings, 'desktop.json'), 'utf8')) as {
      recent?: { path: string }[];
      workspace?: { path: string; name: string }[];
      updates?: { autoCheck: boolean; lastCheck: string | null; skippedVersion: string | null; pending: unknown };
    };
    const recentPaths = (saved.recent ?? []).map(entry => norm(String(entry.path)));
    for (const project of [demo, created]) {
      if (!recentPaths.includes(norm(project))) {
        throw new SmokeFailure(`desktop.json does not list ${project}: ${JSON.stringify(saved.recent)}`);
      }
    }
    pass('f', `createProject opened new-project; killing the shell reaped the server (Job Object); desktop.json lists ${saved.recent!.length} projects`);
    if (!saved.workspace || !equalOrder(saved.workspace, [demo, created])
      || saved.workspace[0].name !== 'demo' || saved.workspace[1].name !== 'new-project') {
      throw new SmokeFailure(`desktop.json workspace did not persist: ${JSON.stringify(saved.workspace)}`);
    }
    pass('f-workspace-save', 'desktop.json preserves the ordered workspace with folder names');

    // 2026-11-09: debug smoke must exercise the new settings without contacting the update service.
    currentStep = 'updates';
    const updates = saved.updates;
    if (!updates || updates.autoCheck !== true || updates.lastCheck !== null
      || updates.skippedVersion !== null || updates.pending !== null) {
      throw new SmokeFailure(`unexpected update settings in debug: ${JSON.stringify(updates)}`);
    }
    const log = readFileSync(path.join(settings, 'server.log'), 'utf8');
    if (!log.includes('updater disabled in debug/self-test mode') || log.includes('updater checking')) {
      throw new SmokeFailure('debug shell did not keep update checks disabled');
    }
    pass('updates', 'update defaults persisted; debug updater stayed disabled');

    // 2026-11-09: repeat with lastProject: the launcher's load must not expose a frame before the board.
    currentStep = 'restart-visibility';
    await poll(async () => shell.exitCode !== null || shell.signalCode !== null, 'the first shell to exit', 10000);
    await page.close();
    shell = launchShell();
    page = await connectToHeadlessBrowser(cdpPort);
    let visibleLauncher = false;
    await poll(async () => {
      const sample = await page!.evaluate(`({ url: location.href, visible: document.visibilityState, ready: document.readyState, board: !!document.querySelector('${boardSelector}') })`);
      if (sample.visible === 'visible' && sample.url.includes('tauri.localhost')) {
        visibleLauncher = true;
      }
      return sample.url.startsWith('http://127.0.0.1:') && sample.ready === 'complete' && sample.board;
    }, 'the last project to auto-open', 30000);
    if (visibleLauncher) throw new SmokeFailure('a visible launcher frame appeared during auto-open');
    const restartVisibility = await page.evaluate('window.__deckmateFirstLoadVisibility');
    if (restartVisibility?.atLoad !== 'hidden') {
      throw new SmokeFailure(`auto-open window was visible before board load: ${JSON.stringify(restartVisibility)}`);
    }
    await poll(async () => (await page!.evaluate('document.visibilityState')) === 'visible',
      'the loaded auto-open board to become visible', 10000);
    const firstShows = readFileSync(path.join(settings, 'server.log'), 'utf8').split(/\r?\n/u)
      .filter(line => line.includes('main first show:'));
    if (firstShows.length !== 2 || !firstShows[1].includes('http://127.0.0.1:')) {
      throw new SmokeFailure(`auto-open exposed a launcher before the board: ${JSON.stringify(firstShows)}`);
    }
    pass('restart-visibility', 'same settings auto-opened last project; board load was hidden; first visible frame was the loaded board');

    pass('smoke', 'all steps passed');
    return 0;
  } catch (error) {
    const detail = error instanceof SmokeFailure ? error.message : (error instanceof Error ? error.stack ?? error.message : String(error));
    console.log(`FAIL ${currentStep} — ${detail}`);
    return 1;
  } finally {
    killShell(true);
    try {
      if (page) await page.close();
    } catch { /* the shell is already gone */ }
    await sleep(500);
    rmSync(temp, { recursive: true, force: true });
  }
}

process.exitCode = await main();
