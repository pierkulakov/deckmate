// 2026-11-13: separate origins and document preloads need a real WebView2 round trip to catch stale theme snapshots.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort } from '../../tools/free-port.ts';
import { connectToHeadlessBrowser, openHeadlessBrowser, type HeadlessPage } from '../../tools/headless-browser.ts';
import { selectPageTheme } from './smoke-controls.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outIndex = process.argv.indexOf('--out');
const output = path.resolve(outIndex < 0 ? mkdtempSync(path.join(tmpdir(), 'deckmate-theme-')) : process.argv[outIndex + 1]);
mkdirSync(output, { recursive: true });
const fixture = mkdtempSync(path.join(output, 'fixture-'));
const settings = path.join(fixture, 'settings');
const config = path.join(settings, 'desktop.json');
const demo = path.join(fixture, 'demo');
mkdirSync(settings);
const init = spawnSync(process.execPath, [path.join(root, 'bin/deckmate.mjs'), 'init', demo], { encoding: 'utf8', windowsHide: true });
assert.equal(init.status, 0, init.stderr || init.stdout);
writeFileSync(config, JSON.stringify({
  lastProject: null, language: 'ru', updates: { autoCheck: false },
  recent: [{ path: demo, name: 'Проверка темы', lastOpened: new Date(Date.now() - 4 * 86400_000).toISOString() }],
}));
const port = await freePort();
const child = spawn(path.join(root, 'desktop/src-tauri/target/debug/Deckmate.exe'), [], {
  windowsHide: true, stdio: 'ignore', env: {
    ...process.env, APPDATA: path.join(fixture, 'appdata'), LOCALAPPDATA: path.join(fixture, 'localappdata'),
    WEBVIEW2_USER_DATA_FOLDER: path.join(fixture, 'webview'),
    DECKMATE_DESKTOP_SETTINGS_DIR: settings, DECKMATE_DESKTOP_CDP_PORT: String(port),
    DECKMATE_DESKTOP_SERVER: path.join(root, 'dist/server/main.js'),
  },
});
let page: HeadlessPage | undefined;
const launcherReady = `document.readyState === 'complete' && !!window.deckmateDesktop && !!document.getElementById('launcher') && !document.getElementById('launcher').hasAttribute('aria-busy')`;
const boardReady = `document.readyState === 'complete' && !!window.deckmateBoard && Number(document.querySelector('.app-shell')?.dataset.updatedAt) > 0 && !!document.querySelector('[data-deck-cover]')`;
const dark = `document.documentElement.classList.contains('dark')`;
const boardToggle = `document.querySelector('button[aria-label="Theme"], button[aria-label="Тема"]')`;
const savedTheme = () => JSON.parse(readFileSync(config, 'utf8')).theme;

async function waitFor(expression: string, target = page!, timeout = 30_000): Promise<void> {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try { if (await target.evaluate(expression)) return; } catch { /* 2026-11-13: navigation replaces the execution context. */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${expression}`);
}

async function reload(ready: string, target = page!): Promise<void> {
  await target.evaluate('window.__oldThemeDocument = true');
  await target.send('Page.reload');
  await waitFor(`!window.__oldThemeDocument && (${ready})`, target);
}

async function shot(name: string, clip?: object): Promise<void> {
  await page!.evaluate('document.fonts.ready.then(() => true)');
  await page!.callFunction(`() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  const result = await page!.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  writeFileSync(path.join(output, `${name}.png`), Buffer.from(result.result.data, 'base64'));
}

async function checkTheme(theme: string, preference = theme): Promise<void> {
  await waitFor(`${dark} === ${theme === 'dark'}`);
  assert.equal(savedTheme(), preference);
}

async function returnToLauncher(): Promise<void> {
  await page!.evaluate('void window.deckmateBoard.showStartScreen()');
  await waitFor(launcherReady);
}

async function openDemo(): Promise<void> {
  await page!.evaluate(`document.querySelector('.mission-control-workspace-open').click()`);
  await waitFor(boardReady);
}

async function saveFailure(bridge: string): Promise<void> {
  const before = savedTheme();
  renameSync(config, `${config}.backup`);
  mkdirSync(config);
  try {
    const result = await page!.callFunction(`async bridge => window[bridge].setTheme('system')`, bridge);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'save-failed');
  } finally {
    rmdirSync(config);
    renameSync(`${config}.backup`, config);
  }
  assert.equal(savedTheme(), before);
}

try {
  page = await connectToHeadlessBrowser(port);
  await waitFor(launcherReady);
  assert.equal(await page.evaluate(`${dark} === matchMedia('(prefers-color-scheme: dark)').matches`), true);
  assert.equal((await page.callFunction(`() => window.deckmateDesktop.getState()`)).theme, 'system');
  assert.equal(await page.evaluate(`document.documentElement.getAttribute('data-shell-theme')`), 'system');
  const csp = await page.evaluate(`document.querySelector('meta[http-equiv="Content-Security-Policy"]').content`);
  const configuredCsp = JSON.parse(readFileSync(path.join(root, 'desktop/src-tauri/tauri.conf.json'), 'utf8')).app.security.csp;
  const policy = (value: string) => value.split(';').map(part => part.trim()).sort();
  assert.deepEqual(policy(csp), policy(configuredCsp));
  console.log('ok fresh-system — launcher matches the OS without a saved choice; CSP unchanged');

  const measurements = [];
  for (const theme of ['dark', 'light']) {
    const opposite = theme === 'dark' ? 'light' : 'dark';
    assert.equal((await page.callFunction(`theme => window.deckmateDesktop.setTheme(theme)`, opposite)).ok, true);
    const poison = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      localStorage.setItem('deckmate-theme', ${JSON.stringify(opposite)});
      localStorage.setItem('freetion-theme', ${JSON.stringify(opposite)});
      if (location.hostname === '127.0.0.1') localStorage.setItem('deckmate-language', 'en');
    ` });
    await reload(launcherReady);
    await selectPageTheme(page, theme);
    await checkTheme(theme);
    await shot(`launcher-${theme}-from-launcher`);
    const row = await page.callFunction(`() => {
      const item = document.querySelector('.mission-control-workspace-row.has-pin');
      const label = item.querySelector('.project-list-when');
      const range = document.createRange(); range.selectNodeContents(label);
      const center = rect => rect.top + rect.height / 2;
      const box = item.getBoundingClientRect();
      return {
        text: label.textContent, textCenter: center(label.getBoundingClientRect()), glyphCenter: center(range.getBoundingClientRect()),
        pinCenter: center(item.querySelector('.project-list-pin svg').getBoundingClientRect()),
        removeCenter: center(item.querySelector('.project-list-remove svg').getBoundingClientRect()),
        clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 3 },
      };
    }`);
    assert.ok(Math.abs(row.textCenter - row.pinCenter) <= 1, JSON.stringify(row));
    assert.ok(Math.abs(row.textCenter - row.removeCenter) <= 1, JSON.stringify(row));
    measurements.push({ theme, ...row });
    await shot(`recent-row-${theme}-3x`, row.clip);
    await saveFailure('deckmateDesktop');
    assert.equal((await page.callFunction(`() => window.deckmateDesktop.setTheme('invalid')`)).code, 'invalid-theme');
    assert.equal(await page.callFunction(`async () => {
      try { return (await window.__TAURI_INTERNALS__.invoke('board_set_theme', { theme: 'dark' })).ok === false; }
      catch { return true; }
    }`), true);

    await openDemo();
    await checkTheme(theme);
    assert.equal(await page.evaluate('window.deckmateBoard.theme'), theme);
    assert.equal(await page.evaluate(`localStorage.getItem('deckmate-theme')`), opposite);
    await shot(`board-${theme}-from-launcher`);
    await saveFailure('deckmateBoard');
    assert.equal((await page.callFunction(`() => window.deckmateBoard.setTheme('invalid')`)).code, 'invalid-theme');
    assert.equal(await page.callFunction(`async () => {
      try { return (await window.__TAURI_INTERNALS__.invoke('desktop_set_theme', { theme: 'dark' })).ok === false; }
      catch { return true; }
    }`), true);

    await selectPageTheme(page, opposite);
    await checkTheme(opposite);
    await shot(`board-${opposite}-from-board`);
    await reload(boardReady);
    await checkTheme(opposite);
    assert.equal(await page.evaluate('window.deckmateBoard.theme'), opposite);
    await returnToLauncher();
    await checkTheme(opposite);
    assert.equal(await page.evaluate(`document.documentElement.getAttribute('data-shell-theme')`), opposite);
    await shot(`launcher-${opposite}-from-board`);
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: poison.result.identifier });
    console.log(`ok ${theme} round-trip — launcher → board, board → reload → launcher; stale storage ignored; save failures and authorization checked`);
  }
  writeFileSync(path.join(output, 'row-centers.json'), JSON.stringify(measurements, null, 2));
  assert.equal((await page.callFunction(`() => window.deckmateDesktop.setTheme('system')`)).ok, true);
  for (const theme of ['light', 'dark']) {
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await reload(launcherReady);
    await checkTheme(theme, 'system');
    await openDemo();
    await checkTheme(theme, 'system');
    await reload(boardReady);
    await checkTheme(theme, 'system');
    if (theme === 'dark') {
      const origin = await page.evaluate('location.origin');
      const browser = await openHeadlessBrowser({ width: 1280, height: 820, scale: 1 });
      try {
        await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `
          if (!localStorage.getItem('deckmate-theme')) localStorage.setItem('deckmate-theme', 'light');
          localStorage.setItem('deckmate-language', 'en');
        ` });
        await browser.send('Page.navigate', { url: origin });
        await waitFor(`!!document.querySelector('.app-shell') && !!(${boardToggle})`, browser);
        assert.equal(await browser.evaluate('typeof window.deckmateBoard'), 'undefined');
        assert.equal(await browser.evaluate(dark), false);
        await selectPageTheme(browser, 'dark');
        assert.equal(await browser.evaluate(`localStorage.getItem('deckmate-theme')`), 'dark');
        await reload(`!!document.querySelector('.app-shell')`, browser);
        assert.equal(await browser.evaluate(dark), true);
        assert.equal(savedTheme(), 'system');
      } finally { await browser.close(); }
    }
    await returnToLauncher();
    await checkTheme(theme, 'system');
  }
  console.log(`ok system + browser — both system schemes survive navigation/reload; browser keeps independent storage; screenshots: ${output}`);
} finally {
  await page?.close();
  if (child.pid && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    await exited;
  }
}
