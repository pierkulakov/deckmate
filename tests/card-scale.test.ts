import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createBrowserSession } from './browser-session.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';
import { waitForLayout } from './browser-layout.ts';

const browserPath = requireBrowser();
describe.skipIf(!browserPath)('card proportions in the real workbench', () => {
  const page = createBrowserSession();
  beforeAll(async () => { await page.open(browserPath!, { viewport: { width: 2000, height: 906, scale: 1 } }); }, 60000);
  afterAll(async () => { await page.close(); }, 20000);
  async function open(parameters = '', ready = '.catalog-results .deck-card') {
    const url = new URL('?view=deck&catalogSource=sandbox&deck=audio&order=priority', browserFixtureUrl('card-scale'));
    for (const [key, value] of new URLSearchParams(parameters.replace(/^&/, ''))) url.searchParams.set(key, value);
    await page.send('Page.navigate', { url: url.href });
    await page.until(`Boolean(document.querySelector(${JSON.stringify(ready)}))`);
    await waitForLayout(page.evaluate, ready);
  }
  async function selectCard(id = 'card:scale-1') {
    await page.callFunction(`id => document.querySelector('[data-deck-card="' + id + '"] .deck-card-open').click()`, id);
    await page.until(`Boolean(document.querySelector('.card-preview-document .check-item'))`);
    await waitForLayout(page.evaluate, '.deck-card, .card-preview-sheet, .card-preview-dock');
  }
  async function measure() {
    return page.evaluate(`(() => {
      const box = selector => { const r = document.querySelector(selector)?.getBoundingClientRect(); return r && { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
      const font = selector => { const e = document.querySelector(selector); if (!e) return null; const s = getComputedStyle(e); return [s.fontSize, s.fontWeight, s.lineHeight]; };
      const tile = '[data-deck-card="card:scale-1"]';
      const groups = [...document.querySelectorAll('.catalog-card-group')];
      const first = groups[0], next = groups[1];
      const label = first.querySelector('.catalog-group-filter').getBoundingClientRect();
      const labelText = first.querySelector('.catalog-group-label').getBoundingClientRect();
      const cards = [...first.querySelectorAll('.deck-card')].map(e => e.getBoundingClientRect());
      const checks = [...document.querySelectorAll('.card-preview-document .check-item')].map(e => e.getBoundingClientRect());
      const rail = [...document.querySelectorAll('.card-preview-action-rail button')].map(e => e.getBoundingClientRect());
      return {
        viewport: [innerWidth, innerHeight], dark: document.documentElement.classList.contains('dark'), tile: box(tile),
        gap: getComputedStyle(first.querySelector('.deck-grid')).columnGap,
        title: font(tile + ' .deck-card-title'), titleBox: box(tile + ' .deck-card-title'),
        strip: box(tile + ' .card-family-trigger'), stripFont: font(tile + ' .card-family-trigger'),
        band: box(tile + ' .deck-card-band'), bandFont: font(tile + ' .card-face-status'), status: box(tile + ' .card-face-status'),
        heroBand: box('[data-deck-card="card:scale-0"] .deck-card-band'),
        emptyHeroBand: box('[data-deck-card="card:scale-4"] .deck-card-band'),
        indicator: box(tile + ' .card-indicator > svg'), effort: box(tile + ' .deck-card-effort'), owner: box(tile + ' .deck-card-owner'), ownerFont: font(tile + ' .deck-card-owner .card-owner-avatar'),
        lane: font('.catalog-group-filter'), laneToTile: Math.min(...cards.map(r => r.y)) - label.bottom,
        nextLane: next.querySelector('.catalog-group-filter').getBoundingClientRect().y - Math.max(...cards.map(r => r.bottom)), rule: box('.catalog-group-rule'),
        laneTextToTile: Math.min(...cards.map(r => r.y)) - labelText.bottom,
        nextLaneText: next.querySelector('.catalog-group-label').getBoundingClientRect().y - Math.max(...cards.map(r => r.bottom)),
        preview: box('.card-preview-sheet'), previewTitle: font('.card-preview-title'), body: font('.card-preview-document .markdown'),
        column: box('.catalog-preview-slot'), shell: box('.card-preview'), header: box('.card-preview-header'), parent: box('.card-preview-parent'),
        dock: box('.card-preview-dock'), panels: box('.card-preview-panels'), workspace: box('.workspace-main'), divider: box('.catalog-resize-line'),
        rail: box('.card-preview-action-rail'), railButton: box('.card-preview-action-rail button'),
        readingInset: getComputedStyle(document.querySelector('.card-preview-reading')).padding,
        panelsOverflow: getComputedStyle(document.querySelector('.card-preview-panels')).overflowY,
        scrollable: document.querySelector('.card-preview-panels').scrollHeight - document.querySelector('.card-preview-panels').clientHeight,
        journey: box('.card-preview-dock-journey'),
        dockControlsOutside: [...document.querySelectorAll('.card-preview-dock :is(button, .card-indicator, .tag-badge-link)')].flatMap(element => {
          const r = element.getBoundingClientRect(), dock = box('.card-preview-dock');
          if (!r.width || !r.height) return [];
          return r.x >= dock.x && r.right <= dock.x + dock.width && r.y >= dock.y && r.bottom <= dock.bottom
            ? [] : [{ control: element.className, bounds: r.toJSON() }];
        }),
        checklist: font('.card-preview-document .check-item'), checklistPitch: checks[1].y - checks[0].y,
        context: box('.card-preview-context .deck-picker-pill'), contextFont: font('.card-preview-context .deck-picker-pill'),
        stateRow: box('.card-preview-state-actions'), stateIcon: box('.card-preview-state-actions svg'),
        edit: box('.card-content-edit-action'), editFont: font('.card-content-edit-action'), idVisible: Boolean(document.querySelector('.card-id-chip')), tagFont: font('.card-preview-relations .tag-badge-name'),
        previewBand: box('.card-preview-material-band'), previewLabel: font('.card-preview-property-shortcut > span'),
        previewPropertyIcon: box('.card-preview-property-shortcut > svg'), previewPropertyName: document.querySelector('.card-preview-property-shortcut')?.getAttribute('aria-label'),
        previewValue: font('.card-preview-property-shortcut > strong'),
        previewOwner: box('.card-preview-owner-shortcut'), railIcon: box('.card-preview-action-rail svg'), railPitch: rail[1].y - rail[0].y,
        titlesFit: [...document.querySelectorAll('.catalog-card-task .deck-card-title')].every(title => {
          const r = title.getBoundingClientRect(), context = title.closest('.deck-card').querySelector('.deck-card-context').getBoundingClientRect();
          return title.scrollWidth <= title.clientWidth && r.height <= 51 && r.height % 17 === 0 && r.bottom <= context.top;
        }),
        statusFits: [...document.querySelectorAll('.deck-card :is(.card-face-state, .card-face-due, .deck-card-effort)')].every(element => {
          const r = element.getBoundingClientRect(), band = element.closest('.deck-card-band').getBoundingClientRect();
          return element.scrollWidth <= element.clientWidth && r.x >= band.x && r.right <= band.right && r.bottom <= band.bottom;
        }),
        footerTextFits: [...document.querySelectorAll('.card-preview-property-shortcut > :is(span, svg, strong)')].every(part => {
          const r = part.getBoundingClientRect(), band = box('.card-preview-material-band'), owner = box('.card-preview-owner-shortcut');
          const overlapsOwner = r.x < owner.x + owner.width && r.right > owner.x && r.y < owner.bottom && r.bottom > owner.y;
          return !overlapsOwner && r.x >= band.x && r.right <= band.x + band.width && r.y >= band.y && r.bottom <= band.bottom;
        }),
        overflow: document.documentElement.scrollWidth > innerWidth || document.querySelector('.workspace-main').scrollWidth > document.querySelector('.workspace-main').clientWidth
      };
    })()`);
  }
  function expectColumn(measurements: Awaited<ReturnType<typeof measure>>, desktop: boolean) {
    expect(measurements.previewTitle).toEqual(['22px', '600', '26px']);
    expect(measurements.body).toEqual(['16px', '400', '22px']);
    expect(measurements.checklist).toEqual(measurements.body);
    expect(measurements.checklistPitch).toBe(34);
    expect(measurements.readingInset).toBe('16px');
    expect(measurements.previewBand.height).toBe(44);
    expect(measurements.previewOwner).toMatchObject({ width: 36, height: 36 });
    expect(measurements.previewOwner.y + 18).toBe(measurements.previewBand.y);
    expect(measurements.footerTextFits).toBe(true);
    expect(measurements.railIcon).toMatchObject({ width: 20, height: 20 });
    expect(measurements.dock.bottom).toBe(measurements.previewBand.y);
    expect(measurements.previewBand.bottom).toBe(measurements.preview.bottom);
    expect(measurements.panels.bottom).toBe(measurements.dock.y);
    expect(measurements.dockControlsOutside).toEqual([]);
    expect(measurements.overflow).toBe(false);
    if (desktop) {
      expect(measurements.railPitch).toBe(36);
      expect(measurements.rail.x - measurements.preview.x - measurements.preview.width).toBe(12);
      expect(measurements.railButton.y).toBe(measurements.preview.y);
      expect(measurements.preview.bottom).toBe(measurements.workspace.bottom - 12);
      expect(measurements.preview.height).toBe(measurements.workspace.bottom - 12 - measurements.preview.y);
      expect(measurements.divider.y).toBe(measurements.shell.y);
      expect(measurements.divider.bottom).toBeGreaterThanOrEqual(measurements.preview.bottom);
      expect(measurements.panelsOverflow).toBe('auto');
    } else {
      expect(measurements.panelsOverflow).toBe('auto');
      expect(measurements.preview.y).toBeLessThanOrEqual(300);
      expect(measurements.preview.bottom).toBeLessThanOrEqual(measurements.viewport[1]);
      expect(measurements.railButton.y).toBeLessThan(measurements.preview.y);
    }
  }
  for (const width of [2560, 2000, 1440, 760, 375]) for (const theme of ['dark', 'light']) {
    it(`matches the card scale with Russian text at ${width}px in ${theme}`, async () => {
      let height = 900;
      if (width === 2000) height = 906;
      if (width === 2560) height = 1440;
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await open('&theme=' + theme);
      await selectCard();
      const measurements = await measure();
      const capture = process.env.DECKMATE_SCALE_CAPTURE;
      if (capture) {
        const destination = path.resolve('.deckmate/inbox/ux/card-scale', `column-${capture}-${width}x${height}-${theme}`);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination + '.json', JSON.stringify(measurements, null, 2));
        const shot = await page.send('Page.captureScreenshot', { format: 'png' });
        await writeFile(destination + '.png', Buffer.from(shot.data, 'base64'));
        if (width <= 760) for (const [suffix, selector] of [['footer', '.card-preview-material-band'], ['tiles', '.catalog-results']]) {
          await page.callFunction(`selector => document.querySelector(selector).scrollIntoView({ block: 'center', behavior: 'instant' })`, selector);
          await waitForLayout(page.evaluate, selector);
          const image = await page.send('Page.captureScreenshot', { format: 'png' });
          await writeFile(destination + '-' + suffix + '.png', Buffer.from(image.data, 'base64'));
        }
      }
      expect(measurements.dark).toBe(theme === 'dark');
      expectColumn(measurements, width > 760);
      if (width === 1440) expect(measurements.column.width).toBe(502);
      if (width === 2560) expect(measurements.column.width).toBe(746);
      expect(measurements.context.height).toBe(22);
      expect(measurements.contextFont).toEqual(['12px', '600', '14px']);
      // 2026-11-10: the state row's height belongs to the state actions rework (card-state-actions.ts) and its own tests.
      expect(measurements.stateIcon).toMatchObject({ width: 16, height: 16 });
      expect(measurements.edit.height).toBe(30);
      expect(measurements.editFont).toEqual(['14px', '600', '16px']);
      expect(measurements.idVisible).toBe(false);
      expect(measurements.tagFont[0]).toBe('12px');
      expect(measurements.previewLabel).toBeNull();
      expect(measurements.previewPropertyIcon).toMatchObject({ width: width === 375 ? 16 : 19, height: width === 375 ? 16 : 19 });
      expect(measurements.previewPropertyName).toMatch(/^Оценка:/u);
      expect(measurements.previewValue).toEqual(['15px', '600', '20px']);
      // 2026-11-10: tile dimensions remain shared across views.
      expect(measurements.tile).toMatchObject({ width: 115, height: 147 });
      expect(measurements.gap).toBe('16px');
      expect(measurements.title).toEqual(['14px', '500', '17px']);
      expect(measurements.titleBox.height).toBe(34);
      expect(measurements.strip.height).toBe(18);
      expect(measurements.stripFont).toEqual(['9.5px', '600', '14px']);
      expect(measurements.titleBox.y - measurements.strip.bottom).toBe(7);
      expect(measurements.titleBox.x - measurements.tile.x).toBe(8);
      expect(measurements.band.height).toBe(Math.max(27, measurements.status.height + 9));
      expect(measurements.bandFont).toEqual(['12px', '500', '16px']);
      expect(measurements.heroBand.height).toBe(35);
      expect(measurements.emptyHeroBand.height).toBe(27);
      expect(measurements.indicator).toBeUndefined();
      expect(measurements.effort.height).toBe(16);
      expect(measurements.owner).toMatchObject({ width: 24, height: 24 });
      expect(measurements.ownerFont).toEqual(['12px', '600', '12px']);
      expect(measurements.statusFits).toBe(true);
      expect(measurements.lane).toEqual(['13px', '500', '14px']); // 2026-11-10: 13px lane labels and a 500 control label follow the Foil Rule.
      if (width >= 1440) {
        expect(measurements.laneTextToTile).toBe(24);
        expect(measurements.nextLaneText).toBe(28);
        expect(measurements.rule.width).toBe(225);
      }
      expect(measurements.titlesFit).toBe(true);
      expect(page.errors).toEqual([]);
    }, 20000);
  }

  for (const [width, height] of [[1440, 900], [2560, 1440]]) for (const theme of ['dark', 'light']) {
    it(`fills short and long sheets and pins the Journey dock at ${width}×${height} in ${theme}`, async () => {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      for (const long of [false, true]) {
        await open(`&theme=${theme}&journey=1${long ? '&long=1' : ''}`);
        for (const id of ['card:scale-1', 'card:scale-0']) {
          await selectCard(id);
          const initial = await measure();
          expectColumn(initial, true);
          expect(initial.column.width).toBe(width === 1440 ? 502 : 746);
          expect(initial.journey.y).toBeGreaterThan(initial.dock.y);
          expect(initial.journey.bottom).toBeLessThan(initial.previewBand.y);
          if (!long) {
            expect(initial.scrollable).toBe(0);
            continue;
          }
          expect(initial.scrollable).toBeGreaterThan(1000);
          for (const position of [.5, 1]) {
            await page.callFunction(`position => {
              const panels = document.querySelector('.card-preview-panels');
              panels.scrollTop = (panels.scrollHeight - panels.clientHeight) * position;
            }`, position);
            await waitForLayout(page.evaluate, '.card-preview-panels');
            expect(await page.evaluate(`document.querySelector('.card-preview-panels').scrollTop`)).toBeGreaterThan(0);
            const scrolled = await measure();
            expectColumn(scrolled, true);
            for (const part of ['preview', 'dock', 'journey', 'previewBand', 'rail', 'column']) expect(scrolled[part], part).toEqual(initial[part]);
          }
        }
      }
      expect(page.errors).toEqual([]);
    }, 20000);

    it(`keeps Properties, Sub Cards and the lifted divider beside the full sheet at ${width}px in ${theme}`, async () => {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await open('&theme=' + theme);
      await selectCard();
      const initial = await measure();
      for (const [button, panel] of [['[aria-controls$="-properties"]', '.card-properties-slot:not([hidden])'], ['[data-card-family]', '.catalog-family-layer > .card-family-panel']]) {
        await page.callFunction(`button => document.querySelector('.card-preview-action-rail button' + button).click()`, button);
        await page.until(`Boolean(document.querySelector(${JSON.stringify(panel)}))`);
        await waitForLayout(page.evaluate, panel + ', .card-preview-sheet, .catalog-resize-line');
        const column = await page.callFunction(`selector => {
          const rect = document.querySelector(selector).getBoundingClientRect();
          const rail = document.querySelector('.card-preview-action-rail').getBoundingClientRect();
          const divider = document.querySelector('.catalog-resize-line').getBoundingClientRect();
          const mark = getComputedStyle(document.querySelector('.card-preview-action-rail button[aria-pressed="true"]'));
          return { gap: rect.x - rail.right, top: rect.y, dividerTop: divider.y, width: rect.width, radius: mark.borderRadius };
        }`, panel);
        expect(column.gap).toBe(12);
        expect(column.top).toBe(initial.shell.y - 8);
        expect(column.dividerTop).toBe(column.top);
        expect(column.width).toBe(379);
        expect(column.radius).toBe('2px');
        const opened = await measure();
        expect(opened.preview).toEqual(initial.preview);
        expect(opened.rail).toEqual(initial.rail);
        expect(opened.dock).toEqual(initial.dock);
        await page.callFunction(`button => document.querySelector('.card-preview-action-rail button' + button).click()`, button);
        await page.until(`!document.querySelector(${JSON.stringify(panel)})`);
      }
      expect(page.errors).toEqual([]);
    }, 20000);
  }

  it('migrates the old saved width and bounds the responsive defaults', async () => {
    for (const [width, expected] of [[900, 420], [1440, 502], [1920, 607], [2600, 754], [3200, 780]]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await open();
      await selectCard();
      expect((await measure()).column.width).toBe(expected);
      expect(await page.evaluate(`localStorage.getItem('deckmate-left-panel-width-v6')`)).toBe(String(expected));
      expect(await page.evaluate(`localStorage.getItem('deckmate-left-panel-width-v5')`)).toBe('503');
    }
  }, 20000);

  it('persists a dragged width in v6 and keeps the 420–800 resize limits', async () => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await open();
    await selectCard();
    const point = await page.evaluate(`(() => { const r = document.querySelector('.catalog-resize-handle').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 40 }; })()`);
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + 148, y: point.y, button: 'left', buttons: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x + 148, y: point.y, button: 'left', buttons: 0, clickCount: 1 });
    await page.until(`localStorage.getItem('deckmate-left-panel-width-v6') === '650'`);
    await open('&keepWidth=1');
    await selectCard();
    expect((await measure()).column.width).toBe(650);
    await page.evaluate(`document.querySelector('.catalog-resize-handle').focus()`);
    for (const [key, value] of [['Home', 420], ['End', 800]] as const) {
      for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: key === 'Home' ? 36 : 35 });
      await waitForLayout(page.evaluate, '.card-preview-sheet');
      expect((await measure()).column.width).toBe(value);
      expect(await page.evaluate(`localStorage.getItem('deckmate-left-panel-width-v6')`)).toBe(String(value));
    }
    expect(page.errors).toEqual([]);
  }, 20000);

  it.each([760, 375])('pins short and long sheets in the phone focus shell at %spx', async width => {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await open();
    await selectCard();
    const short = await measure();
    expectColumn(short, false);
    await open('&long=1');
    await selectCard();
    const long = await measure();
    expectColumn(long, false);
    expect(long.preview).toEqual(short.preview);
    expect(long.scrollable).toBeGreaterThan(1000);
    await page.evaluate(`document.querySelector('.card-preview-panels').scrollTop = 10000`);
    expect(await page.evaluate(`document.querySelector('.card-preview-panels').scrollTop`)).toBeGreaterThan(1000);
    expect((await measure()).dock).toEqual(long.dock);
    expect(page.errors).toEqual([]);
  }, 20000);

  for (const width of [2000, 1440, 760, 375]) for (const theme of ['dark', 'light']) {
    it(`shares the tile in All cards, Unassigned, Hand and planning at ${width}px in ${theme}`, async () => {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      for (const scope of ['scope=all', 'scope=unassigned', 'view=hand&handMember=anna', 'view=timeline']) {
        await open('&theme=' + theme + '&' + scope, '.deck-card');
        expect(await page.evaluate(`(() => {
          const cards = [...document.querySelectorAll('.deck-card')];
          return cards.length > 0 && cards.every(card => {
            const r = card.getBoundingClientRect(), title = getComputedStyle(card.querySelector('.deck-card-title'));
            return r.width === 115 && r.height === 147 && title.fontSize === '14px' && title.fontWeight === '500';
          });
        })()`), scope).toBe(true);
        expect(await page.evaluate(`document.querySelector('.workspace-main').scrollWidth <= document.querySelector('.workspace-main').clientWidth`), scope).toBe(true);
      }
      expect(page.errors).toEqual([]);
    }, 20000);
  }

  it('uses the same open-card proportions on the gold Hero sheet', async () => {
    for (const width of [2560, 1440]) for (const theme of ['dark', 'light']) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: width === 2560 ? 1440 : 900, deviceScaleFactor: 1, mobile: false });
      await open('&theme=' + theme);
      await page.evaluate(`document.querySelector('[data-deck-card="card:scale-0"] .deck-card-open').click()`);
      await page.until(`Boolean(document.querySelector('.card-preview-hero .card-preview-document .check-item'))`);
      await waitForLayout(page.evaluate, '.card-preview-sheet, .card-preview-material-band');
      expect(await page.evaluate(`(() => {
        const root = document.querySelector('.card-preview-hero');
        const band = root.querySelector('.card-preview-material-band').getBoundingClientRect();
        const owner = root.querySelector('.card-preview-owner-shortcut').getBoundingClientRect();
        const title = getComputedStyle(root.querySelector('.card-preview-title'));
        const body = getComputedStyle(root.querySelector('.markdown'));
        return [band.height, owner.width, owner.height, title.fontSize, title.fontWeight, body.fontSize, body.lineHeight];
      })()`)).toEqual([44, 36, 36, '22px', '600', '16px', '22px']);
      if (process.env.DECKMATE_SCALE_CAPTURE) {
        const destination = path.resolve('.deckmate/inbox/ux/card-scale', 'column-' + process.env.DECKMATE_SCALE_CAPTURE + '-hero-' + width + '-' + theme + '.png');
        await mkdir(path.dirname(destination), { recursive: true });
        const image = await page.send('Page.captureScreenshot', { format: 'png' });
        await writeFile(destination, Buffer.from(image.data, 'base64'));
      }
    }
    expect(page.errors).toEqual([]);
  }, 20000);

  it('measures virtual rows from the shared CSS scale after resizing and scrolling', async () => {
    await open('&many=1');
    for (const width of [2000, 1440, 760, 375]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 906, deviceScaleFactor: 1, mobile: false });
      await page.evaluate(`document.querySelector('.workspace-main').scrollTop = 0`);
      await waitForLayout(page.evaluate, '[data-virtual-card-grid]');
      const grid = `[...document.querySelectorAll('[data-virtual-card-grid]')].sort((a, b) => b.clientHeight - a.clientHeight)[0]`;
      await page.evaluate(`(${grid}).scrollIntoView({ block: 'start', behavior: 'instant' })`);
      await page.until(`Boolean((${grid}).querySelector('[data-virtual-card-cell]'))`);
      await waitForLayout(page.evaluate, '[data-virtual-card-grid], [data-virtual-card-cell]');
      for (const end of [false, true]) {
        if (end) {
          await page.evaluate(`(() => { const grid = ${grid}; const scroller = document.querySelector('.workspace-main'); scroller.scrollTop += grid.getBoundingClientRect().bottom - innerHeight; })()`);
          await waitForLayout(page.evaluate, '[data-virtual-card-grid], [data-virtual-card-cell]');
        }
        const result = await page.evaluate(`(() => {
          const grid = ${grid}, columns = Number(grid.dataset.cardWindow.split(':')[2]);
          const count = Number(grid.closest('.catalog-card-group').querySelector('.catalog-group-count').textContent);
          const origin = grid.getBoundingClientRect();
          const cells = [...grid.querySelectorAll('[data-virtual-card-cell]')];
          return { count: cells.length, total: count, height: origin.height, expectedHeight: Math.ceil(count / columns) * 163 - 16,
            rowsFit: cells.every(cell => { const card = cell.querySelector('.deck-card').getBoundingClientRect();
              return card.width === 115 && card.height === 147
                && Math.abs(card.y - origin.y - (Number(cell.style.gridRowStart) - 1) * 163) < 1
                && Math.abs(card.x - origin.x - (Number(cell.style.gridColumnStart) - 1) * 131) < 1; }) };
        })()`);
        expect(result.count).toBeGreaterThan(0);
        expect(result.count).toBeLessThan(result.total);
        expect(result.height).toBe(result.expectedHeight);
        expect(result.rowsFit).toBe(true);
      }
    }
    expect(page.errors).toEqual([]);
  }, 20000);

  it('opens tile settings with the keyboard, returns focus with Escape, and provides a separate 44px touch target', async () => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await open();
    const tile = '[data-deck-card="card:scale-1"]';
    await page.callFunction(`selector => document.querySelector(selector + ' .deck-card-open').focus()`, tile);
    async function key(key: string, code: number) {
      for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: code,
        text: type === 'keyDown' && key === 'Enter' ? '\r' : undefined });
    }
    await key('Tab', 9);
    expect(await page.evaluate(`document.activeElement.className`)).toBe('deck-card-settings');
    await page.until(`getComputedStyle(document.activeElement).opacity === '1'`);
    expect(await page.evaluate(`getComputedStyle(document.activeElement).opacity`)).toBe('1');
    await key('Enter', 13);
    await page.until(`Boolean(document.querySelector('.card-quick-settings'))`);
    expect(await page.evaluate(`document.querySelectorAll('.card-quick-tabs [role="tab"]').length`)).toBe(6);
    await key('Escape', 27);
    await page.until(`!document.querySelector('.card-quick-settings')`);
    await page.until(`document.activeElement.className === 'deck-card-settings'`);
    expect(await page.evaluate(`document.activeElement.className`)).toBe('deck-card-settings');
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 900, deviceScaleFactor: 1, mobile: false });
    await open();
    const target = await page.callFunction(`selector => {
      const button = document.querySelector(selector + ' .deck-card-settings'), r = button.getBoundingClientRect();
      const card = button.closest('.deck-card').getBoundingClientRect();
      return { width:r.width, height:r.height, opacity:getComputedStyle(button).opacity, inside:r.x >= card.x && r.right <= card.right && r.y >= card.y && r.bottom <= card.bottom };
    }`, tile);
    expect(target).toEqual({ width: 44, height: 44, opacity: '1', inside: true });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    expect(page.errors).toEqual([]);
  }, 20000);
});
