import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';

const browserPath = requireBrowser();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const tile = '.catalog-results [data-card-id="card:hero"]';
const face = tile + ' .deck-card-open';
const checkbox = tile + ' .catalog-card-checkbox';

describe.skipIf(!browserPath)('editor Escape restores quiet tile focus (browser)', () => {
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
  async function expectQuietFocus(rest: Awaited<ReturnType<typeof state>>, current: boolean) {
    await until(`document.activeElement === document.querySelector('${face}') && !document.querySelector('.card-edit-text')`);
    // 2026-11-10: compare against the resting material, not "shadow: none" — the card's own depth must survive.
    await until(`getComputedStyle(document.querySelector('${checkbox}')).opacity === '0'`);
    await settleTile();
    expect(await state()).toEqual({ ...rest, focused: true, focusVisible: false, current });
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
      await expectQuietFocus(rest, true);
      expect(await page.evaluate('Boolean(document.querySelector(".card-preview"))')).toBe(true);
      await key('Escape');
      await until('!document.querySelector(".card-preview")');
      await expectQuietFocus(rest, false);
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
      expect(await page.callFunction(`selector => { const tile = document.querySelector(selector).querySelector('.deck-card');
        const opener = tile.querySelector('.deck-card-open');
        return [getComputedStyle(tile).outlineWidth, getComputedStyle(tile).outlineOffset, getComputedStyle(opener).outlineStyle];
      }`, tile)).toEqual(['2px', '-2px', 'none']);
      expect(await page.evaluate(`Boolean(document.querySelector('${tile} .is-multi-selected'))`)).toBe(true);
    });
  }
});

describe.skipIf(!browserPath)('one Escape per layer (browser)', () => {
  let page: HeadlessPage;
  async function until(expression: string) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await page.evaluate(expression)) return;
      await delay(25);
    }
    throw new Error('Timed out: ' + expression + '\n' + page.consoleErrors.join('\n'));
  }
  async function key(key: string, code = key, modifiers = 0) {
    const codes: Record<string, number> = { Escape: 27, Tab: 9, Enter: 13, ArrowDown: 40, '?': 191 };
    let text: string | undefined;
    if (key === 'Enter') text = '\r';
    else if (key.length === 1) text = key;
    for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key, code, modifiers,
      windowsVirtualKeyCode: codes[key], text: type === 'keyDown' ? text : undefined });
  }
  async function tabsTo(selector: string) {
    for (let index = 0; index < 180; index++) {
      if (await page.callFunction('selector => document.activeElement.matches(selector)', selector)) return;
      await key('Tab');
    }
    throw new Error('Tab target not reached: ' + selector);
  }
  async function start(theme: string, width: number, options: object = {}) {
    await page?.close();
    page = await openHeadlessBrowser({ width, height: 900, scale: 1 });
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await page.send('Page.navigate', { url: browserFixtureUrl('escape-focus') });
    await until('Boolean(window.heroReturnTest && document.querySelector(".level-badge") && document.querySelector(".catalog-results .deck-card-open"))');
    await page.callFunction('selector => document.querySelector(selector).setAttribute("data-escape-focus-previous", "")', tile);
    await page.callFunction('options => window.heroReturnTest.render(options)', { theme, ...options });
    await until('!document.querySelector("[data-escape-focus-previous]") && Boolean(document.querySelector(".catalog-results .deck-card-open, .catalog-cover-settings"))');
    await page.evaluate('document.fonts.ready');
  }
  async function expectRestored(selector: string) {
    await until(`document.activeElement === document.querySelector(${JSON.stringify(selector)})`);
    expect(await page.evaluate('document.documentElement.hasAttribute("data-tab-focus")')).toBe(false);
  }
  async function pauseDepartingTips() {
    // 2026-11-13: paused exits expose stale Escape ownership independently of worker speed.
    await page.evaluate(`new MutationObserver(() => {
      for (const tip of document.querySelectorAll('.card-tag-tooltip[data-state="closed"], .journey-track-tip[data-state="closed"]'))
        for (const animation of tip.getAnimations()) animation.pause();
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-state'] })`);
  }
  afterAll(async () => { await page?.close(); }, 20000);

  for (const theme of ['light', 'dark']) for (const width of [1440, 375]) {
    it(`${theme}/${width}: F01 Level closes alone above a deck and an open card`, async () => {
      await start(theme, width);
      await pauseDepartingTips();
      await tabsTo('.level-badge'); await key('Enter');
      await until('document.activeElement.matches("#level-panel h2")');
      await key('Escape');
      await until('!document.querySelector("#level-panel")');
      await expectRestored('.level-badge');
      expect(await page.evaluate('new URL(location.href).searchParams.get("deck")')).toBe('mixed');
      // 2026-11-13: the compact card is a full-screen focus scope; Level remains a separate header layer on desktop.
      if (width === 1440) {
        await tabsTo(face); await key('Enter');
        await until('Boolean(document.querySelector(".card-preview"))');
        await tabsTo('.level-badge'); await key('Enter');
        await until('document.activeElement.matches("#level-panel h2")');
        const card = await page.evaluate('new URL(location.href).searchParams.get("card")');
        await key('Escape');
        await until('!document.querySelector("#level-panel")');
        await expectRestored('.level-badge');
        expect(await page.evaluate('new URL(location.href).searchParams.get("card")')).toBe(card);
        expect(await page.evaluate('Boolean(document.querySelector(".card-preview"))')).toBe(true);
      }
    });

    it.each(['input', '.global-search-pill'])(`${theme}/${width}: F09 search %s owns Escape before Level`, async target => {
      await start(theme, width);
      await tabsTo('.level-badge'); await key('Enter');
      await until('document.activeElement.matches("#level-panel h2")');
      if (width === 375) { await tabsTo('.global-search-trigger'); await key('Enter'); }
      else await tabsTo('.global-search input');
      await until('document.activeElement.matches(".global-search input")');
      await page.send('Input.insertText', { text: 'kind:hero Test' });
      await until('Boolean(document.querySelector(".global-search-row"))');
      await tabsTo('.global-search ' + target);
      expect(await page.evaluate('Boolean(document.querySelector("#level-panel"))')).toBe(true);
      await key('Escape');
      await until('!document.querySelector(".global-search-pop")');
      expect(await page.evaluate('Boolean(document.querySelector("#level-panel"))')).toBe(true);
      await expectRestored(width === 375 ? '.global-search-trigger' : '.global-search input');
      expect(await page.evaluate('document.querySelector(".global-search input").value')).toBe('kind:hero Test');
      await key('Escape');
      await until('!document.querySelector("#level-panel")');
      await expectRestored('.level-badge');
      expect(await page.evaluate('new URL(location.href).searchParams.get("deck")')).toBe('mixed');
    });

    if (width === 1440) it(`${theme}/${width}: F10 the focused editor owns Escape before Level`, async () => {
      await start(theme, width, { kind: 'task', withoutJourney: true });
      await tabsTo('.level-badge'); await key('Enter');
      await until('document.activeElement.matches("#level-panel h2")');
      await tabsTo(face); await key('Enter');
      await until('Boolean(document.querySelector(".card-title-edit:not(:disabled)"))');
      await tabsTo('.card-title-edit'); await key('Enter');
      await until('document.activeElement.matches(".card-edit-text")');
      await key('Escape');
      await until('!document.querySelector(".card-edit-text")');
      expect(await page.evaluate('Boolean(document.querySelector("#level-panel"))')).toBe(true);
      await expectRestored(face);
      await key('Escape');
      await until('!document.querySelector("#level-panel")');
      await expectRestored('.level-badge');
      expect(await page.evaluate('Boolean(document.querySelector(".card-preview"))')).toBe(true);
    });

    it(`${theme}/${width}: F02 deck settings restore the opening control`, async () => {
      await start(theme, width, { query: 'view=deck&catalogSource=sandbox' });
      await until('Boolean(document.querySelector(".catalog-cover-settings"))');
      await tabsTo('.catalog-cover-settings'); await key('Enter');
      await until('document.activeElement.matches(".deck-settings-dialog input")');
      await key('Escape');
      await until('!document.querySelector(".deck-settings-dialog")');
      await expectRestored('.catalog-cover-settings');
      await key('Tab');
      expect(await page.evaluate('document.documentElement.hasAttribute("data-tab-focus") && document.activeElement !== document.body')).toBe(true);
    });

    it(`${theme}/${width}: F05 early Escape cancels cold help without closing the deck`, async () => {
      await start(theme, width);
      await tabsTo('[aria-label="Close deck"]');
      await page.send('Network.enable');
      await page.send('Network.setCacheDisabled', { cacheDisabled: true });
      await page.send('Network.emulateNetworkConditions', { offline: false, latency: 2000, downloadThroughput: -1, uploadThroughput: -1 });
      await key('?', 'Slash', 8);
      await until('document.activeElement.matches(".shortcuts-panel")');
      expect(await page.evaluate('Boolean(document.querySelector(".shortcuts-panel-body"))')).toBe(false);
      await key('Escape');
      await until('!document.querySelector(".shortcuts-panel")');
      await until('performance.getEntriesByType("resource").some(entry => /ShortcutsHelpContent-.*\\.js/.test(entry.name) && entry.responseEnd > 0)');
      await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      expect(await page.evaluate('Boolean(document.querySelector(".shortcuts-panel"))')).toBe(false);
      expect(await page.evaluate('new URL(location.href).searchParams.get("deck")')).toBe('mixed');
      await expectRestored('[aria-label="Close deck"]');
      await key('?', 'Slash', 8);
      await until('document.activeElement.matches(".shortcuts-panel")');
      await key('Escape');
      await until('!document.querySelector(".shortcuts-panel")');
      await expectRestored('[aria-label="Close deck"]');
    });

    it(`${theme}/${width}: F06 a departing tag tooltip cannot swallow Quick Settings Escape`, async () => {
      await start(theme, width, { tags: ['unlinked'] });
      await tabsTo(face); await key('Enter');
      await until('Boolean(document.querySelector(".card-preview .tag-badge-link"))');
      await pauseDepartingTips();
      await tabsTo('.card-preview-owner-shortcut'); await key('Enter');
      await until('document.activeElement.matches(".deck-choice-search")');
      await key('A', 'KeyA'); await key('l', 'KeyL'); await key('e', 'KeyE'); await key('x', 'KeyX');
      await key('ArrowDown');
      expect(await page.evaluate('Boolean(document.querySelector(".card-tag-tooltip[data-state=closed]"))')).toBe(true);
      await key('Escape');
      await until('!document.querySelector(".deck-picker-popover")');
      await expectRestored('.card-preview-owner-shortcut');
      expect(await page.evaluate('Boolean(document.querySelector(".card-preview"))')).toBe(true);
      expect(await page.evaluate('new URL(location.href).searchParams.get("deck")')).toBe('mixed');
    });
  }
});
