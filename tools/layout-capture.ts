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
// 2026-11-12: captures and tests use one driver so process ownership, CDP deadlines and isolation cannot drift.
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openHeadlessBrowser, type HeadlessPage } from './headless-browser.ts';
export { connectToHeadlessBrowser, findHeadlessBrowser, openHeadlessBrowser, type HeadlessPage, type HeadlessBrowserOptions } from './headless-browser.ts';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

async function main(): Promise<void> {
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

  let page: HeadlessPage;
  try { page = await openHeadlessBrowser({ width, height, scale }); }
  catch (error) { console.error(error instanceof Error ? error.message : error); process.exit(2); }
  let mouseHeld = false;
  let mousePoint = { x: 0, y: 0 };
  async function capture(destination: string) {
    const tree = await page.evaluate(walker);
    mkdirSync(path.dirname(path.resolve(destination)), { recursive: true });
    writeFileSync(destination + '.json', tree);
    const shot = await page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(destination + '.png', Buffer.from(shot.result.data, 'base64'));
    console.log('saved ' + destination + '.json and .png');
  }

  try {
    if (colorScheme) await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: colorScheme }] });
    const preload = option('preload');
    if (preload) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: readFileSync(preload, 'utf8') });
    await page.send('Page.navigate', { url });
    await sleep(settle);
    for (const step of steps) {
      if (step.startsWith('wait:')) await sleep(Number(step.slice(5)));
      else if (step.startsWith('click:')) { console.log(await page.evaluate(clicker(step.slice(6)))); await sleep(700); }
      else if (step.startsWith('eval:')) console.log(await page.evaluate(step.slice(5)));
      // 2026-11-05: CDP input keeps the real pointer held for a mid-drag capture; DOM PointerEvents do not drive @dnd-kit faithfully.
      else if (step.startsWith('capture:')) await capture(step.slice(8));
      else if (step === 'mouse-down' || step === 'mouse-up') {
        mouseHeld = step === 'mouse-down';
        await page.send('Input.dispatchMouseEvent', { type: mouseHeld ? 'mousePressed' : 'mouseReleased', ...mousePoint, button: 'left', buttons: mouseHeld ? 1 : 0, clickCount: 1 });
        await sleep(100);
      }
      else if (step.startsWith('key:')) {
        const key = step.slice(4);
        const codes: Record<string, number> = { Enter: 13, Escape: 27, Space: 32, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39 };
        // 2026-11-06: Enter needs its character event as well as the key code for native button activation in Chromium.
        for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: key === 'Space' ? ' ' : key, code: key, windowsVirtualKeyCode: codes[key], text: type === 'keyDown' && key === 'Enter' ? '\r' : undefined });
        await sleep(150);
      }
      // hover:<selector>@<x>,<y> — the real mouse moves to that fraction of the element (0..1), so :hover and pointer handlers run.
      else if (step.startsWith('hover:')) {
        const [selector, at = '.5,.5'] = step.slice(6).split('@');
        const [fx, fy] = at.split(',').map(Number);
        const point = await page.callFunction(`(selector, scroll, fx, fy) => { const el = document.querySelector(selector); if (!el) return null;
          if (scroll) el.scrollIntoView({ block: 'center', behavior: 'instant' });
          const r = el.getBoundingClientRect(); return { x: r.x + r.width * fx, y: r.y + r.height * fy }; }`, selector, !mouseHeld, fx, fy);
        if (!point) console.log('not found: ' + selector);
        // Several moves on the way in: pointermove handlers that ease toward the pointer see a real path, not one jump.
        else for (let index = 1; index <= 6; index += 1) { mousePoint = { x: point.x - (6 - index) * 4, y: point.y - (6 - index) * 3 }; await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...mousePoint, buttons: mouseHeld ? 1 : 0 }); await sleep(30); }
        await sleep(700);
      }
    }
    const tree = await page.evaluate(walker);
    mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    writeFileSync(out + '.json', tree);
    const clipSelector = option('clip');
    const clip = clipSelector ? await page.callFunction(`selector => { const el = document.querySelector(selector); if (!el) return null;
      const r = el.getBoundingClientRect(); return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, innerWidth), height: Math.min(r.height, innerHeight), scale: 1 }; }`, clipSelector) : null;
    if (clipSelector && !clip) console.log('clip not found: ' + clipSelector + ' — saving the whole viewport');
    const shot = await page.send('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' });
    writeFileSync(out + '.png', Buffer.from(shot.result.data, 'base64'));
    console.log(`saved ${out}.json (${tree.length} bytes) and ${out}.png${clip ? ` (clip ${Math.round(clip.width)}x${Math.round(clip.height)})` : ''}`);
    console.log(`console errors: ${page.consoleErrors.length}${page.consoleErrors.length ? ' — ' + page.consoleErrors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await page.close();
  }
}

// Only a direct run (node tools/layout-capture.ts) captures; tools/launcher-capture.ts imports the harness instead.
const invokedDirectly = () => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
};

if (invokedDirectly()) await main();
