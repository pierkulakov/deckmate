// Renders the launcher page in hidden Electron windows and saves PNG frames for design review.
// Run: node_modules\electron\dist\electron.exe capture\capture-launcher.mjs  (2026-11-08)
import { app, BrowserWindow } from 'electron';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const page = path.join(here, '..', 'launcher', 'index.html');
const out = path.join(here, 'out');

const frames = [
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

const FOCUS_TARGETS = {
  'focus-open': '#open-folder',
  'focus-row': '.recent-open',
};
const MAX_TAB_PRESSES = 12;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Frames at 1 CSS px per device px, whatever the monitor's scale is.
app.commandLine.appendSwitch('force-device-scale-factor', '1');

let win = null;

// Polls a page-side predicate until it returns true or the timeout passes.
async function pollPage(expression, timeoutMs, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await win.webContents.executeJavaScript(expression)) return true;
    await sleep(intervalMs);
  }
  return false;
}

// Waits until the launcher finished its first render and fonts are loaded.
async function waitForPageReady() {
  const busyCleared = await pollPage(
    `!document.getElementById('launcher').hasAttribute('aria-busy')`, 5000,
  );
  if (!busyCleared) console.warn('warning: launcher still aria-busy after 5 s');
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
}

// Moves keyboard focus with real Tab key events, so :focus-visible matches a user's focus.
async function tabUntilFocused(selector, frameName) {
  await win.webContents.focus();
  const matches = `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return !!el && document.activeElement === el; })()`;
  for (let press = 0; press < MAX_TAB_PRESSES; press++) {
    if (await win.webContents.executeJavaScript(matches)) return;
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    await sleep(50);
  }
  if (!(await win.webContents.executeJavaScript(matches))) {
    console.warn(`warning: ${frameName}: ${selector} not focused after ${MAX_TAB_PRESSES} Tab presses`);
  }
}

async function capture(frame) {
  const [width, height] = frame.size;
  if (!win) {
    win = new BrowserWindow({
      show: false, width, height, useContentSize: true, backgroundColor: '#322f40',
      webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false },
    });
    await win.loadFile(page);
  }
  win.setContentSize(width, height);
  await win.webContents.executeJavaScript(`localStorage.setItem('deckmate-theme', ${JSON.stringify(frame.theme)}); localStorage.setItem('deckmate-language', ${JSON.stringify(frame.lang)});`);
  await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.webContents.reload(); });
  // A hidden window never advances compositor animations, so the frames show the settled state directly.
  await win.webContents.insertCSS('*, *::before, *::after { animation: none !important; transition: none !important; }');
  await waitForPageReady();

  const state = frame.state ?? 'list';
  await win.webContents.executeJavaScript(`(async () => {
    document.getAnimations().forEach(a => a.finish());
    const state = ${JSON.stringify(state)};
    if (state === 'empty') {
      document.getElementById('recent-list').replaceChildren();
      document.getElementById('recent-empty').hidden = false;
      document.getElementById('recent-count').hidden = true;
    }
    if (state === 'error') document.getElementById('open-folder').click();
    if (state === 'hover-row') document.querySelectorAll('.recent-item')[1].classList.add('is-hover-demo');
  })()`);

  if (state === 'error') {
    const failed = await pollPage(`document.getElementById('status').dataset.phase === 'error'`, 4000, 50);
    if (!failed) console.warn(`warning: ${frame.name}: status phase is not 'error' after 4 s`);
  }
  if (FOCUS_TARGETS[state]) await tabUntilFocused(FOCUS_TARGETS[state], frame.name);

  await sleep(250);
  if (state === 'hover-row') {
    await win.webContents.insertCSS('.recent-item.is-hover-demo .recent-open { background: var(--surface); } .recent-item.is-hover-demo .recent-remove { opacity: 1; }');
    await sleep(150);
  }
  // A hidden window keeps the last bitmap until it is repainted, so ask for a fresh frame first.
  win.webContents.invalidate();
  await sleep(300);
  win.setContentSize(width, height + 1);
  await sleep(200);
  win.setContentSize(width, height);
  await sleep(700);
  const image = await win.webContents.capturePage();
  await writeFile(path.join(out, `${frame.name}.png`), image.toPNG());
  console.log(`saved ${frame.name}.png ${image.getSize().width}x${image.getSize().height}`);
}

app.whenReady().then(async () => {
  await mkdir(out, { recursive: true });
  for (const frame of frames) await capture(frame);
  for (const frame of frames) {
    const digest = createHash('md5').update(await readFile(path.join(out, `${frame.name}.png`))).digest('hex');
    console.log(`md5 ${frame.name}.png ${digest}`);
  }
  win?.destroy();
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
