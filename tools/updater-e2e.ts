// 2026-11-09: exercise the real updater, native Help menu and native dialogs without installing.
// CDP uses the shared driver; the Win32 helpers in desktop-smoke.ts are not exported, so the
// minimal PID-scoped menu dispatch is repeated here and extended to read/answer updater dialogs.
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createProbe, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectToHeadlessBrowser, type HeadlessPage } from './layout-capture.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = path.join(root, 'desktop/src-tauri/target/debug/Deckmate.exe');
const signer = path.join(root, 'desktop/node_modules/@tauri-apps/cli/tauri.js');
const manifestScript = path.join(root, 'desktop/scripts/updater-manifest.mjs');
const version = '9.9.9';
const englishNote = 'E2E signed update.';
const russianNote = 'Проверенное обновление E2E.';
const downloadsUrl = 'https://github.com/pierkulakov/deckmate/releases/latest';
// 2026-11-10: exercise the production budget, not a debug-only reduced download limit.
const maxUpdateBytes = 512 * 1024 * 1024;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
let interrupted = false;

// 2026-11-09: UI Automation reads/answers the actual TaskDialog; Win32 messages enter the real
// menu handler. Every window lookup is restricted to the child shell's PID.
const nativeScript = String.raw`
param([string]$Assembly, [string]$Action, [int]$ShellPid = 0, [string]$Label = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
if ($Action -eq 'compile') {
  Add-Type -ReferencedAssemblies @('System.dll', [System.Windows.Automation.AutomationElement].Assembly.Location, [System.Windows.Automation.ControlType].Assembly.Location) -OutputAssembly $Assembly -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;
public class UpdaterMenuItem { public string Text; public bool Enabled; public uint Id; }
public class UpdaterDialog { public string Title; public string Text; public string[] Buttons; }
public class UpdaterSnapshot { public bool Enabled; public UpdaterMenuItem[] Help; public UpdaterDialog[] Dialogs; }
public static class UpdaterNative {
  delegate bool EnumCallback(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumCallback callback, IntPtr data);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr window);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr window, StringBuilder text, int length);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr window, StringBuilder text, int length);
  [DllImport("user32.dll")] static extern IntPtr GetMenu(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr GetSubMenu(IntPtr menu, int index);
  [DllImport("user32.dll")] static extern int GetMenuItemCount(IntPtr menu);
  [DllImport("user32.dll")] static extern uint GetMenuItemID(IntPtr menu, int index);
  [DllImport("user32.dll")] static extern uint GetMenuState(IntPtr menu, uint item, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetMenuStringW(IntPtr menu, uint item, StringBuilder text, int length, uint flags);
  [DllImport("user32.dll")] static extern bool PostMessageW(IntPtr window, uint message, UIntPtr wparam, IntPtr lparam);
  static string Clean(string text) { return text.Replace("&", "").Split('\t')[0]; }
  static List<IntPtr> Windows(int pid) {
    var found = new List<IntPtr>();
    EnumWindows((window, data) => {
      uint owner; GetWindowThreadProcessId(window, out owner);
      if (owner == pid && IsWindowVisible(window)) found.Add(window);
      return true;
    }, IntPtr.Zero);
    return found;
  }
  static IntPtr MainWindow(int pid) {
    foreach (var window in Windows(pid)) if (GetMenu(window) != IntPtr.Zero) return window;
    throw new Exception("Shell menu window not found for PID " + pid);
  }
  static List<IntPtr> Dialogs(int pid) {
    var found = new List<IntPtr>();
    foreach (var window in Windows(pid)) {
      var name = new StringBuilder(256); GetClassNameW(window, name, name.Capacity);
      if (name.ToString() == "#32770") found.Add(window);
    }
    return found;
  }
  static UpdaterMenuItem[] Help(IntPtr window) {
    var menu = GetMenu(window);
    var help = GetSubMenu(menu, GetMenuItemCount(menu) - 1);
    var items = new List<UpdaterMenuItem>();
    for (uint i = 0; i < GetMenuItemCount(help); i++) {
      var text = new StringBuilder(1024); GetMenuStringW(help, i, text, text.Capacity, 0x400);
      items.Add(new UpdaterMenuItem { Text = Clean(text.ToString()),
        Enabled = (GetMenuState(help, i, 0x400) & 3) == 0, Id = GetMenuItemID(help, (int)i) });
    }
    return items.ToArray();
  }
  static AutomationElementCollection Elements(IntPtr window) {
    return AutomationElement.FromHandle(window).FindAll(TreeScope.Descendants, Condition.TrueCondition);
  }
  public static UpdaterSnapshot Inspect(int pid) {
    var main = MainWindow(pid);
    var dialogs = new List<UpdaterDialog>();
    foreach (var window in Dialogs(pid)) {
      var title = new StringBuilder(1024); GetWindowTextW(window, title, title.Capacity);
      var names = new List<string>(); var buttons = new List<string>();
      foreach (AutomationElement element in Elements(window)) {
        var current = element.Current;
        if (current.ControlType == ControlType.Text) names.Add(current.Name);
        if (current.ControlType == ControlType.Button) buttons.Add(Clean(current.Name));
      }
      dialogs.Add(new UpdaterDialog { Title = title.ToString(), Text = String.Join("\n", names), Buttons = buttons.ToArray() });
    }
    return new UpdaterSnapshot { Enabled = IsWindowEnabled(main), Help = Help(main), Dialogs = dialogs.ToArray() };
  }
  public static void Menu(int pid, string label) {
    var window = MainWindow(pid);
    foreach (var item in Help(window)) if (item.Text == label && item.Enabled && IsWindowEnabled(window)) {
      if (!PostMessageW(window, 0x111, new UIntPtr(item.Id), IntPtr.Zero)) throw new Exception("Menu dispatch failed");
      return;
    }
    throw new Exception("Enabled Help item not found: " + label);
  }
  public static void Button(int pid, string label) {
    foreach (var dialog in Dialogs(pid)) foreach (AutomationElement element in Elements(dialog)) {
      var current = element.Current;
      if (current.ControlType != ControlType.Button || Clean(current.Name) != label || !current.IsEnabled) continue;
      // 2026-11-09: TaskDialog's DirectUI buttons have no HWND; use their real Invoke pattern.
      var invoke = (InvokePattern)element.GetCurrentPattern(InvokePattern.Pattern);
      invoke.Invoke();
      return;
    }
    throw new Exception("Dialog button not found: " + label);
  }
}
'@
  exit
}
Add-Type -Path $Assembly
switch ($Action) {
  'snapshot' { [UpdaterNative]::Inspect($ShellPid) | ConvertTo-Json -Depth 8 -Compress }
  'menu' { [UpdaterNative]::Menu($ShellPid, $Label) }
  'button' { [UpdaterNative]::Button($ShellPid, $Label) }
  default { throw "Unknown native action: $Action" }
}
`;

type Snapshot = {
  Enabled: boolean;
  Help: { Text: string; Enabled: boolean }[];
  Dialogs: { Title: string; Text: string; Buttons: string[] }[];
};
type SavedSettings = {
  language?: string;
  updates: { autoCheck: boolean; skippedVersion: string | null; lastCheck: string | null; pending: unknown };
};
type Manifest = { version: string; notes: string; notes_ru: string; platforms: Record<string, { url: string; signature: string }> };
type Session = {
  child: ChildProcess;
  page: HeadlessPage;
  settings: string;
  externalLog: string;
  log: () => string;
  saved: () => SavedSettings;
  native: (action: string, label?: string) => string;
  snapshot: () => Snapshot;
};

async function bounded<T>(promise: Promise<T>, what: string, ms = 15000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${what}`)), ms);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

// 2026-11-09: freePort/poll are private to desktop-smoke.ts; keep only the small setup primitives.
async function poll(condition: () => boolean | Promise<boolean>, what: string, ms = 20000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (interrupted) throw new Error('Interrupted');
    if (await bounded(Promise.resolve().then(condition), what)) return;
    await sleep(150);
  }
  throw new Error(`Timed out: ${what}`);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createProbe();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function powershell(args: string[]): string {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', ...args],
    { encoding: 'utf8', timeout: 20000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function runNode(script: string, args: string[], cwd: string): void {
  // 2026-11-09: invoke the installed `npx tauri` entry directly, so missing tooling cannot trigger a download.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('TAURI_SIGNING_')));
  execFileSync(process.execPath, [script, ...args], { cwd, timeout: 60000, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...env, CI: 'true' } });
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.pid && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise<void>(resolve => child.once('close', () => resolve()));
    execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'],
      { timeout: 20000, windowsHide: true, stdio: 'pipe' });
    await bounded(exited, 'shell process exit');
  }
}

async function dialog(session: Session, title: string): Promise<Snapshot['Dialogs'][number]> {
  let found: Snapshot['Dialogs'][number] | undefined;
  await poll(() => {
    found = session.snapshot().Dialogs.find(candidate => candidate.Title === title);
    return !!found;
  }, `dialog "${title}"`);
  return found!;
}

async function usable(session: Session, checkLabel = 'Check for updates…'): Promise<Snapshot> {
  let snapshot: Snapshot | undefined;
  try {
    await poll(() => {
      snapshot = session.snapshot();
      return snapshot.Enabled && snapshot.Dialogs.length === 0
        && snapshot.Help.some(item => item.Text === checkLabel && item.Enabled);
    }, 'responsive native window and enabled update menu');
  } catch (error) {
    throw new Error(`${String(error)}; native state: ${JSON.stringify(snapshot)}`);
  }
  const state = await bounded(session.page.callFunction('() => window.deckmateDesktop.getState()'), 'launcher bridge');
  assert.equal(typeof state.version, 'string');
  assert.equal(session.child.exitCode, null);
  assert.equal(session.child.signalCode, null);
  assert.ok(!session.log().includes('updater launching installer'));
  assert.equal(session.saved().updates.pending, null);
  return snapshot!;
}

async function main(): Promise<number> {
  assert.equal(process.platform, 'win32', 'updater e2e requires Windows/WebView2');
  assert.ok(existsSync(executable), 'Build first: cargo build --manifest-path desktop/src-tauri/Cargo.toml');
  assert.ok(existsSync(signer), 'The existing desktop/node_modules/@tauri-apps/cli is required');
  assert.equal(powershell(['-Command', "@(Get-Process -Name Deckmate -ErrorAction SilentlyContinue).Count"]), '0',
    'Close other Deckmate instances before running updater e2e');
  const base = existsSync(path.join(tmpdir(), 'opencode')) ? path.join(tmpdir(), 'opencode') : tmpdir();
  const temp = mkdtempSync(path.join(base, 'deckmate-updater-e2e-'));
  const processes = new Set<ChildProcess>();
  const files = new Map<string, Buffer>();
  const requests: string[] = [];
  const abortedOversized = new Set<string>();
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    requests.push(url.pathname);
    if (url.pathname === '/oversized-header/installer.exe' || url.pathname === '/oversized-stream/installer.exe') {
      const declared = url.pathname.includes('oversized-header');
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store',
        ...(declared ? { 'Content-Length': maxUpdateBytes + 1 } : {}) });
      const chunk = Buffer.alloc(64 * 1024);
      response.on('close', () => abortedOversized.add(url.pathname));
      if (declared) {
        // 2026-11-10: the plugin exposes Content-Length only with the first chunk; no large allocation is needed.
        response.write(chunk);
      } else {
        // 2026-11-10: omit Content-Length and stream until the client cancels, respecting socket backpressure.
        const pump = () => {
          while (!response.destroyed) {
            if (!response.write(chunk)) {
              response.once('drain', pump);
              return;
            }
          }
        };
        pump();
      }
      return;
    }
    const bytes = files.get(url.pathname);
    response.writeHead(bytes ? 200 : 404, { 'Content-Type': url.pathname.endsWith('.json') ? 'application/json' : 'application/octet-stream',
      'Content-Length': bytes?.length ?? 0, 'Cache-Control': 'no-store' });
    response.end(bytes);
  });
  let step = 'setup';
  const onInterrupt = () => { interrupted = true; };
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onInterrupt);
  const pass = (detail: string) => console.log(`ok ${step} — ${detail}`);
  try {
    const helper = path.join(temp, 'native.ps1');
    const assembly = path.join(temp, 'native.dll');
    writeFileSync(helper, nativeScript);
    const nativeArgs = ['-ExecutionPolicy', 'Bypass', '-File', helper, '-Assembly', assembly];
    powershell([...nativeArgs, '-Action', 'compile']);
    for (const key of ['trusted', 'foreign']) {
      runNode(signer, ['signer', 'generate', '--ci', '--password', '', '--write-keys', path.join(temp, key)], temp);
    }
    const pubkey = readFileSync(path.join(temp, 'trusted.pub'), 'utf8').trim();
    const foreignPubkey = readFileSync(path.join(temp, 'foreign.pub'), 'utf8').trim();
    const installer = path.join(temp, 'installer.exe');
    // 2026-11-09: this is deliberately inert data, not an executable; even a broken dry-run cannot install it.
    const payload = Buffer.from('Deckmate updater e2e: signed inert installer fixture\n'.repeat(1024));
    writeFileSync(installer, payload);
    runNode(signer, ['signer', 'sign', '--private-key-path', path.join(temp, 'trusted'), '--password', '',
      '--app-version', version, installer], temp);
    const signature = readFileSync(`${installer}.sig`, 'utf8').trim();
    const signatureLines = Buffer.from(signature, 'base64').toString('utf8').split('\n');
    assert.ok(signatureLines.some(line => line.includes(`\tversion:${version}`)), 'signature must bind the app version');
    const damaged = Buffer.from(signatureLines[1], 'base64');
    damaged[damaged.length - 1] ^= 1;
    signatureLines[1] = damaged.toString('base64');
    const badSignatureFile = path.join(temp, 'invalid.sig');
    writeFileSync(badSignatureFile, Buffer.from(signatureLines.join('\n')).toString('base64'));
    for (const kind of ['installed', 'portable']) {
      const directory = path.join(temp, kind);
      mkdirSync(directory);
      copyFileSync(executable, path.join(directory, 'Deckmate.exe'));
      // portable() checks this adjacent file. Copying the debug binary avoids modifying target/ or an installed app.
      if (kind === 'installed') writeFileSync(path.join(directory, 'uninstall.exe'), '');
    }
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // 2026-11-09: updater-manifest.mjs verifies the installer signature against the configured pubkey and the signed
    // version, and refuses to write anything else. It therefore always builds the genuine 9.9.9 manifest from a config
    // that holds the disposable trusted key; a negative case (damaged signature, announced version other than the
    // signed one) is edited into that output afterwards — exactly what a tampered endpoint would serve.
    const trustedConfig = path.join(temp, 'tauri.conf.json');
    writeFileSync(trustedConfig, JSON.stringify({ plugins: { updater: { pubkey } } }));
    const genuineSignature = `${installer}.sig`;
    const manifest = (id: string, announced = version, signatureFile = genuineSignature): void => {
      const directory = path.join(temp, 'fixtures', id);
      mkdirSync(directory, { recursive: true });
      const changelog = path.join(directory, 'CHANGELOG.md');
      const changelogRu = path.join(directory, 'CHANGELOG.ru.md');
      writeFileSync(changelog, `## [${version}] - 2026-11-09
### Added
- **${englishNote}** English fixture details.
`);
      writeFileSync(changelogRu, `## [${version}] - 2026-11-09
### Добавлено
- **${russianNote}** Русское описание.
`);
      const output = path.join(directory, 'latest.json');
      runNode(manifestScript, ['--version', version, '--url', `${origin}/${id}/installer.exe`, '--installer', installer,
        '--config', trustedConfig, '--signature-file', genuineSignature, '--changelog', changelog, '--changelog-ru', changelogRu,
        '--out', output], temp);
      const built = JSON.parse(readFileSync(output).toString()) as Manifest;
      assert.equal(built.version, version);
      assert.ok(built.notes.includes(englishNote));
      assert.ok(built.notes_ru.includes(russianNote));
      assert.deepEqual(Object.keys(built.platforms).sort(), ['windows-x86_64', 'windows-x86_64-nsis']);
      for (const artifact of Object.values(built.platforms)) {
        assert.equal(artifact.signature, readFileSync(genuineSignature, 'utf8').trim());
        assert.equal(artifact.url, `${origin}/${id}/installer.exe`);
      }
      built.version = announced;
      for (const artifact of Object.values(built.platforms)) artifact.signature = readFileSync(signatureFile, 'utf8').trim();
      files.set(`/${id}/latest.json`, Buffer.from(`${JSON.stringify(built, null, 2)}
`));
      files.set(`/${id}/installer.exe`, payload);
    };
    const count = (id: string, file: string) => requests.filter(url => url === `/${id}/${file}`).length;
    const withShell = async (id: string, options: { portable?: boolean; pubkey?: string; settings?: string },
      check: (session: Session) => Promise<void>): Promise<void> => {
      const settings = options.settings ?? path.join(temp, `settings-${id}`);
      mkdirSync(settings, { recursive: true });
      if (!existsSync(path.join(settings, 'desktop.json'))) {
        writeFileSync(path.join(settings, 'desktop.json'), JSON.stringify({ language: 'en', updates: { autoCheck: false } }));
      }
      const scratch = path.join(settings, 'temp');
      mkdirSync(scratch, { recursive: true });
      const port = await freePort();
      const externalLog = path.join(settings, 'external.log');
      const child = spawn(path.join(temp, options.portable ? 'portable' : 'installed', 'Deckmate.exe'), [], {
        cwd: temp, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
        env: { ...process.env, TEMP: scratch, TMP: scratch, WEBVIEW2_USER_DATA_FOLDER: path.join(settings, 'webview'),
          DECKMATE_DESKTOP_SETTINGS_DIR: settings, DECKMATE_DESKTOP_EXTERNAL_LOG: externalLog,
          DECKMATE_DESKTOP_CDP_PORT: String(port), DECKMATE_DESKTOP_DIRTY_POLICY: 'refuse',
          DECKMATE_DESKTOP_UPDATER_ENDPOINT: `${origin}/${id}/latest.json`,
          DECKMATE_DESKTOP_UPDATER_PUBKEY: options.pubkey ?? pubkey, DECKMATE_DESKTOP_UPDATER_DRY_RUN: '1' },
      });
      processes.add(child);
      let output = '';
      const capture = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-4000); };
      child.stdout?.on('data', capture);
      child.stderr?.on('data', capture);
      let launchError: Error | undefined;
      child.once('error', error => { launchError = error; });
      let page: HeadlessPage | undefined;
      try {
        page = await bounded(connectToHeadlessBrowser(port), 'CDP connection', 30000);
        await poll(async () => (await page!.evaluate("document.readyState === 'complete' && !!window.deckmateDesktop && document.visibilityState === 'visible'")) === true,
          'visible launcher bridge');
        if (launchError) throw launchError;
        const native = (action: string, label = '') => powershell([...nativeArgs, '-Action', action, '-ShellPid', String(child.pid), '-Label', label]);
        const session: Session = { child, page, settings, externalLog, native,
          log: () => readFileSync(path.join(settings, 'server.log'), 'utf8'),
          saved: () => JSON.parse(readFileSync(path.join(settings, 'desktop.json'), 'utf8')) as SavedSettings,
          snapshot: () => JSON.parse(native('snapshot')) as Snapshot };
        await check(session);
      } catch (error) {
        const logFile = path.join(settings, 'server.log');
        console.error(`diagnostic ${id} (PID ${child.pid}, exit ${child.exitCode}, signal ${child.signalCode}): ${existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').slice(-20).join('\n') : 'no shell log'}\nrequests: ${requests.filter(url => url.startsWith(`/${id}/`)).join(', ')}\nshell output: ${output}`);
        throw error;
      } finally {
        try { await page?.close(); } finally { await stop(child); processes.delete(child); }
      }
    };
    pass('ephemeral Tauri keys, version-bound signature, loopback HTTP ready');

    step = 'a';
    manifest(step);
    let runningVersion = '';
    await withShell(step, {}, async session => {
      runningVersion = (await bounded(session.page.callFunction('() => window.deckmateDesktop.getState()'), 'running version')).version;
      session.native('menu', 'Check for updates…');
      const offer = await dialog(session, `Deckmate ${version} is ready to install`);
      assert.ok(offer.Text.includes(englishNote), JSON.stringify(offer));
      session.native('button', 'Later');
      const menu = await usable(session);
      const pending = `Restart and install ${version}…`;
      assert.ok(menu.Help.some(item => item.Text === pending && item.Enabled));
      session.native('menu', pending);
      await dialog(session, `Deckmate ${version} is ready to install`);
      session.native('button', 'Restart and update');
      await poll(() => session.log().includes(`updater dry run verified ${version} ${payload.length}`), 'verified dry-run installation');
      await usable(session);
      const log = session.log();
      const stopped = log.indexOf('updater project stopped');
      const saved = log.indexOf(`updater pending saved; installing ${version}`);
      const verified = log.indexOf(`updater dry run verified ${version} ${payload.length}`);
      assert.ok(stopped >= 0 && saved > stopped && verified > saved);
      assert.ok(log.includes('updater dry run finished; pending cleared, restoring project'));
      assert.equal(count(step, 'installer.exe'), 1);
      pass(`${version} in dialog + Help; updater dry run verified ${version} ${payload.length}; pending cleared, UI responsive`);
    });

    step = 'b';
    manifest(step, runningVersion);
    await withShell(step, {}, async session => {
      session.native('menu', 'Check for updates…');
      await dialog(session, "You're up to date");
      session.native('button', 'OK');
      const menu = await usable(session);
      assert.ok(!menu.Help.some(item => item.Text.startsWith('Restart and install')));
      assert.ok(session.log().includes('updater no newer non-skipped version'));
      assert.ok(session.saved().updates.lastCheck);
      assert.equal(count(step, 'latest.json'), 1);
      assert.equal(count(step, 'installer.exe'), 0);
      pass(`current ${runningVersion}: no update, no package download`);
    });

    const rejected = async (id: string, options: { pubkey?: string }, errorPattern: RegExp): Promise<void> => {
      await withShell(id, options, async session => {
        session.native('menu', 'Check for updates…');
        const failure = await dialog(session, 'Could not check for updates');
        assert.match(failure.Text, errorPattern);
        session.native('button', 'OK');
        const menu = await usable(session);
        assert.match(session.log(), errorPattern);
        assert.ok(session.log().includes('updater check/download failed:'));
        assert.ok(!session.log().includes('updater dry run verified'));
        assert.ok(!session.log().includes('updater pending saved'));
        assert.ok(!menu.Help.some(item => item.Text.startsWith('Restart and install')));
        assert.ok(!existsSync(path.join(session.settings, 'update-cache/package.bin')));
        assert.equal(session.saved().updates.lastCheck, null);
        assert.equal(count(id, 'installer.exe'), 1);
        // A second real menu check proves the operation lock was released after the error dialog.
        session.native('menu', 'Check for updates…');
        await dialog(session, 'Could not check for updates');
        session.native('button', 'OK');
        await usable(session);
        assert.equal(count(id, 'installer.exe'), 2);
        pass(`${failure.Text.replace(/\s+/gu, ' ')}; no installer, second check + UI responsive`);
      });
    };
    step = 'c';
    manifest(step, version, badSignatureFile);
    await rejected(step, {}, /signature/iu);
    step = 'd';
    manifest(step);
    await rejected(step, { pubkey: foreignPubkey }, /key.*(id|match)|signature/iu);

    step = 'e';
    manifest(step);
    const skippedSettings = path.join(temp, 'settings-skipped');
    await withShell(step, { settings: skippedSettings }, async session => {
      session.native('menu', 'Check for updates…');
      await dialog(session, `Deckmate ${version} is ready to install`);
      session.native('button', 'Skip this version');
      await usable(session);
      assert.equal(session.saved().updates.skippedVersion, version);
      assert.ok(!existsSync(path.join(session.settings, 'update-cache')));
    });
    const settingsFile = path.join(skippedSettings, 'desktop.json');
    const saved = JSON.parse(readFileSync(settingsFile, 'utf8')) as SavedSettings;
    saved.updates.autoCheck = true;
    writeFileSync(settingsFile, JSON.stringify(saved));
    const beforeAutomatic = count(step, 'latest.json');
    await withShell(step, { settings: skippedSettings }, async session => {
      // Wait for the real 15-second startup scheduler, not a direct call masquerading as an auto-check.
      await poll(() => session.log().includes('updater checking (manual: false)')
        && session.log().includes('updater no newer non-skipped version'), 'scheduled skipped-version check', 35000);
      assert.equal(count(step, 'latest.json'), beforeAutomatic + 1);
      const menu = await usable(session);
      assert.ok(!menu.Help.some(item => item.Text.startsWith('Restart and install')));
      session.native('menu', 'Check for updates…');
      await dialog(session, "You're up to date");
      session.native('button', 'OK');
      await usable(session);
      assert.equal(session.saved().updates.skippedVersion, version);
      assert.equal(count(step, 'latest.json'), beforeAutomatic + 2);
      assert.equal(count(step, 'installer.exe'), 1);
      pass('Skip persisted across restart; scheduled AND manual checks exclude 9.9.9, no further downloads');
    });

    step = 'f';
    manifest(step);
    await withShell(step, {}, async session => {
      const changed = await bounded(session.page.callFunction("() => window.deckmateDesktop.setLanguage('ru')"), 'Russian language');
      assert.equal(changed.ok, true);
      session.native('menu', 'Проверить обновления…');
      const offer = await dialog(session, `Обновление Deckmate ${version} можно установить`);
      assert.ok(offer.Text.includes(russianNote), JSON.stringify(offer));
      assert.ok(!offer.Text.includes(englishNote));
      session.native('button', 'Позже');
      const menu = await usable(session, 'Проверить обновления…');
      assert.ok(menu.Help.some(item => item.Text === `Перезапустить и установить ${version}…`));
      pass(`ru native dialog renders notes_ru: ${russianNote}`);
    });

    step = 'g';
    manifest(step);
    await withShell(step, { portable: true }, async session => {
      session.native('menu', 'Check for updates…');
      const title = `Deckmate ${version} is available`;
      const offer = await dialog(session, title);
      assert.ok(offer.Buttons.includes('Open download page'));
      assert.ok(!offer.Buttons.includes('Restart and update'));
      session.native('button', 'Later');
      const menu = await usable(session);
      // 2026-11-09: the Help item opens the offer dialog, so it carries an ellipsis the dialog title does not.
      assert.ok(menu.Help.some(item => item.Text === `${title}…`));
      session.native('menu', `${title}…`);
      await dialog(session, title);
      session.native('button', 'Open download page');
      await poll(() => existsSync(session.externalLog), 'portable external link');
      assert.deepEqual(readFileSync(session.externalLog, 'utf8').trim().split(/\r?\n/u), [downloadsUrl]);
      await usable(session);
      assert.ok(session.log().includes(`updater offering ${version} (portable: true)`));
      assert.ok(!session.log().includes('updater downloading'));
      assert.ok(!session.log().includes('updater dry run verified'));
      assert.equal(count(step, 'installer.exe'), 0);
      assert.ok(!existsSync(path.join(session.settings, 'update-cache')));
      pass('portable: notification + EXTERNAL_LOG release URL only; zero package downloads');
    });

    step = 'signed-version';
    manifest(step, '9.9.10');
    await rejected(step, {}, /signed for version 9\.9\.9.*announced version 9\.9\.10/iu);
    for (const id of ['oversized-header', 'oversized-stream']) {
      step = id;
      manifest(step);
      await rejected(step, {}, /download exceeds the 536870912 byte safety limit/iu);
      assert.ok(abortedOversized.has(`/${id}/installer.exe`), 'the oversized response must be disconnected');
    }
    step = 'oversized-manifest-size';
    manifest(step);
    const manifestPath = `/${step}/latest.json`;
    const oversized = JSON.parse(files.get(manifestPath)!.toString()) as Manifest;
    for (const artifact of Object.values(oversized.platforms)) Object.assign(artifact, { size: maxUpdateBytes + 1 });
    files.set(manifestPath, Buffer.from(JSON.stringify(oversized)));
    await withShell(step, {}, async session => {
      session.native('menu', 'Check for updates…');
      const failure = await dialog(session, 'Could not check for updates');
      assert.match(failure.Text, /download exceeds the 536870912 byte safety limit/iu);
      session.native('button', 'OK');
      await usable(session);
      assert.match(session.log(), /download size limit exceeded \(Declared\)/u);
      assert.equal(count(step, 'installer.exe'), 0);
      assert.ok(!existsSync(path.join(session.settings, 'update-cache/package.bin')));
      pass('oversized manifest size rejected before requesting the package');
    });
    console.log('ok updater-e2e — a–g + signed-version + oversized responses passed; manifests built and verified by updater-manifest.mjs');
    return 0;
  } catch (error) {
    console.error(`FAIL ${step} — ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    return 1;
  } finally {
    // 2026-11-09: only PIDs owned by this run are terminated; keys, profiles and fixtures never survive the run.
    interrupted = false;
    try {
      for (const child of processes) await stop(child);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      rmSync(temp, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
      process.off('SIGINT', onInterrupt);
      process.off('SIGTERM', onInterrupt);
    }
  }
}

process.exitCode = await main().catch(error => {
  console.error(`FAIL setup — ${error instanceof Error ? error.message : String(error)}`);
  return 1;
});
