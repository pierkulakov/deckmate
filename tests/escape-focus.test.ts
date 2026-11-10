import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';

const browserPath = requireBrowser();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const tile = '.catalog-results [data-card-id="card:hero"]';
const face = tile + ' .deck-card-open';
const checkbox = tile + ' .catalog-card-checkbox';

describe.skipIf(!browserPath)('editor Escape returns one tile focus indicator (browser)', () => {
  let page: HeadlessPage;
  async function until(expression: string) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await page.evaluate(expression)) return;
      await delay(40);
    }
    throw new Error('Timed out: ' + expression + '\n' + page.consoleErrors.join('\n'));
  }
  async function click(selector: string) {
    const point = await page.callFunction(`selector => {
      const element = document.querySelector(selector);
      element.scrollIntoView({ block: 'nearest' });
      const box = element.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }`, selector);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await page.send('Input.dispatchMouseEvent', { type, ...point, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
    }
  }
  async function key(key: string, code = key) {
    const codes: Record<string, number> = { Escape: 27, Tab: 9, ' ': 32 };
    for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: codes[key] });
  }
  async function state() {
    return page.callFunction(`selector => {
      const space = document.querySelector(selector);
      const tile = space.querySelector('.deck-card');
      const face = space.querySelector('.deck-card-open');
      const checkbox = space.querySelector('.catalog-card-checkbox');
      const style = getComputedStyle(tile);
      return { focused: document.activeElement === face, focusVisible: face.matches(':focus-visible'),
        outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth,
        shadow: style.boxShadow, border: style.borderColor, checkbox: getComputedStyle(checkbox).opacity,
        checked: checkbox.checked, hovered: space.matches(':hover'), current: tile.classList.contains('is-selected') };
    }`, tile);
  }
  async function settleTile() {
    await page.callFunction(`async selector => {
      const card = document.querySelector(selector).querySelector('.deck-card');
      await Promise.all(card.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
    }`, tile);
  }
  async function render(theme: string, kind = 'task') {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
    await page.callFunction('selector => document.querySelector(selector)?.setAttribute("data-escape-focus-previous", "")', tile);
    await page.callFunction('options => window.heroReturnTest.render(options)', { theme, kind, withoutJourney: true });
    await until(`Boolean(document.querySelector('${face}')) && !document.querySelector('${tile}[data-escape-focus-previous]')`);
    await settleTile();
    return state();
  }
  async function edit() {
    await click(face);
    await until(`Boolean(document.querySelector('.card-title-edit:not(:disabled)'))`);
    await click('.card-title-edit');
    await until(`document.activeElement === document.querySelector('.card-edit-text')`);
  }
  async function expectSingleFocus(rest: Awaited<ReturnType<typeof state>>, current: boolean) {
    await until(`document.activeElement === document.querySelector('${face}') && !document.querySelector('.card-edit-text')`);
    // 2026-11-10: compare against the resting material, not "shadow: none" — the card's own depth must survive.
    await until(`getComputedStyle(document.querySelector('${checkbox}')).opacity === '0'`);
    await settleTile();
    expect(await state()).toEqual({ ...rest, focused: true, focusVisible: true, outlineStyle: 'solid', outlineWidth: '2px', current });
  }

  beforeAll(async () => {
    page = await openHeadlessBrowser({ width: 1700, height: 1000, scale: 1 });
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await page.send('Page.navigate', { url: browserFixtureUrl('escape-focus') });
    await until('Boolean(window.heroReturnTest && document.querySelector(".catalog-results .deck-card-open"))');
  }, 90000);
  afterAll(async () => { await page?.close(); }, 20000);

  for (const theme of ['light', 'dark']) {
    it.each(['task', 'hero', 'doc'])(`${theme}: %s editor Escape and second Escape retain focus without mint/checkbox`, async kind => {
      const rest = await render(theme, kind);
      await edit();
      await key('Escape');
      await expectSingleFocus(rest, true);
      expect(await page.evaluate('Boolean(document.querySelector(".card-preview"))')).toBe(true);
      await key('Escape');
      await until('!document.querySelector(".card-preview")');
      await expectSingleFocus(rest, false);
    });

    it(`${theme}: mouse cancel/close do not leave hover or a selection checkbox`, async () => {
      const rest = await render(theme);
      await edit();
      await click('.card-edit-link.is-cancel');
      await until(`!document.querySelector('.card-edit-text') && document.activeElement === document.querySelector('${face}')`);
      await click('.card-preview-tools button');
      await until('!document.querySelector(".card-preview")');
      await settleTile();
      const closed = await state();
      expect(closed).toMatchObject({ focused: true, current: false, checked: false, hovered: false, checkbox: '0', shadow: rest.shadow, border: rest.border });
    });

    it(`${theme}: mouse close directly from the editor restores the tile without mint/checkbox`, async () => {
      const rest = await render(theme);
      await edit();
      await click('.card-preview-tools button');
      await until(`!document.querySelector('.card-preview') && document.activeElement === document.querySelector('${face}')`);
      await settleTile();
      expect(await state()).toMatchObject({ focused: true, current: false, checked: false, hovered: false, checkbox: '0', shadow: rest.shadow, border: rest.border });
    });

    it(`${theme}: actual hover, checkbox focus and checked selection remain available`, async () => {
      await render(theme);
      await edit();
      await key('Escape');
      await until(`document.activeElement === document.querySelector('${face}')`);
      const point = await page.callFunction(`selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }`, face);
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
      await until(`getComputedStyle(document.querySelector('${checkbox}')).opacity === '1'`);
      expect(await state()).toMatchObject({ hovered: true, checked: false });
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
      await key('Tab');
      await page.callFunction('selector => document.querySelector(selector).focus()', checkbox);
      await until(`getComputedStyle(document.querySelector('${checkbox}')).opacity === '1'`);
      expect(await page.callFunction(`selector => document.activeElement === document.querySelector(selector) && document.activeElement.matches(':focus-visible')`, checkbox)).toBe(true);
      await key(' ', 'Space');
      await page.callFunction('selector => document.querySelector(selector).focus()', face);
      expect(await state()).toMatchObject({ checked: true, checkbox: '1', hovered: false });
      expect(await page.evaluate(`Boolean(document.querySelector('${tile} .is-multi-selected'))`)).toBe(true);
    });
  }
});
