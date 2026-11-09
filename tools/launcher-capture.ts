// Launcher start-screen frames for design review: desktop/launcher/index.html in headless Edge/Chrome with the mock bridge
// (a plain browser load has no window.deckmateDesktop, so launcher.js serves sample data).
// Takes over from desktop/capture/capture-launcher.mjs as the shell moves from Electron to Tauri — desktop/README.md,
// "Development loop" (2026-11-09).
// Run: npm run capture:launcher — saves .deckmate/launcher-shots/<frame>.png plus frames.json (size, bytes, SHA-256 per frame).
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openHeadlessBrowser, type HeadlessPage } from './layout-capture.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pageUrl = pathToFileURL(path.join(here, '..', 'desktop', 'launcher', 'index.html')).href;
const output = path.join(here, '..', '.deckmate', 'launcher-shots');

interface Frame { name: string; theme: 'dark' | 'light'; lang: 'en' | 'ru'; size: [number, number]; state?: 'empty' | 'error' | 'hover-row' | 'focus-open' | 'focus-row' }

const frames: Frame[] = [
  { name: 'dark-en-1280', theme: 'dark', lang: 'en', size: [1280, 820] },
  { name: 'light-ru-1280', theme: 'light', lang: 'ru', size: [1280, 820] },
  { name: 'dark-en-960', theme: 'dark', lang: 'en', size: [960, 600] },
  { name: 'light-ru-960', theme: 'light', lang: 'ru', size: [960, 600] },
  { name: 'dark-en-empty', theme: 'dark', lang: 'en', size: [1280, 820], state: 'empty' },
  { name: 'light-ru-empty', theme: 'light', lang: 'ru', size: [1280, 820], state: 'empty' },
  { name: 'dark-en-error', theme: 'dark', lang: 'en', size: [1280, 820], state: 'error' },
  { name: 'light-ru-error', theme: 'light', lang: 'ru', size: [1280, 820], state: 'error' },
  { name: 'dark-en-focus-open', theme: 'dark', lang: 'en', size: [1280, 820], state: 'focus-open' },
  { name: 'dark-en-focus-row', theme: 'dark', lang: 'en', size: [1280, 820], state: 'focus-row' },
  { name: 'light-ru-hover-row', theme: 'light', lang: 'ru', size: [1280, 820], state: 'hover-row' },
];

// Every script sent to the page is a fixed string picked by key: nothing from the frame table is spliced into code.
const THEME_SCRIPTS: Record<string, string> = {
  dark: `localStorage.setItem('deckmate-theme', 'dark')`,
  light: `localStorage.setItem('deckmate-theme', 'light')`,
};
const LANG_SCRIPTS: Record<string, string> = {
  en: `localStorage.setItem('deckmate-language', 'en')`,
  ru: `localStorage.setItem('deckmate-language', 'ru')`,
};
const STATE_SCRIPTS: Record<string, string> = {
  list: `document.getAnimations().forEach(a => a.finish())`,
  empty: `document.getAnimations().forEach(a => a.finish());
    document.getElementById('recent-list').replaceChildren();
    document.getElementById('recent-empty').hidden = false;
    document.getElementById('recent-count').hidden = true;`,
  error: `document.getAnimations().forEach(a => a.finish()); document.getElementById('open-folder').click();`,
  'hover-row': `document.getAnimations().forEach(a => a.finish()); document.querySelectorAll('.recent-item')[1].classList.add('is-hover-demo');`,
  'focus-open': `document.getAnimations().forEach(a => a.finish())`,
  'focus-row': `document.getAnimations().forEach(a => a.finish())`,
};
const FOCUS_CHECKS: Record<string, string> = {
  'focus-open': `document.activeElement === document.getElementById('open-folder')`,
  'focus-row': `document.activeElement === document.querySelector('.recent-open')`,
};
const MAX_TAB_PRESSES = 12;

// The launcher CSP allows inline styles (style-src 'unsafe-inline'), so page-state overrides enter as <style> elements.
const INJECT_STYLE = 'css => { const style = document.createElement("style"); style.textContent = css; document.head.append(style); return true; }';
// The settle keyframes only animate from hidden, so with animations off the frames show the settled state directly.
const NO_MOTION = '*, *::before, *::after { animation: none !important; transition: none !important; }';
const HOVER_DEMO = '.recent-item.is-hover-demo .recent-open { background: var(--surface); } .recent-item.is-hover-demo .recent-remove { opacity: 1; }';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function scriptFor(table: Record<string, string>, key: string, what: string): string {
  if (!Object.hasOwn(table, key)) throw new Error(`Unknown ${what}: ${key}`);
  return table[key];
}

// Polls a page-side predicate until it returns true or the timeout passes.
async function pollPage(page: HeadlessPage, expression: string, timeoutMs: number, intervalMs = 50): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.evaluate(expression)) return true;
    await sleep(intervalMs);
  }
  return false;
}

// The previous document may already report readyState 'complete', so a flag on the old page marks the wait as being for the new one.
async function navigateAndWait(page: HeadlessPage, what: string): Promise<void> {
  await page.evaluate('window.__deckmateCaptureOldDocument = true');
  await page.send('Page.navigate', { url: pageUrl });
  const loaded = await pollPage(page, `!window.__deckmateCaptureOldDocument && document.readyState === 'complete'`, 10000);
  if (!loaded) throw new Error(`${what}: the launcher page did not finish loading within 10 s`);
}

// Waits until the launcher finished its first render and the fonts are loaded.
async function waitForPageReady(page: HeadlessPage, frame: string): Promise<void> {
  const busyCleared = await pollPage(page, `!document.getElementById('launcher').hasAttribute('aria-busy')`, 5000);
  if (!busyCleared) throw new Error(`${frame}: the launcher is still aria-busy after 5 s`);
  await page.evaluate('document.fonts.ready.then(() => true)');
}

// Moves keyboard focus with real Tab key events, so :focus-visible matches a user's focus.
async function tabUntilFocused(page: HeadlessPage, matches: string, frameName: string): Promise<void> {
  for (let press = 0; press < MAX_TAB_PRESSES; press++) {
    if (await page.evaluate(matches)) return;
    for (const type of ['keyDown', 'keyUp']) {
      await page.send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    }
    await sleep(50);
  }
  if (!(await page.evaluate(matches))) throw new Error(`${frameName}: target not focused after ${MAX_TAB_PRESSES} Tab presses`);
}

interface Shot { name: string; width: number; height: number; bytes: number; sha256: string }

async function captureFrame(page: HeadlessPage, frame: Frame, destination: string): Promise<Shot> {
  const [width, height] = frame.size;
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  // The settings are written on the loaded page; the reload below re-runs theme.js and launcher.js against them.
  await page.evaluate(scriptFor(THEME_SCRIPTS, frame.theme, 'theme'));
  await page.evaluate(scriptFor(LANG_SCRIPTS, frame.lang, 'language'));
  await navigateAndWait(page, frame.name);
  await page.callFunction(INJECT_STYLE, NO_MOTION);
  await waitForPageReady(page, frame.name);

  const state = frame.state ?? 'list';
  await page.evaluate(scriptFor(STATE_SCRIPTS, state, 'state'));
  if (state === 'error') {
    const failed = await pollPage(page, `document.getElementById('status').dataset.phase === 'error'`, 4000);
    if (!failed) throw new Error(`${frame.name}: the status phase is not 'error' after 4 s`);
  }
  if (Object.hasOwn(FOCUS_CHECKS, state)) await tabUntilFocused(page, FOCUS_CHECKS[state], frame.name);
  await sleep(250);
  if (state === 'hover-row') {
    await page.callFunction(INJECT_STYLE, HOVER_DEMO);
    await sleep(150);
  }
  const shot = await page.send('Page.captureScreenshot', { format: 'png' });
  const png = Buffer.from(shot.result.data, 'base64');
  const [pngWidth, pngHeight] = [png.readUInt32BE(16), png.readUInt32BE(20)];
  if (pngWidth !== width || pngHeight !== height) {
    throw new Error(`${frame.name}: expected ${width}x${height} at device scale 1, got ${pngWidth}x${pngHeight}`);
  }
  await writeFile(destination, png);
  console.log(`${frame.name}: ${pngWidth}x${pngHeight}, ${png.length} bytes`);
  return { name: frame.name, width: pngWidth, height: pngHeight, bytes: png.length, sha256: createHash('sha256').update(png).digest('hex') };
}

// 2026-11-09: README captures must follow release versions without changing the launcher's standalone design-review mock.
export async function captureLauncherReadme(destination: string): Promise<Shot> {
  const root = path.join(here, '..');
  const [deckmate, desktop] = await Promise.all(['package.json', 'desktop/package.json'].map(async file =>
    JSON.parse(await readFile(path.join(root, file), 'utf8')) as { version: string }));
  const page = await openHeadlessBrowser({ width: 1280, height: 820, scale: 1 });
  try {
    const source = String.raw`(() => {
      const now = Date.now();
      const recent = [
        { path: 'D:\\Projects\\Hollow Signal', name: 'Hollow Signal', lastOpened: new Date(now - 90e3).toISOString() },
        { path: 'D:\\Projects\\demo', name: 'demo', lastOpened: new Date(now - 5 * 3600e3).toISOString() },
        { path: 'C:\\Users\\Someone\\Documents\\Долгий путь к релизу', name: 'Долгий путь к релизу', lastOpened: new Date(now - 3 * 86400e3).toISOString() },
      ];
      window.deckmateDesktop = {
        async getState() { return { recent, lastProject: recent[0].path, version: ${JSON.stringify(desktop.version)}, deckmateVersion: ${JSON.stringify(deckmate.version)}, locale: 'en-US' }; },
        async chooseFolder() { return 'D:\\Projects\\New Deck'; },
        async openProject() { return { ok: false, code: 'missing' }; },
        async createProject() { return { ok: false, code: 'not-empty' }; },
        async removeRecent() { return { ok: true }; },
        async setLanguage() { return { ok: true }; },
        onStatus() { return () => {}; },
      };
    })()`;
    const registered = await page.send('Page.addScriptToEvaluateOnNewDocument', { source });
    if (registered.error) throw new Error(`Cannot register launcher bridge: ${registered.error.message}`);
    await navigateAndWait(page, 'initial load');
    const shot = await captureFrame(page, frames[0], destination);
    const footer = await page.evaluate('document.getElementById("version").textContent');
    const expected = deckmate.version === desktop.version ? `Deckmate ${deckmate.version}` : `Deckmate ${deckmate.version} · Desktop ${desktop.version}`;
    if (footer !== expected) throw new Error(`Unexpected launcher version: ${footer}`);
    if (page.consoleErrors.length) throw new Error(`console errors during capture: ${page.consoleErrors.join(' | ')}`);
    return shot;
  } finally {
    await page.close();
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--readme')) {
    await captureLauncherReadme(path.join(here, '..', 'docs', 'screenshots', 'desktop-start.png'));
    return;
  }
  const page = await openHeadlessBrowser({ width: frames[0].size[0], height: frames[0].size[1], scale: 1 });
  try {
    await mkdir(output, { recursive: true });
    await navigateAndWait(page, 'initial load');
    const shots: Shot[] = [];
    for (const frame of frames) shots.push(await captureFrame(page, frame, path.join(output, `${frame.name}.png`)));
    await sleep(300);
    if (page.consoleErrors.length) throw new Error(`console errors during capture: ${page.consoleErrors.join(' | ')}`);
    const report = { capturedAt: new Date().toISOString(), page: 'desktop/launcher/index.html', deviceScaleFactor: 1, frames: shots };
    await writeFile(path.join(output, 'frames.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`frames.json: ${shots.length} frames, ${shots.reduce((total, entry) => total + entry.bytes, 0)} bytes of PNG`);
  } finally {
    await page.close();
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) await main();
