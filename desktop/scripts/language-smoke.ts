// 2026-11-13: separate origins, native menus and persisted preloads need a real WebView2 language round trip.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort } from '../../tools/free-port.ts';
import { connectToHeadlessBrowser, openHeadlessBrowser, type HeadlessPage } from '../../tools/headless-browser.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, '.deckmate', 'language-smoke', `${Date.now()}-${process.pid}`);
mkdirSync(output, { recursive: true });
const fixture = mkdtempSync(path.join(tmpdir(), 'deckmate-language-'));
const settings = path.join(fixture, 'settings');
const config = path.join(settings, 'desktop.json');
const projects = ['first', 'second'].map(name => path.join(fixture, name));
const exe = path.join(root, 'desktop/src-tauri/target/debug/Deckmate.exe');
const env = {
  ...process.env, APPDATA: path.join(fixture, 'appdata'), LOCALAPPDATA: path.join(fixture, 'localappdata'),
  WEBVIEW2_USER_DATA_FOLDER: path.join(fixture, 'webview'), DECKMATE_DESKTOP_SETTINGS_DIR: settings,
  DECKMATE_DESKTOP_SERVER: path.join(root, 'dist/server/main.js'),
};
const launcherReady = `document.readyState === 'complete' && !!window.deckmateDesktop && !!document.querySelector('#launcher:not([aria-busy])')`;
const boardReady = `!!window.deckmateBoard && Number(document.querySelector('.app-shell')?.dataset.updatedAt) > 0 && !!document.querySelector('[data-deck-cover]')`;
const menuButton = `.mission-control-trigger`;
const languageButton = `.mission-control button:has(svg.lucide-languages)`;
const results: unknown[] = [];
let shell: ChildProcess | undefined;
let page: HeadlessPage | undefined;
let news: HeadlessPage | undefined;
let port = 0;
const disk = () => JSON.parse(readFileSync(config, 'utf8'));

async function until(condition: () => Promise<boolean> | boolean, description: string, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await condition()) return; } catch { /* 2026-11-13: navigation replaces the execution context. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${description}`);
}

async function waitFor(expression: string, target = page!) {
  await until(() => target.evaluate(expression), expression);
}

function native(action: 'state' | 'en' | 'ru' | 'news' | 'quit' = 'state', target: 'main' | 'news' = 'main') {
  // 2026-11-13: WM_COMMAND exercises native handlers on this process without requiring foreground keyboard focus.
  return JSON.parse(execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `
    $ErrorActionPreference = 'Stop';
    [Console]::OutputEncoding=[System.Text.Encoding]::UTF8;
    Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public class LanguageMenu {
      public delegate bool Visitor(IntPtr hwnd, IntPtr data);
      [DllImport("user32.dll")] public static extern bool EnumWindows(Visitor visit, IntPtr data);
      [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
      [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hwnd, StringBuilder text, int count);
      [DllImport("user32.dll")] public static extern IntPtr GetMenu(IntPtr hwnd);
      [DllImport("user32.dll")] public static extern IntPtr GetSubMenu(IntPtr menu, int index);
      [DllImport("user32.dll")] public static extern int GetMenuItemCount(IntPtr menu);
      [DllImport("user32.dll")] public static extern uint GetMenuItemID(IntPtr menu, int index);
      [DllImport("user32.dll")] public static extern uint GetMenuState(IntPtr menu, uint index, uint flags);
      [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetMenuStringW(IntPtr menu, uint index, StringBuilder text, int count, uint flags);
      [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr hwnd, uint message, UIntPtr wparam, IntPtr lparam);
      public static IntPtr Find(uint pid, bool main) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((hwnd, data) => { uint owner; GetWindowThreadProcessId(hwnd, out owner);
          var title = new StringBuilder(512); GetWindowTextW(hwnd, title, title.Capacity);
          if (owner == pid && title.Length > 0 && GetMenu(hwnd) != IntPtr.Zero && title.ToString().StartsWith("Deckmate") == main) { found = hwnd; return false; } return true;
        }, IntPtr.Zero); return found;
      }
    }';
    $window = [LanguageMenu]::Find(${shell!.pid}, ${target === 'main' ? '$true' : '$false'});
    $menu = [LanguageMenu]::GetMenu($window);
    if ($window -eq 0 -or $menu -eq 0) { throw 'Main menu not found'; }
    $view = [LanguageMenu]::GetSubMenu($menu, 2);
    $language = [LanguageMenu]::GetSubMenu($view, [LanguageMenu]::GetMenuItemCount($view) - 1);
    $labels = @(0..3 | ForEach-Object {
      $text = New-Object System.Text.StringBuilder 256;
      [void][LanguageMenu]::GetMenuStringW($menu, $_, $text, $text.Capacity, 0x400); $text.ToString().Replace('&', '');
    });
    $checked = @(0..1 | ForEach-Object { ([LanguageMenu]::GetMenuState($language, $_, 0x400) -band 8) -ne 0 });
    $action = '${action}';
    if ($action -ne 'state') {
      $target = $language; $index = 0;
      if ($action -eq 'ru') { $index = 1; }
      if ($action -eq 'news') { $target = [LanguageMenu]::GetSubMenu($menu, 3); $index = 2; }
      if ($action -eq 'quit') { $target = [LanguageMenu]::GetSubMenu($menu, 0); $index = [LanguageMenu]::GetMenuItemCount($target) - 1; }
      $id = [LanguageMenu]::GetMenuItemID($target, $index);
      if ($target -eq 0 -or $id -eq [uint32]::MaxValue) { throw 'Menu command not found'; }
      if (-not [LanguageMenu]::PostMessageW($window, 0x111, [UIntPtr]::new($id), [IntPtr]::Zero)) { throw 'PostMessage failed'; }
    }
    @{ labels = $labels; checked = $checked } | ConvertTo-Json -Compress;
  `], { encoding: 'utf8', timeout: 15_000, windowsHide: true }));
}

async function start(ready = launcherReady) {
  port = await freePort();
  shell = spawn(exe, [], { env: { ...env, DECKMATE_DESKTOP_CDP_PORT: String(port) }, stdio: 'ignore', windowsHide: true });
  page = await connectToHeadlessBrowser(port);
  await waitFor(ready);
}

async function stop() {
  await news?.close(); news = undefined;
  await page?.close(); page = undefined;
  if (!shell?.pid || shell.exitCode !== null || shell.signalCode !== null) return;
  const exited = new Promise<void>(resolve => shell!.once('exit', () => resolve()));
  try {
    native('quit');
    await until(() => shell!.exitCode !== null || shell!.signalCode !== null, 'shell exit', 10_000);
  } catch {
    spawnSync('taskkill', ['/PID', String(shell.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  }
  await exited;
}

async function reload(ready: string, target = page!) {
  await target.evaluate('window.__languageOldDocument = true');
  await target.send('Page.reload');
  await waitFor(`!window.__languageOldDocument && (${ready})`, target);
}

async function check(language: string, name: string, board = true) {
  await waitFor(`document.documentElement.lang === ${JSON.stringify(language)}`);
  await until(() => disk().language === language, 'persisted language');
  const menu = native();
  assert.deepEqual(menu.labels, language === 'ru' ? ['Файл', 'Правка', 'Вид', 'Справка'] : ['File', 'Edit', 'View', 'Help']);
  assert.deepEqual(menu.checked, [language === 'en', language === 'ru']);
  if (board) {
    assert.equal(await page!.evaluate('window.deckmateBoard.language'), language);
    assert.ok((await page!.evaluate('document.cookie')).includes(`deckmate-lang=${language}`));
    const requests = await page!.evaluate('window.__languageRequests') as { language: string; cookie: string }[] | undefined;
    if (requests) {
      assert.ok(requests.length > 0, 'the board must request API data');
      for (const request of requests) assert.ok(request.cookie.includes(`deckmate-lang=${request.language}`), JSON.stringify(request));
    }
  } else {
    assert.equal((await page!.evaluate('window.deckmateDesktop.getState()')).language, language);
  }
  if (news) {
    await waitFor(`document.documentElement.lang === ${JSON.stringify(language)} && !!document.querySelector('#whats-new:not([aria-busy])')`, news);
    assert.equal(await news.evaluate('document.documentElement.dataset.shellLang'), language);
    assert.deepEqual(native('state', 'news'), menu);
  }
  const screenshot = await page!.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(output, `${name}.png`), Buffer.from(screenshot.result.data, 'base64'));
  results.push({ name, language, menu, settings: disk(), url: await page!.evaluate('location.href') });
  console.log(`ok ${name}`);
}

async function openProject(index: number) {
  await page!.callFunction(`folder => { void window.deckmateDesktop.openProject(folder); }`, projects[index]);
  await waitFor(boardReady);
}

async function launcher() {
  await page!.evaluate('void window.deckmateBoard.showStartScreen()');
  await waitFor(launcherReady);
}

async function toggleLanguage(target = page!) {
  await target.evaluate(`if (!document.querySelector(${JSON.stringify(languageButton)})) document.querySelector(${JSON.stringify(menuButton)}).click()`);
  await waitFor(`!!document.querySelector(${JSON.stringify(languageButton)})`, target);
  await target.evaluate(`document.querySelector(${JSON.stringify(languageButton)}).click()`);
}

async function openNews() {
  native('news');
  const adapter = createServer(async (_request, response) => {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { url: string }[];
      response.end(JSON.stringify(targets.filter(target => target.url.includes('whats-new.html'))));
    } catch { response.end('[]'); }
  });
  await new Promise<void>(resolve => adapter.listen(0, '127.0.0.1', resolve));
  try { news = await connectToHeadlessBrowser((adapter.address() as { port: number }).port); }
  finally { await new Promise<void>((resolve, reject) => adapter.close(error => error ? reject(error) : resolve())); }
  await waitFor(`!!document.querySelector('#whats-new:not([aria-busy])')`, news);
}

async function rejectedWrites(bridge: string) {
  const before = disk().language;
  for (const lang of [null, false, 3, {}, ['ru'], '', 'RU', 'de']) {
    assert.equal((await page!.callFunction(`(bridge, lang) => window[bridge].setLanguage(lang)`, bridge, lang)).code, 'invalid-language');
  }
  const wrongCommand = bridge === 'deckmateBoard' ? 'desktop_set_language' : 'board_set_language';
  assert.equal(await page!.callFunction(`async command => {
    try { return (await window.__TAURI_INTERNALS__.invoke(command, { lang: 'ru' })).ok === false; }
    catch { return true; }
  }`, wrongCommand), true);
  renameSync(config, `${config}.backup`);
  mkdirSync(config);
  try {
    const next = before === 'en' ? 'ru' : 'en';
    assert.equal((await page!.callFunction(`(bridge, lang) => window[bridge].setLanguage(lang)`, bridge, before)).code, 'save-failed');
    assert.equal((await page!.callFunction(`(bridge, lang) => window[bridge].setLanguage(lang)`, bridge, next)).code, 'save-failed');
    if (bridge === 'deckmateBoard') {
      const errors = page!.consoleErrors.length;
      await toggleLanguage();
      await until(() => page!.consoleErrors.length > errors, 'board save failure');
    } else {
      await page!.evaluate(`document.querySelector('.language-toggle').click()`);
      await waitFor(`document.querySelector('#status').dataset.phase === 'error'`);
    }
    assert.equal(await page!.evaluate('document.documentElement.lang'), before);
  } finally {
    rmdirSync(config);
    renameSync(`${config}.backup`, config);
  }
  assert.equal(disk().language, before);
}

try {
  mkdirSync(settings);
  for (const project of projects) {
    const init = spawnSync(process.execPath, [path.join(root, 'bin/deckmate.mjs'), 'init', project], { encoding: 'utf8', windowsHide: true, timeout: 120_000 });
    assert.equal(init.status, 0, init.stderr || init.stdout);
  }
  writeFileSync(config, JSON.stringify({ updates: { autoCheck: false }, recent: projects.map(folder => ({ path: folder, name: path.basename(folder) })) }));
  const selfTest = spawnSync(exe, ['--self-test', projects[0]], { env, encoding: 'utf8', windowsHide: true, timeout: 120_000 });
  assert.equal(selfTest.status, 0, selfTest.stderr || selfTest.stdout);
  writeFileSync(path.join(output, 'self-test.json'), selfTest.stdout);
  await start();
  // 2026-11-13: checking cookies at fetch entry catches a wrong first API language that later UI checks would miss.
  await page!.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__languageRequests = [];
    const originalFetch = window.fetch;
    window.fetch = function(input, ...options) {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
        window.__languageRequests.push({ language: window.deckmateBoard?.language, cookie: document.cookie });
      }
      return originalFetch.call(this, input, ...options);
    };
  ` });
  await page!.evaluate(`localStorage.setItem('deckmate-theme', 'light')`);
  const initial = await page!.evaluate('window.deckmateDesktop.getState()');
  const defaultLanguage = initial.locale.toLowerCase().startsWith('ru') ? 'ru' : 'en';
  assert.equal(initial.language, defaultLanguage);
  await openProject(0);
  await check(defaultLanguage, 'system-default');
  await launcher();
  await page!.evaluate(`if (document.documentElement.lang !== 'ru') document.querySelector('.language-toggle').click()`);
  await check('ru', 'launcher-ru', false);
  await rejectedWrites('deckmateDesktop');
  await page!.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('deckmate-language', 'en'); localStorage.setItem('freetion-language', 'en');` });
  await openProject(0);
  await check('ru', 's2-first-board-ru');
  assert.equal((await page!.evaluate(`window.deckmateBoard.setTheme('dark')`)).ok, true);
  await openNews();
  assert.equal(await news!.evaluate('document.documentElement.dataset.shellTheme'), 'dark');
  assert.equal(await news!.evaluate('document.documentElement.dataset.shellLang'), 'ru');
  assert.equal(await news!.evaluate(`localStorage.getItem('deckmate-theme')`), 'light');
  assert.equal(await news!.evaluate(`document.documentElement.classList.contains('dark')`), true);
  await rejectedWrites('deckmateBoard');
  await page!.evaluate('window.__languageDocument = true; void (window.__languageShell = document.querySelector(".app-shell"))');
  await toggleLanguage();
  await check('en', 'board-en-live');
  assert.equal(await page!.evaluate('window.__languageDocument && window.__languageShell === document.querySelector(".app-shell")'), true);
  await toggleLanguage();
  await check('ru', 'board-ru-live');
  await reload(boardReady);
  await check('ru', 'board-ru-reload');
  await launcher();
  await check('ru', 'launcher-after-board', false);
  await page!.evaluate(`if (document.documentElement.lang !== 'en') document.querySelector('.language-toggle').click()`);
  await check('en', 'launcher-en', false);
  await page!.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('deckmate-language', 'ru');` });
  await openProject(1);
  await check('en', 's2-second-board-en');
  await page!.evaluate('window.__languageDocument = true');
  native('ru');
  await check('ru', 'native-menu-ru');
  assert.equal(await page!.evaluate('window.__languageDocument'), true);
  native('ru');
  await check('ru', 'native-menu-same-language');
  native('en');
  await check('en', 'native-menu-en');
  native('ru', 'news');
  await check('ru', 'news-menu-ru');
  native('en', 'news');
  await check('en', 'news-menu-en');
  await reload(boardReady);
  await check('en', 'native-menu-reload');
  await launcher();
  native('ru');
  await check('ru', 'native-menu-launcher', false);
  await reload(launcherReady);
  await check('ru', 'launcher-stale-storage', false);
  await openProject(1);
  await stop();
  await start(boardReady);
  await check('ru', 'restart-auto-open');

  const browser = await openHeadlessBrowser({ width: 1280, height: 820, scale: 1 });
  try {
    await browser.send('Page.navigate', { url: await page!.evaluate('location.origin') });
    await waitFor(`!!document.querySelector('.app-shell') && !!document.querySelector(${JSON.stringify(menuButton)})`, browser);
    assert.equal(await browser.evaluate('typeof window.deckmateBoard'), 'undefined');
    assert.equal(await browser.evaluate('document.documentElement.lang'), 'en');
    await toggleLanguage(browser);
    await waitFor(`document.documentElement.lang === 'ru'`, browser);
    assert.equal(await browser.evaluate(`localStorage.getItem('deckmate-language')`), 'ru');
    await reload(`!!document.querySelector('.app-shell')`, browser);
    assert.equal(await browser.evaluate('document.documentElement.lang'), 'ru');
    await toggleLanguage(browser);
    await waitFor(`document.documentElement.lang === 'en'`, browser);
    assert.equal(disk().language, 'ru');
  } finally { await browser.close(); }
  console.log('ok independent-browser — local choice, reload and cookies remain separate from shell settings');
} finally {
  await stop();
  writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`Evidence: ${output}`);
  await rm(fixture, { recursive: true, force: true, maxRetries: 15, retryDelay: 100 });
}
