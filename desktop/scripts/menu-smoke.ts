// 2026-11-13: HWND ownership and broadcast menu routing require two real WebView2 windows.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort } from '../../tools/free-port.ts';
import { connectToHeadlessBrowser, type HeadlessPage } from '../../tools/headless-browser.ts';
import { assertMenuStable, menuLayout } from '../../tools/desktop-menu.ts';
import { selectPageTheme } from './smoke-controls.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, '.deckmate', 'menu-smoke', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(output, { recursive: true });
const fixture = mkdtempSync(path.join(tmpdir(), 'deckmate-menu-'));
const settings = path.join(fixture, 'settings');
const config = path.join(settings, 'desktop.json');
const demo = path.join(fixture, 'demo');
const second = path.join(fixture, 'second');
const third = path.join(fixture, 'third');
const exe = path.join(root, 'desktop/src-tauri/target/debug/Deckmate.exe');
const port = await freePort();
const environment: NodeJS.ProcessEnv = {
  ...process.env, APPDATA: path.join(fixture, 'appdata'), LOCALAPPDATA: path.join(fixture, 'localappdata'),
  WEBVIEW2_USER_DATA_FOLDER: path.join(settings, 'webview'),
  DECKMATE_DESKTOP_SETTINGS_DIR: settings, DECKMATE_DESKTOP_CDP_PORT: String(port),
  DECKMATE_DESKTOP_SERVER: path.join(root, 'dist/server/main.js'), DECKMATE_DESKTOP_DIRTY_POLICY: 'refuse',
};
delete environment.DECKMATE_DESKTOP_UPDATER_ENDPOINT;
const pages: HeadlessPage[] = [];
let child: ReturnType<typeof spawn> | undefined;
let page: HeadlessPage;
const launcherReady = `document.readyState === 'complete' && !!window.deckmateDesktop && !!document.querySelector('#launcher:not([aria-busy])')`;
const newsReady = `document.readyState === 'complete' && !!document.querySelector('#whats-new:not([aria-busy])')`;
const boardReady = `document.readyState === 'complete' && !!window.deckmateBoard && Number(document.querySelector('.app-shell')?.dataset.updatedAt) > 0`;
const saved = () => JSON.parse(readFileSync(config, 'utf8'));
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const results: { name: string; data: unknown }[] = [];

function pass(name: string, data: unknown = true): void {
  results.push({ name, data });
  writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  if (name === 'FAIL') console.error(`FAIL ${data}`);
  else console.log(`ok ${name}`);
}

async function until(check: () => Promise<unknown>, description: string, timeout = 30_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch { /* 2026-11-13: navigation replaces the execution context. */ }
    await delay(100);
  }
  throw new Error(`Timed out: ${description}`);
}

type MenuItem = { text: string; id: number; enabled: boolean; checked: boolean; children: MenuItem[] };
type NativeWindow = { handle: number; menu: number; valid: boolean; count: number; title: string; caption: boolean; client: { x: number; y: number }; items: MenuItem[] };

function native(action = '', handle = 0, indices: number[] = []): NativeWindow[] {
  const script = `
    $ErrorActionPreference = 'Stop';
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
    Add-Type -TypeDefinition 'using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
    public class MenuWindow {
      public delegate bool Visitor(IntPtr hwnd, IntPtr data);
      [DllImport("user32.dll")] static extern bool EnumWindows(Visitor visitor, IntPtr data);
      [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
      [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr hwnd, StringBuilder text, int count);
      [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr hwnd, StringBuilder text, int count);
      [DllImport("user32.dll")] public static extern IntPtr GetMenu(IntPtr hwnd);
      [DllImport("user32.dll")] public static extern bool IsMenu(IntPtr menu);
      [DllImport("user32.dll")] public static extern int GetMenuItemCount(IntPtr menu);
      [DllImport("user32.dll")] public static extern IntPtr GetSubMenu(IntPtr menu, int index);
      [DllImport("user32.dll")] public static extern uint GetMenuItemID(IntPtr menu, int index);
      [DllImport("user32.dll")] public static extern uint GetMenuState(IntPtr menu, uint index, uint flags);
      [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetMenuStringW(IntPtr menu, uint index, StringBuilder text, int count, uint flags);
      [DllImport("user32.dll")] public static extern int GetWindowLongW(IntPtr hwnd, int index);
      [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr hwnd, uint message, UIntPtr wparam, IntPtr lparam);
      [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hwnd, ref Point point);
      public struct Point { public int x; public int y; }
      public static Point ClientOrigin(IntPtr hwnd) { var point = new Point(); ClientToScreen(hwnd, ref point); return point; }
      public static IntPtr[] Find(uint pid) {
        var windows = new List<IntPtr>();
        EnumWindows((hwnd, data) => { uint owner; GetWindowThreadProcessId(hwnd, out owner);
          var kind = new StringBuilder(256); GetClassNameW(hwnd, kind, kind.Capacity);
          if (owner == pid && kind.ToString() == "Tauri Window") windows.Add(hwnd); return true;
        }, IntPtr.Zero); return windows.ToArray();
      }
      public static string Title(IntPtr hwnd) { var text = new StringBuilder(512); GetWindowTextW(hwnd, text, text.Capacity); return text.ToString(); }
    }';
    function Items([IntPtr]$menu) {
      for ($i = 0; $i -lt [MenuWindow]::GetMenuItemCount($menu); $i++) {
        $text = New-Object System.Text.StringBuilder 4096;
        [void][MenuWindow]::GetMenuStringW($menu, $i, $text, $text.Capacity, 0x400);
        $sub = [MenuWindow]::GetSubMenu($menu, $i);
        $state = [MenuWindow]::GetMenuState($menu, $i, 0x400);
        @{ text=$text.ToString(); id=[MenuWindow]::GetMenuItemID($menu, $i);
           enabled=($state -band 3) -eq 0; checked=($state -band 8) -ne 0; children=@(Items $sub) }
      }
    }
    $windows = @([MenuWindow]::Find(${child!.pid}));
    $target = [IntPtr]::new(${handle});
    if ('${action}' -ne '') {
      if ($windows -notcontains $target) { throw 'Target is not an owned Tauri window'; }
      $message = 0x10; $id = 0;
      if ('${action}' -eq 'menu') {
        $menu = [MenuWindow]::GetMenu($target);
        ${indices.slice(0, -1).map(index => `$menu = [MenuWindow]::GetSubMenu($menu, ${index});`).join('\n')}
        $id = [MenuWindow]::GetMenuItemID($menu, ${indices.at(-1) ?? 0});
        if ($menu -eq [IntPtr]::Zero -or $id -eq [uint32]::MaxValue) { throw 'Menu command not found'; }
        $message = 0x111;
      }
      if (-not [MenuWindow]::PostMessageW($target, $message, [UIntPtr]::new($id), [IntPtr]::Zero)) { throw 'PostMessage failed'; }
    }
    $rows = @(foreach ($window in $windows) {
      $menu = [MenuWindow]::GetMenu($window);
      @{ handle=$window.ToInt64(); menu=$menu.ToInt64(); valid=[MenuWindow]::IsMenu($menu);
         count=[MenuWindow]::GetMenuItemCount($menu); title=[MenuWindow]::Title($window);
         caption=([MenuWindow]::GetWindowLongW($window, -16) -band 0xC00000) -ne 0;
         client=[MenuWindow]::ClientOrigin($window); items=@(Items $menu) }
    });
    ConvertTo-Json -InputObject $rows -Depth 20 -Compress;
  `;
  return JSON.parse(execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', windowsHide: true, timeout: 20_000,
  }).replace(/^\uFEFF/, '').trim());
}

async function openNews(main: number): Promise<{ news: HeadlessPage; window: NativeWindow }> {
  native('menu', main, [3, 2]);
  const targets = async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { url: string }[])
    .filter(target => target.url.includes('whats-new.html'));
  await until(async () => (await targets()).length > 0, 'the secondary CDP target');
  // 2026-11-13: a loopback list adapter selects the secondary target without duplicating the shared CDP driver.
  const adapter = createServer(async (_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(await targets()));
  });
  await new Promise<void>(resolve => adapter.listen(0, '127.0.0.1', resolve));
  let news: HeadlessPage;
  try {
    news = await connectToHeadlessBrowser((adapter.address() as { port: number }).port);
    pages.push(news);
  } finally {
    await new Promise<void>(resolve => adapter.close(() => resolve()));
  }
  await until(() => news.evaluate(newsReady), 'the secondary content');
  let windows: NativeWindow[] = [];
  // 2026-11-13: WebView2 can expose its document before the native window finishes construction.
  await until(async () => {
    windows = native();
    return windows.some(window => window.handle === main) && windows.some(window => window.handle !== main);
  }, 'the secondary native window');
  const primary = windows.find(window => window.handle === main)!;
  const secondary = windows.find(window => window.handle !== main)!;
  assert.ok(primary.valid && secondary.valid);
  assert.equal(primary.count, 4);
  assert.equal(secondary.count, 4);
  assert.notEqual(primary.menu, secondary.menu);
  assert.equal(secondary.items[0].children.length, 4, 'secondary File contains only local commands');
  return { news, window: secondary };
}

async function reload(target: HeadlessPage, handle: number, item: number, ready: string): Promise<void> {
  await target.evaluate('window.__menuDocument = true');
  native('menu', handle, [0, item]);
  await until(() => target.evaluate(`!window.__menuDocument && (${ready})`), 'menu reload of its source');
}

async function expectZoom(target: HeadlessPage, base: number, factor: number): Promise<void> {
  await until(async () => Math.abs(Number(await target.evaluate('devicePixelRatio')) - base * factor) < 0.001, `zoom ${factor}`);
}

function expectMenuLanguage(window: NativeWindow, language: string): void {
  const russian = language === 'ru';
  const text = (item: MenuItem) => item.text.split('\t')[0].replaceAll('&', '');
  const labels = (items: MenuItem[]) => items.filter(item => text(item)).map(text);
  const file = window.items[0].children;
  const main = file.length > 4;
  const edit = window.items[1].children;
  const view = window.items[2].children;
  const help = window.items[3].children;
  assert.deepEqual(labels(window.items), russian ? ['Файл', 'Правка', 'Вид', 'Справка'] : ['File', 'Edit', 'View', 'Help']);
  assert.deepEqual(labels(file).filter(label => !label.includes(' — ')), russian
    ? [...(main ? ['Открыть папку…', 'Недавние проекты', 'Рабочее пространство', 'Добавить текущий проект в пространство', 'Показать папку проекта', 'Сменить проект…', 'Закрыть проект'] : []),
      'Перезагрузить', 'Инструменты разработчика', main ? 'Выход' : 'Закрыть окно']
    : [...(main ? ['Open folder…', 'Recent projects', 'Workspace', 'Add current project to workspace', 'Reveal project folder', 'Switch project…', 'Close project'] : []),
      'Reload', 'Toggle DevTools', main ? 'Quit' : 'Close window']);
  assert.deepEqual(labels(edit), russian
    ? ['Отменить', 'Повторить', 'Вырезать', 'Копировать', 'Вставить', 'Выделить всё']
    : ['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Select all']);
  assert.deepEqual(labels(view), russian
    ? ['Увеличить', 'Уменьшить', 'Исходный размер', 'Полноэкранный режим', 'Язык интерфейса']
    : ['Zoom in', 'Zoom out', 'Actual size', 'Toggle full screen', 'Interface language']);
  assert.deepEqual(labels(view.at(-1)!.children), ['English', 'Русский']);
  assert.deepEqual(view.at(-1)!.children.map(item => item.checked), [!russian, russian]);
  assert.deepEqual(labels(help), russian
    ? [...(main ? ['Проверить обновления…', 'Проверять обновления автоматически'] : []), 'Что нового', 'Открыть папку журналов', 'О программе Deckmate']
    : [...(main ? ['Check for updates…', 'Check for updates automatically'] : []), "What's new", 'Open logs folder', 'About Deckmate']);
  if (main) {
    assert.equal(file[3].enabled, false, 'Add current project is disabled on the launcher');
    assert.equal(file[4].enabled, false, 'Reveal project is disabled on the launcher');
    assert.equal(file[7].enabled, false, 'Close project is disabled on the launcher');
    assert.equal(file[1].children.at(-1) && text(file[1].children.at(-1)!), russian ? 'Очистить список' : 'Clear list');
    assert.equal(text(file[2].children[0]), russian ? 'Нет проектов' : 'No projects');
    assert.equal(file[2].children[0].enabled, false);
    assert.equal(help[0].enabled, false, 'Update checks are unavailable in the debug shell');
    assert.equal(help[1].checked, saved().updates.autoCheck);
  }
}

async function closeNews(main: number, secondary: NativeWindow, news: HeadlessPage, fromMenu = false): Promise<void> {
  const menuBefore = native().find(window => window.handle === main)!.menu;
  native(fromMenu ? 'menu' : 'close', secondary.handle, [0, 3]);
  await until(async () => !(await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { url: string }[])
    .some(target => target.url.includes('whats-new.html')), 'secondary close');
  await news.close();
  const primary = native().find(window => window.handle === main)!;
  assert.equal(primary.menu, menuBefore);
  assert.ok(primary.valid);
  assert.equal(primary.count, 4);
  assert.ok(primary.items.every(item => item.children.length > 0));
}

function removeOwnTree(folder: string): void {
  const stat = lstatSync(folder);
  if (stat.isSymbolicLink() || !stat.isDirectory()) { unlinkSync(folder); return; }
  for (const child of readdirSync(folder)) removeOwnTree(path.join(folder, child));
  rmdirSync(folder);
}

try {
  mkdirSync(settings);
  for (const project of [demo, second, third]) {
    const init = spawnSync(process.execPath, [path.join(root, 'bin/deckmate.mjs'), 'init', project], { encoding: 'utf8', windowsHide: true, timeout: 120_000 });
    assert.equal(init.status, 0, init.stderr || init.stdout);
  }
  const selfTest = spawnSync(exe, ['--self-test', demo], { encoding: 'utf8', windowsHide: true, env: environment, timeout: 60_000 });
  assert.equal(selfTest.status, 0, selfTest.stderr || selfTest.stdout);
  assert.equal(JSON.parse(selfTest.stdout.trim()).ok, true);
  pass('self-test', JSON.parse(selfTest.stdout.trim()));
  writeFileSync(config, JSON.stringify({ language: 'en', theme: 'light', zoomFactor: 1, updates: { autoCheck: false },
    recent: [demo, second].map(folder => ({ path: folder, name: path.basename(folder), lastOpened: new Date().toISOString() })), lastProject: null }));
  child = spawn(exe, [], { env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stdout?.on('data', chunk => writeFileSync(path.join(output, 'shell-stdout.log'), chunk, { flag: 'a' }));
  child.stderr?.on('data', chunk => writeFileSync(path.join(output, 'shell-stderr.log'), chunk, { flag: 'a' }));
  try {
    page = await connectToHeadlessBrowser(port);
  } catch (error) {
    throw new Error(`CDP startup failed (pid=${child.pid}, exit=${child.exitCode}, signal=${child.signalCode}): ${error}`);
  }
  pages.push(page);
  await until(() => page.evaluate(launcherReady), 'launcher');
  const main = native().find(window => window.title === 'Deckmate')!.handle;
  const base = Number(await page.evaluate('devicePixelRatio'));
  for (const factor of [1.1, 1.2]) {
    native('menu', main, [2, 0]);
    await expectZoom(page, base, factor);
  }
  let secondary = await openNews(main);
  await expectZoom(secondary.news, base, 1.2);
  for (const factor of [1.3, 1.4]) {
    native('menu', secondary.window.handle, [2, 0]);
    await expectZoom(secondary.news, base, factor);
    await expectZoom(page, base, 1.2);
    assert.equal(saved().zoomFactor, factor);
  }
  native('menu', main, [2, 0]);
  await expectZoom(page, base, 1.3);
  await expectZoom(secondary.news, base, 1.4);
  await page.evaluate('window.__mainUnchanged = true');
  await reload(secondary.news, secondary.window.handle, 0, newsReady);
  assert.equal(await page.evaluate('window.__mainUnchanged'), true);
  await expectZoom(secondary.news, base, 1.4);
  await reload(page, main, 9, launcherReady);
  await expectZoom(page, base, 1.3);
  pass('S3-source-window-zoom-and-reload', { main: await page.evaluate('devicePixelRatio'), news: await secondary.news.evaluate('devicePixelRatio'), saved: saved().zoomFactor, windows: native() });

  for (const target of [page, secondary.news]) await target.evaluate(`window.__editCommands = []; document.execCommand = command => { window.__editCommands.push(command); return true; }`);
  native('menu', secondary.window.handle, [1, 0]);
  await until(async () => (await secondary.news.evaluate('window.__editCommands.length')) === 1, 'secondary Undo');
  native('menu', main, [1, 1]);
  await until(async () => (await page.evaluate('window.__editCommands.length')) === 1, 'main Redo');
  assert.deepEqual(await page.evaluate('window.__editCommands'), ['redo']);
  assert.deepEqual(await secondary.news.evaluate('window.__editCommands'), ['undo']);
  native('menu', secondary.window.handle, [2, 4]);
  await until(async () => native().find(window => window.handle === secondary.window.handle)?.caption === false, 'secondary full screen');
  assert.equal(native().find(window => window.handle === main)!.caption, true);
  native('menu', secondary.window.handle, [2, 4]);
  await until(async () => native().find(window => window.handle === secondary.window.handle)?.caption === true, 'secondary restored');
  pass('edit-and-full-screen-source-window');

  const beforePreferences = saved();
  for (const [command, args] of [['desktop_set_language', { lang: 'ru' }], ['desktop_set_theme', { theme: 'dark' }], ['board_set_theme', { theme: 'dark' }], ['board_show_start_screen', {}]] as const) {
    assert.equal(await secondary.news.callFunction(`async (command, args) => { try { return (await window.__TAURI_INTERNALS__.invoke(command, args)).ok === false; } catch { return true; } }`, command, args), true);
  }
  assert.equal(saved().language, beforePreferences.language);
  assert.equal(saved().theme, beforePreferences.theme);
  await closeNews(main, secondary.window, secondary.news);
  pass('S1-native-close-keeps-main-menu', native());

  for (const language of ['ru', 'en']) {
    const initialZoom = saved().zoomFactor;
    secondary = await openNews(main);
    await expectZoom(secondary.news, base, initialZoom);
    const beforeLanguage = native();
    await page.callFunction(`language => { if (document.documentElement.lang !== language) document.querySelector('.language-toggle').click(); }`, language);
    await until(() => page.evaluate(`document.documentElement.lang === '${language}'`), 'launcher language');
    const menus = native();
    assert.ok(menus.every(window => window.valid && window.items[0].text === (language === 'ru' ? 'Файл' : 'File')));
    for (const window of menus) expectMenuLanguage(window, language);
    assert.notEqual(menus[0].menu, menus[1].menu);
    for (const before of beforeLanguage) {
      const after = menus.find(window => window.handle === before.handle)!;
      assert.ok(Math.abs(after.client.x - before.client.x) <= 1 && Math.abs(after.client.y - before.client.y) <= 1,
        `language sync moved the client origin: ${JSON.stringify({ before: before.client, after: after.client })}`);
      assert.equal(after.menu, before.menu, 'language sync must keep the native menu handle');
    }
    const theme = language === 'ru' ? 'dark' : 'light';
    await selectPageTheme(page, theme);
    await until(async () => saved().theme === theme, 'theme save');
    await closeNews(main, secondary.window, secondary.news, language === 'en');
    native('menu', main, [2, 2]);
    await expectZoom(page, base, 1);
    await reload(page, main, 9, launcherReady);
    assert.equal(await page.evaluate(`document.documentElement.classList.contains('dark')`), theme === 'dark');
    assert.equal(await page.evaluate('document.documentElement.lang'), language);
    pass(`S1-${language}-in-place-menu-close-and-main-commands`, {
      languageSync: beforeLanguage.map(before => {
        const after = menus.find(window => window.handle === before.handle)!;
        return { handle: before.handle, menuBefore: before.menu, menuAfter: after.menu, clientBefore: before.client, clientAfter: after.client };
      }),
      windows: native(),
    });
  }

  native('menu', main, [0, 1, 0]);
  await until(() => page.evaluate(boardReady), 'recent project menu');
  const boardOrigin = await page.evaluate('location.origin');
  secondary = await openNews(main);
  await closeNews(main, secondary.window, secondary.news);
  await reload(page, main, 9, boardReady);
  pass('S1-board-menu-after-secondary-close', native());
  secondary = await openNews(main);
  await secondary.news.evaluate('window.__newsUnchanged = true');
  const beforeSwitch = native().find(window => window.handle === main)!;
  native('menu', main, [0, 6]);
  await until(() => page.evaluate(launcherReady), 'Switch project menu (Ctrl+Shift+P command)');
  const afterSwitch = native().find(window => window.handle === main)!;
  expectMenuLanguage(afterSwitch, saved().language);
  assert.equal(afterSwitch.menu, beforeSwitch.menu, 'Ctrl+Shift+P command must keep the native menu handle');
  assert.ok(Math.abs(afterSwitch.client.x - beforeSwitch.client.x) <= 1 && Math.abs(afterSwitch.client.y - beforeSwitch.client.y) <= 1,
    `Ctrl+Shift+P moved the client origin: ${JSON.stringify({ before: beforeSwitch.client, after: afterSwitch.client })}`);
  pass('ctrl-shift-p-command-keeps-menu-and-client-origin', { before: beforeSwitch.client, after: afterSwitch.client, menu: afterSwitch.menu });
  assert.equal(await secondary.news.evaluate('window.__newsUnchanged'), true);
  await until(async () => !(await fetch(boardOrigin).catch(() => null)), 'project server exit');
  await closeNews(main, secondary.window, secondary.news, true);
  await reload(page, main, 9, launcherReady);
  const beforeAutoCheck = native().find(window => window.handle === main)!.menu;
  native('menu', main, [3, 1]);
  await until(async () => saved().updates.autoCheck === true, 'Help automatic-update preference');
  const afterAutoCheck = native().find(window => window.handle === main)!;
  assert.equal(afterAutoCheck.menu, beforeAutoCheck);
  assert.equal(afterAutoCheck.items[3].children[1].checked, true);
  pass('main-file-and-help-after-secondary-close');

  const layout = () => menuLayout(child!.pid!, main);
  const stable = (before: ReturnType<typeof layout>, action: string) => pass(action, assertMenuStable(before, layout(), action));
  assert.deepEqual(saved().recent.map((entry: { path: string }) => entry.path), [demo, second]);
  let beforeStructure = layout();
  // 2026-11-13: opening the second recent project exercises a reorder before navigation leaves the launcher.
  await page.callFunction(`folder => { void window.deckmateDesktop.openProject(folder); }`, second);
  await until(() => page.evaluate(boardReady), 'launcher to second recent project');
  assert.deepEqual(saved().recent.map((entry: { path: string }) => entry.path), [second, demo]);
  assert.ok(native().find(window => window.handle === main)!.items[0].children[1].children[0].text.includes(second));
  stable(beforeStructure, 'launcher-A-B-open-B-keeps-menu-and-content');

  beforeStructure = layout();
  native('menu', main, [0, 3]);
  await until(async () => saved().workspace?.[0]?.path === second, 'add current project to workspace');
  const workspaceItem = native().find(window => window.handle === main)!.items[0].children[2].children[0];
  assert.ok(workspaceItem.text.includes(second) && workspaceItem.text.includes('Ctrl+1'));
  stable(beforeStructure, 'board-add-current-workspace-keeps-menu-and-content');

  await page.evaluate('void window.deckmateBoard.showStartScreen()');
  await until(() => page.evaluate(launcherReady), 'structural checks on launcher');
  for (const [method, args] of [
    ['addToWorkspace', [demo]],
    ['moveInWorkspace', [demo, 0]],
    ['removeFromWorkspace', [second]],
    ['removeFromWorkspace', [demo]],
    ['removeRecent', [demo]],
  ] as const) {
    beforeStructure = layout();
    assert.equal((await page.callFunction(`(method, args) => window.deckmateDesktop[method](...args)`, method, args)).ok, true);
    stable(beforeStructure, `launcher-${method}-${path.basename(args[0])}-keeps-menu-and-content`);
    if (method === 'moveInWorkspace') {
      const items = native().find(window => window.handle === main)!.items[0].children[2].children;
      for (const [index, folder] of [demo, second].entries()) {
        assert.ok(items[index].text.includes(folder) && items[index].text.includes(`Ctrl+${index + 1}`));
      }
    }
  }

  beforeStructure = layout();
  await page.callFunction(`folder => { void window.deckmateDesktop.openProject(folder); }`, third);
  await until(() => page.evaluate(boardReady), 'new project absent from recent');
  stable(beforeStructure, 'new-recent-keeps-menu-and-content');
  beforeStructure = layout();
  native('menu', main, [0, 1, 3]);
  await until(async () => saved().recent.length === 0, 'clear recent list');
  stable(beforeStructure, 'clear-recent-keeps-menu-and-content');
  assert.equal(native().find(window => window.handle === main)!.items[0].children[1].children[0].enabled, false);
  await page.evaluate('void window.deckmateBoard.showStartScreen()');
  await until(() => page.evaluate(launcherReady), 'empty recent launcher');
  beforeStructure = layout();
  await page.callFunction(`folder => { void window.deckmateDesktop.openProject(folder); }`, demo);
  await until(() => page.evaluate(boardReady), 'first project replaces noRecent');
  stable(beforeStructure, 'first-recent-keeps-menu-and-content');
  native('menu', main, [0, 12]);
  await until(async () => child!.exitCode !== null || child!.signalCode !== null, 'Quit menu');
  pass('main-quit-after-secondary-close');
} catch (error) {
  pass('FAIL', String(error instanceof Error ? error.stack : error));
  process.exitCode = 1;
} finally {
  for (const target of pages) await target.close().catch(() => {});
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { windowsHide: true, stdio: 'ignore', timeout: 15_000 });
    await until(async () => child!.exitCode !== null || child!.signalCode !== null, 'owned process exit');
  }
  await until(async () => !(await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) }).catch(() => null)), 'owned WebView2 exit');
  for (const file of ['desktop.json', 'server.log']) {
    if (existsSync(path.join(settings, file))) copyFileSync(path.join(settings, file), path.join(output, file));
  }
  await until(async () => { try { if (existsSync(fixture)) removeOwnTree(fixture); return true; } catch { return false; } }, 'owned fixture cleanup');
  console.log(`evidence: ${output}`);
}
