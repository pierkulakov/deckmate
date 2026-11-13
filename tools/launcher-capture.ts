// 2026-11-13: captures use Vite serve because the production entry excludes the browser mock.
// Run: npm run capture:launcher — saves .deckmate/launcher-shots/<frame>.png plus frames.json (size, bytes, SHA-256 per frame).
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { openHeadlessBrowser, type HeadlessPage } from './layout-capture.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const output = process.env.DECKMATE_LAUNCHER_CAPTURE_OUTPUT || path.join(here, '..', '.deckmate', 'launcher-shots');

async function startPreview() {
  const server = await createServer({ configFile: path.join(here, '..', 'desktop.vite.config.ts'),
    logLevel: 'error', server: { host: '127.0.0.1', port: 0, open: false } });
  await server.listen();
  return { server, url: server.resolvedUrls!.local[0] };
}

interface Frame {
  name: string; theme: 'dark' | 'light'; lang: 'en' | 'ru'; size: [number, number]; page?: 'whats-new';
  state?: 'empty' | 'one' | 'error' | 'hover-row' | 'focus-open' | 'focus-row' | 'focus-workspace';
  scenario?: 'empty' | 'many' | 'missing' | 'opening' | 'error' | 'create';
  error?: string; zoom?: number; reducedMotion?: boolean;
  expand?: 'templates' | 'details';
  covers?: 'visible' | 'hidden';
}

const frames: Frame[] = [
  { name: 'dark-en-1280', theme: 'dark', lang: 'en', size: [1280, 820], covers: 'visible' },
  { name: 'light-ru-1280', theme: 'light', lang: 'ru', size: [1280, 820], covers: 'visible' },
  { name: 'dark-en-960-tall', theme: 'dark', lang: 'en', size: [960, 900], covers: 'visible' },
  { name: 'light-ru-960-tall', theme: 'light', lang: 'ru', size: [960, 900], covers: 'visible' },
  { name: 'dark-en-1440', theme: 'dark', lang: 'en', size: [1440, 900], covers: 'visible' },
  { name: 'light-ru-1440', theme: 'light', lang: 'ru', size: [1440, 900], covers: 'visible' },
  { name: 'dark-en-960', theme: 'dark', lang: 'en', size: [960, 600], covers: 'hidden' },
  { name: 'light-ru-960', theme: 'light', lang: 'ru', size: [960, 600], covers: 'hidden' },
  { name: 'dark-en-empty', theme: 'dark', lang: 'en', size: [1280, 820], state: 'empty' },
  { name: 'light-ru-empty', theme: 'light', lang: 'ru', size: [1280, 820], state: 'empty' },
  { name: 'dark-en-error', theme: 'dark', lang: 'en', size: [1280, 820], state: 'error' },
  { name: 'light-ru-error', theme: 'light', lang: 'ru', size: [1280, 820], state: 'error' },
  { name: 'dark-en-focus-open', theme: 'dark', lang: 'en', size: [1280, 820], state: 'focus-open' },
  { name: 'dark-en-focus-row', theme: 'dark', lang: 'en', size: [1280, 820], state: 'focus-row' },
  { name: 'light-ru-focus-workspace', theme: 'light', lang: 'ru', size: [960, 600], state: 'focus-workspace' },
  { name: 'light-ru-hover-row', theme: 'light', lang: 'ru', size: [1280, 820], state: 'hover-row' },
  { name: 'whats-new-dark-en', theme: 'dark', lang: 'en', size: [760, 680], page: 'whats-new' },
  { name: 'whats-new-dark-ru', theme: 'dark', lang: 'ru', size: [760, 680], page: 'whats-new' },
  { name: 'whats-new-light-en', theme: 'light', lang: 'en', size: [760, 680], page: 'whats-new' },
  { name: 'whats-new-light-ru', theme: 'light', lang: 'ru', size: [760, 680], page: 'whats-new' },
];

// 2026-11-10: explicit URL fixtures make the same edge cases reproducible in a normal browser, not just in screenshots.
const errorCodes = ['invalid-path', 'missing', 'not-empty', 'create-failed', 'start-failed', 'timeout', 'load-failed', 'save-failed'];
for (const theme of ['dark', 'light'] as const) {
  frames.push({ name: `${theme}-ru-long-375`, theme, lang: 'ru', size: [375, 900], scenario: 'many' });
  frames.push({ name: `${theme}-ru-long-1280`, theme, lang: 'ru', size: [1280, 820], scenario: 'many', covers: 'visible' });
  for (const lang of ['en', 'ru'] as const) {
    for (const size of [[960, 600], [1280, 820]] as [number, number][]) {
      if ((theme === 'dark' && lang === 'ru') || (theme === 'light' && lang === 'en')) {
        frames.push({ name: `${theme}-${lang}-${size[0]}`, theme, lang, size, covers: size[1] > 680 ? 'visible' : 'hidden' });
      }
      frames.push({ name: `${theme}-${lang}-one-${size[0]}`, theme, lang, size, state: 'one' });
      for (const scenario of ['empty', 'many', 'missing', 'opening', 'create'] as const) {
        frames.push({ name: `${theme}-${lang}-${scenario}-${size[0]}`, theme, lang, size, scenario });
      }
    }
    for (const error of errorCodes) {
      frames.push({ name: `${theme}-${lang}-error-${error}`, theme, lang, size: [960, 600], scenario: 'error', error });
      frames.push({ name: `${theme}-${lang}-error-${error}-1280`, theme, lang, size: [1280, 820], scenario: 'error', error });
    }
    frames.push({ name: `${theme}-${lang}-templates`, theme, lang, size: [960, 600], scenario: 'empty', expand: 'templates' });
    frames.push({ name: `${theme}-${lang}-details`, theme, lang, size: [960, 600], scenario: 'error', error: 'start-failed', expand: 'details' });
  }
}
for (const zoom of [0.5, 2]) {
  for (const scenario of ['many', 'empty', 'create'] as const) {
    frames.push({ name: `light-ru-${scenario}-zoom-${zoom}`, theme: 'light', lang: 'ru', size: [960, 600], scenario, zoom, reducedMotion: true });
  }
}

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
  empty: `document.getAnimations().forEach(a => a.finish())`,
  one: `document.getAnimations().forEach(a => a.finish())`,
  error: `document.getAnimations().forEach(a => a.finish()); document.getElementById('open-folder').click();`,
  'hover-row': `document.getAnimations().forEach(a => a.finish()); document.querySelectorAll('.mission-control-workspace-row')[1].classList.add('is-hover-demo');`,
  'focus-open': `document.getAnimations().forEach(a => a.finish())`,
  'focus-row': `document.getAnimations().forEach(a => a.finish())`,
  'focus-workspace': `document.getAnimations().forEach(a => a.finish())`,
};
const FOCUS_CHECKS: Record<string, string> = {
  'focus-open': `document.getElementById('open-folder').matches(':focus-visible')`,
  'focus-row': `document.querySelector('#recent-list .mission-control-workspace-open').matches(':focus-visible')`,
  'focus-workspace': `document.querySelector('#workspace-list .mission-control-workspace-open').matches(':focus-visible')`,
};
const MAX_TAB_PRESSES = 48;

// The launcher CSP allows inline styles (style-src 'unsafe-inline'), so page-state overrides enter as <style> elements.
const INJECT_STYLE = 'css => { const style = document.createElement("style"); style.textContent = css; document.head.append(style); return true; }';
// The settle keyframes only animate from hidden, so with animations off the frames show the settled state directly.
const NO_MOTION = '*, *::before, *::after { animation: none !important; transition: none !important; }';
const HOVER_DEMO = '.mission-control-workspace-row.is-hover-demo .mission-control-workspace-open { background: var(--hover); }';

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
async function navigateAndWait(page: HeadlessPage, what: string, url: string): Promise<void> {
  await page.evaluate('window.__deckmateCaptureOldDocument = true');
  await page.send('Page.navigate', { url });
  const loaded = await pollPage(page, `!window.__deckmateCaptureOldDocument && document.readyState === 'complete'`, 10000);
  if (!loaded) throw new Error(`${what}: the launcher page did not finish loading within 10 s`);
}

// Waits until the launcher finished its first render and the fonts are loaded.
async function waitForPageReady(page: HeadlessPage, frame: string, root = 'launcher'): Promise<void> {
  const busyCleared = await pollPage(page, `!document.getElementById('${root}').hasAttribute('aria-busy')`, 5000);
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

async function verifyControlStates(page: HeadlessPage, pageUrl: string): Promise<void> {
  await navigateAndWait(page, 'pointer checks', pageUrl);
  await waitForPageReady(page, 'pointer checks');
  const point = async (selector: string) => page.callFunction(`selector => {
    const box = document.querySelector(selector).getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }`, selector);
  const move = async (coordinates: { x: number; y: number }, buttons = 0) => page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...coordinates, buttons });
  const appearance = `(() => { const style = getComputedStyle(document.getElementById('open-folder')); return [style.backgroundColor, style.color, style.opacity].join('|'); })()`;
  await move({ x: 0, y: 0 });
  const idle = await page.evaluate(appearance);
  const open = await point('#open-folder');
  await move(open);
  await sleep(150);
  if (await page.evaluate(appearance) === idle) throw new Error('Pointer: the primary button has no hover feedback');
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...open, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(150);
  const press = await page.evaluate(`new DOMMatrixReadOnly(getComputedStyle(document.getElementById('open-folder')).transform).m42`);
  if (Math.abs(press - 1) > .05) throw new Error(`Pointer: expected a 1px press, got ${press}`);
  await move({ x: 0, y: 0 }, 1);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 0, y: 0, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(50);
  if (await page.evaluate(appearance) !== idle) throw new Error('Pointer: the button hover did not clear immediately');
  const row = `getComputedStyle(document.querySelector('#last-list .mission-control-workspace-open')).backgroundColor`;
  const rowIdle = await page.evaluate(row);
  await move(await point('#last-list .mission-control-workspace-open'));
  await sleep(150);
  if (await page.evaluate(row) === rowIdle) throw new Error('Pointer: the project row has no hover feedback');
  await move(await point('#recent-list .mission-control-workspace-open'));
  await sleep(50);
  if (await page.evaluate(row) !== rowIdle) throw new Error('Pointer: the project row hover did not clear immediately');
  await move({ x: 0, y: 0 });
  console.log('pointer: hover, immediate exit and press passed');
}

interface Shot { name: string; width: number; height: number; bytes: number; sha256: string; zoom?: number }

async function verifyCovers(page: HeadlessPage, frame: Frame): Promise<void> {
  const problem = await page.callFunction(`async expected => {
    const isVisible = node => {
      for (let element = node; element; element = element.parentElement) {
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
      }
      return true;
    };
    const intro = document.querySelector('.intro').getBoundingClientRect();
    const actionsElement = document.querySelector('.actions');
    const actions = actionsElement.getBoundingClientRect();
    const table = document.querySelector('.table');
    if (!isVisible(actionsElement) || actions.left < intro.left || actions.right > intro.right ||
        actions.top < intro.top || actions.bottom > intro.bottom) return 'project actions are clipped';
    const visible = isVisible(table);
    if (!visible) return expected === 'hidden' ? '' : 'cover table is hidden';
    if (expected === 'hidden') return 'cover table should give the actions room';
    const bounds = table.getBoundingClientRect();
    const covers = [...table.querySelectorAll('.cover')];
    if (covers.length !== 2) return 'expected two deck covers';
    const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    for (const cover of covers) {
      const box = cover.getBoundingClientRect();
      if (!isVisible(cover) || !box.width || !box.height || box.left < bounds.left || box.right > bounds.right ||
          box.top < bounds.top || box.bottom > bounds.bottom || box.top < intro.top || box.bottom > intro.bottom) {
        return 'a cover is hidden or clipped';
      }
      if (overlaps(box, actions)) return 'a cover overlaps the project actions';
      if ([...table.querySelectorAll('.fan-card')].some(card => overlaps(box, card.getBoundingClientRect()))) {
        return 'the card fan obscures a cover';
      }
      const backdrop = cover.querySelector('.cover-backdrop');
      const face = getComputedStyle(backdrop, '::after');
      if (!isVisible(backdrop) || face.content === 'none' || face.backgroundColor === 'rgba(0, 0, 0, 0)') return 'a cover face is hidden';
      for (const part of cover.querySelectorAll('.cover-art, .cover-title, .cover-count')) {
        const partBox = part.getBoundingClientRect();
        if (!isVisible(part) || !partBox.width || !partBox.height || partBox.left < box.left || partBox.right > box.right ||
            partBox.top < box.top || partBox.bottom > box.bottom) return 'cover art, title or count is clipped';
      }
      const background = getComputedStyle(cover.querySelector('.cover-art')).backgroundImage;
      if (!background.startsWith('url("') || !background.endsWith('")')) return 'cover art is missing';
      const image = new Image();
      image.src = background.slice(5, -2);
      try { await image.decode(); } catch { return 'cover art did not load'; }
      if (!image.naturalWidth || !image.naturalHeight) return 'cover art is empty';
    }
    const fan = [...table.querySelectorAll('.fan-card')];
    if (fan.length !== 3) return 'expected three cards in the fan';
    for (const card of fan) {
      const background = getComputedStyle(card).backgroundImage;
      if (!background.startsWith('url("') || !background.endsWith('")')) return 'card art is missing';
      const source = background.slice(5, -2);
      const expectedFile = document.documentElement.classList.contains('dark') ? 'cards.png' : 'cards-light.png';
      if (!new URL(source).pathname.endsWith('/' + expectedFile)) return 'card art does not match the theme';
      const image = new Image(); image.src = source;
      try { await image.decode(); } catch { return 'card art did not load'; }
      if (image.naturalWidth !== 1310 || image.naturalHeight !== 326) return 'card art has unexpected dimensions';
    }
    return '';
  }`, frame.covers);
  if (problem) throw new Error(`${frame.name}: ${problem}`);
}

async function captureFrame(page: HeadlessPage, frame: Frame, destination: string, pageUrl: string): Promise<Shot> {
  const [width, height] = frame.size;
  const zoom = frame.zoom ?? 1;
  await page.send('Emulation.setDeviceMetricsOverride', { width: width / zoom, height: height / zoom, deviceScaleFactor: zoom, mobile: false });
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: frame.reducedMotion ? 'reduce' : 'no-preference' }] });
  // 2026-11-13: reload picks up browser preferences before the dev bridge supplies its first snapshot.
  await page.evaluate(scriptFor(THEME_SCRIPTS, frame.theme, 'theme'));
  await page.evaluate(scriptFor(LANG_SCRIPTS, frame.lang, 'language'));
  const url = new URL(frame.page === 'whats-new' ? 'whats-new.html' : 'index.html', pageUrl);
  if (frame.state === 'one' || frame.state === 'empty') url.searchParams.set('scenario', frame.state);
  if (frame.scenario) url.searchParams.set('scenario', frame.scenario);
  if (frame.error) url.searchParams.set('error', frame.error);
  await navigateAndWait(page, frame.name, url.href);
  await page.callFunction(INJECT_STYLE, NO_MOTION);
  await waitForPageReady(page, frame.name, frame.page === 'whats-new' ? 'whats-new' : 'launcher');
  const themeMatches = await page.callFunction('theme => document.documentElement.classList.contains("dark") === (theme === "dark")', frame.theme);
  if (!themeMatches) throw new Error(`${frame.name}: expected ${frame.theme} theme`);

  const state = frame.state ?? 'list';
  if (frame.page !== 'whats-new') await page.evaluate(scriptFor(STATE_SCRIPTS, state, 'state'));
  if (state === 'error' || frame.scenario === 'error') {
    const failed = await pollPage(page, `document.getElementById('status').dataset.phase === 'error'`, 4000);
    if (!failed) throw new Error(`${frame.name}: the status phase is not 'error' after 4 s`);
  }
  if (frame.scenario === 'opening' && !await pollPage(page, `document.getElementById('status').dataset.phase === 'starting'`, 2000)) {
    throw new Error(`${frame.name}: no opening feedback`);
  }
  if (frame.scenario === 'create' && !await pollPage(page, `!document.getElementById('create-panel').hidden`, 2000)) {
    throw new Error(`${frame.name}: no creation confirmation`);
  }
  if (Object.hasOwn(FOCUS_CHECKS, state)) await tabUntilFocused(page, FOCUS_CHECKS[state], frame.name);
  await sleep(250);
  if (state === 'hover-row') {
    await page.callFunction(INJECT_STYLE, HOVER_DEMO);
    await sleep(150);
  }
  if (frame.page !== 'whats-new') {
    const overflow = await page.evaluate(`document.documentElement.scrollWidth > innerWidth`);
    if (overflow) throw new Error(`${frame.name}: horizontal overflow`);
    if (frame.covers) await verifyCovers(page, frame);
    if (frame.scenario === 'opening' && await page.evaluate(`document.getElementById('open-folder').disabled`)) {
      throw new Error(`${frame.name}: choosing another project is blocked`);
    }
  }
  if (frame.expand === 'templates') await page.evaluate(`document.querySelector('.template-help').open = true`);
  if (frame.expand === 'details') await page.evaluate(`document.getElementById('status-details').open = true`);
  const shot = await page.send('Page.captureScreenshot', { format: 'png' });
  const png = Buffer.from(shot.result.data, 'base64');
  const [pngWidth, pngHeight] = [png.readUInt32BE(16), png.readUInt32BE(20)];
  if (pngWidth !== width || pngHeight !== height) {
    throw new Error(`${frame.name}: expected ${width}x${height} at device scale 1, got ${pngWidth}x${pngHeight}`);
  }
  await writeFile(destination, png);
  console.log(`${frame.name}: ${pngWidth}x${pngHeight}, ${png.length} bytes`);
  return { name: frame.name, width: pngWidth, height: pngHeight, bytes: png.length, sha256: createHash('sha256').update(png).digest('hex'), zoom };
}

export function launcherReadmeFrame(theme: 'dark' | 'light' = 'dark'): Frame {
  return { name: `readme-${theme}-en-1280`, theme, lang: 'en', size: [1280, 820], covers: 'visible' };
}

// 2026-11-09: README captures must follow release versions without changing the launcher's standalone browser mock.
export async function captureLauncherReadme(destination: string, theme: 'dark' | 'light' = 'dark'): Promise<Shot> {
  const root = path.join(here, '..');
  const [deckmate, desktop] = await Promise.all(['package.json', 'desktop/package.json'].map(async file =>
    JSON.parse(await readFile(path.join(root, file), 'utf8')) as { version: string }));
  const page = await openHeadlessBrowser({ width: 1280, height: 820, scale: 1 });
  const preview = await startPreview();
  try {
    const source = String.raw`(() => {
      const now = Date.now();
      const recent = [
        { path: 'D:\\Projects\\Moonwake Studio', name: 'Moonwake Studio', lastOpened: new Date(now - 90e3).toISOString() },
        { path: 'D:\\Projects\\Hollow Signal', name: 'Hollow Signal', lastOpened: new Date(now - 5 * 3600e3).toISOString() },
        { path: 'D:\\Projects\\Harbor Tools', name: 'Harbor Tools', lastOpened: new Date(now - 3 * 86400e3).toISOString() },
      ];
      const workspace = [
        { path: recent[2].path, name: recent[2].name, missing: false },
      ];
      window.deckmateDesktop = {
        async getState() { return { ok: true, current: null, recent, projects: workspace, lastProject: recent[0].path, version: ${JSON.stringify(desktop.version)}, deckmateVersion: ${JSON.stringify(deckmate.version)}, locale: 'en-US' }; },
        async chooseFolder() { return 'D:\\Projects\\New Deck'; },
        async openProject() { return { ok: false, code: 'missing' }; },
        async createProject() { return { ok: false, code: 'not-empty' }; },
        async removeRecent() { return { ok: true }; },
        async setLanguage() { return { ok: true }; },
        async setTheme() { return { ok: true }; },
        onStatus() { return () => {}; },
      };
    })()`;
    // 2026-11-09: layout-capture rejects CDP error replies, so a failed registration arrives as a rejection.
    try {
      await page.send('Page.addScriptToEvaluateOnNewDocument', { source });
    } catch (error) {
      throw new Error(`Cannot register launcher bridge: ${error instanceof Error ? error.message : String(error)}`);
    }
    await navigateAndWait(page, 'initial load', preview.url);
    // A full-size CSS viewport keeps the decorative covers above the compact-height breakpoint.
    const shot = await captureFrame(page, launcherReadmeFrame(theme), destination, preview.url);
    const projectsFit = await page.evaluate(`(() => {
      const sections = document.querySelector('.project-sections').getBoundingClientRect();
      return [...document.querySelectorAll('.mission-control-workspace-open')].every(row => {
        const bounds = row.getBoundingClientRect();
        return bounds.top >= sections.top && bounds.bottom <= sections.bottom;
      });
    })()`);
    if (!projectsFit) throw new Error('README launcher cuts off a project row.');
    const footer = await page.evaluate('document.getElementById("version").textContent');
    const expected = deckmate.version === desktop.version ? `Deckmate ${deckmate.version}` : `Deckmate ${deckmate.version} · Desktop ${desktop.version}`;
    if (footer !== expected) throw new Error(`Unexpected launcher version: ${footer}`);
    if (page.consoleErrors.length) throw new Error(`console errors during capture: ${page.consoleErrors.join(' | ')}`);
    return shot;
  } finally {
    await page.close();
    await preview.server.close();
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--readme')) {
    await captureLauncherReadme(path.join(here, '..', 'docs', 'screenshots', 'desktop-start.png'));
    return;
  }
  const page = await openHeadlessBrowser({ width: frames[0].size[0], height: frames[0].size[1], scale: 1 });
  const preview = await startPreview();
  try {
    await mkdir(output, { recursive: true });
    await navigateAndWait(page, 'initial load', preview.url);
    await verifyControlStates(page, preview.url);
    const shots: Shot[] = [];
    const filter = process.env.DECKMATE_LAUNCHER_CAPTURE_FILTER;
    for (const frame of frames.filter(frame => !filter || new RegExp(filter).test(frame.name))) shots.push(await captureFrame(page, frame, path.join(output, `${frame.name}.png`), preview.url));
    await sleep(300);
    if (page.consoleErrors.length) throw new Error(`console errors during capture: ${page.consoleErrors.join(' | ')}`);
    const report = { capturedAt: new Date().toISOString(), page: 'client/desktop/index.html (Vite serve)', deviceScaleFactor: 1, frames: shots };
    await writeFile(path.join(output, 'frames.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`frames.json: ${shots.length} frames, ${shots.reduce((total, entry) => total + entry.bytes, 0)} bytes of PNG`);
  } finally {
    await page.close();
    await preview.server.close();
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) await main();
