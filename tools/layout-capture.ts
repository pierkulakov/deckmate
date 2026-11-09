// Layout capture for UI parity work: opens a page in headless Edge/Chrome, optionally clicks through to a view,
// then saves a layout tree (boxes + computed styles) and a PNG for numerical layout comparisons.
//
//   npm run capture -- --url "http://127.0.0.1:4320/?view=deck&catalogSource=sandbox" --out tmp/overview
//   npm run capture -- --url ... --step "click:Characters, Asset" --step "wait:800" --out tmp/deck-open
//
// --step click:<text> clicks the first visible element whose aria-label or own text starts with <text>.
// Writes <out>.json and <out>.png. Viewport defaults to 1700x1000 at DPR 1.5 for consistent comparisons.
// Economy (2026-11-04): --clip <css selector> saves only that element's box; --dpr 1 for looking, not for parity numbers.
// Console errors and uncaught exceptions are counted from the first navigation and printed, so a look is needed only when numbers say so.
import { spawn } from 'node:child_process';
import { environmentValue } from '../server/environment.ts';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const option = (name: string, fallback?: string) => { const index = argv.indexOf('--' + name); return index >= 0 ? argv[index + 1] : fallback; };
const steps: string[] = option('steps') ? JSON.parse(readFileSync(option('steps')!, 'utf8')) : argv.flatMap((value, index) => argv[index - 1] === '--step' ? [value] : []);
const url = option('url');
const out = option('out');
if (!url || !out) { console.error('Usage: npm run capture -- --url <url> --out <path-without-ext> [--step click:<text>] [--step wait:<ms>]'); process.exit(2); }
const width = Number(option('width', '1700'));
const height = Number(option('height', '1000'));
const scale = Number(option('dpr', '1.5'));
const settle = Number(option('wait', '1500'));
const colorScheme = option('color-scheme');
if (colorScheme && colorScheme !== 'dark' && colorScheme !== 'light') throw new Error('--color-scheme must be dark or light');

const browsers = [environmentValue('BROWSER'), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
const browser = browsers.find(candidate => candidate && existsSync(candidate));
if (!browser) { console.error('No Edge/Chrome found; set DECKMATE_BROWSER.'); process.exit(2); }

const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(path.join(tmpdir(), 'deckmate-capture-'));
const child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
// 2026-11-04: finally does not run when only this process is killed (TaskStop, an agent's timeout) and the headless tree stayed
// alive; a detached watchdog waits for this process and ends the browser tree, checking the PID still belongs to a browser.
if (process.platform === 'win32' && child.pid) {
  const watch = 'Wait-Process -Id ' + process.pid + ' -ErrorAction SilentlyContinue; $b = Get-Process -Id ' + child.pid + " -ErrorAction SilentlyContinue; if ($b -and $b.ProcessName -match 'msedge|chrome') { taskkill /T /F /PID " + child.pid + ' | Out-Null }';
  spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', watch], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

async function target(): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
      const page = list.find(item => item.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* browser still starting */ }
    await sleep(200);
  }
  throw new Error('Browser did not expose a page target');
}

// Keep the tree format stable so captures remain comparable.
const walker = String.raw`(() => {
  const R = n => Math.round(n * 10) / 10;
  const keep = ['backgroundColor','color','fontSize','fontWeight','fontFamily','lineHeight','letterSpacing','textTransform','borderRadius','borderTopWidth','borderTopColor','borderLeftWidth','borderLeftColor','boxShadow','paddingTop','paddingRight','paddingBottom','paddingLeft','gap','opacity','backgroundImage','display','flexDirection','position','cursor','transform','filter','transition'];
  const defaults = {backgroundColor:'rgba(0, 0, 0, 0)',borderRadius:'0px',borderTopWidth:'0px',borderLeftWidth:'0px',boxShadow:'none',paddingTop:'0px',paddingRight:'0px',paddingBottom:'0px',paddingLeft:'0px',gap:'normal',opacity:'1',backgroundImage:'none',position:'static',cursor:'auto',transform:'none',filter:'none',letterSpacing:'normal',textTransform:'none',transition:'all 0s ease 0s'};
  const inherit = ['color','fontSize','fontWeight','fontFamily','lineHeight','cursor','letterSpacing','textTransform'];
  const walk = (el, depth, ps) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'contents') { const kids = []; for (const ch of el.children) { const k = walk(ch, depth + 1, ps); if (k) kids.push(k); } return kids.length ? { t: el.tagName.toLowerCase(), b: [0, 0, 0, 0], contents: true, k: kids } : null; }
    const r = el.getBoundingClientRect();
    // 2026-11-04: some apps put modals into a zero-size container — keep the children of tiny boxes, drop only the box itself.
    if (r.width < 4 || r.height < 4) { if (depth >= 50) return null; const kids = []; for (const ch of el.children) { const k = walk(ch, depth + 1, ps); if (k) kids.push(k); } return kids.length ? { t: el.tagName.toLowerCase(), b: [R(r.x), R(r.y), R(r.width), R(r.height)], tiny: true, k: kids } : null; }
    if (r.bottom < -50 || r.top > innerHeight * 1.5) return null;
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    const s = {};
    for (const k of keep) { const v = cs[k]; if (defaults[k] === v) continue; if (k === 'borderTopColor' && cs.borderTopWidth === '0px') continue; if (k === 'borderLeftColor' && cs.borderLeftWidth === '0px') continue; if (ps && inherit.includes(k) && ps[k] === v) continue; s[k] = k === 'backgroundImage' ? v.slice(0, 160) : (k === 'transition' ? v.slice(0, 120) : v); }
    const node = { t: el.tagName.toLowerCase(), b: [R(r.x), R(r.y), R(r.width), R(r.height)] };
    const cls = typeof el.className === 'string' ? el.className : ''; if (cls) node.c = cls.slice(0, 100);
    const aria = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('data-tooltip'); if (aria) node.a = aria.slice(0, 60);
    if (Object.keys(s).length) node.s = s;
    const txt = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim(); if (txt) node.x = txt.slice(0, 70);
    if (el.tagName === 'svg' || el.tagName === 'IMG') { if (el.tagName === 'IMG') node.src = (el.currentSrc || '').slice(-80); return node; }
    if (depth < 50) { const kids = []; for (const ch of el.children) { const k = walk(ch, depth + 1, cs); if (k) kids.push(k); } if (kids.length) node.k = kids; }
    return node;
  };
  return JSON.stringify({ url: location.href, vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio, at: new Date().toISOString(), scrollY, tree: walk(document.body, 0, null) });
})()`;

const clicker = (text: string) => `(() => {
  const wanted = ${JSON.stringify(text)};
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const own = el => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim();
  const el = [...document.querySelectorAll('button, a, [role=button], [role=tab], input, label, span, div, h1, h2, h3, strong')]
    .find(el => visible(el) && ((el.getAttribute('aria-label') || '').startsWith(wanted) || own(el).startsWith(wanted)));
  if (!el) return 'not found: ' + wanted;
  (el.closest('button, a, [role=button], [role=tab]') || el).click();
  return 'clicked: ' + wanted;
})()`;

let socket: WebSocket | undefined;
try {
  socket = new WebSocket(await target());
  await new Promise(resolve => socket!.addEventListener('open', resolve, { once: true }));
  let sequence = 0;
  let executionContextId: number | undefined;
  const pending = new Map<number, (value: any) => void>();
  const consoleErrors: string[] = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.executionContextCreated' && message.params.context.auxData?.isDefault)
      executionContextId = message.params.context.id;
    if (message.id && pending.has(message.id)) { pending.get(message.id)!(message); pending.delete(message.id); return; }
    if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(String(message.params?.exceptionDetails?.exception?.description ?? message.params?.exceptionDetails?.text ?? 'exception').split('\n')[0]);
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') consoleErrors.push((message.params.args ?? []).map((arg: { value?: unknown; description?: string }) => String(arg.value ?? arg.description ?? '')).join(' ').slice(0, 200));
  });
  const send = (method: string, params: object = {}) => new Promise<any>(resolve => { const id = ++sequence; pending.set(id, resolve); socket!.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression: string) => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text);
    return response.result?.result?.value;
  };
  // 2026-11-09: values cross into the page as callFunctionOn arguments, not as text baked into the evaluated code
  // (CodeQL js/bad-code-sanitization flags JSON.stringify interpolation).
  const callFunction = async (functionDeclaration: string, ...args: unknown[]) => {
    const response = await send('Runtime.callFunctionOn', { functionDeclaration, executionContextId,
      arguments: args.map(value => ({ value })), returnByValue: true, awaitPromise: true });
    if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text);
    return response.result?.result?.value;
  };
  let mouseHeld = false;
  let mousePoint = { x: 0, y: 0 };
  async function capture(destination: string) {
    const tree = await evaluate(walker);
    mkdirSync(path.dirname(path.resolve(destination)), { recursive: true });
    writeFileSync(destination + '.json', tree);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(destination + '.png', Buffer.from(shot.result.data, 'base64'));
    console.log('saved ' + destination + '.json and .png');
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
  if (colorScheme) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: colorScheme }] });
  await send('Page.navigate', { url });
  await sleep(settle);
  for (const step of steps) {
    if (step.startsWith('wait:')) await sleep(Number(step.slice(5)));
    else if (step.startsWith('click:')) { console.log(await evaluate(clicker(step.slice(6)))); await sleep(700); }
    else if (step.startsWith('eval:')) console.log(await evaluate(step.slice(5)));
    // 2026-11-05: CDP input keeps the real pointer held for a mid-drag capture; DOM PointerEvents do not drive @dnd-kit faithfully.
    else if (step.startsWith('capture:')) await capture(step.slice(8));
    else if (step === 'mouse-down' || step === 'mouse-up') {
      mouseHeld = step === 'mouse-down';
      await send('Input.dispatchMouseEvent', { type: mouseHeld ? 'mousePressed' : 'mouseReleased', ...mousePoint, button: 'left', buttons: mouseHeld ? 1 : 0, clickCount: 1 });
      await sleep(100);
    }
    else if (step.startsWith('key:')) {
      const key = step.slice(4);
      const codes: Record<string, number> = { Enter: 13, Escape: 27, Space: 32, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39 };
      // 2026-11-06: Enter needs its character event as well as the key code for native button activation in Chromium.
      for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: key === 'Space' ? ' ' : key, code: key, windowsVirtualKeyCode: codes[key], text: type === 'keyDown' && key === 'Enter' ? '\r' : undefined });
      await sleep(150);
    }
    // hover:<selector>@<x>,<y> — the real mouse moves to that fraction of the element (0..1), so :hover and pointer handlers run.
    else if (step.startsWith('hover:')) {
      const [selector, at = '.5,.5'] = step.slice(6).split('@');
      const [fx, fy] = at.split(',').map(Number);
      const point = await callFunction(`(selector, scroll, fx, fy) => { const el = document.querySelector(selector); if (!el) return null;
        if (scroll) el.scrollIntoView({ block: 'center', behavior: 'instant' });
        const r = el.getBoundingClientRect(); return { x: r.x + r.width * fx, y: r.y + r.height * fy }; }`, selector, !mouseHeld, fx, fy);
      if (!point) console.log('not found: ' + selector);
      // Several moves on the way in: pointermove handlers that ease toward the pointer see a real path, not one jump.
      else for (let index = 1; index <= 6; index += 1) { mousePoint = { x: point.x - (6 - index) * 4, y: point.y - (6 - index) * 3 }; await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...mousePoint, buttons: mouseHeld ? 1 : 0 }); await sleep(30); }
      await sleep(700);
    }
  }
  const tree = await evaluate(walker);
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  writeFileSync(out + '.json', tree);
  const clipSelector = option('clip');
  const clip = clipSelector ? await callFunction(`selector => { const el = document.querySelector(selector); if (!el) return null;
    const r = el.getBoundingClientRect(); return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, innerWidth), height: Math.min(r.height, innerHeight), scale: 1 }; }`, clipSelector) : null;
  if (clipSelector && !clip) console.log('clip not found: ' + clipSelector + ' — saving the whole viewport');
  const shot = await send('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' });
  writeFileSync(out + '.png', Buffer.from(shot.result.data, 'base64'));
  console.log(`saved ${out}.json (${tree.length} bytes) and ${out}.png${clip ? ` (clip ${Math.round(clip.width)}x${Math.round(clip.height)})` : ''}`);
  console.log(`console errors: ${consoleErrors.length}${consoleErrors.length ? ' — ' + consoleErrors.slice(0, 3).join(' | ') : ''}`);
} finally {
  // 2026-11-04: child.kill() on Windows ends only the launcher; the headless browser tree stayed alive (98 orphans, 10 GB).
  // Ask the browser to close over CDP first, then kill the whole process tree.
  if (socket && socket.readyState === WebSocket.OPEN) {
    try { socket.send(JSON.stringify({ id: 1_000_000, method: 'Browser.close' })); } catch { /* the page may already be gone */ }
    await sleep(500);
  }
  socket?.close();
  if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' });
  else child.kill();
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* the browser may still hold the profile briefly */ }
}
