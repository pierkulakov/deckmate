import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';

const browserPath = requireBrowser();

describe.skipIf(!browserPath)('native select styling (browser)', () => {
  let page: HeadlessPage;
  beforeAll(async () => {
    page = await openHeadlessBrowser({ width: 1280, height: 800, scale: 1 });
    await page.send('Page.navigate', { url: browserFixtureUrl('selects') });
    const deadline = Date.now() + 10000;
    while (!await page.evaluate('Boolean(document.querySelector("#role"))')) {
      if (Date.now() > deadline) throw Error('Select fixture did not load');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }, 60000);
  afterAll(async () => { await page?.close(); });
  it('uses one picker icon and leaves listboxes native', async () => {
    const result = await page.evaluate(`(() => {
      const select = document.querySelector('#role');
      return { supported: CSS.supports('appearance', 'base-select'), appearance: getComputedStyle(select).appearance,
        arrow: getComputedStyle(select, '::picker-icon').display, sibling: getComputedStyle(select.nextElementSibling).display,
        multiple: getComputedStyle(document.querySelector('#multiple')).appearance, list: getComputedStyle(document.querySelector('#list')).appearance };
    })()`);
    if (result.supported) {
      expect(result.appearance).toBe('base-select');
      expect(result.arrow).not.toBe('none');
      expect(result.sibling).toBe('none');
      expect(result.multiple).not.toBe('base-select');
      expect(result.list).not.toBe('base-select');
    }
  });
});
