import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/headless-browser.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';

const browserPath = requireBrowser();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe.skipIf(!browserPath)('Vision popover dismissal (browser)', () => {
  let page: HeadlessPage;
  async function until(expression: string) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await page.evaluate(expression)) return;
      await delay(25);
    }
    throw new Error('Timed out: ' + expression + '\n' + page.consoleErrors.join('\n'));
  }
  async function click(selector: string) {
    const point = await page.callFunction(`selector => {
      const element = document.querySelector(selector);
      element.scrollIntoView({ block: 'nearest' });
      const r = element.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }`, selector);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', {
      type, ...point, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1,
    });
  }
  async function escape() {
    for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  }
  async function outside() {
    // 2026-11-13: Radix installs outside-pointer listeners after the opening event's task.
    await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', {
      type, x: 2, y: 2, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1,
    });
  }
  async function open(theme: string, width: number) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.send('Page.navigate', { url: `${browserFixtureUrl('vision-popovers')}?theme=${theme}&deck=d-1` });
    await until(`Boolean(document.querySelector('.excalidraw canvas')) && document.querySelector('.vision-save-state')?.textContent === 'Saved'`);
  }
  async function retained() {
    expect(await page.evaluate(`Boolean(document.querySelector('.vision-canvas .excalidraw')) && new URL(location.href).searchParams.get('deck') === 'd-1'`)).toBe(true);
  }
  beforeAll(async () => {
    page = await openHeadlessBrowser({ width: 1440, height: 900, scale: 1 });
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  }, 90000);
  afterAll(async () => { await page?.close(); }, 20000);

  for (const theme of ['light', 'dark']) for (const width of [1440, 375]) {
    it(`${theme}/${width}: Escape closes the canvas palette before its parent menu and restores its trigger`, async () => {
      await open(theme, width);
      await click('.main-menu-trigger');
      const trigger = '.properties-trigger[aria-label="Canvas background"]';
      await until(`Boolean(document.querySelector('${trigger}'))`);
      await click(trigger);
      await until(`Boolean(document.querySelector('.color-picker-input'))`);
      await click('.color-picker-input');
      await escape();
      await until(`!document.querySelector('.color-picker-input')`);
      expect(await page.evaluate(`Boolean(document.querySelector('.excalidraw .dropdown-menu'))`)).toBe(true);
      await until(`document.activeElement === document.querySelector('${trigger}')`);
      await click(trigger);
      await until(`Boolean(document.querySelector('.color-picker-input'))`);
      await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      await click('.excalidraw .dropdown-menu-group-title');
      await until(`!document.querySelector('.color-picker-input')`);
      expect(await page.evaluate(`Boolean(document.querySelector('.excalidraw .dropdown-menu'))`)).toBe(true);
      await escape();
      await until(`!document.querySelector('.excalidraw .dropdown-menu')`);
      await until(`document.activeElement === document.querySelector('.main-menu-trigger')`);
      await retained();
    });

    it(`${theme}/${width}: property popovers accept edits, dismiss once and restore their controls`, async () => {
      for (const [tool, trigger, content] of [
        ['rectangle', '.properties-trigger[aria-label="Stroke"]', '.color-picker-input'],
        ['rectangle', '.properties-trigger[aria-label="Background"]', '.color-picker-input'],
        ['text', '[data-testid="font-family-show-fonts"]', '.properties-content'],
        ['arrow', '[aria-label="arrowhead_start"]', '.picker'],
        ['arrow', '[aria-label="arrowhead_end"]', '.picker'],
      ]) {
        await open(theme, width);
        await click(`[data-testid="toolbar-${tool}"]`);
        if (width === 375) await click('.excalidraw button[aria-label="Edit"]');
        await until(`Boolean(document.querySelector('${trigger}'))`);
        await click(trigger);
        await until(`Boolean(document.querySelector('${content}'))`);
        if (content === '.color-picker-input') {
          await click('[data-testid="color-blue"]');
          await click(content);
          for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
          await page.send('Input.insertText', { text: 'aabbcc' });
          await until(`document.querySelector('.color-picker-input')?.value === 'aabbcc'`);
        } else if (tool === 'text') {
          await click('.properties-content input');
          await page.send('Input.insertText', { text: 'Nunito' });
          await until(`document.querySelector('.properties-content input')?.value === 'Nunito'`);
        } else {
          await click('.picker-option[aria-label="Triangle"]');
          await until(`document.querySelector('.picker-option[aria-label="Triangle"]')?.classList.contains('active')`);
        }
        expect(await page.evaluate(`Boolean(document.querySelector('${content}'))`)).toBe(true);
        await escape();
        await until(`!document.querySelector('${content}') && document.activeElement === document.querySelector('${trigger}')`);
        if (width === 375) expect(await page.evaluate(`Boolean(document.querySelector('.App-mobile-menu'))`)).toBe(true);
        expect(await page.evaluate(`document.querySelector('[data-testid="toolbar-${tool}"]').checked`)).toBe(true);
        await retained();
        await click(trigger);
        await until(`Boolean(document.querySelector('${content}'))`);
        await outside();
        await until(`!document.querySelector('${content}')`);
      }
    });

    it(`${theme}/${width}: eyedropper Escape keeps the palette and a second Escape restores its opener`, async () => {
      await open(theme, width);
      await click('[data-testid="toolbar-rectangle"]');
      if (width === 375) await click('.excalidraw button[aria-label="Edit"]');
      const trigger = '.properties-trigger[aria-label="Stroke"]';
      await until(`Boolean(document.querySelector('${trigger}'))`);
      await click(trigger);
      await until(`Boolean(document.querySelector('.color-picker-input'))`);
      if (width === 375) {
        expect(await page.evaluate(`Boolean(document.querySelector('.excalidraw-eye-dropper-trigger'))`)).toBe(false);
        return;
      }
      await click('.excalidraw-eye-dropper-trigger');
      await until(`Boolean(document.querySelector('.excalidraw-eye-dropper-backdrop'))`);
      await escape();
      await until(`!document.querySelector('.excalidraw-eye-dropper-backdrop')`);
      expect(await page.evaluate(`Boolean(document.querySelector('.color-picker-input'))`)).toBe(true);
      expect(await page.evaluate(`document.activeElement.matches('.color-picker-input')`)).toBe(true);
      await escape();
      await until(`!document.querySelector('.color-picker-input') && document.activeElement === document.querySelector('${trigger}')`);
      await retained();
    });

    it(`${theme}/${width}: menus and the undocked library close from inside without losing their opener`, async () => {
      for (const [trigger, content, inside] of [
        ['.main-menu-trigger', '.excalidraw .dropdown-menu', '[data-testid="help-menu-item"]'],
        ['.App-toolbar__extra-tools-trigger', '.excalidraw .dropdown-menu', '.excalidraw .dropdown-menu button'],
        ['.sidebar-trigger__label-element input', '.excalidraw .sidebar', '.sidebar__close'],
      ]) {
        await open(theme, width);
        await click(trigger);
        await until(`Boolean(document.querySelector('${content}'))`);
        await page.callFunction(`selector => document.querySelector(selector).focus()`, inside);
        await escape();
        await until(`!document.querySelector('${content}') && document.activeElement === document.querySelector('${trigger}')`);
        await retained();
        await click(trigger);
        await until(`Boolean(document.querySelector('${content}'))`);
        await outside();
        await until(`!document.querySelector('${content}')`);
      }
    });

    it(`${theme}/${width}: a nested library menu closes before the library`, async () => {
      await open(theme, width);
      await click('.sidebar-trigger__label-element input');
      const trigger = '.library-menu-dropdown-container .dropdown-menu-button';
      await until(`Boolean(document.querySelector('${trigger}'))`);
      await click(trigger);
      await until(`Boolean(document.querySelector('.library-menu'))`);
      await page.evaluate(`document.querySelector('.library-menu button').focus()`);
      await escape();
      await until(`!document.querySelector('.library-menu') && document.activeElement === document.querySelector('${trigger}')`);
      expect(await page.evaluate(`Boolean(document.querySelector('.sidebar'))`)).toBe(true);
      await escape();
      await until(`!document.querySelector('.sidebar') && document.activeElement.matches('.sidebar-trigger__label-element input')`);
      await retained();
    });

    it(`${theme}/${width}: main-menu commands are reachable and their layers restore the surviving menu trigger`, async () => {
      for (const command of ['help-menu-item', 'json-export-button', 'image-export-button', 'clear-canvas-button', 'search-menu-button']) {
        await open(theme, width);
        await click('.main-menu-trigger');
        const trigger = `[data-testid="${command}"]`;
        await until(`Boolean(document.querySelector('${trigger}'))`);
        expect(await page.callFunction(`selector => {
          const element = document.querySelector(selector), r = element.getBoundingClientRect();
          return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
        }`, trigger)).toBe(true);
        await click(trigger);
        const content = command === 'search-menu-button' ? '.excalidraw .sidebar' : '.excalidraw-modal-container .Modal';
        await until(`Boolean(document.querySelector('${content}'))`);
        if (command === 'search-menu-button') {
          await click('.excalidraw .sidebar input');
          await page.send('Input.insertText', { text: 'Chrome' });
          if (width === 1440) {
            await click('.main-menu-trigger');
            await until(`Boolean(document.querySelector('.excalidraw .dropdown-menu'))`);
            await escape();
            await until(`!document.querySelector('.excalidraw .dropdown-menu')`);
            expect(await page.evaluate(`Boolean(document.querySelector('.excalidraw .sidebar'))`)).toBe(true);
          }
        } else await until(`document.querySelector('${content}').contains(document.activeElement)`);
        await escape();
        await until(`!document.querySelector('${content}') && document.activeElement === document.querySelector('.main-menu-trigger')`);
        await retained();
      }
    });

    it(`${theme}/${width}: Escape dismisses the board-title hint while preserving the field`, async () => {
      await open(theme, width);
      await click('.vision-board-name');
      await until(`getComputedStyle(document.querySelector('.vision-title-full')).display !== 'none'`);
      await escape();
      await until(`getComputedStyle(document.querySelector('.vision-title-full')).display === 'none'`);
      expect(await page.evaluate(`document.activeElement.matches('.vision-board-name')`)).toBe(true);
      await outside();
      await click('.vision-board-name');
      await until(`getComputedStyle(document.querySelector('.vision-title-full')).display !== 'none'`);
      await retained();
    });
  }

  it('does not emit runtime errors', () => { expect(page.consoleErrors).toEqual([]); });
});
