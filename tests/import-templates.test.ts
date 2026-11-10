import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';

const browserPath = requireBrowser();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 2026-11-10: the shared-grammar pass over the CSV import dialog and the template picker — the dialog frame,
// glass sections, counters and the mint action verified as rendered boxes at 375px and desk width, both themes.
// Row set: a Task (new), a Doc (new), a Doc carrying a state (error) and a repeat of the first row (skipped).
const csvContent = ['Reference;Title;Type;Owner;Effort;Priority;State;Tags;Markdown',
  ';First card;task;Ann;2;high;not-started;demo;Body text',
  ';Second card;doc;;;;;;Doc body',
  ';Doc with state;doc;;;;not-started;;No state on docs',
  ';First card;task;Ann;2;high;not-started;demo;Body text'].join('\n');

describe.skipIf(!browserPath)('Import and templates dialogs (browser)', () => {
  let page: HeadlessPage;
  async function until(expression: string) {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (await page.evaluate(expression)) return;
      await delay(50);
    }
    throw new Error(expression + '\n' + page.consoleErrors.join('\n'));
  }
  async function viewport(width: number, height = 800) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await delay(60);
  }
  const fits = (selector: string) => page.callFunction(`selector => { const el = document.querySelector(selector);
    if (!el) return null; return el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().width <= innerWidth; }`, selector);

  beforeAll(async () => {
    page = await openHeadlessBrowser({ width: 1280, height: 800, scale: 1 });
    await page.send('Page.navigate', { url: browserFixtureUrl('import-templates') });
    await until(`Boolean(document.querySelector('.project-template-picker .project-template-option'))`);
  }, 60000);
  afterAll(async () => { await page?.close(); }, 20000);

  it('builds the picker from the shared dialog grammar with counters and one mint action', async () => {
    expect(await page.evaluate(`document.querySelector('.project-template-picker').classList.contains('dialog-panel')`)).toBe(true);
    // 2026-11-10: the Foil Rule — the picker is a dialog panel with the 4px --glass-radius (was 12px), compared against
    // the computed token so the next radius change does not break the test.
    expect(await page.evaluate(`(() => {
      const radius = getComputedStyle(document.querySelector('.project-template-picker')).borderRadius;
      const probe = document.createElement('i'); probe.style.borderRadius = 'var(--glass-radius)'; document.body.append(probe);
      const glassRadius = getComputedStyle(probe).borderRadius; probe.remove();
      return radius === glassRadius;
    })()`)).toBe(true);
    expect(await page.evaluate(`document.querySelector('.project-template-heading h2').classList.contains('dialog-title')`)).toBe(true);
    expect(await page.evaluate(`getComputedStyle(document.querySelector('.project-template-heading h2')).fontSize`)).toBe('18px');
    expect(await page.evaluate(`document.querySelectorAll('.project-template-pane .glass-panel').length`)).toBe(2);
    expect(await page.evaluate(`document.querySelector('.project-template-browser .panel-title').textContent`)).toBe('Games');
    expect(await page.evaluate(`document.querySelector('.project-template-browser .panel-count').textContent`)).toBe('2');
    expect(await page.evaluate(`document.querySelectorAll('.project-template-counts .page-number').length`)).toBe(4);
    const mono = await page.evaluate(`getComputedStyle(document.querySelector('.project-template-counts .page-number')).fontFamily`);
    expect(mono).toContain('Geist Mono');
    expect(await page.evaluate(`document.querySelector('.project-template-actions button:last-child').classList.contains('action-mint')`)).toBe(true);
    expect(await page.evaluate(`document.querySelector('.project-template-actions button:last-child').textContent.trim()`)).toBe('Apply');
    await delay(200);
    const controls = await page.evaluate(`(() => {
      const group = getComputedStyle(document.querySelector('.project-template-shelves'));
      const selected = getComputedStyle(document.querySelector('.project-template-shelf[aria-selected="true"]'));
      const option = getComputedStyle(document.querySelector('.project-template-option[aria-pressed="true"]'));
      const probe = document.createElement('span'); document.body.appendChild(probe);
      const token = name => { probe.style.background = name; return getComputedStyle(probe).backgroundColor; };
      const result = [parseFloat(group.borderTopWidth), group.borderRadius, group.borderTopColor === token('var(--control-line)'), selected.backgroundColor === token('var(--mark-tint)'), option.borderTopColor === token('var(--mark)')];
      probe.style.borderRadius = 'var(--control-radius)'; result.push(getComputedStyle(probe).borderRadius);
      probe.remove(); return result;
    })()`);
    expect(controls[0]).toBeGreaterThan(0);
    // 2026-11-10: the Foil Rule — the resting line is the quiet --control-line, the chosen shelf/option is --mark on
    // --mark-tint (not --violet-fill), and the radius follows --control-radius (2px, was 4px).
    expect(controls.slice(1, 5)).toEqual([controls[5], true, true, true]);
  });

  it('keeps the picker inside a 375px viewport with Russian text and the dark theme', async () => {
    await viewport(375);
    await page.evaluate(`window.importTemplatesTest.render('templates', { lang: 'ru' })`);
    await until(`Boolean(document.querySelector('.project-template-picker .project-template-option'))`);
    await page.evaluate(`document.documentElement.classList.add('dark')`);
    await delay(60);
    expect(await page.evaluate(`document.documentElement.scrollWidth <= 375`)).toBe(true);
    expect(await page.evaluate(`document.querySelector('.project-template-picker').getBoundingClientRect().width <= 375`)).toBe(true);
    expect(await fits('.project-template-heading h2')).toBe(true);
    expect(await fits('.project-template-description')).toBe(true);
    expect(await page.evaluate(`document.querySelector('.project-template-actions button:last-child').textContent.trim()`)).toBe('Применить');
    await page.evaluate(`document.documentElement.classList.remove('dark')`);
    await viewport(1280);
  });

  it('switches shelves with the keyboard and shows the empty shelf state', async () => {
    await page.evaluate(`window.importTemplatesTest.render('templates')`);
    await until(`Boolean(document.querySelector('.project-template-option'))`);
    await page.evaluate(`document.querySelector('.project-template-shelf[aria-selected="true"]').focus()`);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await until(`Boolean(document.querySelector('.ui-empty')) && !document.querySelector('.project-template-option')`);
    expect(await page.evaluate(`document.querySelector('.project-template-shelf[aria-selected="true"]').textContent`)).toBe('Software');
    expect(await page.evaluate(`document.activeElement.textContent`)).toBe('Software');
    expect(await page.evaluate(`document.querySelector('.ui-empty').textContent`)).toBe('No starters on this shelf yet.');
  });

  it('reports list failure through the shared error state', async () => {
    await page.evaluate(`window.importTemplatesTest.render('templates', { failures: { list: true } })`);
    await until(`Boolean(document.querySelector('.ui-error'))`);
    expect(await page.evaluate(`document.querySelector('.ui-error > span').textContent`)).toContain('Could not load templates');
    expect(await page.evaluate(`Boolean(document.querySelector('.ui-error button'))`)).toBe(true);
    // The remembered shelf from the keyboard test must not hide the Games starters of the next render.
    await page.evaluate(`localStorage.removeItem('deckmate:template-shelf')`);
    await page.evaluate(`window.importTemplatesTest.render('templates')`);
    await until(`Boolean(document.querySelector('.project-template-option'))`);
  });

  it('maps a chosen CSV into glass sections with mono counters and no page overflow at 375px', async () => {
    await page.evaluate(`window.importTemplatesTest.render('csv')`);
    await until(`Boolean(document.querySelector('.csv-import-file-label')) && !document.querySelector('.csv-import-file-label input').disabled`);
    expect(await page.evaluate(`document.querySelector('.csv-import').classList.contains('dialog-panel')`)).toBe(true);
    expect(await page.evaluate(`getComputedStyle(document.querySelector('.csv-import-heading h2')).fontSize`)).toBe('18px');
    // A file without a header row shows the parse error in the pick slot.
    await page.callFunction(`(name, content) => window.importTemplatesTest.chooseCsv(name, content)`, 'empty.csv', '\n');
    await until(`document.querySelector('.csv-import-file-label span').textContent.includes('header row')`);
    await page.callFunction(`(name, content) => window.importTemplatesTest.chooseCsv(name, content)`, 'cards.csv', csvContent);
    await until(`Boolean(document.querySelector('.csv-import-mapping ul li'))`);
    expect(await page.evaluate(`document.querySelectorAll('.csv-import .glass-panel').length`)).toBe(2);
    expect(await page.evaluate(`document.querySelector('.csv-import-preview .panel-count').textContent`)).toBe('first 4 of 4');
    const countsLine = await page.evaluate(`document.querySelector('.csv-import-counts').textContent`);
    expect(countsLine).toContain('New 2');
    expect(countsLine).toContain('skipped 1');
    expect(countsLine).toContain('errors 1');
    expect(await page.evaluate(`document.querySelectorAll('.csv-import-counts .page-number').length`)).toBe(4);
    expect(await page.evaluate(`document.querySelector('.csv-import-foot .action-mint').textContent.trim()`)).toBe('Import');
    await viewport(375);
    expect(await page.evaluate(`document.documentElement.scrollWidth <= 375`)).toBe(true);
    expect(await page.evaluate(`document.querySelector('.csv-import').getBoundingClientRect().width <= 375`)).toBe(true);
    // The wide table scrolls inside its own pane, never the page.
    expect(await page.evaluate(`document.querySelector('.csv-import-table-scroll').scrollWidth > document.querySelector('.csv-import-table-scroll').clientWidth`)).toBe(true);
    expect(await page.evaluate(`document.querySelector('.csv-import-table-scroll').clientWidth <= 375 - 2 * 16 - 2 * 16`)).toBe(true);
    await page.evaluate(`document.documentElement.classList.add('dark')`);
    await delay(60);
    expect(await fits('.csv-import-heading h2')).toBe(true);
    await page.evaluate(`document.documentElement.classList.remove('dark')`);
    await viewport(1280);
  });
});
