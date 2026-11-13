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
        band: box(tile + ' .deck-card-band'), stateWord: Boolean(document.querySelector(tile + ' .card-face-status')),
        heroBand: box('[data-deck-card="card:scale-0"] .deck-card-band'),
        emptyHeroBand: box('[data-deck-card="card:scale-4"] .deck-card-band'),
        indicator: box(tile + ' .card-hand-indicator > svg'), effort: box(tile + ' .deck-card-metrics'), effortFont: font(tile + ' .deck-card-metrics strong'), priorityIcon: box(tile + ' .priority-icon svg'), owner: box(tile + ' .deck-card-owner-medallion'), ownerFont: font(tile + ' .deck-card-owner .card-owner-avatar'),
        lane: font('.catalog-group-filter'), laneToTile: Math.min(...cards.map(r => r.y)) - label.bottom,
        nextLane: next.querySelector('.catalog-group-filter').getBoundingClientRect().y - Math.max(...cards.map(r => r.bottom)), rule: box('.catalog-group-rule'),
        laneTextToTile: Math.min(...cards.map(r => r.y)) - labelText.bottom,
        nextLaneText: next.querySelector('.catalog-group-label').getBoundingClientRect().y - Math.max(...cards.map(r => r.bottom)),
        preview: box('.card-preview-sheet'), previewTitle: font('.card-preview-title'), body: font('.card-preview-document .markdown'),
        column: box('.catalog-preview-slot'), shell: box('.card-preview'), header: box('.card-preview-header'), parent: box('.card-preview-parent'),
        dock: box('.card-preview-dock'), panels: box('.card-preview-panels'), workspace: box('.workspace-main'), divider: box('.catalog-resize-line'), toolbar: box('.deck-open-toolbar'),
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
        edit: box('.card-content-edit-action'), editFont: font('.card-content-edit-action'), idVisible: Boolean(document.querySelector('.card-id-chip')), tagFont: font('.card-preview-tags .tag-badge-name'),
        previewBand: box('.card-preview-material-band'), previewLabel: font('.card-preview-property-label'),
        previewLabelVisible: Boolean(box('.card-preview-property-label')?.width),
        previewPropertyIcon: box('.card-preview-property-shortcut > svg'), previewPropertyName: document.querySelector('.card-preview-property-shortcut')?.getAttribute('aria-label'),
        previewValue: font('.card-preview-property-shortcut > strong'),
        previewOwner: box('.card-preview-owner-shortcut'), railIcon: box('.card-preview-action-rail svg'), railPitch: rail[1].y - rail[0].y,
        titlesFit: [...document.querySelectorAll('.catalog-card-task .deck-card-title')].every(title => {
          const r = title.getBoundingClientRect(), context = title.closest('.deck-card').querySelector('.deck-card-face-meta').getBoundingClientRect();
          return title.scrollWidth <= title.clientWidth && r.height <= 51 && r.height % 17 === 0 && r.bottom <= context.top;
        }),
        statusFits: [...document.querySelectorAll('.deck-card .card-face-status')].every(element => {
          const r = element.getBoundingClientRect(), face = element.closest('.deck-card-face').getBoundingClientRect();
          const hand = element.parentElement.querySelector('.deck-card-hand-row')?.getBoundingClientRect();
          return element.scrollWidth <= element.clientWidth && r.x >= face.x && r.right <= face.right && r.bottom <= (hand?.top ?? face.bottom);
        }),
        footerTextFits: [...document.querySelectorAll('.card-preview-property-shortcut > :is(span, svg, strong)')].every(part => {
          const r = part.getBoundingClientRect(), band = box('.card-preview-material-band'), owner = box('.card-preview-owner-shortcut');
          if (!r.width || !r.height) return true;
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
    expect(measurements.previewBand.height).toBe(64);
    expect(measurements.previewOwner).toMatchObject({ width: 56, height: 56 });
    expect(measurements.previewOwner.y + 28).toBe(measurements.previewBand.y);
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
      expect(measurements.divider.y).toBe(measurements.toolbar.bottom);
      expect(measurements.divider.bottom).toBe(measurements.preview.bottom);
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
      expect(measurements.idVisible).toBe(true);
      expect(measurements.tagFont[0]).toBe('12px');
      expect(measurements.previewLabel).toEqual(['13px', '600', '18px']);
      expect(measurements.previewLabelVisible).toBe(measurements.preview.width > 400);
      expect(measurements.previewPropertyIcon).toMatchObject({ width: 22, height: 22 });
      expect(measurements.previewPropertyName).toMatch(/^Оценка:/u);
      expect(measurements.previewValue).toEqual(['20px', '500', '24px']);
      // 2026-11-10: tile dimensions remain shared across views.
      expect(measurements.tile).toMatchObject({ width: 115, height: 147 });
      expect(measurements.gap).toBe('16px');
      expect(measurements.title).toEqual(['14px', '500', '17px']);
      expect(measurements.titleBox.height).toBe(51);
      expect(measurements.strip.height).toBe(18);
      expect(measurements.stripFont).toEqual(['9.5px', '600', '14px']);
      expect(measurements.titleBox.y - measurements.strip.bottom).toBe(7);
      expect(measurements.titleBox.x - measurements.tile.x).toBe(8);
      expect(measurements.band.height).toBe(24);
      // The tile face carries no workflow word; the band and the accessible name say the state.
      expect(measurements.stateWord).toBe(false);
      expect(measurements.heroBand.height).toBe(29);
      expect(measurements.emptyHeroBand.height).toBe(29);
      expect(measurements.indicator).toMatchObject({ width: 16, height: 16 });
      expect(measurements.effort.height).toBe(16);
      expect(measurements.effortFont).toEqual(['13px', '700', '16px']);
      expect(measurements.priorityIcon).toMatchObject({ width: 14, height: 14 });
      expect(measurements.owner).toMatchObject({ width: 23, height: 23 });
      expect(measurements.owner.x + measurements.owner.width / 2).toBe(measurements.tile.x + measurements.tile.width / 2);
      expect(Math.abs(measurements.owner.y + measurements.owner.height / 2 - measurements.band.y)).toBeLessThanOrEqual(1);
      expect(measurements.ownerFont).toEqual(['8px', '600', '8px']);
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
            // 2026-11-11: the restored chrome can leave a partial reading line to scroll; the dock remains pinned.
            expect(initial.scrollable).toBeLessThanOrEqual(parseFloat(initial.body[2]));
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
          return { gap: rect.x - rail.right, top: rect.y, bottom: rect.bottom, dividerTop: divider.y, dividerBottom: divider.bottom, width: rect.width, radius: mark.borderRadius };
        }`, panel);
        expect(column.gap).toBe(12);
        expect(column.top).toBe(initial.shell.y - 8);
        expect(column.dividerTop).toBe(column.top);
        expect(column.dividerBottom).toBe(column.bottom);
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

  it('keeps the sticky divider level with the visible panel while the outer card list scrolls', async () => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await open('&many=1');
    await selectCard();
    expect(await page.evaluate(`getComputedStyle(document.querySelector('.catalog-resize-line')).position`)).toBe('sticky');
    for (const [button, panel] of [[null, null], ['[aria-controls$="-properties"]', '.card-properties-slot:not([hidden])'], ['[data-card-family]', '.catalog-family-layer > .card-family-panel']]) {
      if (button) {
        await page.callFunction(`button => document.querySelector('.card-preview-action-rail button' + button).click()`, button);
        await page.until(`Boolean(document.querySelector(${JSON.stringify(panel)}))`);
      }
      for (const offset of [0, 400]) {
        await page.callFunction(`offset => { document.querySelector('.workspace-main').scrollTop = offset; }`, offset);
        await waitForLayout(page.evaluate, '.card-preview, .catalog-resize-line, .card-properties-slot, .card-family-panel');
        const current = await measure();
        const top = panel ? await page.callFunction(`selector => document.querySelector(selector).getBoundingClientRect().top`, panel) : current.toolbar.bottom;
        expect(current.divider.y).toBe(top);
        expect(current.divider.bottom).toBe(current.preview.bottom);
        if (offset) expect(await page.evaluate(`document.querySelector('.workspace-main').scrollTop`)).toBeGreaterThan(0);
      }
      if (button) {
        await page.callFunction(`button => document.querySelector('.card-preview-action-rail button' + button).click()`, button);
        await page.until(`!document.querySelector(${JSON.stringify(panel)})`);
      }
    }
    expect(page.errors).toEqual([]);
  }, 20000);

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
      })()`)).toEqual([64, 56, 56, '22px', '600', '16px', '22px']);
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
    expect(await page.callFunction(`selector => {
      const tile = document.querySelector(selector);
      return [getComputedStyle(tile.querySelector('.deck-card-owner-medallion')).borderTopWidth,
        getComputedStyle(tile.querySelector('.card-owner-avatar')).borderTopWidth,
        getComputedStyle(tile.querySelector('.deck-card-settings')).outlineStyle,
        getComputedStyle(tile.querySelector('.deck-card-settings')).boxShadow];
    }`, tile)).toEqual(['1px', '0px', 'none', 'none']);
    await page.callFunction(`selector => document.querySelector(selector + ' .deck-card-open').focus()`, tile);
    async function key(key: string, code: number) {
      for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: code,
        text: type === 'keyDown' && key === 'Enter' ? '\r' : undefined });
    }
    await key('Tab', 9);
    expect(await page.evaluate(`document.activeElement.className`)).toBe('deck-card-settings');
    expect(await page.evaluate(`document.activeElement.matches(':focus-visible') && getComputedStyle(document.activeElement).outlineWidth === '2px'`)).toBe(true);
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
      const band = button.closest('.deck-card-band').getBoundingClientRect();
      return { width:r.width, height:r.height, opacity:getComputedStyle(button).opacity, top:r.top - band.top };
    }`, tile);
    expect(target).toEqual({ width: 44, height: 44, opacity: '1', top: 0 });
    await page.callFunction(`selector => document.querySelector(selector).scrollIntoView({ block: 'center', behavior: 'instant' })`, tile);
    await waitForLayout(page.evaluate, tile);
    const points = await page.callFunction(`selector => {
      const card = document.querySelector(selector), band = card.querySelector('.deck-card-band').getBoundingClientRect();
      const center = band.left + band.width / 2;
      const button = (x, y) => document.elementFromPoint(x, y)?.closest('button')?.className ?? '';
      const metric = property => { const r = card.querySelector('[data-shortcut-property="' + property + '"]').getBoundingClientRect();
        return button(r.x + r.width / 2, r.y + r.height / 2); };
      return { face: { x: center + 18, y: band.top - 8 }, faceHit: button(center + 18, band.top - 8),
        owner: { x: center, y: band.top + 8 }, ownerHit: button(center, band.top + 8), effort: metric('effort'), priority: metric('priority'),
        effortEdge: button(band.left + 4, band.bottom - 2), priorityEdge: button(band.right - 6, band.bottom - 2) };
    }`, tile);
    expect(points.faceHit).toContain('deck-card-open');
    expect(points.ownerHit).toContain('deck-card-settings');
    expect(points.effort).toContain('deck-card-metric');
    expect(points.priority).toContain('deck-card-metric');
    // The band is too low for a 44px target, so each metric's target reaches the tile's edge and the band's bottom.
    expect(points.effortEdge).toContain('deck-card-metric');
    expect(points.priorityEdge).toContain('deck-card-metric');
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points.face] });
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.until(`Boolean(document.querySelector('.card-preview-sheet'))`);
    await open();
    await page.callFunction(`selector => document.querySelector(selector).scrollIntoView({ block: 'center', behavior: 'instant' })`, tile);
    await waitForLayout(page.evaluate, tile);
    const ownerPoint = await page.callFunction(`selector => {
      const r = document.querySelector(selector + ' .deck-card-settings').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + 8 };
    }`, tile);
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [ownerPoint] });
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.until(`Boolean(document.querySelector('.card-quick-settings'))`);
    expect(await page.evaluate(`document.querySelector('.card-quick-tabs [role="tab"][aria-selected="true"]').getAttribute('aria-label')`)).toBe('Исполнитель');
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    expect(page.errors).toEqual([]);
  }, 20000);

  it('keeps touch grips clear of English and Russian titles, with and without a parent', async () => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      await open('&order=manual');
      await page.evaluate(`document.querySelector('.deck-overview-collapse')?.click()`);
      for (const id of ['card:scale-1', 'card:scale-2']) for (const text of ['Paint the harbor color script', 'Подготовить звуки деревянного причала']) {
        const result = await page.callFunction(`(id, text) => {
          const card = document.querySelector('[data-deck-card="' + id + '"]');
          const title = card.querySelector('.deck-card-title');
          title.textContent = text;
          const grip = card.querySelector('.card-transfer-handle').getBoundingClientRect();
          const bounds = title.getBoundingClientRect(), range = document.createRange(), node = title.firstChild;
          const overlap = [];
          for (let i = 0; i < node.length; i++) {
            range.setStart(node, i); range.setEnd(node, i + 1);
            const r = range.getBoundingClientRect();
            if (r.bottom <= bounds.bottom + .5 && r.top < grip.bottom && r.bottom > grip.top && r.left < grip.right && r.right > grip.left)
              overlap.push(node.textContent[i]);
          }
          const tile = card.getBoundingClientRect();
          return { overlap, width: tile.width, height: tile.height, padding: getComputedStyle(title).paddingRight };
        }`, id, text);
        expect(result.overlap, id + ': ' + text).toEqual([]);
        expect(result).toMatchObject({ width: 115, height: 147, padding: '20px' });
      }
      await page.evaluate(`document.querySelector('[data-deck-card="card:scale-1"] .card-transfer-handle').scrollIntoView({ block: 'center', behavior: 'instant' })`);
      await waitForLayout(page.evaluate, '[data-deck-card="card:scale-1"]');
      const start = await page.evaluate(`(() => { const r = document.querySelector('[data-deck-card="card:scale-1"] .card-transfer-handle').getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, id: 1 }; })()`);
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
      await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...start, x: start.x + 20 }] });
      await page.until(`Boolean(document.querySelector('.card-transfer-targets'))`);
      await page.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      await page.until(`!document.querySelector('.card-transfer-targets')`);
      expect(page.errors).toEqual([]);
    } finally { await page.send('Emulation.setTouchEmulationEnabled', { enabled: false }); }
  }, 20000);

  it('clears the sticky divider and keyboard focus above the first ungrouped row', async () => {
    for (const width of [1440, 375]) for (const theme of ['dark', 'light']) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await open('&order=manual&theme=' + theme);
      await page.evaluate(`document.querySelector('.deck-overview-collapse')?.click()`);
      await waitForLayout(page.evaluate, '.catalog-card-grid, .deck-open-toolbar');
      for (const selected of [false, true]) {
        if (selected) await page.evaluate(`document.querySelector('.catalog-card-grid .catalog-card-checkbox').click()`);
        await waitForLayout(page.evaluate, '.catalog-card-grid, .deck-open-toolbar');
        await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        await page.evaluate(`document.querySelector('.catalog-card-grid .catalog-card-checkbox').focus({ preventScroll: true })`);
        const result = await page.evaluate(`(() => {
          const checkbox = document.querySelector('.catalog-card-grid .catalog-card-checkbox');
          const box = checkbox.getBoundingClientRect(), header = document.querySelector('.deck-open-toolbar').getBoundingClientRect();
          const style = getComputedStyle(checkbox);
          return { clearance: box.top - parseFloat(style.outlineWidth) - parseFloat(style.outlineOffset) - (header.bottom + 8),
            focus: checkbox.matches(':focus-visible'), selected: checkbox.checked,
            offset: parseFloat(style.top), padding: getComputedStyle(document.querySelector('.catalog-card-grid')).paddingTop };
        })()`);
        expect(result.focus).toBe(true);
        expect(result.selected).toBe(selected);
        expect(result.offset).toBe(-8);
        expect(result.padding).toBe('12px');
        expect(result.clearance).toBeGreaterThanOrEqual(0);
        if (!selected) for (const [x, y] of [[-8, -8], [-8, 8], [8, -8], [8, 8]]) {
          await page.callFunction(`(x, y) => {
            const card = document.querySelector('.catalog-card-grid .deck-card');
            card.style.setProperty('--tilt-x', x + 'deg'); card.style.setProperty('--tilt-y', y + 'deg');
            getComputedStyle(card).transform;
            card.getAnimations().forEach(animation => { try { animation.finish(); } catch {} });
          }`, x, y);
          const clearance = await page.evaluate(`(() => {
            const box = document.querySelector('.catalog-card-grid .catalog-card-checkbox').getBoundingClientRect();
            const header = document.querySelector('.deck-open-toolbar').getBoundingClientRect();
            return box.top - 4 - (header.bottom + 8);
          })()`);
          expect(clearance, `tilt ${x}/${y}`).toBeGreaterThanOrEqual(0);
        }
        if (!selected) await page.evaluate(`(() => {
          const card = document.querySelector('.catalog-card-grid .deck-card');
          card.style.setProperty('--tilt-x', '0deg'); card.style.setProperty('--tilt-y', '0deg');
          getComputedStyle(card).transform;
          card.getAnimations().forEach(animation => { try { animation.finish(); } catch {} });
        })()`);
      }
    }
    expect(page.errors).toEqual([]);
  }, 30000);

  it('clears the separate sticky selection dock in the all-cards scope', async () => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const url = new URL('?view=deck&catalogSource=sandbox&scope=all&order=manual', browserFixtureUrl('card-scale'));
    await page.send('Page.navigate', { url: url.href });
    await page.until(`Boolean(document.querySelector('.catalog-card-grid .catalog-card-checkbox'))`);
    await waitForLayout(page.evaluate, '.catalog-card-grid');
    await page.evaluate(`document.querySelector('.catalog-card-grid .catalog-card-checkbox').click()`);
    await page.until(`Boolean(document.querySelector('.catalog-selection-dock'))`);
    await waitForLayout(page.evaluate, '.catalog-card-grid, .catalog-selection-dock');
    const clearance = await page.evaluate(`(() => {
      const box = document.querySelector('.catalog-card-grid .catalog-card-checkbox').getBoundingClientRect();
      const dock = document.querySelector('.catalog-selection-dock').getBoundingClientRect();
      return box.top - 4 - (dock.bottom + 8);
    })()`);
    expect(clearance).toBeGreaterThanOrEqual(0);
    expect(page.errors).toEqual([]);
  }, 20000);
});
