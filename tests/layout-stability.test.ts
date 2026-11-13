import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { desktopFixtureUrl } from './browser-fixture.ts';
import { createBrowserSession } from './browser-session.ts';
import { requireBrowser } from './browser-environment.ts';
import { waitForLayout } from './browser-layout.ts';

const browserPath = requireBrowser();
const output = process.env.DECKMATE_LAYOUT_SHOTS;
const measurements: unknown[] = [];

describe.skipIf(!browserPath)('language layout stability (browser)', () => {
  const session = createBrowserSession();
  const { send, evaluate, until } = session;
  beforeAll(async () => {
    await session.open(browserPath!, { extraArgs: ['--disable-features=OverlayScrollbar'] });
    await session.navigate('layout-stability', `Boolean(window.shellTest && document.querySelector('.catalog-spaces'))`);
  }, 90000);
  afterAll(async () => {
    if (output) {
      mkdirSync(output, { recursive: true });
      writeFileSync(path.join(output, 'measurements.json'), JSON.stringify(measurements, null, 2));
    }
    await session.close();
  }, 20000);

  async function size(width: number) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
  }
  async function shot(name: string) {
    if (!output) return;
    mkdirSync(output, { recursive: true });
    const image = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(output, name + '.png'), Buffer.from(image.data, 'base64'));
  }
  async function startMeasurement(selector: string, observeShifts = false) {
    await waitForLayout(evaluate, selector);
    await evaluate(`(() => {
      const nodes = [...new Set([...document.querySelectorAll(${JSON.stringify(selector)}),
        ...(window.layoutScrollports ?? []).filter(node => node.isConnected)])];
      const geometry = node => { const r = node.getBoundingClientRect(); return [r.x, r.y, r.width, r.height, node.scrollLeft, node.scrollTop]; };
      const before = nodes.map(geometry);
      const started = performance.now(), layoutShifts = [];
      const collect = entries => entries.filter(entry => entry.startTime >= started).forEach(entry => layoutShifts.push({
        value: entry.value, recentInput: entry.hadRecentInput,
        sources: entry.sources.map(source => ({ node: source.node?.className || source.node?.parentElement?.className || source.node?.nodeName,
          before: source.previousRect.toJSON(), after: source.currentRect.toJSON() })),
      }));
      const observer = ${observeShifts} ? new PerformanceObserver(list => collect(list.getEntries())) : null;
      observer?.observe({ type: 'layout-shift', buffered: true });
      let frame, frames = 0, maxDelta = 0;
      const shifts = new Map();
      function sample() {
        nodes.forEach((node, index) => {
          const after = geometry(node);
          const delta = Math.max(...after.map((value, axis) => Math.abs(value - before[index][axis])));
          maxDelta = Math.max(maxDelta, delta);
          const key = (node.id || node.className) + ':' + index;
          if ((delta > 1 || !node.isConnected) && delta >= (shifts.get(key)?.delta ?? 0)) shifts.set(key,
            { delta, connected: node.isConnected, before: before[index], after });
        });
        frames++;
        frame = requestAnimationFrame(sample);
      }
      sample();
      window.layoutMeasurement = () => {
        cancelAnimationFrame(frame);
        if (observer) { collect(observer.takeRecords()); observer.disconnect(); }
        return { frames, maxDelta, layoutShift: layoutShifts.reduce((sum, entry) => sum + entry.value, 0), layoutShifts,
          shifts: [...shifts], blocks: nodes.map((node, index) => ({
          key: (node.id || node.className) + ':' + index, before: before[index], after: geometry(node), connected: node.isConnected,
        })) };
      };
    })()`);
  }
  async function finishMeasurement(name: string) {
    const result = await evaluate('window.layoutMeasurement()');
    measurements.push({ name, ...result });
    expect(result.frames).toBeGreaterThan(1);
    expect(result.blocks.length).toBeGreaterThan(3);
    expect.soft(result.shifts.slice(0, 3), name).toEqual([]);
  }
  async function languageRoundTrip(blocks: string, menu = false) {
    if (menu) {
      await evaluate(`document.querySelector('.mission-control-trigger').click()`);
      await until(`Boolean(document.querySelector('.mission-control-menu .lucide-languages'))`);
    }
    for (const lang of ['en', 'ru']) {
      await evaluate(menu ? `document.querySelector('.mission-control-menu .lucide-languages').closest('button').click()`
        : `window.shellTest.setLang('${lang}')`);
      await until(`document.documentElement.lang.split('-')[0] === '${lang}'`);
      await waitForLayout(evaluate, blocks);
    }
    if (menu) {
      await evaluate(`document.querySelector('.mission-control-head button').click()`);
      await until(`!document.querySelector('.mission-control')`);
      await waitForLayout(evaluate, blocks);
    }
  }
  async function scrollBoard() {
    return evaluate(`(() => {
      const ports = [...document.querySelectorAll('.workspace-main, .workspace-main *')].filter(node => {
        const style = getComputedStyle(node);
        return node.clientHeight && ((/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1)
          || (/(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1));
      });
      window.layoutScrollports = ports;
      ports.forEach(node => node.scrollTo({ top: 500, left: 500, behavior: 'instant' }));
      return ports.map(node => ({ name: node.className, top: node.scrollTop, left: node.scrollLeft }));
    })()`);
  }
  async function labelsFit(selector: string) {
    const clipped = await evaluate(`(() => {
      return [...document.querySelectorAll(${JSON.stringify(selector)})].filter(node => {
        const box = node.getBoundingClientRect();
        if (!box.width || !box.height) return false;
        const clipsVertically = /hidden|clip/.test(getComputedStyle(node).overflowY);
        return node.scrollWidth > node.clientWidth + 1 || (clipsVertically && node.scrollHeight > node.clientHeight + 1);
      }).map(node => ({ name: node.className, text: node.textContent, width: node.clientWidth, contentWidth: node.scrollWidth }));
    })()`);
    expect.soft(clipped, selector).toEqual([]);
  }
  async function shortcut() {
    // 2026-11-13: the native accelerator belongs to Tauri; this guards against accidental browser handlers only.
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', {
      type, key: 'P', code: 'KeyP', modifiers: 10, windowsVirtualKeyCode: 80,
    });
  }

  const screens = [
    { name: 'gallery', options: {}, ready: '.catalog-spaces', blocks: '.deck-gallery-header, .catalog-spaces, .catalog-cover-item' },
    { name: 'cards', options: { deck: true, layout: 'cards' }, ready: '[data-virtual-card-cell]', blocks: '.deck-toolbar-content, .catalog-content-layout, .catalog-card-grid, [data-virtual-card-cell], .deck-card' },
    { name: 'table', options: { deck: true }, ready: '.deck-table-row', blocks: '.deck-toolbar-content, .catalog-content-layout, .deck-table-row' },
    { name: 'scope', options: {}, setup: `document.querySelector('.catalog-nav-section:nth-child(2) button').click()`, ready: '.card-scope-view .catalog-content-layout', blocks: '.card-scope-header, .catalog-content-layout, .catalog-card-grid, [data-virtual-card-cell], .deck-card, .deck-table-row' },
    { name: 'hand', options: { view: 'hand' }, ready: '.hand-slot', blocks: '.hand-panel-header, .hand-panel, .hand-tabs, .hand-slot' },
    { name: 'timeline', options: { view: 'timeline' }, ready: '.timeline-axis-panel', blocks: '.planning-view > .page-head, .timeline-axis-panel, .timeline-scroll, .timeline-nothing' },
    { name: 'vision', options: { view: 'vision' }, ready: '.excalidraw', blocks: '.vision-toolbar, .vision-body, .vision-canvas, .vision-links, .vision-panel' },
  ];
  it.each([375, 1440])('locale-shift is zero in Decks, Hand and Timeline at %s px', async width => {
    await size(width);
    expect(await evaluate(`PerformanceObserver.supportedEntryTypes.includes('layout-shift')`)).toBe(true);
    for (const theme of ['light', 'dark']) for (const screen of screens.filter(screen => screen.name !== 'vision')) {
      await evaluate(`window.shellTest.render('app', ${JSON.stringify({ ...screen.options, theme, lang: 'en' })})`);
      if (screen.setup) {
        await until(`Boolean(document.querySelector('.catalog-spaces'))`);
        await evaluate(screen.setup);
      }
      await until(`Boolean(document.querySelector(${JSON.stringify(screen.ready)}))`);
      if (screen.name === 'gallery') await until(`document.querySelector('.project-pulse')?.getAttribute('aria-busy') === 'false'`);
      if (width === 375 && (screen.name === 'cards' || screen.name === 'table')) {
        await evaluate(`document.querySelector('.deck-tools-toggle').click()`);
      }
      const blocks = 'html, .global-topbar, .global-tabs, .workspace-main, ' + screen.blocks
        + ', .deck-gallery-project, .deck-gallery-search, .catalog-browser-navigation, .catalog-browser-navigation button'
        + ', .deck-open-toolbar, .deck-toolbar-search, .deck-open-tools > button, .deck-neighbor-rail [data-deck-cover], .catalog-add-deck'
        + ', .planning-view > .page-head button, .hand-panel-header button, .hand-tabs button';
      for (const lang of ['ru', 'en']) {
        const name = `${screen.name}-${theme}-${width}-${lang}`;
        await startMeasurement(blocks, true);
        await evaluate(`window.shellTest.setLang('${lang}')`);
        await until(`document.documentElement.lang.split('-')[0] === '${lang}'`);
        await waitForLayout(evaluate, blocks);
        const result = await evaluate('window.layoutMeasurement()');
        measurements.push({ name, ...result });
        expect.soft(result.layoutShift, name + JSON.stringify(result.layoutShifts)).toBe(0);
        expect.soft(result.maxDelta, name + JSON.stringify(result.shifts)).toBe(0);
        expect.soft(result.blocks.every((block: { connected: boolean }) => block.connected), name + ' retained nodes').toBe(true);
        await labelsFit('.catalog-browser-navigation button, .deck-gallery-add, .deck-open-tools > button, .hand-tabs button, .project-pulse-label, .project-pulse-toggle');
        expect.soft(await evaluate('document.documentElement.scrollWidth <= innerWidth'), name + ' page overflow').toBe(true);
        expect.soft(await evaluate(`document.querySelector('.workspace-main').scrollWidth <= document.querySelector('.workspace-main').clientWidth`), name + ' workspace overflow').toBe(true);
      }
    }
    expect(session.errors).toEqual([]);
  }, 180000);
  it.each([375, 1440])('locale-shift is zero in Vision at %s px', async width => {
    await size(width);
    expect(await evaluate(`PerformanceObserver.supportedEntryTypes.includes('layout-shift')`)).toBe(true);
    const blocks = 'html, .global-topbar, .global-tabs, .workspace-main, .vision-toolbar, .vision-toolbar .page-head-main, .vision-toolbar .page-tools'
      + ', .vision-board-name, .vision-save-state, .vision-toolbar button, .vision-board-picker, .vision-viewport-tools, .vision-viewport-tools button'
      + ', .vision-body, .vision-canvas, .vision-links, .vision-linked-list, .vision-card-row, .vision-panel, .vision-panel .panel-count'
      + ', .vision-tools input, .vision-tools select, .vision-tools button';
    for (const theme of ['light', 'dark']) {
      await evaluate(`window.shellTest.render('app', { view: 'vision', theme: '${theme}', lang: 'ru' })`);
      await until(`Boolean(document.querySelector('.excalidraw canvas')) && document.querySelector('.vision-save-state')?.textContent === 'Сохранено'`);
      await until(`document.querySelectorAll('.vision-linked-list .vision-card-row').length === 1`);
      for (const board of ['saved', 'new']) {
        if (board === 'new') {
          await evaluate(`document.querySelector('.vision-new-board').click()`);
          await until(`Boolean(document.querySelector('.excalidraw canvas')) && document.querySelector('.vision-save-state')?.textContent === 'Новая доска'`);
        }
        for (const scrolled of [false, true]) {
          if (scrolled) await scrollBoard();
          else await evaluate(`document.querySelectorAll('.workspace-main, .vision-body, .vision-links').forEach(node => node.scrollTo({ top: 0, left: 0, behavior: 'instant' }))`);
          const name = `vision-${board}-${theme}-${width}${scrolled ? '-scrolled' : ''}`;
          await startMeasurement(blocks, true);
          await languageRoundTrip(blocks);
          const result = await evaluate('window.layoutMeasurement()');
          measurements.push({ name, ...result });
          expect(result.frames, name).toBeGreaterThan(1);
          expect.soft(result.layoutShift, name + JSON.stringify(result.layoutShifts)).toBe(0);
          expect.soft(result.maxDelta, name + JSON.stringify(result.shifts)).toBe(0);
          expect.soft(result.blocks.every((block: { connected: boolean }) => block.connected), name + ' retained nodes').toBe(true);
          await labelsFit('.vision-toolbar-actions button, .vision-access, .vision-viewport-tools button, .vision-links .reserved-text, .sidebar-trigger__label');
          expect.soft(await evaluate('document.documentElement.scrollWidth <= innerWidth'), name + ' page overflow').toBe(true);
          expect.soft(await evaluate(`['.workspace-main', '.vision-body', '.vision-links'].every(selector => {
            const node = document.querySelector(selector); return node.scrollWidth <= node.clientWidth;
          })`), name + ' scrollport overflow').toBe(true);
          await shot(name);
        }
      }
    }
    expect(session.errors).toEqual([]);
  }, 90000);
  it.each([375, 1440])('retains board blocks and scroll offsets at %s px', async width => {
    await size(width);
    for (const theme of ['light', 'dark']) for (const screen of screens) {
      const name = `${screen.name}-${theme}-${width}`;
      await evaluate(`window.shellTest.render('app', ${JSON.stringify({ ...screen.options, theme, lang: 'ru' })})`);
      if (screen.setup) {
        await until(`Boolean(document.querySelector('.catalog-spaces'))`);
        await evaluate(screen.setup);
      }
      await until(`Boolean(document.querySelector(${JSON.stringify(screen.ready)}))`);
      if (screen.name === 'cards') {
        const cells = await evaluate(`document.querySelectorAll('[data-virtual-card-cell]').length`);
        expect(cells).toBeGreaterThan(0);
        expect(cells).toBeLessThan(240);
      }
      const blocks = 'html, .global-topbar, .global-tabs, .workspace-main, ' + screen.blocks;
      await waitForLayout(evaluate, blocks);
      await shot(name + '-before');
      await startMeasurement(blocks);
      await shortcut();
      await waitForLayout(evaluate, blocks);
      await finishMeasurement(name + '-shortcut');
      await startMeasurement(blocks, true);
      await languageRoundTrip(blocks);
      await shot(name + '-after');
      await finishMeasurement(name + '-language');
      await labelsFit('.catalog-browser-navigation button, .global-tabs button, .vision-toolbar-actions button, .vision-links .reserved-text');
      const scroll = await scrollBoard();
      expect(scroll.some((port: { top: number; left: number }) => port.top > 0 || port.left > 0), name).toBe(true);
      measurements.push({ name: name + '-scrollports', scroll });
      await startMeasurement(blocks);
      await shortcut();
      await waitForLayout(evaluate, blocks);
      await languageRoundTrip(blocks, true);
      await finishMeasurement(name + '-scrolled');
    }
    expect(session.errors).toEqual([]);
  }, 180000);

  it.each([375, 1440])('retains Mission Control rows, controls and scroll offsets at %s px', async width => {
    await size(width);
    for (const theme of ['light', 'dark']) {
      await evaluate(`window.shellTest.render('app', { workspace: true, theme: '${theme}', lang: 'ru' })`);
      await until(`Boolean(document.querySelector('.catalog-spaces'))`);
      await evaluate(`document.querySelector('.mission-control-trigger').click()`);
      await until(`document.querySelectorAll('.mission-control-workspace-row').length === 4`);
      const blocks = '.mission-control, .mission-control-head, .mission-control-project, .mission-control-workspace-row, .mission-control-menu > button, .mission-control-sections, .mission-control-foot';
      await waitForLayout(evaluate, blocks);
      await evaluate(`window.layoutScrollports = [document.querySelector('.mission-control'), document.querySelector('.mission-control-workspace-list')]; window.layoutScrollports.forEach(node => node.scrollTop = 40)`);
      await shot(`mission-control-${theme}-${width}-before`);
      await startMeasurement(blocks);
      for (const lang of ['en', 'ru']) {
        await evaluate(`document.querySelector('.mission-control-menu .lucide-languages').closest('button').click()`);
        await until(`document.documentElement.lang === '${lang}'`);
        await waitForLayout(evaluate, blocks);
      }
      await finishMeasurement(`mission-control-${theme}-${width}`);
      await shot(`mission-control-${theme}-${width}-after`);
      await labelsFit('.mission-control .reserved-text');
    }
  });

  it.each([375, 1440])('retains launcher blocks and scroll offsets at %s px', async width => {
    await size(width);
    for (const theme of ['light', 'dark']) for (const scenario of ['many', 'empty', 'create', 'error']) {
      const url = new URL(desktopFixtureUrl());
      url.searchParams.set('scenario', scenario);
      url.searchParams.set('error', 'create-failed');
      await send('Page.navigate', { url: url.href });
      await until(`Boolean(document.querySelector('#launcher:not([aria-busy])'))`);
      if (scenario === 'create') await until(`!document.querySelector('#create-panel').hidden`);
      if (scenario === 'error') await until(`document.querySelector('#status').dataset.phase === 'error'`);
      if (scenario === 'empty') await evaluate(`document.querySelector('.template-help').open = true`);
       await evaluate(`document.documentElement.classList.toggle('dark', ${theme === 'dark'}); if (document.documentElement.lang !== 'ru') document.querySelector('.language-toggle').click()`);
      await until(`document.documentElement.lang === 'ru'`);
       const blocks = 'html, .intro, .actions, .action, .table, .project-sections, .recent-head, .mission-control-workspace-row, .welcome, .create-panel, .bar, .bar-tools, .status-copy';
      const name = `launcher-${scenario}-${theme}-${width}`;
      await waitForLayout(evaluate, blocks);
      await shot(name + '-before');
      await startMeasurement(blocks);
      await shortcut();
      await waitForLayout(evaluate, blocks);
      await finishMeasurement(name + '-shortcut');
      await startMeasurement(blocks);
       await evaluate(`document.querySelector('.language-toggle').click()`);
      await until(`document.documentElement.lang === 'en'`);
      await waitForLayout(evaluate, blocks);
       await evaluate(`document.querySelector('.language-toggle').click()`);
      await until(`document.documentElement.lang === 'ru'`);
      await waitForLayout(evaluate, blocks);
      await shot(name + '-after');
      await finishMeasurement(name + '-language');
       await labelsFit('.reserved-text');
      const scroll = await evaluate(`(() => {
        const node = innerWidth <= 760 ? document.scrollingElement : document.querySelector('.project-sections');
        node.scrollTo({ top: ${scenario === 'many' ? '500' : 'node.scrollHeight'}, behavior: 'instant' });
        return node.scrollTop;
      })()`);
      if (scenario === 'many') expect(scroll).toBeGreaterThan(0);
      await startMeasurement(blocks);
      await shot(name + '-scrolled-before');
       await evaluate(`document.querySelector('.language-toggle').click()`);
      await until(`document.documentElement.lang === 'en'`);
      await waitForLayout(evaluate, blocks);
       await evaluate(`document.querySelector('.language-toggle').click()`);
      await until(`document.documentElement.lang === 'ru'`);
      await waitForLayout(evaluate, blocks);
      await shot(name + '-scrolled-after');
      await finishMeasurement(name + '-scrolled');
    }
  }, 90000);
});
