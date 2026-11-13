import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/app.ts';
import { initializeDemo } from '../server/demo.ts';
import { appendActivity } from '../server/activity.ts';
import { randomUUID } from 'node:crypto';
import { browserFixtureUrl } from './browser-fixture.ts';
import { createBrowserSession } from './browser-session.ts';
import { requireBrowser } from './browser-environment.ts';
import { waitForLayout } from './browser-layout.ts';
import { freePort } from './free-port.ts';

const browserPath = requireBrowser();
const measurements: unknown[] = [];
const cardId = (index: number) => `card:00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const cardPath = (root: string, index: number) => path.join(root, 'cards', `${cardId(index).slice(5)}.md`);
const body = '- [ ] Keep the checkbox stable\n\n' + Array.from({ length: 40 }, (_, index) => `Paragraph ${index}: content before refresh.\n`).join('\n');

// 2026-11-13: record every painted frame, not only settled bounds; a transient collapse can otherwise pass unnoticed.
const startMeasurement = `(selectors, scrollSelector) => {
  const nodes = [...document.querySelectorAll(selectors)].filter(node => {
    const r = node.getBoundingClientRect(); return r.width && r.height && r.bottom > 0 && r.top < innerHeight;
  });
  const rects = nodes.map(node => node.getBoundingClientRect());
  const scroll = document.querySelector(scrollSelector);
  const initialScroll = scroll.scrollTop;
  const result = { frames: 0, displacement: 0, scroll: 0, removed: 0, layoutShift: 0, shiftSources: [] };
  const shifts = new PerformanceObserver(list => { for (const entry of list.getEntries()) {
    result.layoutShift += entry.value;
    result.shiftSources.push(...entry.sources.map(source => ({ node: source.node?.className ?? source.node?.nodeName, before: source.previousRect.toJSON(), after: source.currentRect.toJSON() })));
  } });
  shifts.observe({ type: 'layout-shift' });
  const removals = new MutationObserver(() => { result.removed = Math.max(result.removed, nodes.filter(node => !node.isConnected).length); });
  removals.observe(document.body, { childList: true, subtree: true });
  let frame;
  const sample = () => {
    result.frames++;
    result.scroll = Math.max(result.scroll, Math.abs(scroll.scrollTop - initialScroll));
    nodes.forEach((node, index) => {
      if (!node.isConnected) return;
      const r = node.getBoundingClientRect(), before = rects[index];
      result.displacement = Math.max(result.displacement, Math.abs(r.x - before.x), Math.abs(r.y - before.y), Math.abs(r.width - before.width), Math.abs(r.height - before.height));
    });
    frame = requestAnimationFrame(sample);
  };
  sample();
  window.stopRefreshMeasurement = () => { cancelAnimationFrame(frame); shifts.disconnect(); removals.disconnect(); return result; };
  return nodes.length;
}`;

describe.skipIf(!browserPath)('catalog refresh continuity with real file events', () => {
  const page = createBrowserSession();
  let temporary: string;
  let root: string;
  let app: FastifyInstance | undefined;
  let origin: string;

  beforeAll(async () => {
    temporary = await mkdtemp(path.join(tmpdir(), 'deckmate-refresh-'));
    root = path.join(temporary, 'project');
    for (const [key, folder] of Object.entries({ DECKMATE_INDEX: 'index', DECKMATE_COORDINATION: 'coordination', APPDATA: 'appdata' })) {
      const directory = path.join(temporary, folder);
      if (key !== 'DECKMATE_COORDINATION') await mkdir(directory);
      vi.stubEnv(key, directory);
    }
    await initializeDemo(root);
    await Promise.all(Array.from({ length: 80 }, (_, index) => writeFile(cardPath(root, index),
      `---\ndeckmate: card\nschema: 1\nid: ${cardId(index).slice(5)}\nkind: task\ntitle: Refresh ${String(index).padStart(3, '0')}\nstate: not-started\nowner: Leo Park\ndeckId: engineering\nparentId: null\ntrackIds: []\n---\n\n${body}`)));
    const port = await freePort();
    app = await createApp({ editMode: 'direct', dataRoot: root, writeRoot: root, projectName: 'Refresh', port, python: 'python' });
    const fixture = new URL(browserFixtureUrl('catalog-refresh'));
    // 2026-11-13: serve the invocation's immutable fixture build on the API origin, including its real WebSocket.
    app.addHook('onRequest', async (request, reply) => {
      if (request.url.startsWith('/api/') || request.url.startsWith('/r/')) return;
      const asset = request.url.split('?')[0] === '/' ? fixture : new URL(request.url, fixture);
      const response = await fetch(asset);
      return reply.code(response.status).type(response.headers.get('content-type') ?? 'application/octet-stream').send(Buffer.from(await response.arrayBuffer()));
    });
    await app.listen({ host: '127.0.0.1', port });
    origin = `http://127.0.0.1:${port}`;
    await page.open(browserPath!, { viewport: { width: 1440, height: 900, scale: 1 } });
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      localStorage.setItem('deckmate-language', 'en');
      localStorage.setItem('deckmate-summary-collapsed', 'true');
      localStorage.setItem('deckmate-current-member', 'leo');
    ` });
  }, 120000);

  afterAll(async () => {
    await page.close();
    await app?.close();
    vi.unstubAllEnvs();
    if (temporary) await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    if (process.env.DECKMATE_REFRESH_MEASURE) await writeFile(process.env.DECKMATE_REFRESH_MEASURE, JSON.stringify(measurements, null, 2));
  }, 30000);

  async function open(width: number, theme: string, cpu: number, query = 'deck=engineering&layout=cards&order=title&direction=asc') {
    await page.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.send('Page.navigate', { url: origin + '/?view=deck&catalogSource=sandbox&' + query });
    await page.until(`Boolean(document.querySelector('.deck-card, .catalog-deck-cover'))`, 400);
    await page.callFunction(`theme => { document.documentElement.classList.toggle('dark', theme === 'dark'); localStorage.setItem('deckmate-theme', theme); }`, theme);
    await waitForLayout(page.evaluate, '.deck-card, .catalog-deck-cover, .topbar');
    await page.until(`window.refreshTest && window.refreshTest.catalog() !== null`, 600);
  }
  async function measure(name: string) {
    const result = await page.evaluate('window.stopRefreshMeasurement()');
    measurements.push({ name, ...result });
    console.info(name, JSON.stringify(result));
    return result;
  }
  function expectStable(result: Awaited<ReturnType<typeof measure>>) {
    expect(result.frames).toBeGreaterThan(0);
    expect(result.removed).toBe(0);
    expect(result.displacement).toBeLessThanOrEqual(1);
    expect(result.scroll).toBeLessThanOrEqual(1);
    expect(result.layoutShift).toBeLessThanOrEqual(.0001);
  }

  for (const width of [375, 1440]) for (const theme of ['dark', 'light']) for (const cpu of [1, 4]) {
    const configuration = `${width}/${theme}/CPU${cpu}`;
    it(`keeps mounted cards and the upward scroll anchor on external edits: ${configuration}`, async () => {
      await open(width, theme, cpu);
      await page.evaluate(`document.querySelector('.workspace-main').scrollTop = 1100`);
      await waitForLayout(page.evaluate, '[data-virtual-card-cell]');
      await page.evaluate(`document.querySelector('.workspace-main').scrollTop -= 180`);
      await waitForLayout(page.evaluate, '[data-virtual-card-cell]');
      const id = await page.evaluate(`(() => {
        const tile = [...document.querySelectorAll('[data-deck-card]')].find(node => { const r = node.getBoundingClientRect(); return r.top > 180 && r.bottom < innerHeight; });
        tile.querySelector('.deck-card-open').focus({ preventScroll: true }); window.refreshFocused = document.activeElement;
        return tile.dataset.deckCard;
      })()`);
      const previous = await page.evaluate(`window.refreshTest.catalog().cards.find(card => card.id === ${JSON.stringify(id)}).sourceHash`);
      expect(await page.callFunction(startMeasurement, '[data-deck-card], [data-virtual-card-grid]', '.workspace-main')).toBeGreaterThan(0);
      const file = path.join(root, 'cards', id.slice(5) + '.md');
      const title = `Refresh ${String(Number(id.slice(-12))).padStart(3, '0')} updated ${configuration}`;
      await writeFile(file, (await readFile(file, 'utf8')).replace(/^title:.*$/mu, `title: ${title}`)
        .replace('content before refresh.', `content ${configuration} ${Date.now()}.`));
      await page.until(`window.refreshTest.catalog().cards.find(card => card.id === ${JSON.stringify(id)}).sourceHash !== ${JSON.stringify(previous)}`, 400);
      await waitForLayout(page.evaluate, '[data-virtual-card-cell]');
      const result = await measure('external ' + configuration);
      expect(await page.callFunction(`id => document.querySelector('[data-deck-card="' + id + '"] .deck-card-title').textContent`, id)).toBe(title);
      expect(await page.evaluate('document.activeElement === window.refreshFocused')).toBe(true);
      expectStable(result);
    }, 30000);

    it(`keeps the gallery and header still through a slow repeat request: ${configuration}`, async () => {
      await open(width, theme, cpu, '');
      await page.until(`Boolean(document.querySelector('.project-pulse-value'))`);
      await waitForLayout(page.evaluate, '.catalog-deck-cover, .page-tools, .catalog-heading-actions');
      expect(await page.callFunction(startMeasurement, '.catalog-deck-cover, .catalog-heading-actions, .notifications-trigger', '.workspace-main')).toBeGreaterThan(0);
      await page.evaluate(`window.refreshTest.delay = 650; window.refreshTest.refresh()`);
      await waitForLayout(page.evaluate, '.catalog-deck-cover, .catalog-heading-actions');
      expectStable(await measure('repeat ' + configuration));
    }, 30000);

    it(`saves a reading checkbox and the editor without stale or empty frames: ${configuration}`, async () => {
      await open(width, theme, cpu, `deck=engineering&layout=cards&order=title&card=${encodeURIComponent(cardId(0))}`);
      await page.until(`Boolean(document.querySelector('.card-preview-document input[type=checkbox]:not(:disabled)'))`, 400);
      await waitForLayout(page.evaluate, '.card-preview-sheet, .card-preview-dock');
      await page.callFunction(startMeasurement, '.card-preview-sheet, .card-preview-dock, .card-preview-material-band', '.card-preview-panels');
      await page.evaluate(`(() => {
        window.savedCheckbox = document.querySelector('.card-preview-document input[type=checkbox]');
        const wanted = !window.savedCheckbox.checked;
        window.checkboxFrames = [];
        const sample = () => { window.checkboxFrames.push(document.querySelector('.card-preview-document input[type=checkbox]')?.checked === wanted); window.checkboxFrame = requestAnimationFrame(sample); };
        window.savedCheckbox.click(); requestAnimationFrame(sample);
      })()`);
      await page.until(`Boolean(document.querySelector('.card-preview-document input[type=checkbox]:not(:disabled), .card-content-notice, .catalog-error'))`, 400);
      expect(await page.evaluate(`document.querySelector('.catalog-error, .card-content-notice')?.textContent ?? ''`)).toBe('');
      await waitForLayout(page.evaluate, '.card-preview-sheet, .card-preview-dock');
      await page.evaluate(`cancelAnimationFrame(window.checkboxFrame)`);
      const checkbox = await measure('checkbox ' + configuration);
      expect(await page.evaluate(`window.checkboxFrames.every(Boolean)`)).toBe(true);
      expect(await page.evaluate(`document.querySelector('.card-preview-document input[type=checkbox]') === window.savedCheckbox`)).toBe(true);
      expectStable(checkbox);
      await page.evaluate(`document.querySelector('.card-content-edit-action').click()`);
      await page.until(`Boolean(document.querySelector('.card-edit-text'))`);
      const savedText = 'Paragraph 0: Saved ' + configuration;
      await page.callFunction(`text => {
        const field = document.querySelector('.card-edit-text');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, field.value.replace(/^Paragraph 0:.*$/m, text));
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }`, savedText);
      await waitForLayout(page.evaluate, '.card-preview-sheet, .card-preview-material-band');
      await page.callFunction(startMeasurement, '.card-preview-sheet, .card-preview-material-band', '.workspace-main');
      await page.callFunction(`text => {
        window.editorFrames = [];
        const sample = () => {
          const reading = document.querySelector('.card-preview-document');
          if (reading) window.editorFrames.push(reading.textContent.includes(text));
          window.editorFrame = requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
        document.querySelector('.card-edit').requestSubmit();
      }`, savedText);
      await page.until(`!document.querySelector('.card-edit-text')`, 400);
      await waitForLayout(page.evaluate, '.card-preview-sheet, .card-preview-material-band');
      await page.evaluate(`cancelAnimationFrame(window.editorFrame)`);
      const editor = await measure('editor ' + configuration);
      expect(await page.evaluate(`window.editorFrames.length > 0 && window.editorFrames.every(Boolean)`)).toBe(true);
      expect(editor.removed).toBe(0);
      expect(editor.displacement).toBeLessThanOrEqual(1);
      expect(editor.scroll).toBeLessThanOrEqual(1);
      expect(page.errors).toEqual([]);
    }, 30000);
  }

  it('keeps header controls and open notification stacks still during arrival and refresh', async () => {
    await open(375, 'dark', 4, '');
    await page.evaluate(`document.querySelector('.notifications-trigger').click()`);
    await page.until(`Boolean(document.querySelector('.notifications-body select'))`);
    await page.evaluate(`document.querySelector('.notifications-close').click()`);
    await waitForLayout(page.evaluate, '.notifications-trigger');
    const count = await page.evaluate(`document.querySelector('.notifications-trigger').getAttribute('aria-label')`);
    await page.callFunction(startMeasurement, '.notifications-trigger, .topbar-actions > *, .topbar-tabs', '.workspace-main');
    await appendActivity(root, { schema: 1, id: randomUUID(), at: new Date().toISOString(), actor: 'Deckmate', actorMemberId: 'maya', action: 'set-card-state',
      cards: [{ id: cardId(1), title: 'Refresh 001' }], deckIds: ['engineering'], summary: 'Refresh arrival', details: ['Refresh 001: State: not-started → started'], transitions: [{ cardId: cardId(1), from: 'not-started', to: 'started' }] }, 'en');
    await page.until(`document.querySelector('.notifications-trigger').getAttribute('aria-label') !== ${JSON.stringify(count)}`);
    const arrival = await measure('notification arrival');
    await page.evaluate(`document.querySelector('.notifications-trigger').click()`);
    await page.until(`Boolean(document.querySelector('.notification-pill, .notification-stack'))`);
    await waitForLayout(page.evaluate, '.notifications-panel');
    await page.callFunction(startMeasurement, '.notification-pill, .notification-stack', '.notifications-body');
    await page.evaluate(`window.refreshTest.notificationDelay = 850`);
    // 2026-11-13: a real event refreshes the already-open panel while its request remains pending past the busy delay.
    const file = cardPath(root, 1);
    await writeFile(file, (await readFile(file, 'utf8')) + '\nNotification refresh.\n');
    await page.evaluate(`new Promise(resolve => setTimeout(resolve, 1700))`);
    const refresh = await measure('notification repeat');
    expectStable(arrival);
    expectStable(refresh);
  }, 30000);

  it('retains visible DOM nodes when the card count crosses the virtualization threshold in either direction', async () => {
    await page.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.send('Page.navigate', { url: new URL('?gridProbe', browserFixtureUrl('catalog-refresh')).href });
    await page.until(`document.querySelectorAll('[data-deck-card]').length === 49`);
    await waitForLayout(page.evaluate, '.deck-card');
    await page.evaluate(`document.querySelector('.workspace-main').scrollTop = 1500`);
    await waitForLayout(page.evaluate, '.deck-card');
    await page.callFunction(startMeasurement, '[data-deck-card]', '.workspace-main');
    await page.evaluate(`window.refreshTest.resize(50)`);
    await page.until(`Boolean(document.querySelector('[data-virtual-card-grid]'))`);
    await waitForLayout(page.evaluate, '.deck-card');
    const enabled = await measure('threshold 49→50');
    await page.callFunction(startMeasurement, '[data-deck-card]', '.workspace-main');
    await page.evaluate(`window.refreshTest.resize(49)`);
    await page.until(`document.querySelectorAll('[data-deck-card]').length === 49`);
    await waitForLayout(page.evaluate, '.deck-card');
    const disabled = await measure('threshold 50→49');
    expectStable(enabled);
    expectStable(disabled);
  }, 15000);

  it('keeps the virtual window while its ancestor moves and fresh card objects arrive', async () => {
    await page.send('Page.navigate', { url: new URL('?gridProbe', browserFixtureUrl('catalog-refresh')).href });
    await page.until(`document.querySelectorAll('[data-deck-card]').length === 49`);
    await page.evaluate(`window.refreshTest.resize(80)`);
    await page.until(`Boolean(document.querySelector('[data-virtual-card-grid]'))`);
    await page.evaluate(`document.querySelector('.workspace-main').scrollTop = 1600`);
    await waitForLayout(page.evaluate, '[data-virtual-card-cell]');
    const result = await page.evaluate(`(async () => {
      const grid = document.querySelector('[data-virtual-card-grid]');
      const before = grid.dataset.cardWindow;
      const cells = [...grid.children];
      const animation = grid.parentElement.animate([{ transform: 'translateY(280px)' }, { transform: 'translateY(0px)' }], { duration: 800 });
      window.refreshTest.rebind();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const during = { window: grid.dataset.cardWindow === before, retained: cells.every(cell => cell.isConnected), running: animation.playState === 'running' };
      await animation.finished;
      return during;
    })()`);
    expect(result).toEqual({ window: true, retained: true, running: true });
    await waitForLayout(page.evaluate, '[data-virtual-card-cell]');
  }, 15000);

  it('does not reverse smooth upward scrolling or expose an empty virtual window during a repeat GET', async () => {
    await open(1440, 'light', 4);
    await page.evaluate(`document.querySelector('.workspace-main').scrollTop = 1100`);
    await waitForLayout(page.evaluate, '[data-virtual-card-cell]');
    const result = await page.evaluate(`new Promise((resolve, reject) => {
      const scroll = document.querySelector('.workspace-main');
      const target = scroll.scrollTop - 600;
      let previous = scroll.scrollTop, reversed = false, empty = false, refreshed = false, frames = 0;
      window.refreshTest.delay = 300;
      window.refreshTest.refresh().then(() => { refreshed = true; });
      scroll.scrollTo({ top: target, behavior: 'smooth' });
      const deadline = performance.now() + 5000;
      function sample() {
        frames++;
        reversed ||= scroll.scrollTop > previous + 1;
        previous = scroll.scrollTop;
        empty ||= ![...document.querySelectorAll('[data-virtual-card-cell]')].some(cell => { const r = cell.getBoundingClientRect(); return r.bottom > 180 && r.top < innerHeight; });
        if (refreshed && Math.abs(scroll.scrollTop - target) <= 1) return resolve({ reversed, empty, frames });
        if (performance.now() > deadline) return reject(new Error('Smooth scroll was interrupted'));
        requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    })`);
    expect(result.reversed).toBe(false);
    expect(result.empty).toBe(false);
    expect(result.frames).toBeGreaterThan(3);
  }, 20000);
});
