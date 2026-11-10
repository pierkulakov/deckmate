import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';

const browserPath = requireBrowser();
describe.skipIf(!browserPath)('empty open deck', () => {
  let page: HeadlessPage;
  async function until(expression: string) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await page.evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(expression + '\n' + page.consoleErrors.join('\n'));
  }
  beforeAll(async () => {
    page = await openHeadlessBrowser({ width: 1440, height: 900, scale: 1 });
    await page.send('Page.navigate', { url: browserFixtureUrl('empty-deck') });
    await until(`Boolean(document.querySelector('.deck-empty'))`);
  }, 60000);
  afterAll(async () => { await page?.close(); }, 20000);
  it('fills the main area, omits empty metrics and opens the composer', async () => {
    await page.evaluate(`if (!document.querySelector('.deck-overview')) document.querySelector('[data-deck-panel=info]').click()`);
    await until(`Boolean(document.querySelector('.deck-overview-empty')) && !document.querySelector('.deck-activity-loading')`);
    expect(await page.evaluate(`Boolean(document.querySelector('.deck-empty button'))`)).toBe(true);
    expect(await page.evaluate(`Boolean(document.querySelector('.deck-overview-stats, .deck-activity-filters, .deck-overview-files'))`)).toBe(false);
    expect(await page.evaluate(`Math.abs(document.querySelector('.catalog-resize-handle').getBoundingClientRect().bottom - document.querySelector('.workspace-main').getBoundingClientRect().bottom) < 2`)).toBe(true);
    await page.evaluate(`document.querySelector('.deck-empty button').click()`);
    await until(`Boolean(document.querySelector('.catalog-preview-slot textarea'))`);
  });
});
