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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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

function quitFromMenu(pid: number): void {
  // 2026-11-09: WM_COMMAND enters the same native Quit menu handler without adding a page capability.
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class DeckmateMenu {
      [DllImport("user32.dll")] public static extern IntPtr GetMenu(IntPtr hwnd);
      [DllImport("user32.dll")] public static extern IntPtr GetSubMenu(IntPtr menu, int index);
      [DllImport("user32.dll")] public static extern int GetMenuItemCount(IntPtr menu);
      [DllImport("user32.dll")] public static extern uint GetMenuItemID(IntPtr menu, int index);
      [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr hwnd, uint message, UIntPtr wparam, IntPtr lparam);
    }';
    $window = (Get-Process -Id ${pid}).MainWindowHandle;
    $menu = [DeckmateMenu]::GetSubMenu([DeckmateMenu]::GetMenu($window), 0);
    $id = [DeckmateMenu]::GetMenuItemID($menu, [DeckmateMenu]::GetMenuItemCount($menu) - 1);
    if ($window -eq 0 -or $menu -eq 0 -or $id -eq [uint32]::MaxValue) { throw 'Quit menu not found'; }
    if (-not [DeckmateMenu]::PostMessageW($window, 0x111, [UIntPtr]::new($id), [IntPtr]::Zero)) { throw 'PostMessage failed'; }
  `], { encoding: 'utf8', timeout: 15000, windowsHide: true });
}

function openWhatsNew(pid: number): void {
  // 2026-11-09: the debug Help menu has no pending-update item; What's new is its third command.
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class DeckmateHelp {
      [DllImport("user32.dll")] public static extern IntPtr GetMenu(IntPtr hwnd);
      [DllImport("user32.dll")] public static extern IntPtr GetSubMenu(IntPtr menu, int index);
      [DllImport("user32.dll")] public static extern uint GetMenuItemID(IntPtr menu, int index);
      [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr hwnd, uint message, UIntPtr wparam, IntPtr lparam);
    }';
    $window = (Get-Process -Id ${pid}).MainWindowHandle;
    $menu = [DeckmateHelp]::GetSubMenu([DeckmateHelp]::GetMenu($window), 3);
    $id = [DeckmateHelp]::GetMenuItemID($menu, 2);
    if ($window -eq 0 -or $menu -eq 0 -or $id -eq [uint32]::MaxValue) { throw 'Help menu not found'; }
    if (-not [DeckmateHelp]::PostMessageW($window, 0x111, [UIntPtr]::new($id), [IntPtr]::Zero)) { throw 'PostMessage failed'; }
  `], { encoding: 'utf8', timeout: 15000, windowsHide: true });
}

function sessionWindow(pid: number, action: 'query' | 'cancel' | 'end' | 'reason', flags = 0, title = '', className = ''): { result: number; reason: string | null } {
  const message = action === 'query' ? 0x11 : 0x16;
  const output = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `
    [Console]::OutputEncoding=[System.Text.Encoding]::UTF8;
    Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public class DeckmateSession {
      public delegate bool Visitor(IntPtr hwnd, IntPtr data);
      [DllImport("user32.dll")] public static extern bool EnumWindows(Visitor callback, IntPtr data);
      [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
      [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hwnd, StringBuilder text, int count);
      [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hwnd, StringBuilder text, int count);
      [DllImport("user32.dll")] public static extern IntPtr SendMessageW(IntPtr hwnd, uint message, UIntPtr wparam, IntPtr lparam);
      [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool ShutdownBlockReasonQuery(IntPtr hwnd, StringBuilder reason, ref uint count);
      public static IntPtr Find(uint pid, string title, string className) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((hwnd, data) => {
          uint owner; GetWindowThreadProcessId(hwnd, out owner);
          var text = new StringBuilder(512); GetWindowTextW(hwnd, text, text.Capacity);
          var kind = new StringBuilder(128); GetClassNameW(hwnd, kind, kind.Capacity);
          bool matches = className.Length > 0 ? kind.ToString() == className : (title.Length == 0 ? text.ToString().StartsWith("Deckmate") : text.ToString() == title);
          if (owner == pid && matches) {
            found = hwnd; return false;
          }
          return true;
        }, IntPtr.Zero);
        return found;
      }
    }';
    $window = [DeckmateSession]::Find(${pid}, '${title.replace(/'/g, "''")}', '${className.replace(/'/g, "''")}');
    if ($window -eq [IntPtr]::Zero) { throw 'Session window not found'; }
    $result = [IntPtr]::Zero;
    ${action === 'reason' ? '' : `$result = [DeckmateSession]::SendMessageW($window, ${message}, [UIntPtr]::new(${action === 'end' ? 1 : 0}), [IntPtr]::new(${flags}));`}
    $reason = New-Object System.Text.StringBuilder 512;
    [uint32]$count = $reason.Capacity;
    $exists = [DeckmateSession]::ShutdownBlockReasonQuery($window, $reason, [ref]$count);
    @{ result = $result.ToInt64(); reason = $(if ($exists) { $reason.ToString() } else { $null }) } | ConvertTo-Json -Compress;
  `], { encoding: 'utf8', timeout: 15000, windowsHide: true, stdio: 'pipe' }).trim();
  return JSON.parse(output) as { result: number; reason: string | null };
}

async function shortcut(key: string, code: string, virtualKey: number, modifiers = 2): Promise<void> {
  for (const type of ['rawKeyDown', 'keyUp']) {
    await page!.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: virtualKey, modifiers });
  }
}

async function copyText(text: string): Promise<void> {
  // 2026-11-10: after readText is denied, WebView2 can also refuse later async writes; use real Copy, not a CDP permission grant.
  await page!.callFunction(`text => {
    const input = document.createElement('textarea');
    input.id = 'smoke-clipboard-source'; input.value = text; document.body.append(input);
    input.focus(); input.select();
  }`, text);
  await shortcut('c', 'KeyC', 67);
  await page!.evaluate(`document.getElementById('smoke-clipboard-source').remove()`);
}

async function pasteInEditors(boardOrigin: string): Promise<void> {
  // 2026-11-10: a plain textarea misses the real paste listeners in the card editor and Excalidraw.
  currentStep = 'b-card-paste';
  const catalog = await (await fetch(`${boardOrigin}/api/catalog?source=live`)).json() as { cards: { id: string }[] };
  if (!catalog.cards.length) throw new SmokeFailure('demo has no card for the paste check');
  await page!.evaluate(`location.href = ${JSON.stringify(`${boardOrigin}/?catalogSource=live&scope=all&card=${encodeURIComponent(catalog.cards[0].id)}`)}`);
  await poll(async () => (await page!.evaluate(`!!document.querySelector('.card-content-edit-action:not(:disabled)')`)) === true,
    'the real card editor action to become available', 20000);
  await page!.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await page!.evaluate(`document.querySelector('.card-content-edit-action').click()`);
  await poll(async () => (await page!.evaluate(`!!document.querySelector('.card-edit-text:not(:disabled)')`)) === true,
    'the card text editor to open', 10000);
  await copyText(' deckmate-card-paste');
  await page!.callFunction(`() => {
    const editor = document.querySelector('.card-edit-text');
    editor.focus(); editor.setSelectionRange(editor.value.length, editor.value.length);
    window.__smokeCardBeforePaste = editor.value;
  }`);
  await shortcut('v', 'KeyV', 86);
  await poll(async () => (await page!.evaluate(`document.querySelector('.card-edit-text').value === window.__smokeCardBeforePaste + ' deckmate-card-paste'`)) === true,
    'Ctrl+V to paste into the card editor', 5000);
  await shortcut('z', 'KeyZ', 90);
  await poll(async () => (await page!.evaluate(`document.querySelector('.card-edit-text').value === window.__smokeCardBeforePaste`)) === true,
    'Undo to restore the card before closing its editor', 5000);
  await page!.evaluate(`document.querySelector('.card-edit .is-cancel').click()`);
  await poll(async () => (await page!.evaluate(`!document.querySelector('.card-edit-text') && !document.querySelector('.global-tabs button:last-child').disabled`)) === true,
    'the unchanged card editor to close', 5000);
  pass('b-card-paste', 'CDP Ctrl+V reached the real card editor; Undo restored its text without saving');

  currentStep = 'b-vision-paste';
  await page!.evaluate(`document.querySelector('.global-tabs button:last-child').click()`);
  await poll(async () => (await page!.evaluate(`!!document.querySelector('.excalidraw canvas.interactive')`)) === true,
    'the Vision canvas to mount', 20000);
  await copyText('deckmate-vision-paste');
  const point = await page!.evaluate(`(() => {
    const box = document.querySelector('.excalidraw canvas.interactive').getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  })()`);
  await page!.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await page!.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await page!.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  await shortcut('v', 'KeyV', 86);
  await poll(async () => (await page!.evaluate(`!document.querySelector('.vision-toolbar-actions button:last-child').disabled`)) === true,
    'Ctrl+V to change the Vision scene', 10000);
  await page!.evaluate(`document.querySelector('.vision-toolbar-actions button').click()`);
  await poll(async () => (await page!.evaluate(`!!document.querySelector('.vision-toolbar select').value && document.querySelector('.vision-toolbar-actions button:last-child').disabled`)) === true,
    'the pasted Vision scene to save in the temporary demo', 10000);
  const pasted = await page!.callFunction(`async () => {
    const id = document.querySelector('.vision-toolbar select').value;
    const response = await fetch('/api/boards/' + encodeURIComponent(id) + '?source=live');
    const board = await response.json();
    return response.ok && board.scene.elements.some(element => !element.isDeleted && element.text === 'deckmate-vision-paste');
  }`);
  if (pasted !== true) throw new SmokeFailure('the saved Vision scene has no pasted text element');
  await page!.evaluate(`document.querySelectorAll('.global-tabs button')[1].click()`);
  await poll(async () => (await page!.evaluate(`!document.querySelector('.vision-workspace')`)) === true,
    'the clean Vision scene to return to Decks', 5000);
  pass('b-vision-paste', 'CDP Ctrl+V created a text element in Vision; its saved temporary scene contains the clipboard text');
}

function switchProjectShortcut(pid: number): void {
  // 2026-11-09: CDP input reaches only the renderer, so native AcceleratorKeyPressed needs Win32 virtual-key input.
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class DeckmateKeys {
      [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
      [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
      [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr hwnd, int command);
      [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, IntPtr process);
      [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
      [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
      [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
      public static void Focus(IntPtr hwnd) {
        ShowWindowAsync(hwnd, 9);
        uint foreground = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
        uint current = GetCurrentThreadId();
        bool attached = foreground != current && AttachThreadInput(current, foreground, true);
        SetForegroundWindow(hwnd);
        if (attached) AttachThreadInput(current, foreground, false);
      }
    }';
    $window = (Get-Process -Id ${pid}).MainWindowHandle;
    if ($window -eq 0) { throw 'Main window not found'; }
    [DeckmateKeys]::Focus($window);
    Start-Sleep -Milliseconds 200;
    if ([DeckmateKeys]::GetForegroundWindow() -ne $window) { throw 'Could not focus the debug window'; }
    [DeckmateKeys]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero);
    [DeckmateKeys]::keybd_event(0x10, 0, 0, [UIntPtr]::Zero);
    [DeckmateKeys]::keybd_event(0x50, 0, 0, [UIntPtr]::Zero);
    [DeckmateKeys]::keybd_event(0x50, 0, 2, [UIntPtr]::Zero);
    [DeckmateKeys]::keybd_event(0x10, 0, 2, [UIntPtr]::Zero);
    [DeckmateKeys]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero);
  `], { encoding: 'utf8', timeout: 15000, windowsHide: true });
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
  const launchShell = (askPolicy = 'rendererCrashedRepeatedly=startScreen', server = serverEntry) => spawn(exe, [], {
    env: {
      ...process.env,
      DECKMATE_DESKTOP_CDP_PORT: String(cdpPort),
      DECKMATE_DESKTOP_SETTINGS_DIR: settings,
      DECKMATE_DESKTOP_SERVER: server,
      DECKMATE_DESKTOP_DIRTY_POLICY: 'refuse',
      DECKMATE_DESKTOP_ASK_POLICY: askPolicy,
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
    const dirtyFromLauncher = await page!.callFunction(`async () => {
      try { return await window.__TAURI_INTERNALS__.invoke('board_set_dirty', { dirty: true }); }
      catch { return { ok: false }; }
    }`);
    if (dirtyFromLauncher.ok !== false) throw new SmokeFailure('launcher could set board dirty state');
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
    const notification = await page!.callFunction(`() => Notification.requestPermission()`);
    if (notification !== 'denied') throw new SmokeFailure(`notifications were not denied: ${notification}`);
    pass('b-notifications', 'Notification.requestPermission resolved denied without a prompt');
    currentStep = 'b-keys';
    await page!.evaluate(`(() => {
      window.__smokePrints = 0;
      addEventListener('beforeprint', () => window.__smokePrints++);
      const input = document.createElement('textarea');
      input.id = 'smoke-edit'; document.body.append(input); input.focus(); input.value = 'editing';
      window.__smokeDocument = true;
    })()`);
    await shortcut('p', 'KeyP', 80);
    await shortcut('F5', 'F5', 116, 0);
    await sleep(500);
    if ((await page!.evaluate('window.__smokePrints === 0 && window.__smokeDocument === true')) !== true) {
      throw new SmokeFailure('Ctrl+P printed or F5 reloaded the page');
    }
    await shortcut('a', 'KeyA', 65);
    await shortcut('c', 'KeyC', 67);
    await shortcut('x', 'KeyX', 88);
    if ((await page!.evaluate(`document.getElementById('smoke-edit').value`)) !== '') throw new SmokeFailure('Ctrl+A/C/X editing failed');
    await shortcut('v', 'KeyV', 86);
    if ((await page!.evaluate(`document.getElementById('smoke-edit').value`)) !== 'editing') throw new SmokeFailure('Ctrl+V editing failed');
    await shortcut('z', 'KeyZ', 90);
    if ((await page!.evaluate(`document.getElementById('smoke-edit').value`)) !== '') throw new SmokeFailure('Ctrl+Z editing failed');
    await shortcut('y', 'KeyY', 89);
    if ((await page!.evaluate(`document.getElementById('smoke-edit').value`)) !== 'editing') throw new SmokeFailure('Ctrl+Y editing failed');
    await page!.evaluate(`document.getElementById('smoke-edit').remove()`);
    pass('b-keys', 'CDP Ctrl+P/F5 did not print/reload; Ctrl+A/C/X/V/Z/Y still edit text');
    await pasteInEditors(boardOrigin);
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

    currentStep = 'c-dirty';
    const dirty = await page!.callFunction(`async () => {
      const marked = await window.deckmateBoard.setDirty(true);
      const refused = await window.deckmateBoard.showStartScreen();
      return { marked, refused };
    }`);
    if (!dirty.marked.ok || dirty.refused.ok !== false || dirty.refused.code !== 'cancelled') {
      throw new SmokeFailure(`dirty start-screen switch was not refused: ${JSON.stringify(dirty)}`);
    }
    const cancelledBeforeQuit = readFileSync(path.join(settings, 'server.log'), 'utf8').split('unsaved work: action cancelled').length;
    quitFromMenu(shell.pid!);
    await poll(async () => readFileSync(path.join(settings, 'server.log'), 'utf8').split('unsaved work: action cancelled').length > cancelledBeforeQuit,
      'the dirty Quit menu action to be cancelled', 10000);
    if (shell.exitCode !== null || (await page!.evaluate('location.origin')) !== boardOrigin || !(await fetch(boardOrigin)).ok) {
      throw new SmokeFailure('dirty Quit stopped the window or its server');
    }
    await page!.callFunction(`() => window.deckmateBoard.setDirty(false)`);
    pass('c-dirty', 'dirty bridge/start-screen switch and native Quit menu refused; window and server remain alive');

    currentStep = 'session-query';
    const cancelledBeforeSession = readFileSync(path.join(settings, 'server.log'), 'utf8').split('unsaved work: action cancelled').length;
    for (const flags of [0, 1]) { // ENDSESSION_CLOSEAPP (Restart Manager) must not bypass unsaved work.
      await page!.callFunction(`() => window.deckmateBoard.setDirty(true)`);
      const blocked = sessionWindow(shell.pid!, 'query', flags);
      if (blocked.result !== 0 || !blocked.reason?.includes(state.language === 'ru' ? 'несохранённые изменения' : 'unsaved changes')) {
        throw new SmokeFailure(`dirty WM_QUERYENDSESSION (${flags}) did not register a localized reason: ${JSON.stringify(blocked)}`);
      }
      const cancelled = sessionWindow(shell.pid!, 'cancel');
      if (cancelled.reason !== null) throw new SmokeFailure('WM_ENDSESSION(FALSE) left the shutdown reason registered');
      if (sessionWindow(shell.pid!, 'query', flags).result !== 0) throw new SmokeFailure('dirty query after cancellation was not blocked');
      await page!.callFunction(`() => window.deckmateBoard.setDirty(false)`);
      await poll(async () => sessionWindow(shell.pid!, 'reason').reason === null,
        'saving work to release the shutdown reason without ending the session', 10000);
      const clean = sessionWindow(shell.pid!, 'query', flags);
      if (clean.result === 0 || clean.reason !== null) throw new SmokeFailure(`clean WM_QUERYENDSESSION (${flags}) was blocked: ${JSON.stringify(clean)}`);
      sessionWindow(shell.pid!, 'cancel');
    }
    await page!.callFunction(`() => window.deckmateBoard.setDirty(true)`);
    if (sessionWindow(shell.pid!, 'query', 1, '', 'Tao Thread Event Target').result !== 0
      || !sessionWindow(shell.pid!, 'reason').reason) throw new SmokeFailure("hidden tao query did not register a visible shutdown reason");
    sessionWindow(shell.pid!, 'cancel', 0, '', 'Tao Thread Event Target');
    if (sessionWindow(shell.pid!, 'reason').reason !== null) throw new SmokeFailure('hidden tao cancellation left a visible shutdown reason');
    await page!.callFunction(`() => window.deckmateBoard.setDirty(false)`);
    if (sessionWindow(shell.pid!, 'query', 1, '', 'Tao Thread Event Target').result === 0) throw new SmokeFailure('hidden tao query blocked clean work');
    sessionWindow(shell.pid!, 'cancel', 0, '', 'Tao Thread Event Target');
    if (readFileSync(path.join(settings, 'server.log'), 'utf8').split('unsaved work: action cancelled').length !== cancelledBeforeSession) {
      throw new SmokeFailure('session queries opened the ordinary unsaved-work confirmation path');
    }
    if ((await page!.evaluate('location.origin')) !== boardOrigin || !(await fetch(boardOrigin)).ok) {
      throw new SmokeFailure('session query/cancellation stopped the board or its server');
    }
    pass('session-query', 'main + hidden tao normal/Restart Manager queries block only dirty work; visible Windows reason cleared on cancellation and setDirty(false); no native leave dialog');

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

    // e. The native Switch project shortcut works inside a board editor, independently of the keyboard layout.
    currentStep = 'e';
    await page!.evaluate(`(() => {
      const input = document.createElement('textarea');
      input.id = 'smoke-switch-edit'; document.body.append(input); input.focus();
    })()`);
    await page!.send('Page.bringToFront');
    switchProjectShortcut(shell.pid!);
    await poll(launcherLoaded,
      'Ctrl+Shift+P to return to the launcher', 20000);
    await poll(async () => serverProcesses(needles).length === 0,
      'the demo server process to exit', 15000);
    pass('e', 'native Ctrl+Shift+P from a CDP-focused editor returned to the launcher by virtual key; no demo server remains');

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

    currentStep = 'e-save-failed';
    const settingsFile = path.join(settings, 'desktop.json');
    const settingsBackup = path.join(settings, 'desktop.json.smoke');
    renameSync(settingsFile, settingsBackup);
    mkdirSync(settingsFile);
    try {
      const failed = await page!.callFunction(`async folder => ({
        language: await window.deckmateDesktop.setLanguage('ru'),
        recent: await window.deckmateDesktop.removeRecent('C:\\\\missing-smoke-project'),
        workspace: await window.deckmateDesktop.addToWorkspace(folder),
      })`, demo);
      if (Object.values(failed).some(result => (result as { ok: boolean; code: string }).ok !== false || (result as { code: string }).code !== 'save-failed')) {
        throw new SmokeFailure(`settings commands hid a failed save: ${JSON.stringify(failed)}`);
      }
      await page!.callFunction(`() => removeRecent('C:\\\\missing-smoke-project')`);
      if ((await page!.evaluate(`document.getElementById('status').dataset.phase`)) !== 'error') throw new SmokeFailure('removeRecent UI hid a failed save');
      await page!.evaluate(`document.querySelector('[data-lang="en"]').click()`);
      await poll(async () => (await page!.evaluate(`document.getElementById('status').dataset.phase === 'error' && document.getElementById('status-text').textContent.includes('Could not save settings')`)) === true,
        'language save error to reach the status line', 5000);
    } finally {
      rmSync(settingsFile, { recursive: true, force: true });
      renameSync(settingsBackup, settingsFile);
    }
    await page!.callFunction(`async folder => {
      await window.deckmateDesktop.setLanguage('en');
      await window.deckmateDesktop.removeFromWorkspace(folder);
    }`, demo);
    pass('e-save-failed', 'language/recent/workspace returned save-failed; launcher language and recent actions showed status errors');

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
    currentStep = 'f-dirty-switch';
    const refusedSwitch = await page!.callFunction(`async folder => {
      await window.deckmateBoard.setDirty(true);
      return window.deckmateBoard.switchProject(folder);
    }`, demo);
    if (refusedSwitch?.ok !== false || refusedSwitch?.code !== 'cancelled') {
      throw new SmokeFailure(`dirty workspace switch was not refused: ${JSON.stringify(refusedSwitch)} (${await diagnose(settings)})`);
    }
    await page!.callFunction(`() => window.deckmateBoard.setDirty(false)`);
    await page!.evaluate(`window.__smokeOldProject = true; localStorage.setItem('deckmate-smoke-origin', 'kept')`);
    await page!.callFunction(`folder => { void window.deckmateBoard.switchProject(folder); }`, demo);
    await poll(async () => {
      if ((await page!.evaluate('window.__smokeOldProject')) === true) return false;
      return (await page!.callFunction(`async folder => {
        if (!window.deckmateBoard || !document.querySelector('${boardSelector}')) return false;
        const projects = await window.deckmateBoard.workspaceProjects();
        return projects.some(project => project.path.replace(/\\\\/g, '/').toLowerCase() === folder && project.current);
      }`, norm(demo))) === true;
    }, 'switchProject to the workspace-only project', 30000);
    if ((await page!.evaluate('location.origin')) !== boardOrigin) throw new SmokeFailure('project switch changed the saved board origin');
    pass('f-workspace-switch', 'dirty switch refused; clean switch opened a workspace entry absent from recent on the same origin');
    shell.kill();
    await poll(async () => serverProcesses(needles).length === 0,
      'the Job Object to reap the server after killing the shell', 15000);
    const saved = JSON.parse(readFileSync(path.join(settings, 'desktop.json'), 'utf8')) as {
      recent?: { path: string }[];
      serverPort?: number;
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
    if (saved.serverPort !== Number(new URL(boardOrigin).port)
      || (await page!.evaluate('location.origin')) !== boardOrigin
      || (await page!.evaluate(`localStorage.getItem('deckmate-smoke-origin')`)) !== 'kept') {
      throw new SmokeFailure('serverPort/origin/localStorage did not survive restart');
    }
    pass('restart-origin', 'serverPort, board origin and localStorage survived project switching and shell restart');

    currentStep = 'renderer-crash';
    await page!.evaluate('window.__smokeBeforeCrash = true');
    void page!.send('Page.crash');
    await poll(async () => (await page!.evaluate(`!window.__smokeBeforeCrash && !!document.querySelector('${boardSelector}')`)) === true,
      'the crashed renderer to reload the board', 20000);
    if (!readFileSync(path.join(settings, 'server.log'), 'utf8').includes('recovery=Reload')) throw new SmokeFailure('renderer crash was not logged');
    pass('renderer-crash', 'WebView2 renderer crash logged; the current board automatically reloaded');

    currentStep = 'renderer-crash-budget';
    await page!.evaluate('window.__smokeBeforeCrash = true');
    void page!.send('Page.crash').catch(() => {});
    await poll(async () => (await page!.evaluate(`!window.__smokeBeforeCrash && !!document.querySelector('${boardSelector}')`)) === true,
      'the second crashed renderer to reload the board', 20000);
    void page!.send('Page.crash').catch(() => {});
    await poll(launcherLoaded, 'the third crash question to select the start screen', 20000);
    const crashLog = readFileSync(path.join(settings, 'server.log'), 'utf8').split(/\r?\n/u);
    const autoReloads = crashLog.filter(line => line.includes('WebView2 automatic renderer reload'));
    if (autoReloads.length !== 2 || crashLog.filter(line => line.includes('native question: rendererCrashedRepeatedly')).length !== 1) {
      throw new SmokeFailure(`renderer budget did not stop after two reloads: ${autoReloads.length} automatic reloads (${await diagnose(settings)})`);
    }
    for (const reload of autoReloads) {
      const index = crashLog.indexOf(reload);
      const failure = crashLog.slice(0, index).findLast(line => line.includes('WebView2 process failed:') && line.includes('recovery=Reload'));
      if (!failure || Date.parse(reload.split(' ')[0]) - Date.parse(failure.split(' ')[0]) < 450) {
        throw new SmokeFailure('automatic renderer reload did not wait about 500 ms');
      }
    }
    await poll(async () => serverProcesses(needles).length === 0, 'crash recovery to stop the board server', 15000);
    pass('renderer-crash-budget', 'three rapid crashes: exactly two delayed automatic reloads, then Reload/Start screen question; Start screen stopped the server');

    currentStep = 'session-secondary';
    await page!.callFunction(`folder => { void window.deckmateDesktop.openProject(folder); }`, demo);
    await poll(async () => (await page!.evaluate(`typeof window.deckmateBoard === 'object' && !!document.querySelector('${boardSelector}')`)) === true,
      'session-end test to reopen the board', 30000);
    openWhatsNew(shell.pid!);
    const whatsNewTitle = "What's new in Deckmate";
    try {
      await poll(async () => sessionWindow(shell.pid!, 'reason', 0, whatsNewTitle).reason === null,
        "the What's new window to open", 10000);
    } catch (error) {
      throw new SmokeFailure(`${(error as Error).message} (${await diagnose(settings)})`);
    }
    await page!.callFunction(`() => window.deckmateBoard.setDirty(true)`);
    const secondaryBlocked = sessionWindow(shell.pid!, 'query', 1, whatsNewTitle);
    if (secondaryBlocked.result !== 0 || !secondaryBlocked.reason?.includes('unsaved changes')) {
      throw new SmokeFailure(`What's new bypassed unsaved session protection: ${JSON.stringify(secondaryBlocked)}`);
    }
    if (sessionWindow(shell.pid!, 'cancel', 0, whatsNewTitle).reason !== null) throw new SmokeFailure("What's new kept a cancelled shutdown reason");
    sessionWindow(shell.pid!, 'query', 0, whatsNewTitle);
    await page!.callFunction(`() => window.deckmateBoard.setDirty(false)`);
    await poll(async () => sessionWindow(shell.pid!, 'reason', 0, whatsNewTitle).reason === null,
      "saving work to clear the What's new shutdown reason", 10000);
    if (sessionWindow(shell.pid!, 'query', 1, whatsNewTitle).result === 0) throw new SmokeFailure("What's new blocked a clean shutdown");
    sessionWindow(shell.pid!, 'cancel', 0, whatsNewTitle);
    pass('session-secondary', "What's new uses the same dirty/clean shutdown policy and releases its reasons on cancellation and saving");

    currentStep = 'session-end';
    await page!.callFunction(`() => window.deckmateBoard.setDirty(true)`);
    const beforeEndSave = statSync(path.join(settings, 'desktop.json')).mtimeMs;
    sessionWindow(shell.pid!, 'end', 1, whatsNewTitle);
    await poll(async () => shell.exitCode !== null || shell.signalCode !== null, 'WM_ENDSESSION(TRUE) to exit the shell', 10000);
    await poll(async () => serverProcesses(needles).length === 0, 'session end to reap the server', 10000);
    const sessionLog = readFileSync(path.join(settings, 'server.log'), 'utf8');
    if (!sessionLog.includes('Windows session ending') || !sessionLog.includes('Windows session ending: server stopped; code=0, forced=false')) {
      throw new SmokeFailure(`session end did not log a graceful server stop: ${sessionLog.split('\n').slice(-8).join(' | ')}`);
    }
    const finalSettings = JSON.parse(readFileSync(path.join(settings, 'desktop.json'), 'utf8'));
    if (!finalSettings.windowBounds || norm(finalSettings.lastProject) !== norm(demo)
      || statSync(path.join(settings, 'desktop.json')).mtimeMs <= beforeEndSave) throw new SmokeFailure('session end did not save window/project settings');
    pass('session-end', 'forced ENDSESSION(TRUE) via secondary window exited without a leave dialog; server stopped gracefully; window/project settings preserved');

    currentStep = 'renderer-crash-manual';
    await page!.close();
    shell = launchShell('rendererCrashedRepeatedly=reload');
    page = await connectToHeadlessBrowser(cdpPort);
    await poll(async () => (await page!.evaluate(`typeof window.deckmateBoard === 'object' && !!document.querySelector('${boardSelector}')`)) === true,
      'the manual crash-recovery test to auto-open the board', 30000);
    for (let crash = 0; crash < 4; crash++) {
      await page!.evaluate('window.__smokeBeforeCrash = true');
      void page!.send('Page.crash').catch(() => {});
      await poll(async () => (await page!.evaluate(`!window.__smokeBeforeCrash && !!document.querySelector('${boardSelector}')`)) === true,
        `renderer crash ${crash + 1} to reload automatically or by explicit answer`, 20000);
    }
    const manualLog = readFileSync(path.join(settings, 'server.log'), 'utf8');
    if (manualLog.split('WebView2 automatic renderer reload').length - sessionLog.split('WebView2 automatic renderer reload').length !== 2
      || manualLog.split('native question: rendererCrashedRepeatedly').length - sessionLog.split('native question: rendererCrashedRepeatedly').length !== 2) {
      throw new SmokeFailure('manual Reload reset the automatic budget or did not ask again on the fourth crash');
    }
    pass('renderer-crash-manual', 'Reload answer restored the board; the fourth crash asked again without resetting the two-reload budget');

    currentStep = 'session-hidden-end';
    await page!.callFunction(`() => window.deckmateBoard.setDirty(true)`);
    sessionWindow(shell.pid!, 'end', 0, '', 'Tao Thread Event Target');
    await poll(async () => shell.exitCode !== null || shell.signalCode !== null, "the hidden tao HWND's ENDSESSION(TRUE) to exit", 10000);
    await poll(async () => serverProcesses(needles).length === 0, 'hidden-window session end to stop the server', 10000);
    const hiddenLog = readFileSync(path.join(settings, 'server.log'), 'utf8').slice(manualLog.length);
    if (!hiddenLog.includes('Windows session ending: server stopped; code=0, forced=false')) {
      throw new SmokeFailure(`hidden tao HWND bypassed graceful shutdown: ${hiddenLog}`);
    }
    pass('session-hidden-end', "ENDSESSION(TRUE) sent first to tao's hidden HWND also logged and stopped the server gracefully before tao exited");

    currentStep = 'session-end-timeout';
    const stalledServer = path.join(temp, 'stalled-server.cjs');
    // 2026-11-09: a ready HTTP server which ignores stdin exercises the real two-second deadline,
    // rather than the normal three-second server stop or a second timeout after a lifecycle wait.
    writeFileSync(stalledServer, `
      const http = require('node:http');
      const server = http.createServer((_request, reply) => {
        reply.writeHead(200, { 'Content-Type': 'text/html' });
        reply.end('<!doctype html><html><body><div class="app-shell">shutdown deadline fixture</div></body></html>');
      });
      server.listen(Number(process.env.DECKMATE_PORT), '127.0.0.1', () => {
        console.log('Deckmate: http://127.0.0.1:' + process.env.DECKMATE_PORT);
      });
      process.stdin.resume();
      process.stdin.on('data', () => {});
    `);
    needles.push(norm(stalledServer));
    const beforeTimeoutLog = readFileSync(path.join(settings, 'server.log'), 'utf8');
    await page!.close();
    shell = launchShell(undefined, stalledServer);
    page = await connectToHeadlessBrowser(cdpPort);
    await poll(async () => (await page!.evaluate(`typeof window.deckmateBoard === 'object' && !!document.querySelector('${boardSelector}')`)) === true,
      'the shutdown deadline fixture to load in the real window', 30000);
    if (serverProcesses([norm(stalledServer)]).length !== 1) throw new SmokeFailure('stalled server fixture did not start');
    await page!.callFunction(`() => window.deckmateBoard.setDirty(true)`);
    sessionWindow(shell.pid!, 'end');
    await poll(async () => shell.exitCode !== null || shell.signalCode !== null, 'the main window session end to exit despite a stalled server', 10000);
    await poll(async () => serverProcesses(needles).length === 0, 'the Job Object to reap the stalled server at the shutdown deadline', 10000);
    const timeoutLog = readFileSync(path.join(settings, 'server.log'), 'utf8').slice(beforeTimeoutLog.length).split(/\r?\n/u);
    const ending = timeoutLog.find(line => line.endsWith('Windows session ending'));
    const deadline = timeoutLog.find(line => line.includes('Windows session ending: server cleanup deadline reached'));
    const elapsed = ending && deadline ? Date.parse(deadline.split(' ')[0]) - Date.parse(ending.split(' ')[0]) : NaN;
    if (!Number.isFinite(elapsed) || elapsed < 1800 || elapsed > 2000) {
      throw new SmokeFailure(`stalled server did not respect one two-second cleanup deadline: ${elapsed} ms; ${timeoutLog.slice(-5).join(' | ')}`);
    }
    pass('session-end-timeout', `main HWND exited with a stalled server; one cleanup deadline (${elapsed} ms); Job Object reaped the child`);

    currentStep = 'startup-failure';
    const rejectedProject = path.join(temp, 'rejected-project');
    const outsideTools = path.join(temp, 'outside-tools');
    mkdirSync(rejectedProject);
    mkdirSync(outsideTools);
    writeFileSync(path.join(outsideTools, 'board.py'), '');
    // 2026-11-09: a junction needs no symlink privilege; the real server rejects the escaped board
    // path before starting Python. lastProject still passes the shell's existing-directory check.
    symlinkSync(outsideTools, path.join(rejectedProject, 'Tools'), 'junction');
    needles.push(norm(rejectedProject));
    for (let attempt = 1; attempt <= 3; attempt++) {
      await page!.close();
      const beforeFailureLog = readFileSync(path.join(settings, 'server.log'), 'utf8');
      const restartSettings = JSON.parse(readFileSync(settingsFile, 'utf8'));
      writeFileSync(settingsFile, JSON.stringify({ ...restartSettings, lastProject: rejectedProject, language: 'en' }));
      shell = launchShell();
      page = await connectToHeadlessBrowser(cdpPort);
      try {
        await poll(async () => await launcherLoaded()
          && (await page!.evaluate(`document.visibilityState === 'visible' && document.getElementById('status').dataset.phase === 'error'`)) === true,
        `failed auto-open ${attempt} to return to a loaded launcher with an error`, 30000);
        // Let late NavigationCompleted events arrive before checking that the cause stayed intact.
        await sleep(1000);
        const message = String(await page!.evaluate(`document.getElementById('status-text').textContent`));
        const failureLog = readFileSync(path.join(settings, 'server.log'), 'utf8').slice(beforeFailureLog.length);
        if (!message.includes('The path is outside the project.') || message.includes('WebView2')
          || !failureLog.includes('project launch failed:') || !failureLog.includes('The path is outside the project.')) {
          throw new SmokeFailure(`failed auto-open ${attempt} lost the server refusal: ${message}`);
        }
      } catch (error) {
        throw new SmokeFailure(`${(error as Error).message} (${await diagnose(settings)})`);
      }
      quitFromMenu(shell.pid!);
      await poll(async () => shell.exitCode !== null || shell.signalCode !== null,
        `failed auto-open ${attempt} shell to exit`, 10000);
      await poll(async () => serverProcesses(needles).length === 0,
        `failed auto-open ${attempt} to leave no server`, 10000);
    }
    pass('startup-failure', 'three consecutive lastProject launches kept the real server refusal on the loaded launcher and in server.log, not a WebView2 error');

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
