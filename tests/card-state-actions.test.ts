import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';

const browserPath = requireBrowser();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const reviewTile = '[data-card-id="card:review"]';

describe.skipIf(!browserPath)('card state shortcuts on the real Deck', () => {
  let page: HeadlessPage;
  async function until(expression: string) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { if (await page.evaluate(expression)) return; await delay(40); }
    throw new Error('Timed out: ' + expression + '\n' + page.consoleErrors.join('\n'));
  }
  async function render(options: object = {}) {
    await page.callFunction('options => window.cardStateTest.render(options)', options);
    await until(`Boolean(document.querySelector('[data-card-id="card:review"]'))`);
    await delay(80);
  }
  async function click(selector: string) {
    await page.callFunction('selector => document.querySelector(selector).click()', selector);
    await delay(70);
  }
  async function hover() {
    await page.evaluate(`document.activeElement?.blur(); document.querySelector('${reviewTile}').dataset.cardHovered = 'true'`);
  }
  async function key(key: string, code: string) {
    const virtualKey = { Space: 32, KeyW: 87, Escape: 27, Enter: 13 }[code];
    for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: virtualKey });
    await delay(100);
  }
  beforeAll(async () => {
    page = await openHeadlessBrowser({ width: 1440, height: 1000, scale: 1 });
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await page.send('Page.navigate', { url: browserFixtureUrl('card-state-actions') });
    await until('Boolean(window.cardStateTest && document.querySelector("[data-card-id]"))');
  }, 90000);
  afterAll(async () => { await page?.close(); }, 20000);

  it.each(['cards', 'table'])('hover-Space and hover-W open Review decisions without writing or reassigning (%s)', async layout => {
    for (const [character, code] of [[' ', 'Space'], ['ц', 'KeyW']]) {
      await render({ layout });
      await hover();
      await key(character, code);
      await until(`Boolean(document.querySelector('.card-review-accept'))`);
      const target = code === 'Space' ? '.card-review-menu' : '.card-review-accept';
      expect(await page.evaluate(`document.activeElement === document.querySelector('${target}')`)).toBe(true);
      if (code === 'Space') {
        await key(' ', 'Space');
        expect(await page.evaluate(`document.activeElement === document.querySelector('.card-review-menu')`)).toBe(true);
      }
      expect(await page.evaluate(`Boolean(document.querySelector('.journey-return'))`)).toBe(false);
      expect(await page.evaluate('window.cardStateTest.requests')).toEqual([]);
      expect(await page.evaluate('window.cardStateTest.cards()[0].owner')).toBe('Leo Park');
      if (code === 'Space') await click('.card-review-accept');
      else await key('Enter', 'Enter');
      await until('window.cardStateTest.requests.length === 1');
      expect(await page.evaluate('window.cardStateTest.requests[0]')).toMatchObject({ action: 'set-card-state', state: 'done', sourceHash: 'card-hash', manifestHash: 'manifest-hash' });
      await until(`document.activeElement === document.querySelector('.card-state-done')`);
    }
  });

  it.each(['space', 'done'])('consumes the hover %s request before Back/Forward remounts the card', async trigger => {
    await render();
    await page.evaluate(`history.pushState(null, '', location.href)`);
    await hover();
    if (trigger === 'space') await key(' ', 'Space');
    else await key('w', 'KeyW');
    await until(`Boolean(document.querySelector('.card-review-menu'))`);
    await key('Escape', 'Escape');
    await page.evaluate('history.back()');
    await until(`!document.querySelector('.card-preview')`);
    await page.evaluate('history.forward()');
    await until(`Boolean(document.querySelector('.card-preview'))`);
    await delay(120);
    expect(await page.evaluate(`Boolean(document.querySelector('.card-review-menu'))`)).toBe(false);
    expect(await page.evaluate(`document.activeElement === document.querySelector('.card-review-accept')`)).toBe(false);
    expect(await page.evaluate('window.cardStateTest.requests')).toEqual([]);
  });

  it('keeps the reason after a real HTTP 409/store refresh and retries only with explicit current data', async () => {
    await render();
    await hover();
    await key('w', 'KeyW');
    await click('.card-review-return');
    await until(`Boolean(document.querySelector('.journey-return-reason input'))`);
    await page.send('Input.insertText', { text: 'Исправить результат' });
    await page.evaluate(`window.cardStateTest.failEdit('conflict')`);
    await click('.journey-return-actions button:last-child');
    await until(`Boolean(document.querySelector('.card-review-return-dialog > button'))`);
    expect(await page.evaluate(`document.querySelector('.journey-return-reason input').value`)).toBe('Исправить результат');
    expect(await page.evaluate(`document.querySelector('.journey-return-actions button:last-child').disabled`)).toBe(true);
    expect(await page.evaluate('window.cardStateTest.requests.length')).toBe(1);
    await page.evaluate('window.cardStateTest.failEdit(null)');
    await click('.card-review-return-dialog > button');
    expect(await page.evaluate(`document.querySelector('.journey-return-reason input').value`)).toBe('Исправить результат');
    await click('.journey-return-actions button:last-child');
    await until(`!document.querySelector('.journey-return')`);
    expect(await page.evaluate('window.cardStateTest.requests[1]')).toMatchObject({ action: 'set-card-state', state: 'not-started', returnReason: 'Исправить результат', sourceHash: 'card-hash-refreshed' });
    expect(await page.evaluate('window.cardStateTest.cards()[0]')).toMatchObject({ state: 'not-started', owner: 'Leo Park' });
  });

  it.each(['done', 'wont-do'])('hover-Space leaves %s alone; W reopens without assigning', async state => {
    await render({ state });
    await hover();
    await key(' ', 'Space');
    expect(await page.evaluate('window.cardStateTest.requests')).toEqual([]);
    await key('w', 'KeyW');
    await until('window.cardStateTest.requests.length === 1');
    expect(await page.evaluate('window.cardStateTest.requests[0]')).toMatchObject({ action: 'set-card-state', state: 'not-started' });
    expect(await page.evaluate('window.cardStateTest.cards()[0].owner')).toBe('Leo Park');
  });

  it('preserves hover-Space assignment, start and stop outside Review and direct W completion', async () => {
    await render({ state: 'not-started' });
    await hover();
    for (let index = 0; index < 3; index++) await key(' ', 'Space');
    expect(await page.evaluate('window.cardStateTest.requests')).toMatchObject([
      { action: 'bulk-edit-cards', change: { kind: 'properties', owner: 'Maya Chen' } },
      { action: 'set-card-state', state: 'started' },
      { action: 'set-card-state', state: 'not-started' },
    ]);
    await key('w', 'KeyW');
    expect(await page.evaluate('window.cardStateTest.requests[3]')).toMatchObject({ action: 'set-card-state', state: 'done' });
  });

  it('keeps bulk W as confirmed Done and bulk Space as assign-to-me, including Review', async () => {
    for (const trigger of ['done', 'space']) {
      await render();
      await page.evaluate(`document.querySelectorAll('.catalog-card-checkbox').forEach(input => input.click())`);
      await until(`Boolean(document.querySelector('.card-selection-toolbar'))`);
      await hover();
      if (trigger === 'done') {
        await key('w', 'KeyW');
        await until(`Boolean(document.querySelector('.bulk-actions-dialog'))`);
        expect(await page.evaluate('window.cardStateTest.requests')).toEqual([]);
        await click('.bulk-dialog-footer button[type="submit"]');
      } else await key(' ', 'Space');
      await until('window.cardStateTest.requests.length === 1');
      const expected = trigger === 'done' ? { kind: 'state', state: 'done' } : { kind: 'properties', owner: 'Maya Chen' };
      expect(await page.evaluate('window.cardStateTest.requests[0]')).toMatchObject({ action: 'bulk-edit-cards', change: expected });
      expect(await page.evaluate('window.cardStateTest.requests[0].cards.length')).toBe(2);
    }
  });

  it('blocks read-only hover mutations in both layouts', async () => {
    for (const layout of ['cards', 'table']) {
      await render({ layout, writable: false });
      await hover();
      await key(' ', 'Space');
      await key('w', 'KeyW');
      expect(await page.evaluate('window.cardStateTest.requests')).toEqual([]);
    }
    expect(page.consoleErrors).toEqual([]);
  });
});
