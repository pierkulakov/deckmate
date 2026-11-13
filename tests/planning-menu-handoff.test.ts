import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/headless-browser.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';
import { expectPageStateDuring, waitForLayout } from './browser-layout.ts';

const browserPath = requireBrowser();
const titleField = '.planning-popover input[maxlength="120"]';
const createMenu = '.planning-create-menu';
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe.skipIf(!browserPath)('planning menu to form handoff (browser)', () => {
  let page: HeadlessPage;
  async function until(expression: string) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await page.evaluate(expression)) return;
      await delay(25);
    }
    throw new Error('Timed out: ' + expression + '\n' + page.consoleErrors.join('\n'));
  }
  async function key(key: string) {
    const codes: Record<string, number> = { Tab: 9, Enter: 13, Escape: 27, Home: 36, End: 35 };
    for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', {
      type, key, code: key, windowsVirtualKeyCode: codes[key], text: type === 'keyDown' && key === 'Enter' ? '\r' : undefined,
    });
  }
  async function tabsTo(selector: string) {
    for (let index = 0; index < 40; index++) {
      if (await page.callFunction('selector => document.activeElement.matches(selector)', selector)) return;
      await key('Tab');
    }
    throw new Error('Tab target not reached: ' + selector);
  }
  async function click(selector: string) {
    const point = await page.callFunction(`selector => {
      const box = document.querySelector(selector).getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }`, selector);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', {
      type, ...point, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1,
    });
  }
  async function reset(width: number, theme: string, screen = 'timeline') {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.evaluate('window.previousHandoffPage = true');
    await page.send('Page.navigate', { url: browserFixtureUrl('planning-menu-handoff') + `?theme=${theme}&screen=${screen}` });
    const ready = screen === 'bulk' ? '.bulk-actions' : '.timeline-canvas';
    await until(`!window.previousHandoffPage && Boolean(document.querySelector('${ready}')) && document.hasFocus()`);
    await page.evaluate('document.fonts.ready.then(() => true)');
    await page.evaluate(`window.handoffOverlap = false;
      new MutationObserver(() => {
        if (document.querySelector('.planning-popover, .bulk-actions-dialog') && document.querySelector('.planning-create-menu, .bulk-more-menu')) window.handoffOverlap = true;
      }).observe(document.body, { childList: true, subtree: true });`);
  }
  async function choose(menu: string, last = false) {
    await until(`Boolean(document.querySelector('${menu} [role="menuitem"]'))`);
    if (last) {
      await key('End');
      await until(`document.activeElement === [...document.querySelectorAll('${menu} [role="menuitem"]')].at(-1)`);
    }
    // 2026-11-13: waiting between navigation and selection hides the deferred roving-focus race.
    await key(last ? 'End' : 'Home');
    await key('Enter');
  }
  async function expectForm(field = titleField, menu = createMenu, form = '.planning-popover') {
    await until(`Boolean(document.querySelector('${form}'))`);
    await waitForLayout(page.evaluate, form);
    await expectPageStateDuring(page.evaluate,
      `Boolean(document.querySelector('${form}')) && !document.querySelector('${menu}') && document.activeElement === document.querySelector('${field}')`, 100);
    expect(await page.evaluate('window.handoffOverlap'), 'the menu must finish closing before the form opens').toBe(false);
    expect(page.consoleErrors).toEqual([]);
  }
  async function closePlanning(opener: string) {
    await key('Escape');
    await until('!document.querySelector(".planning-popover")');
    expect(await page.evaluate('Boolean(document.querySelector(".planning-calendar-panel"))')).toBe(true);
    await key('Escape');
    await until('!document.querySelector(".planning-calendar-panel")');
    expect(await page.callFunction('selector => document.activeElement === document.querySelector(selector)', opener)).toBe(true);
  }

  beforeAll(async () => {
    page = await openHeadlessBrowser({ width: 1440, height: 900, scale: 1 });
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  }, 90000);
  afterAll(async () => { await page?.close(); }, 20000);

  for (const width of [1440, 375]) for (const theme of ['dark', 'light']) {
    describe(`${theme}, ${width}px`, () => {
      it.each([1, 2, 3, 4, 5])('keeps the Milestone title focused after rapid Home/Enter, attempt %i of 20', async () => {
        await reset(width, theme);
        await tabsTo('.timeline-create');
        await key('Enter');
        await choose(createMenu);
        await expectForm();
        await closePlanning('.timeline-create');
      });

      it('hands off the neighboring Run schedule action', async () => {
        await reset(width, theme);
        await tabsTo('.timeline-create');
        await key('Enter');
        await choose(createMenu, true);
        await expectForm('.planning-popover input[maxlength="5"]');
        expect(await page.evaluate('document.querySelector(".planning-popover .dialog-title").textContent')).toBe('New Run schedule');
        await closePlanning('.timeline-create');
      });

      it('hands off a clustered calendar Milestone to its edit form', async () => {
        await reset(width, theme);
        await tabsTo('button[aria-label="Calendar"]');
        await key('Enter');
        await until('document.activeElement.matches(".planning-calendar-milestone")');
        await key('Enter');
        await choose('.timeline-cluster-menu', true);
        await expectForm();
        expect(await page.callFunction('selector => document.querySelector(selector).value', titleField)).toBe('Milestone 2');
        await closePlanning('button[aria-label="Calendar"]');
      });

      it('hands off the bulk menu to its non-modal form', async () => {
        await reset(width, theme, 'bulk');
        await tabsTo('.bulk-actions button[aria-haspopup="menu"]');
        await key('Enter');
        await choose('.bulk-more-menu');
        await expectForm('.bulk-actions-dialog input[data-autofocus]', '.bulk-more-menu', '.bulk-actions-dialog');
        await key('Escape');
        await until('!document.querySelector(".bulk-actions-dialog")');
        await until('document.activeElement.matches(".bulk-actions button[aria-haspopup=menu]")');
      });

      it('keeps pointer selection open and dismisses the clean form on a real outside click', async () => {
        await reset(width, theme);
        await click('.timeline-create');
        await until('Boolean(document.querySelector(".planning-create-menu [role=menuitem]"))');
        await click('.planning-create-menu [role=menuitem]');
        await expectForm();
        await click('.planning-calendar-panel-header .dialog-title');
        await until('!document.querySelector(".planning-popover")');
        expect(await page.evaluate('Boolean(document.querySelector(".planning-calendar-panel"))')).toBe(true);
      });
    });
  }
});
