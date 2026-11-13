import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/app.ts';
import { initializeDemo } from '../server/demo.ts';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';
import { waitForLayout } from './browser-layout.ts';
import { freePort } from './free-port.ts';
import { readDurationMs } from '../client/motion.ts';

const browserPath = requireBrowser();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe.skipIf(!browserPath)('Hand navigation history (browser)', () => {
  let temporary: string;
  let app: FastifyInstance | undefined;
  let vite: ViteDevServer | undefined;
  let page: HeadlessPage | undefined;
  let origin: string;
  const previousIndex = process.env.DECKMATE_INDEX;

  async function until(expression: string) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await page!.evaluate(expression)) return;
      await delay(25);
    }
    throw new Error('Timed out: ' + expression + '\n' + page!.consoleErrors.join('\n'));
  }

  async function open(width: number, query = '') {
    await page!.send('Emulation.setDeviceMetricsOverride', { width, height: width === 375 ? 812 : 600, deviceScaleFactor: 1, mobile: false });
    await page!.send('Page.navigate', { url: `${origin}/?view=hand&catalogSource=sandbox&handMember=maya${query}` });
    await until(`Boolean(document.querySelector('#hand-tab-runs'))`);
    await page!.evaluate('document.fonts.ready');
    await waitForLayout(page!.evaluate, '.hand-view');
    await page!.evaluate(`history.scrollRestoration = 'manual'`);
  }

  beforeAll(async () => {
    temporary = await mkdtemp(path.join(tmpdir(), 'deckmate-hand-navigation-'));
    process.env.DECKMATE_INDEX = path.join(temporary, 'index');
    const root = path.join(temporary, 'project');
    await initializeDemo(root);
    const port = await freePort();
    app = await createApp({ editMode: 'direct', dataRoot: root, writeRoot: root, projectName: 'Moonwake Studio', port, python: 'python' });
    await app.listen({ host: '127.0.0.1', port });
    const target = `http://127.0.0.1:${port}`;
    vite = await createServer({ configFile: 'app.vite.config.ts', cacheDir: path.join(temporary, 'vite'), logLevel: 'error',
      server: { port: 0, proxy: {
        '^/api/': { target, changeOrigin: true, ws: true, configure(proxy) {
          proxy.on('proxyReq', request => request.setHeader('origin', target));
          proxy.on('proxyReqWs', request => request.setHeader('origin', target));
        } },
        '^/r/': { target, changeOrigin: true },
      } } });
    await vite.listen();
    origin = vite.resolvedUrls!.local[0].replace(/\/$/u, '');
    page = await openHeadlessBrowser({ width: 375, height: 812, scale: 1 });
  }, 120000);

  afterAll(async () => {
    await page?.close();
    await vite?.close();
    await app?.close();
    if (previousIndex === undefined) delete process.env.DECKMATE_INDEX; else process.env.DECKMATE_INDEX = previousIndex;
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }, 30000);

  it.each(['due', 'runs', 'milestone', 'bookmarks', 'team'])('opens linked %s without scrolling', async tab => {
    await open(375, `&handTab=${tab}`);
    expect(await page!.callFunction(`function(tab) { return document.querySelector('#hand-tab-' + tab).getAttribute('aria-selected'); }`, tab)).toBe('true');
    expect(await page!.evaluate(`document.querySelector('.workspace-main').scrollTop`)).toBe(0);
  });

  it.each(['invalid', '', 'RUNS'])('falls back to Bookmarks for invalid linked tab %j', async tab => {
    await open(375, `&handTab=${tab}`);
    expect(await page!.evaluate(`document.querySelector('#hand-tab-bookmarks').getAttribute('aria-selected')`)).toBe('true');
    const result = await page!.evaluate(`({ top: document.querySelector('.workspace-main').scrollTop, state: history.state })`);
    expect(result.top, JSON.stringify(result)).toBe(0);
  });

  it.each([375, 1440])('Team Hands share the deck footprint, metric bands and slot numbers at %i px', async width => {
    await open(width, '&handTab=team');
    for (const dark of [true, false]) {
      await page!.evaluate(`document.documentElement.classList.toggle('dark', ${dark})`);
      const result = await page!.evaluate(`(() => {
        const panel = document.querySelector('#hand-tab-panel');
        const tiles = [...panel.querySelectorAll('.deck-card')];
        return { count: tiles.length, old: panel.querySelectorAll('.sprint-task').length,
          overflow: panel.scrollWidth > panel.clientWidth,
          badTiles: tiles.filter(tile => { const box = tile.getBoundingClientRect(); return box.width !== 115 || box.height !== 147; }).length,
          badBands: tiles.filter(tile => tile.querySelector('.deck-card-band').getBoundingClientRect().height !== (tile.classList.contains('catalog-card-hero') ? 29 : 24)).length,
          hero: panel.querySelector('.catalog-card-hero .deck-card-metrics').textContent,
          slot: panel.querySelector('.catalog-card-hero .card-hand-number').textContent,
          handSlot: document.querySelector('.hand-slot .catalog-card-hero .card-hand-number').textContent,
          metadataInside: panel.querySelectorAll('.deck-card .hand-team-card-meta').length,
          medallions: panel.querySelectorAll('.deck-card-owner-medallion').length };
      })()`);
      expect(result.count).toBeGreaterThan(7);
      expect(result.old).toBe(0);
      expect(result.overflow).toBe(false);
      expect(result.badTiles).toBe(0);
      expect(result.badBands).toBe(0);
      expect(result.hero).toContain('13');
      expect(result.slot).toBe(result.handSlot);
      expect(result.metadataInside).toBe(0);
      expect(result.medallions).toBeGreaterThan(0);
    }
    await page!.evaluate(`document.querySelector('#hand-tab-panel .deck-card-open').click()`);
    await until(`Boolean(document.querySelector('.card-preview'))`);
    expect(page!.consoleErrors).toEqual([]);
  });

  it.each([375, 1440])('returns to the selected Run tab and scroll position at %i px', async width => {
    await open(width);
    await page!.evaluate(`history.replaceState({ preserved: 'yes' }, '', location.href); document.querySelector('#hand-tab-runs').click()`);
    await until(`document.querySelector('#hand-tab-runs').getAttribute('aria-selected') === 'true'`);
    await delay(300);
    if (width === 375) expect(await page!.evaluate(`document.querySelector('.workspace-main').scrollTop`)).toBeGreaterThan(0);
    expect(await page!.evaluate(`new URL(location.href).searchParams.get('handTab')`)).toBe('runs');
    expect(await page!.evaluate(`history.state.preserved`)).toBe('yes');
    const before = await page!.evaluate(`(() => {
      const scrollport = document.querySelector('.workspace-main');
      scrollport.scrollTo({ top: scrollport.scrollHeight - scrollport.clientHeight - 20, behavior: 'instant' });
      return scrollport.scrollTop;
    })()`);
    expect(before).toBeGreaterThan(100);
    await page!.evaluate(`document.querySelector('[aria-labelledby="hand-tab-runs"] .hand-section-row').click()`);
    await until(`Boolean(document.querySelector('.card-preview'))`);
    expect(await page!.evaluate(`new URL(location.href).searchParams.get('handTab')`)).toBe('runs');
    await page!.evaluate('history.back()');
    await until(`Boolean(document.querySelector('.hand-view [role="tabpanel"]'))`);
    await waitForLayout(page!.evaluate, '.hand-view');
    await delay(200);
    expect(await page!.evaluate(`document.querySelector('#hand-tab-runs').getAttribute('aria-selected')`)).toBe('true');
    expect(await page!.evaluate(`document.querySelector('.hand-member-picker select').value`)).toBe('maya');
    expect(await page!.evaluate(`history.state.preserved`)).toBe('yes');
    expect(Math.abs(await page!.evaluate(`document.querySelector('.workspace-main').scrollTop`) - before)).toBeLessThanOrEqual(1);
    expect(page!.consoleErrors).toEqual([]);
  }, 30000);

  it('waits for a delayed catalog before restoring the saved position', async () => {
    await open(375, '&handTab=runs');
    const before = await page!.evaluate(`(() => {
      const scrollport = document.querySelector('.workspace-main');
      scrollport.scrollTo({ top: 900, behavior: 'instant' });
      return scrollport.scrollTop;
    })()`);
    expect(before).toBe(900);
    await page!.evaluate(`document.querySelector('[aria-labelledby="hand-tab-runs"] .hand-section-row').click()`);
    await until(`Boolean(document.querySelector('.card-preview'))`);
    await page!.evaluate('history.back()');
    await until(`Boolean(document.querySelector('#hand-tab-runs[aria-selected="true"]'))`);
    await page!.evaluate(`document.querySelector('.workspace-main').scrollTo({ top: 0, behavior: 'instant' })`);
    const script = await page!.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      const originalFetch = window.fetch;
      let release;
      const waiting = new Promise(resolve => { release = resolve; });
      window.releaseHandCatalog = release;
      window.fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (url.pathname === '/api/catalog' && (!init?.method || init.method === 'GET')) await waiting;
        return originalFetch(input, init);
      };
    })()` });
    try {
      await page!.send('Page.reload');
      await until(`Boolean(window.releaseHandCatalog && document.querySelector('.hand-view') && !document.querySelector('#hand-tab-runs'))`);
      await page!.evaluate('window.releaseHandCatalog()');
      await until(`Boolean(document.querySelector('#hand-tab-runs[aria-selected="true"]'))`);
      await until(`Math.abs(document.querySelector('.workspace-main').scrollTop - ${before}) <= 1`);
      await waitForLayout(page!.evaluate, '.hand-view');
      expect(await page!.evaluate(`document.querySelector('.workspace-main').scrollTop`)).toBe(before);
    } finally {
      await page!.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: script.result.identifier });
    }
  }, 30000);

  it('restores the earlier Hand entry when Back stays on the Hand view', async () => {
    await open(375, '&handTab=runs');
    await page!.evaluate(`(() => {
      document.querySelector('.workspace-main').scrollTo({ top: 900, behavior: 'instant' });
      document.querySelector('[aria-labelledby="hand-tab-runs"] .hand-section-row').click();
    })()`);
    await until(`Boolean(document.querySelector('.card-preview'))`);
    await page!.evaluate('history.back()');
    await until(`Boolean(document.querySelector('#hand-tab-runs[aria-selected="true"]'))`);
    await until(`document.querySelector('.workspace-main').scrollTop === 900`);
    await page!.evaluate(`document.querySelector('[aria-labelledby="hand-tab-runs"] .hand-section-row').click()`);
    await until(`Boolean(document.querySelector('.card-preview'))`);
    await page!.evaluate(`document.querySelector('.global-tabs button:first-child').click()`);
    await until(`Boolean(document.querySelector('#hand-tab-runs[aria-selected="true"]'))`);
    await page!.evaluate(`(() => {
      const picker = document.querySelector('.hand-member-picker select');
      picker.value = 'leo'; picker.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('#hand-tab-team').click();
    })()`);
    await until(`document.querySelector('#hand-tab-team').getAttribute('aria-selected') === 'true'`);
    await delay(300);
    await page!.evaluate('history.back()');
    await until(`new URLSearchParams(location.search).get('handMember') === 'maya'`);
    await delay(200);
    expect(await page!.evaluate(`document.querySelector('.hand-member-picker select').value`)).toBe('maya');
    expect(await page!.evaluate(`document.querySelector('#hand-tab-runs').getAttribute('aria-selected')`)).toBe('true');
    expect(await page!.evaluate(`document.querySelector('.workspace-main').scrollTop`)).toBe(900);
  }, 30000);

  it('cancels a pending restoration when the viewed member changes', async () => {
    await open(375, '&handTab=runs');
    await page!.callFunction(`async function() {
      const catalog = await (await fetch('/api/catalog?source=sandbox')).json();
      history.replaceState({ deckmateHandScroll: { project: catalog.rootIdentity, source: 'sandbox', member: 'maya', tab: 'runs', all: false, top: 900 } }, '', location.href);
      document.querySelector('.workspace-main').scrollTo({ top: 0, behavior: 'instant' });
    }`);
    const script = await page!.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      const ready = document.fonts.ready;
      const waiting = new Promise(resolve => { window.releaseHandFonts = () => ready.then(resolve); });
      Object.defineProperty(document.fonts, 'ready', { configurable: true, value: waiting });
    })()` });
    try {
      await page!.send('Page.reload');
      await until(`Boolean(window.releaseHandFonts && document.querySelector('#hand-tab-runs[aria-selected="true"]'))`);
      await page!.evaluate(`(() => {
        const picker = document.querySelector('.hand-member-picker select');
        picker.value = 'leo'; picker.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('.workspace-main').scrollTo({ top: 0, behavior: 'instant' });
        window.releaseHandFonts();
      })()`);
      await until(`document.querySelector('.hand-member-picker select').value === 'leo'`);
      await delay(200);
      expect(await page!.evaluate(`document.querySelector('.workspace-main').scrollTop`)).toBe(0);
      expect(await page!.evaluate(`history.state.deckmateHandScroll`)).toBeUndefined();
    } finally {
      await page!.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: script.result.identifier });
    }
  }, 30000);

  it.each(['project', 'source', 'member', 'tab', 'all'])('does not restore scroll from another %s context', async key => {
    await open(375, '&handTab=runs');
    await page!.callFunction(`async function(key) {
      const catalog = await (await fetch('/api/catalog?source=sandbox')).json();
      const wrong = { project: 'other-project', source: 'live', member: 'leo', tab: 'team', all: true };
      const saved = { project: catalog.rootIdentity, source: 'sandbox', member: 'maya', tab: 'runs', all: false, top: 900 };
      history.replaceState({ deckmateHandScroll: { ...saved, [key]: wrong[key] } }, '', location.href);
      document.querySelector('.workspace-main').scrollTo({ top: 0, behavior: 'instant' });
    }`, key);
    const script = await page!.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      const scrollTo = Element.prototype.scrollTo;
      window.handScrollCalls = [];
      Element.prototype.scrollTo = function(...args) {
        if (this.matches('.workspace-main')) window.handScrollCalls.push(args);
        return scrollTo.apply(this, args);
      };
    })()` });
    try {
      await page!.send('Page.reload');
      await until(`Boolean(document.querySelector('#hand-tab-runs[aria-selected="true"]'))`);
      await waitForLayout(page!.evaluate, '.hand-view');
      await delay(200);
      expect(await page!.evaluate('window.handScrollCalls')).toEqual([]);
    } finally {
      await page!.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: script.result.identifier });
    }
  }, 30000);

  it('preserves unrelated history state while changing Hand parameters', async () => {
    await open(375);
    await page!.evaluate(`(() => {
      history.replaceState({ preserved: 'yes' }, '', location.href);
      const picker = document.querySelector('.hand-member-picker select');
      picker.value = 'leo'; picker.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('#hand-tab-team').click();
      document.querySelector('.hand-all-toggle input').click();
    })()`);
    await until(`document.querySelector('.hand-member-picker select').value === 'leo'`);
    const state = await page!.evaluate(`({ url: location.href, preserved: history.state.preserved })`);
    const query = new URL(state.url).searchParams;
    expect(query.get('handMember')).toBe('leo');
    expect(query.get('handTab')).toBe('team');
    expect(query.get('hands')).toBe('all');
    expect(state.preserved).toBe('yes');
    await page!.evaluate(`localStorage.removeItem('deckmate-hand-all')`);
  });

  it.each([375, 768, 1440].flatMap(width => ['en', 'ru'].flatMap(lang => ['dark', 'light'].map(theme => ({ width, lang, theme })))))
  ('centers All Hands names and mirrors switch insets at $width px, $lang, $theme', async ({ width, lang, theme }) => {
    const preload = await page!.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      localStorage.setItem('deckmate-language', ${JSON.stringify(lang)});
      localStorage.setItem('deckmate-theme', ${JSON.stringify(theme)});
      localStorage.removeItem('deckmate-hand-all');
    ` });
    try {
      await open(width);
      await page!.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1.5, mobile: false });
      await waitForLayout(page!.evaluate, '.hand-all-track');
      expect(await page!.evaluate('document.documentElement.lang')).toBe(lang);
      expect(await page!.evaluate(`document.documentElement.classList.contains('dark')`)).toBe(theme === 'dark');
      const switchGeometry = () => page!.evaluate(`(() => {
        const track = document.querySelector('.hand-all-track').getBoundingClientRect();
        const thumb = document.querySelector('.hand-all-thumb').getBoundingClientRect();
        return { checked: document.querySelector('.hand-all-toggle input').checked,
          left: thumb.left - track.left, right: track.right - thumb.right,
          centerDelta: thumb.y + thumb.height / 2 - track.y - track.height / 2 };
      })()`);
      const off = await switchGeometry();
      expect(off.checked).toBe(false);
      await page!.evaluate(`document.querySelector('.hand-all-toggle input').click()`);
      await until(`Boolean(document.querySelector('.hand-all-member-heading'))`);
      await waitForLayout(page!.evaluate, '.hand-all-thumb, .hand-all-member-heading');
      const on = await switchGeometry();
      expect(on.checked).toBe(true);
      expect(off.left).toBeGreaterThan(0);
      expect(Math.abs(off.left - on.right)).toBeLessThanOrEqual(.1);
      for (const geometry of [off, on]) expect(Math.abs(geometry.centerDelta)).toBeLessThanOrEqual(.5);

      const headings = await page!.evaluate(`Array.from(document.querySelectorAll('.hand-all-member-heading'), heading => {
        const avatar = heading.querySelector('.card-owner-avatar').getBoundingClientRect();
        const name = heading.querySelector('h2');
        const range = document.createRange(); range.selectNodeContents(name);
        const text = range.getBoundingClientRect();
        return { name: name.textContent, avatarWidth: avatar.width, avatarHeight: avatar.height,
          nameHeight: name.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(name).lineHeight),
          centerDelta: text.y + text.height / 2 - avatar.y - avatar.height / 2 };
      })`);
      expect(headings.map((heading: { name: string }) => heading.name)).toEqual(expect.arrayContaining(['Maya Chen', 'Leo Park', 'Build Agent']));
      for (const heading of headings) {
        expect(heading.avatarWidth).toBe(28);
        expect(heading.avatarHeight).toBe(28);
        expect(heading.nameHeight).toBe(heading.lineHeight);
        expect(Math.abs(heading.centerDelta), JSON.stringify(heading)).toBeLessThanOrEqual(.5);
      }

      const longName = lang === 'ru' ? 'Отдел международного сотрудничества и развития цифровых технологий ' : 'International collaboration and digital technology development team ';
      const wrapped = await page!.callFunction(`function(label) {
        const heading = document.querySelector('.hand-all-member-heading');
        const name = heading.querySelector('h2'); name.textContent = label.repeat(8);
        const avatar = heading.querySelector('.card-owner-avatar').getBoundingClientRect();
        const text = name.getBoundingClientRect();
        const row = heading.getBoundingClientRect();
        return { lines: text.height / parseFloat(getComputedStyle(name).lineHeight), avatarWidth: avatar.width, avatarHeight: avatar.height,
          centerDelta: text.y + text.height / 2 - avatar.y - avatar.height / 2,
          fits: text.left >= avatar.right && text.right <= row.right && text.top >= row.top && text.bottom <= row.bottom,
          nextTop: heading.nextElementSibling.getBoundingClientRect().top, bottom: row.bottom,
          overflow: document.documentElement.scrollWidth > innerWidth || heading.scrollWidth > heading.clientWidth };
      }`, longName);
      expect(wrapped.lines).toBeGreaterThan(1);
      expect(wrapped.avatarWidth).toBe(28);
      expect(wrapped.avatarHeight).toBe(28);
      expect(Math.abs(wrapped.centerDelta)).toBeLessThanOrEqual(.5);
      expect(wrapped.fits).toBe(true);
      expect(wrapped.nextTop).toBeGreaterThanOrEqual(wrapped.bottom);
      expect(wrapped.overflow).toBe(false);

      await page!.evaluate(`document.querySelector('.hand-all-track').style.width = '40px'; document.querySelector('.hand-all-thumb').style.width = '12px'`);
      await waitForLayout(page!.evaluate, '.hand-all-thumb');
      const resizedOn = await switchGeometry();
      await page!.evaluate(`document.querySelector('.hand-all-toggle input').click()`);
      await waitForLayout(page!.evaluate, '.hand-all-thumb');
      const resizedOff = await switchGeometry();
      expect(Math.abs(resizedOff.left - resizedOn.right)).toBeLessThanOrEqual(.1);
      expect(page!.consoleErrors).toEqual([]);
    } finally {
      await page!.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: preload.result.identifier });
    }
  });
});

interface SourceDropFrame {
  x: number;
  progress: number;
  overlay: boolean;
  visible: boolean;
  duration: number;
}

interface NeighborSlideFrame {
  x: number;
  progress: number;
  motion: number | null;
  released: boolean;
}

interface NeighborSlideMotion {
  kind: 'sort' | 'settle';
  from: number;
  to: number;
  duration: number;
}

interface NeighborSlides {
  origin: number;
  target: number;
  frames: NeighborSlideFrame[];
  motions: NeighborSlideMotion[];
  release: NeighborSlideFrame | null;
}

describe.skipIf(!browserPath)('Hand pointer drag work (browser)', () => {
  let page: HeadlessPage | undefined;
  let motionDuration: number;
  afterEach(async () => {
    try {
      expect(page?.consoleErrors ?? []).toEqual([]);
      if (page) expect(await page.evaluate('window.handDragTest?.result().opened ?? []')).toEqual([]);
    }
    finally { await page?.close(); }
  });

  async function openHand({ reducedMotion = false, queue = false, readOnly = false, width = 1440 } = {}) {
    page = await openHeadlessBrowser({ width, height: 900, scale: 1 });
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' }] });
    const query = new URLSearchParams();
    if (queue) query.set('queue', '');
    if (readOnly) query.set('readonly', '');
    await page.send('Page.navigate', { url: browserFixtureUrl('hand-drag-performance') + (query.size ? '?' + query : '') });
    for (let attempt = 0; attempt < 300; attempt++) {
      if (await page.evaluate(`document.querySelectorAll('.hand-slots .hand-slot.is-filled').length === 7`)) break;
      await delay(50);
    }
    expect(await page.evaluate(`document.querySelectorAll('.hand-slots .hand-slot.is-filled').length`)).toBe(7);
    await waitForLayout(page.evaluate, '.hand-slots');
    motionDuration = await page.evaluate(`(${readDurationMs})('--motion-material')`);
    return page;
  }

  async function pointOf(selector: string) {
    return page!.callFunction(`function(selector) {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }`, selector);
  }

  async function waitFor(expression: string) {
    await page!.evaluate(`(async () => {
      const deadline = performance.now() + 5000;
      while (!(${expression})) {
        if (performance.now() > deadline) throw new Error('Timed out waiting for Hand state');
        await new Promise(requestAnimationFrame);
      }
    })()`);
  }

  async function recordSourceDrop() {
    await page!.evaluate(`(() => {
      const slot = document.querySelector('.hand-slot.is-drag-source');
      const start = performance.now();
      const frames = [];
      let stable = 0;
      window.handSourceDropFrames = new Promise((resolve, reject) => {
        function sample() {
          const face = document.querySelector('.card-drag-face');
          const source = face ?? slot;
          const motion = face?.parentElement.getAnimations().find(animation =>
            animation.effect.getKeyframes().some(key => key.transform));
          const style = getComputedStyle(source);
          frames.push({ x: source.getBoundingClientRect().left,
            progress: face ? motion?.effect.getComputedTiming().progress ?? 0 : 1,
            duration: motion?.effect.getComputedTiming().duration ?? 0,
            overlay: !!face, visible: source.isConnected && style.visibility === 'visible' && Number(style.opacity) >= .99 });
          stable = face ? 0 : stable + 1;
          if (stable >= 3) return resolve(frames);
          if (performance.now() - start > 5000) return reject(new Error('Source drop did not finish'));
          requestAnimationFrame(sample);
        }
        sample();
      });
    })()`);
  }

  function expectContinuousSourceDrop(frames: SourceDropFrame[]) {
    const start = frames[0].x;
    const end = frames.at(-1)!.x;
    expect(frames[0].overlay).toBe(true);
    expect(frames.at(-1)!.overlay).toBe(false);
    expect(start - end).toBeCloseTo(16, 1);
    // 2026-11-10: one long frame can span the whole effect; require its duration, not an intermediate frame count.
    expect(frames.some(frame => frame.duration === motionDuration), JSON.stringify(frames)).toBe(true);
    // 2026-11-10: a 33ms frame travels 10.4px along the same curve as a 16ms frame's 6.4px.
    // Subtract WAAPI's eased travel, not elapsed frame count, so a missing overlay or a handoff snap still fails.
    let previousError = 0;
    for (const frame of frames) {
      expect(frame.visible).toBe(true);
      if (frame.duration) expect(frame.duration).toBe(motionDuration);
      const error = frame.x - (start + (end - start) * frame.progress);
      expect(Math.abs(error), JSON.stringify(frame)).toBeLessThanOrEqual(1);
      expect(Math.abs(error - previousError), JSON.stringify(frame)).toBeLessThanOrEqual(1);
      previousError = error;
    }
  }

  async function recordHandDrag(pointerX: number) {
    await page!.callFunction(`function(pointerX) {
      window.handDragTest.reset();
      const recording = window.handDragTest.record(pointerX);
      const face = document.querySelector('.hand-slots [data-card-id="card:hand-1"]');
      const slot = face.closest('.hand-slot');
      const origin = face.getBoundingClientRect().left;
      const target = document.querySelector('.hand-slot.is-drag-source').getBoundingClientRect().left;
      const frames = [], motions = [], identities = new Map();
      let release = null, frame;
      // 2026-11-10: activation can transition from none to translate(0); that must not trigger an early release.
      const isSlide = animation => {
        const keys = animation.effect.getKeyframes();
        return keys[0].transform && keys.at(-1).transform
          && new DOMMatrixReadOnly(keys[0].transform).m41 !== new DOMMatrixReadOnly(keys.at(-1).transform).m41;
      };
      function sample() {
        const active = [slot, face].map(element => ({ element, animation: element.getAnimations().find(isSlide) }))
          .find(motion => motion.animation);
        const { element, animation } = active ?? {};
        const x = face.getBoundingClientRect().left;
        if (animation && !identities.has(animation)) {
          const keys = animation.effect.getKeyframes();
          const base = x - new DOMMatrixReadOnly(getComputedStyle(element).transform).m41;
          identities.set(animation, motions.length);
          motions.push({ kind: element === slot ? 'sort' : 'settle',
            from: base + new DOMMatrixReadOnly(keys[0].transform).m41,
            to: base + new DOMMatrixReadOnly(keys.at(-1).transform).m41,
            duration: animation.effect.getComputedTiming().duration });
        }
        const snapshot = { x, progress: animation?.effect.getComputedTiming().progress ?? 1,
          motion: animation ? identities.get(animation) : null, released: release !== null };
        frames.push(snapshot);
        return snapshot;
      }
      // 2026-11-10: the release coordinate must be read before React replaces the sortable transition with FLIP.
      const captureRelease = () => { release = sample(); };
      window.addEventListener('pointerup', captureRelease, true);
      const tick = () => { sample(); frame = requestAnimationFrame(tick); };
      tick();
      window.handDragRecording = {
        phase: value => recording.phase(value),
        whenSliding: () => new Promise(resolve => {
          function check() {
            const current = frames.at(-1);
            if (current.motion !== null && current.progress > 0 && current.progress < 1) {
              recording.phase('drop');
              resolve();
            } else requestAnimationFrame(check);
          }
          check();
        }),
        finish: () => {
          cancelAnimationFrame(frame);
          window.removeEventListener('pointerup', captureRelease, true);
          sample();
          return { ...recording.finish(), neighborSlides: { origin, target, frames, motions, release } };
        }
      };
    }`, pointerX);
  }

  function expectContinuousNeighborSlides(slides: NeighborSlides, earlyDrop = false) {
    const { origin, target, frames, motions, release } = slides;
    const expected: Omit<NeighborSlideMotion, 'duration'>[] = [{ kind: 'sort', from: origin, to: target }];
    if (earlyDrop) {
      expect(release).not.toBeNull();
      expect(release!.motion).toBe(0);
      expect(release!.progress).toBeGreaterThan(0);
      expect(release!.progress).toBeLessThan(1);
      expect(release!.x - origin).toBeGreaterThan(1);
      expect(target - release!.x).toBeGreaterThan(1);
      expected.push({ kind: 'settle', from: release!.x, to: target });
    } else {
      expected.push({ kind: 'sort', from: target, to: origin }, { kind: 'sort', from: origin, to: target });
    }
    expect(motions, JSON.stringify({ motions, release })).toHaveLength(expected.length);
    for (const [index, motion] of motions.entries()) {
      expect(motion.kind).toBe(expected[index].kind);
      expect(Math.abs(motion.from - expected[index].from), JSON.stringify(motion)).toBeLessThanOrEqual(1);
      expect(Math.abs(motion.to - expected[index].to), JSON.stringify(motion)).toBeLessThanOrEqual(1);
      expect(motion.duration).toBe(motionDuration);
    }
    // 2026-11-10: long frames legitimately cover most of a slot; only travel unexplained by eased progress is a jump.
    // Independent endpoints, including pointerup's position, also reject a full restart or a skipped handoff.
    let destination = origin, previousError = 0;
    const progress = motions.map(() => 0);
    for (const frame of frames) {
      let x = destination;
      if (frame.motion !== null) {
        const motion = expected[frame.motion];
        expect(frame.progress, JSON.stringify(frame)).toBeGreaterThanOrEqual(progress[frame.motion]);
        progress[frame.motion] = frame.progress;
        x = motion.from + (motion.to - motion.from) * frame.progress;
        destination = motion.to;
        if (motion.kind === 'settle') expect(frame.released).toBe(true);
      }
      const error = frame.x - x;
      expect(Math.abs(error), JSON.stringify(frame)).toBeLessThanOrEqual(1);
      expect(Math.abs(error - previousError), JSON.stringify(frame)).toBeLessThanOrEqual(1);
      previousError = error;
    }
    expect(Math.abs(frames.at(-1)!.x - target)).toBeLessThanOrEqual(1);
  }

  async function dragBetween(start: { x: number; y: number }, end: { x: number; y: number }, touch = false) {
    const send = async (type: 'start' | 'move' | 'end', point: typeof start) => {
      if (touch) {
        const names = { start: 'touchStart', move: 'touchMove', end: 'touchEnd' };
        await page!.send('Input.dispatchTouchEvent', { type: names[type], touchPoints: type === 'end' ? [] : [{ ...point, id: 1 }] });
      } else {
        const names = { start: 'mousePressed', move: 'mouseMoved', end: 'mouseReleased' };
        await page!.send('Input.dispatchMouseEvent', { type: names[type], ...point, button: 'left', buttons: type === 'end' ? 0 : 1, clickCount: 1 });
      }
    };
    await send('start', start);
    for (let step = 1; step <= 20; step++) {
      await send('move', { x: start.x + (end.x - start.x) * step / 20, y: start.y + (end.y - start.y) * step / 20 });
      await delay(20);
    }
    await delay(250);
    await send('end', end);
    await delay(350);
  }

  it.each([false, true])('makes room once per slow boundary crossing and stays still in the dead zone (reduced motion: %s)', async reducedMotion => {
    page = await openHand({ reducedMotion });
    const points = await page.evaluate(`(() => {
      const slots = document.querySelectorAll('.hand-slot.is-filled');
      const source = slots[2].querySelector('.deck-card-open').getBoundingClientRect();
      const neighbor = slots[1].getBoundingClientRect();
      const own = slots[2].getBoundingClientRect();
      return { start: { x: source.x + source.width / 2, y: source.y + source.height / 2 },
        boundary: (neighbor.x + neighbor.width / 2 + own.x + own.width / 2) / 2, end: neighbor.x + neighbor.width / 2 };
    })()`);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...points.start });
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.start, button: 'left', buttons: 1, clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points.start.x - 12, y: points.start.y, buttons: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points.start.x - 14, y: points.start.y, buttons: 1 });
    await waitForLayout(page.evaluate, '.hand-slots');
    await recordHandDrag(points.start.x - 14);
    let x = points.start.x - 14;
    const moveTo = async (target: number) => {
      const start = x;
      const steps = Math.ceil(Math.abs(target - start) / 2);
      for (let step = 1; step <= steps; step++) {
        x = start + (target - start) * step / steps;
        await page!.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: points.start.y, buttons: 1 });
        await delay(1000 / 60);
      }
    };
    for (const [phase, direction] of [['left', -1], ['right', 1], ['left-again', -1]] as const) {
      await page.callFunction('function(value) { window.handDragRecording.phase(value); }', phase);
      await moveTo(points.boundary + direction * 20);
      for (let cycle = 0; cycle < 3; cycle++) {
        await moveTo(points.boundary + 3);
        await moveTo(points.boundary - 3);
      }
      await moveTo(points.boundary + direction * 20);
      await delay(250);
    }
    await moveTo(points.end + 16);
    await delay(250);
    // 2026-11-10: a throttled drop may exceed 50ms without extra work; pointer moves must never reformat card dates.
    expect.soft((await page.evaluate('window.handDragTest.result()')).dateFormats).toBe(0);
    await page.evaluate(`window.handDragRecording.phase('drop')`);
    if (!reducedMotion) await recordSourceDrop();
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y: points.start.y, button: 'left', buttons: 0, clickCount: 1 });
    if (!reducedMotion) expectContinuousSourceDrop(await page.evaluate('window.handSourceDropFrames'));
    await waitForLayout(page.evaluate, '.hand-slots');
    const { neighborSlides, ...metrics }: { neighborSlides: NeighborSlides; [key: string]: any } = await page.evaluate('window.handDragRecording.finish()');
    console.info('Hand slow drag:', JSON.stringify(metrics));
    for (const phase of ['left', 'right', 'left-again']) expect.soft(metrics.changes[phase], JSON.stringify(metrics)).toBe(1);
    expect.soft(metrics.positions).toMatchObject({ left: 1, right: 0, 'left-again': 1, drop: 1 });
    expect.soft(metrics.emptyFrames).toBe(0);
    expect.soft(metrics.outlinedFrames).toBe(0);
    expect.soft(metrics.classChanges).toBe(0);
    if (reducedMotion) {
      expect.soft(metrics.movingFrames).toBe(0);
      expect(neighborSlides.motions).toEqual([]);
      for (const frame of neighborSlides.frames.filter(frame => frame.released)) {
        expect(Math.abs(frame.x - neighborSlides.target), JSON.stringify(frame)).toBeLessThanOrEqual(1);
      }
    } else {
      expectContinuousNeighborSlides(neighborSlides);
      expect.soft(metrics.sourceDropSteps.every((step: number) => step < 0)).toBe(true);
    }
    // 2026-11-10: CDP and React may land either side of rAF; allow two 2px input samples, never a slot reset.
    expect.soft(metrics.maxPointerError).toBeLessThan(4.1);
    expect((await page.evaluate('window.handDragTest.result()')).reorder).toEqual([0, 2, 1, 3, 4, 5, 6].map(index => `card:hand-${index}`));
  }, 30000);

  it('continues the neighbor slide when dropped before it has finished', async () => {
    page = await openHand();
    const start = await pointOf('.hand-slots [data-card-id="card:hand-2"] .deck-card-open');
    const neighbor = await pointOf('.hand-slots [data-card-id="card:hand-1"]');
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x - 12, y: start.y, buttons: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x - 14, y: start.y, buttons: 1 });
    await waitForLayout(page.evaluate, '.hand-slots');
    await recordHandDrag(start.x - 14);
    const end = { x: (start.x + neighbor.x) / 2 - 10, y: start.y };
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...end, buttons: 1 });
    await page.evaluate('window.handDragRecording.whenSliding()');
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', buttons: 0, clickCount: 1 });
    await waitForLayout(page.evaluate, '.hand-slots');
    const { neighborSlides, ...metrics } = await page.evaluate('window.handDragRecording.finish()');
    console.info('Hand early drop:', JSON.stringify(metrics));
    expectContinuousNeighborSlides(neighborSlides, true);
    expect(metrics.emptyFrames).toBe(0);
    expect(metrics.outlinedFrames).toBe(0);
    expect(metrics.classChanges).toBe(0);
    expect((await page.evaluate('window.handDragTest.result()')).reorder).toEqual([0, 2, 1, 3, 4, 5, 6].map(index => `card:hand-${index}`));
  }, 20000);

  it('keeps keyboard reorder and Escape cancellation on the handle', async () => {
    page = await openHand();
    const focusHero = () => page!.evaluate(`document.querySelector('.hand-slots [data-card-id="card:hand-2"]').closest('.hand-slot').querySelector('.hand-slot-handle').focus()`);
    const key = async (code: string, key: string, windowsVirtualKeyCode: number) => {
      await page!.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key, windowsVirtualKeyCode });
      await page!.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode });
      await delay(250);
    };
    await focusHero();
    await key('Space', ' ', 32);
    await key('ArrowLeft', 'ArrowLeft', 37);
    await key('Space', ' ', 32);
    expect((await page.evaluate('window.handDragTest.result()')).reorder).toEqual([0, 2, 1, 3, 4, 5, 6].map(index => `card:hand-${index}`));
    await focusHero();
    await key('Space', ' ', 32);
    await key('ArrowRight', 'ArrowRight', 39);
    await key('Escape', 'Escape', 27);
    expect((await page.evaluate('window.handDragTest.result()')).writes).toBe(1);
    expect(await page.evaluate(`Boolean(document.querySelector('.is-drag-source'))`)).toBe(false);
  }, 15000);

  it('preserves slot/queue transfers, touch queue handles and touch scrolling on faces', async () => {
    page = await openHand({ queue: true });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await dragBetween(await pointOf('.hand-slots [data-card-id="card:hand-2"] .deck-card-open'), await pointOf('.hand-slots [data-card-id="card:hand-1"]'), true);
    expect((await page.evaluate('window.handDragTest.result()')).writes).toBe(0);
    await dragBetween(await pointOf('.hand-queue li:first-child .hand-queue-handle'), await pointOf('.hand-slots [data-card-id="card:hand-5"]'));
    expect((await page.evaluate('window.handDragTest.result()')).reorder).toEqual([0, 1, 2, 3, 4, 7, 5, 6, 8].map(index => `card:hand-${index}`));
    await dragBetween(await pointOf('.hand-slots [data-card-id="card:hand-5"] .deck-card-open'), await pointOf('.hand-queue li:last-child .hand-queue-handle'));
    expect((await page.evaluate('window.handDragTest.result()')).reorder).toEqual([0, 1, 2, 3, 4, 7, 6, 8, 5].map(index => `card:hand-${index}`));
    await dragBetween(await pointOf('.hand-queue li:first-child .hand-queue-handle'), await pointOf('.hand-queue li:last-child .hand-queue-handle'), true);
    expect((await page.evaluate('window.handDragTest.result()')).reorder).toEqual([0, 1, 2, 3, 4, 7, 6, 5, 8].map(index => `card:hand-${index}`));
    expect((await page.evaluate('window.handDragTest.result()')).writes).toBe(3);
  }, 20000);

  it('reorders an occupied slot by its visible touch handle and cancels a touch drag', async () => {
    page = await openHand({ queue: true });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const handle = '.hand-slots [data-card-id="card:hand-2"]';
    await delay(350);
    const geometry = await page.evaluate(`(() => {
      const handle = document.querySelector('${handle}').closest('.hand-slot').querySelector('.hand-slot-handle');
      const rect = handle.getBoundingClientRect();
      return { width: rect.width, height: rect.height, opacity: getComputedStyle(handle).opacity };
    })()`);
    expect(geometry.width).toBeGreaterThanOrEqual(44);
    expect(geometry.height).toBeGreaterThanOrEqual(44);
    expect(geometry.opacity).toBe('1');
    const handleButton = '.hand-slot[data-hand-card="card:hand-2"] .hand-slot-handle';
    await dragBetween(await pointOf(handleButton), await pointOf('.hand-slots [data-card-id="card:hand-1"]'), true);
    expect((await page.evaluate('window.handDragTest.result()')).reorder).toEqual([0, 2, 1, 3, 4, 5, 6, 7, 8].map(index => `card:hand-${index}`));
    const start = await pointOf(handleButton);
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
    await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + 20, y: start.y, id: 1 }] });
    await page.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await delay(250);
    expect((await page.evaluate('window.handDragTest.result()')).writes).toBe(1);
    expect(await page.evaluate(`Boolean(document.querySelector('.is-drag-source'))`)).toBe(false);
    await dragBetween(await pointOf(handleButton), await pointOf('.hand-queue li:last-child .hand-queue-handle'), true);
    expect((await page.evaluate('window.handDragTest.result()')).reorder).toEqual([0, 1, 3, 4, 5, 6, 7, 8, 2].map(index => `card:hand-${index}`));
    await dragBetween(await pointOf('[data-hand-card="card:hand-2"] .hand-queue-handle'), await pointOf('.hand-slots [data-card-id="card:hand-0"]'), true);
    expect((await page.evaluate('window.handDragTest.result()')).reorder).toEqual([2, 0, 1, 3, 4, 5, 6, 7, 8].map(index => `card:hand-${index}`));
    expect((await page.evaluate('window.handDragTest.result()')).writes).toBe(3);
  }, 15000);

  it.each([false, true])('keeps slot controls outside the card face without overlapping settings (touch: %s)', async touch => {
    page = await openHand({ width: 375 });
    if (touch) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const geometry = await page.evaluate(`(() => {
      const slot = document.querySelector('.hand-slot.is-filled');
      const rect = element => { const r = element.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height }; };
      return { face:rect(slot.querySelector('.deck-card')), settings:rect(slot.querySelector('.deck-card-settings')), handle:rect(slot.querySelector('.hand-slot-handle')), remove:rect(slot.querySelector('.hand-slot-remove')) };
    })()`);
    for (const control of [geometry.handle, geometry.remove]) {
      expect(control.top).toBeGreaterThanOrEqual(geometry.face.bottom);
      expect(control.width).toBeGreaterThanOrEqual(touch ? 44 : 24);
      expect(control.height).toBeGreaterThanOrEqual(touch ? 44 : 24);
      expect(control.top).toBeGreaterThanOrEqual(geometry.settings.bottom);
    }
    expect(geometry.remove.right).toBeLessThanOrEqual(geometry.handle.left);
  });

  it('keeps Done Cards outside ordering and reorders across wrapped tile rows', async () => {
    page = await openHand({ width: 600 });
    const start = await pointOf('.hand-slots [data-card-id="card:hand-2"] .deck-card-open');
    await dragBetween(start, await pointOf('.hand-slot-done'));
    expect((await page.evaluate('window.handDragTest.result()')).writes).toBe(0);
    expect(await page.evaluate(`document.querySelector('.hand-slot-done-count').textContent`)).toBe('1');
    await dragBetween(start, await pointOf('.hand-slots [data-card-id="card:hand-5"]'));
    expect((await page.evaluate('window.handDragTest.result()')).reorder).toEqual([0, 1, 3, 4, 5, 2, 6].map(index => `card:hand-${index}`));
    expect(await page.evaluate(`document.querySelectorAll('.hand-slots .hand-slot.is-filled').length`)).toBe(7);
  }, 15000);

  it('opens the Done pile with the keyboard and closes it when the viewed member changes', async () => {
    page = await openHand();
    await page.evaluate(`document.querySelector('.hand-slot-done').focus()`);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await delay(100);
    expect(await page.evaluate(`document.querySelector('.hand-slot-done').getAttribute('aria-expanded')`)).toBe('true');
    expect(await page.evaluate(`document.querySelector('.hand-done-list:not([hidden])').innerText`)).toContain('Done card');
    await page.evaluate(`document.querySelector('.hand-done-list button').click()`);
    expect((await page.evaluate('window.handDragTest.result()')).opened).toEqual(['card:done']);
    await page.evaluate(`window.handDragTest.clearOpened(); const select = document.querySelector('.hand-member-picker select'); select.value = 'maya'; select.dispatchEvent(new Event('change', { bubbles: true }))`);
    await delay(100);
    expect(await page.evaluate(`document.querySelector('.hand-slot-done').getAttribute('aria-expanded')`)).toBe('false');
    expect(await page.evaluate(`document.querySelector('.hand-member-picker select').value`)).toBe('maya');
  });

  it('opens tile settings by keyboard, restores focus, and saves an owner independently of Hand membership', async () => {
    page = await openHand();
    const selector = '[data-hand-card="card:hand-1"] .deck-card-settings';
    await page.evaluate(`document.querySelector('${selector}').focus()`);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await waitFor(`document.querySelector('.card-quick-settings[data-tab="owner"]')`);
    expect(await page.evaluate(`document.querySelector('${selector}').getAttribute('aria-expanded')`)).toBe('true');
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await waitFor(`!document.querySelector('.card-quick-settings') && document.activeElement.matches('${selector}')`);
    await page.evaluate(`document.querySelector('${selector}').click()`);
    await waitFor(`document.querySelector('.card-quick-settings [role="option"]')`);
    await page.evaluate(`Array.from(document.querySelectorAll('.card-quick-settings [role="option"]')).find(option => option.innerText.includes('Leo')).click()`);
    await waitFor(`!document.querySelector('.card-quick-settings') && document.querySelector('[data-hand-card="card:hand-1"] .deck-card-owner')?.getAttribute('aria-label') === 'Owner: Leo'`);
    const result = await page.evaluate('window.handDragTest.result()');
    expect(result.propertyAction).toMatchObject({ action: 'set-card-properties', cardId: 'card:hand-1', sourceHash: 'hash-1', manifestHash: 'manifest', owner: 'Leo' });
    expect(result.cards.find((card: { id: string }) => card.id === 'card:hand-1').handMemberIds).toEqual(['leo']);
    expect(result.writes).toBe(0);
  });

  it('offers the same settings on bookmarks and All Hands, and no settings in read-only mode', async () => {
    page = await openHand();
    expect(await page.evaluate(`Boolean(document.querySelector('.hand-bookmarks .deck-card-settings'))`)).toBe(true);
    await page.evaluate(`document.querySelector('.hand-bookmarks .deck-card-settings').click()`);
    await waitFor(`document.querySelector('.card-quick-settings')`);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await waitFor(`!document.querySelector('.card-quick-settings')`);
    await page.evaluate(`document.querySelector('.hand-all-toggle input').click()`);
    await waitFor(`document.querySelector('.hand-all-member .deck-card-settings')`);
    await page.evaluate(`document.querySelector('.hand-all-member .deck-card-settings').click()`);
    await waitFor(`document.querySelector('.card-quick-settings')`);
    await page.close();
    page = await openHand({ readOnly: true });
    expect(await page.evaluate(`document.querySelectorAll('.deck-card-settings').length`)).toBe(0);
  });

  it('keeps a failed settings save open with its error and the original owner', async () => {
    page = await openHand();
    await page.evaluate(`window.handDragTest.failWrites(409); document.querySelector('[data-hand-card="card:hand-1"] .deck-card-settings').click()`);
    await waitFor(`document.querySelector('.card-quick-settings [role="option"]')`);
    await page.evaluate(`Array.from(document.querySelectorAll('.card-quick-settings [role="option"]')).find(option => option.innerText.includes('Leo')).click()`);
    await waitFor(`document.querySelector('.card-quick-settings [role="alert"]')`);
    expect(await page.evaluate(`document.querySelector('.card-quick-settings [role="alert"]').textContent`)).toContain('Change not saved');
    expect(await page.evaluate(`document.querySelector('[data-hand-card="card:hand-1"] .deck-card-owner').getAttribute('aria-label')`)).toBe('Owner: Maya');
    expect((await page.evaluate('window.handDragTest.result()')).propertyAction).toBeNull();
  });

  it('reserves slot action space while a touch settings save is pending', async () => {
    page = await openHand({ width: 375 });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await page.evaluate(`window.handDragTest.pauseWrites(); document.querySelector('[data-hand-card="card:hand-1"] .deck-card-settings').click()`);
    await waitFor(`document.querySelector('.card-quick-settings [role="option"]')`);
    const before = await page.evaluate(`document.querySelector('.hand-slots').getBoundingClientRect().height`);
    await page.evaluate(`Array.from(document.querySelectorAll('.card-quick-settings [role="option"]')).find(option => option.innerText.includes('Leo')).click()`);
    await waitFor(`document.querySelector('[data-hand-card="card:hand-1"] .deck-card-settings:disabled')`);
    expect(await page.evaluate(`document.querySelector('.hand-slots').getBoundingClientRect().height`)).toBe(before);
    await page.evaluate(`window.handDragTest.resumeWrites()`);
    await waitFor(`!document.querySelector('.card-quick-settings')`);
  });

  it('shows each decorated tag once in the Team Hand card', async () => {
    page = await openHand();
    await page.evaluate(`document.querySelector('#hand-tab-team').click()`);
    await waitFor(`document.querySelector('.hand-team-card .deck-card-title .card-tag-emoji')`);
    expect(await page.evaluate(`document.querySelector('.hand-team-card .deck-card-title').textContent`)).toContain('🔈');
    expect(await page.evaluate(`document.querySelector('.hand-team-card').querySelectorAll('.deck-card-title .card-tag-emoji').length`)).toBe(1);
    expect(await page.evaluate(`document.querySelectorAll('.hand-team-card .tag-badge').length`)).toBe(0);
  });

  it('removes queue cards and cards owned by someone else, restoring focus after the save', async () => {
    page = await openHand({ queue: true });
    await page.evaluate(`document.querySelector('[data-hand-card="card:hand-8"] .hand-queue-remove').click()`);
    await delay(300);
    expect((await page.evaluate('window.handDragTest.result()')).bulkWrites).toBe(1);
    expect(await page.evaluate(`Boolean(document.querySelector('[data-hand-card="card:hand-8"]'))`)).toBe(false);
    await page.evaluate(`document.querySelector('[data-hand-card="card:hand-1"] .hand-slot-remove').click()`);
    await delay(300);
    expect((await page.evaluate('window.handDragTest.result()')).bulkWrites).toBe(2);
    expect(await page.evaluate(`Boolean(document.querySelector('[data-hand-card="card:hand-1"]'))`)).toBe(false);
    expect(await page.evaluate(`document.activeElement.closest('[data-hand-card]')?.dataset.handCard`)).toBe('card:hand-2');
  });

  it.each([500, 409])('keeps a failed removal visible with an explicitly named data refresh action (status %i)', async status => {
    page = await openHand({ queue: true, width: 375 });
    await page.evaluate(`window.handDragTest.failWrites(${status}); document.querySelector('[data-hand-card="card:hand-8"] .hand-queue-remove').scrollIntoView(); document.querySelector('[data-hand-card="card:hand-8"] .hand-queue-remove').click()`);
    await delay(300);
    expect(await page.evaluate(`Boolean(document.querySelector('[data-hand-card="card:hand-8"]'))`)).toBe(true);
    expect(await page.evaluate(`document.querySelector('.hand-error button')?.textContent`)).toBe('Refresh data');
    expect(await page.evaluate(`(() => { const rect = document.querySelector('.hand-error').getBoundingClientRect(); return rect.bottom > 0 && rect.top < innerHeight })()`)).toBe(true);
  });

  it('keeps the mobile planning tabs reachable and counts the displayed due cards', async () => {
    page = await openHand({ width: 375 });
    const tabs = await page.evaluate(`Array.from(document.querySelectorAll('[role="tab"]')).map(tab => ({ id: tab.id, bottom: tab.getBoundingClientRect().bottom }))`);
    for (const id of ['hand-tab-due', 'hand-tab-runs', 'hand-tab-team']) expect(tabs.find((tab: { id: string }) => tab.id === id)?.bottom).toBeLessThanOrEqual(900);
    await page.evaluate(`document.querySelector('#hand-tab-due').click()`);
    await delay(150);
    expect(await page.evaluate(`document.querySelector('#hand-tab-due .hand-tab-count').textContent`)).toBe('6');
    expect(await page.evaluate(`document.querySelectorAll('.hand-section .hand-section-row').length`)).toBe(6);
    await page.evaluate(`document.querySelector('.hand-show-all').click()`);
    await delay(100);
    expect(await page.evaluate(`document.querySelector('#hand-tab-due .hand-tab-count').textContent`)).toBe('7');
    expect(await page.evaluate(`document.querySelectorAll('.hand-section .hand-section-row').length`)).toBe(7);
    expect(await page.evaluate(`document.querySelector('#hand-tab-due').getAttribute('aria-label')`)).toContain('7 cards');
    await page.evaluate(`document.querySelector('#hand-tab-team').click()`);
    await delay(150);
    expect(await page.evaluate(`document.querySelector('#hand-tab-panel').getBoundingClientRect().top < innerHeight`)).toBe(true);
  });

  it('shows a Done pile in All Hands even when the member has no open cards', async () => {
    page = await openHand();
    await page.evaluate(`document.querySelector('.hand-all-toggle input').click()`);
    await delay(100);
    expect(await page.evaluate(`document.querySelector('[aria-label="Hand: Maya"] .hand-slot-done-count')?.textContent`)).toBe('1');
  });

  it('scrolls the mobile page from a card face without starting a touch reorder', async () => {
    page = await openHand({ width: 375 });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await delay(350);
    const point = await pointOf('.hand-slots [data-card-id="card:hand-1"] .deck-card-open');
    const before = await page.evaluate('document.scrollingElement.scrollTop');
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
    for (let step = 1; step <= 8; step++) {
      await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y - step * 20, id: 1 }] });
      await delay(20);
    }
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await delay(150);
    expect(await page.evaluate('document.scrollingElement.scrollTop')).toBeGreaterThan(before);
    expect((await page.evaluate('window.handDragTest.result()')).writes).toBe(0);
  });

  it.each(['face', 'handle'])('keeps disabled deck-transfer faces out of per-move renders when dragging by %s', async activator => {
    page = await openHand();
    const points = await page.callFunction(`function(activator) {
      const slots = document.querySelectorAll('.hand-slot.is-filled');
      const source = (activator === 'handle' ? slots[0].querySelector('.hand-slot-handle') : slots[0].querySelector('.deck-card-open')).getBoundingClientRect();
      const target = slots[5].getBoundingClientRect();
      return { start: { x: source.x + source.width / 2, y: source.y + source.height / 2 }, end: { x: target.x + target.width / 2, y: target.y + target.height / 2 } };
    }`, activator);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...points.start });
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.start, button: 'left', buttons: 1, clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points.start.x + 12, y: points.start.y, buttons: 1 });
    await delay(150);
    expect(await page.evaluate(`Boolean(document.querySelector('.hand-slot.is-drag-source'))`)).toBe(true);
    await page.evaluate('window.handDragTest.reset()');
    for (let step = 1; step <= 30; step++) {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', buttons: 1,
        x: points.start.x + 12 + (points.end.x - points.start.x - 12) * step / 30,
        y: points.start.y + (points.end.y - points.start.y) * step / 30 });
      await delay(1000 / 60);
    }
    const during = await page.evaluate('window.handDragTest.result()');
    // 2026-11-10: allow enter/leave at six slot boundaries, not fresh Intl work on all 30 moves.
    // A deterministic work budget avoids frame-time limits dependent on other builds on the host.
    expect(during.dateFormats, JSON.stringify(during)).toBeLessThanOrEqual(16);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.end, button: 'left', buttons: 0, clickCount: 1 });
    await delay(250);
    expect((await page.evaluate('window.handDragTest.result()')).reorder).toEqual([1, 2, 3, 4, 5, 0, 6].map(index => `card:hand-${index}`));
  }, 30000);
});
