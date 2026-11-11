import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';
import { waitForLayout } from './browser-layout.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// 2026-11-10: the card scopes share the Decks home's header row and the open deck's workbench, and say which
// emptiness they show: every card in a deck, an empty track, cards only hidden by search, or no cards at all.
const browserPath = requireBrowser();
type PlateMeasurement = { frames: { opacity: number; connected: boolean; stable: boolean }[][]; label: string };
describe.skipIf(!browserPath)('card scope views', () => {
  let page: HeadlessPage;
  async function until(expression: string) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await page.evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const state = await page.evaluate(`JSON.stringify({ focus: document.activeElement?.outerHTML, filters: document.querySelector('.card-filter-bar')?.textContent, preview: Boolean(document.querySelector('.card-preview')), pageFocused: document.hasFocus() })`);
    throw new Error(expression + '\n' + state + '\n' + page.consoleErrors.join('\n'));
  }
  const text = (selector: string) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
  const click = (selector: string) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  async function pointer(selector: string) {
    const point = await page.callFunction(`selector => {
      const button = document.querySelector(selector);
      button.scrollIntoView({ block: 'nearest' });
      const box = button.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }`, selector);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await page.send('Input.dispatchMouseEvent', { type, ...point, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
    }
  }
  async function key(key: string) {
    const codes: Record<string, number> = { Enter: 13, Escape: 27, Tab: 9 };
    for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', {
      type, key, code: key, windowsVirtualKeyCode: codes[key], text: key === 'Enter' && type === 'keyDown' ? '\r' : undefined,
    });
  }
  async function home(parameters = '') {
    await page.send('Page.navigate', { url: browserFixtureUrl('card-scope') + '?pulse=1' + parameters });
    await until(`Boolean(document.querySelector('.project-pulse-value'))`);
  }
  async function cards(count: number) {
    await until(`document.querySelectorAll('.catalog-results .deck-card').length === ${count}`);
  }
  async function capture(name: string) {
    const phase = process.env.DECKMATE_SCOPE_CAPTURE;
    if (!phase) return;
    const directory = path.resolve('.deckmate/inbox/ux/scope-filter-from-home');
    await mkdir(directory, { recursive: true });
    await waitForLayout(page.evaluate, '.card-scope-header, .catalog-results, .deck-action-rail');
    const image = await page.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(directory, `${phase}-${name}.png`), Buffer.from(image.result.data, 'base64'));
  }
  const clickPill = (label: string) => page.evaluate(`[...document.querySelectorAll('.catalog-nav-section button')].find(button => button.textContent.startsWith(${JSON.stringify(label)})).click()`);
  const type = (selector: string, value: string) => page.evaluate(`(() => {
    const field = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(field.constructor.prototype, 'value').set.call(field, ${JSON.stringify(value)});
    field.dispatchEvent(new Event(field.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  })()`);
  async function open(url: string) {
    await page.send('Page.navigate', { url });
    await until(`Boolean(document.querySelector('.card-scope-view .catalog-results'))`);
  }
  beforeAll(async () => {
    page = await openHeadlessBrowser({ width: 1440, height: 900, scale: 1 });
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await open(browserFixtureUrl('card-scope'));
  }, 60000);
  afterAll(async () => { await page?.close(); }, 20000);

  it.skipIf(!process.env.DECKMATE_SCOPE_CAPTURE)('captures the pulse filter in both themes, desktop and Russian phone layouts', async () => {
    for (const lang of ['en', 'ru']) for (const theme of ['dark', 'light']) for (const width of [1700, 375]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: width === 375 ? 812 : 1000, deviceScaleFactor: 1, mobile: false });
      await page.send('Page.navigate', { url: browserFixtureUrl('card-scope') + `?pulse=1&lang=${lang}&theme=${theme}` });
      await until(`Boolean(document.querySelector('.project-pulse-value'))`);
      await click('.project-pulse-segment:first-child');
      await until(`document.querySelectorAll('.catalog-results .deck-card').length === 5`);
      await capture(`${theme}-${width}-${lang}`);
    }
    await page.send('Emulation.clearDeviceMetricsOverride', {});
    await open(browserFixtureUrl('card-scope'));
  }, 60000);

  it('keeps the home header row above the open deck workbench and says every card is in a deck', async () => {
    await until(`Boolean(document.querySelector('.card-scope-empty'))`);
    expect(await text('.card-scope-empty h2')).toBe('Every card is in a deck');
    expect(await page.evaluate(`Boolean(document.querySelector('.card-scope-empty .empty-art svg path'))`)).toBe(true);
    expect(await text('.card-scope-header .page-title')).toBe('No deck');
    expect(await text('.card-scope-header .page-number')).toBe('0');
    // Search, scope pills and the track select share the header row; no stacked labels or separate search row remain.
    expect(await page.evaluate(`Boolean(document.querySelector('.card-scope-header .deck-gallery-search input') && document.querySelector('.card-scope-header .catalog-browser-navigation'))`)).toBe(true);
    expect(await page.evaluate(`[...document.querySelectorAll('.catalog-nav-label')].every(label => getComputedStyle(label).display === 'none')`)).toBe(true);
    // The title sits where the home's project name does; the rail where the open deck's rail does.
    expect(await page.evaluate(`Math.round(document.querySelector('.card-scope-header .page-title').getBoundingClientRect().left)`)).toBe(40);
    expect(await page.evaluate(`Math.round(document.querySelector('.deck-action-rail').getBoundingClientRect().left)`)).toBe(16);
    expect(await page.evaluate(`[...document.querySelectorAll('.deck-action-rail button')].map(button => button.getAttribute('aria-label'))`)).toEqual(['Ordering', 'Tags']);
  });

  it('shows the cards of All cards and hides cards only behind search, with a reset', async () => {
    await clickPill('All cards');
    await until(`document.querySelectorAll('.catalog-results .deck-card').length === 3`);
    expect(await page.evaluate(`Boolean(document.querySelector('.card-scope-empty'))`)).toBe(false);
    expect(await text('.card-scope-header .page-number')).toBe('3');
    await type('.deck-gallery-search input', 'zzzz');
    await until(`Boolean(document.querySelector('.card-scope-empty.ui-empty-filtered'))`);
    expect(await text('.card-scope-empty h2')).toBe('No matching cards');
    expect(await text('.card-filter-count')).toBe('0 of 3 cards');
    await click('.card-scope-empty button');
    await until(`document.querySelectorAll('.catalog-results .deck-card').length === 3 && document.querySelector('.deck-gallery-search input').value === ''`);
    // An open card's context bar is the workbench's first row too, and its sheet starts level with its icon rail.
    // 2026-11-10: the reset commits the list once more right after the count settles; a click on the replaced tile is lost.
    await waitForLayout(page.evaluate, '.catalog-results');
    await pointer('.catalog-results .deck-card-open');
    await until(`Boolean(document.querySelector('.card-preview-header') && document.querySelector('.card-preview-sheet'))`);
    expect(await page.evaluate(`(() => {
      const rail = document.querySelector('.deck-action-rail button').getBoundingClientRect();
      const bar = document.querySelector('.card-preview-header').getBoundingClientRect();
      const sheet = document.querySelector('.card-preview-sheet').getBoundingClientRect();
      const icon = document.querySelector('.card-preview-action-rail button').getBoundingClientRect();
      return [Math.round(bar.top - rail.top), Math.round(bar.height - rail.height), Math.round(icon.top - sheet.top)];
    })()`)).toEqual([0, 0, 0]);
    await page.evaluate(`document.querySelector('.card-preview-tools button').click()`);
    await until(`!document.querySelector('.card-preview-header')`);
  });

  it('keeps the open card plate stable during a Priority save from All cards in the light theme', async () => {
    await page.evaluate(`document.documentElement.classList.remove('dark')`);
    await clickPill('All cards');
    await until(`document.querySelectorAll('.catalog-results .deck-card').length === 3`);
    await click('.catalog-results .deck-card-open');
    await until(`Boolean(document.querySelector('.card-preview [data-quick-settings-tab="priority"]') && document.querySelector('.card-content-edit-action'))`);
    await waitForLayout(page.evaluate, '.card-preview-material-band');
    await click('.card-preview [data-quick-settings-tab="priority"]');
    await until(`document.querySelector('.card-quick-settings')?.dataset.tab === 'priority'`);
    const measurement = await page.evaluate(`new Promise((resolve, reject) => {
      const controls = [...document.querySelectorAll('.card-preview-material-band button')].map(element => {
        const rect = element.getBoundingClientRect();
        return { element, rect: [rect.x, rect.y, rect.width, rect.height] };
      });
      const option = [...document.querySelectorAll('[role="option"]')].find(item => item.querySelector('.deck-choice-name')?.textContent === 'Medium');
      const frames = [];
      option.click();
      const timer = setTimeout(() => reject(new Error('All cards Priority save did not finish')), 3000);
      function sample() {
        frames.push(controls.map(({ element, rect }) => {
          const next = element.getBoundingClientRect();
          return { opacity: Number(getComputedStyle(element).opacity), connected: element.isConnected,
            stable: JSON.stringify(rect) === JSON.stringify([next.x, next.y, next.width, next.height]) };
        }));
        if (!document.querySelector('.card-quick-settings')) {
          clearTimeout(timer);
          resolve({ frames, label: document.querySelector('.card-preview [data-quick-settings-tab="priority"]').getAttribute('aria-label') });
        } else requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    })`) as PlateMeasurement;
    expect(measurement.frames.length).toBeGreaterThan(3);
    expect(measurement.frames.flat().every(frame => frame.opacity === 1 && frame.connected && frame.stable), JSON.stringify(measurement.frames)).toBe(true);
    expect(measurement.label).toBe('Priority: Medium');
    await click('.card-preview-tools button');
    await until(`!document.querySelector('.card-preview-header')`);
  });

  it('opens Ordering in the left column and explains an empty track', async () => {
    await click('.deck-action-rail button[aria-label="Ordering"]');
    await until(`Boolean(document.querySelector('.catalog-content-layout.has-narrow-panel .deck-narrow-panel'))`);
    expect(await page.evaluate(`document.querySelector('.deck-action-rail button[aria-label="Ordering"]').getAttribute('aria-pressed')`)).toBe('true');
    // The workbench's first row: the panel heading shares the rail's first button's top line and height.
    expect(await page.evaluate(`(() => {
      const rail = document.querySelector('.deck-action-rail button').getBoundingClientRect();
      const head = document.querySelector('.deck-narrow-panel .panel-head').getBoundingClientRect();
      return [Math.round(head.top - rail.top), Math.round(head.height - rail.height)];
    })()`)).toEqual([0, 0]);
    // Table, as in a deck, lives in Ordering; its lane heading and rows start at the results' edge, like the card grid.
    const viewButton = (label: string) => `[...document.querySelectorAll('.card-ordering .control-segmented button')].find(item => item.textContent === '${label}')`;
    expect(await page.evaluate(`document.querySelector('.card-ordering-body').children[1].matches('.control-segmented')`)).toBe(true);
    await page.evaluate(`${viewButton('Table')}.click()`);
    await until(`document.querySelectorAll('.deck-table-row').length === 3`);
    expect(await page.evaluate(`(() => {
      const edge = document.querySelector('.catalog-results').getBoundingClientRect().left;
      return ['.deck-table', '.deck-table-row'].map(selector => Math.round(document.querySelector(selector).getBoundingClientRect().left - edge));
    })()`)).toEqual([0, 0]);
    await page.evaluate(`${viewButton('Cards')}.click()`);
    await until(`document.querySelectorAll('.catalog-results .deck-card').length === 3`);
    await click('.deck-action-rail button[aria-label="Ordering"]');
    await until(`!document.querySelector('.deck-narrow-panel')`);
    await type('#catalog-track-view', 'route');
    await until(`document.querySelector('.card-scope-empty h2')?.textContent === 'No cards on this track yet'`);
    expect(await text('.card-scope-header .page-title')).toBe('Ferry route');
  });

  it('fits a 375px phone without horizontal scroll', async () => {
    await clickPill('All cards');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
    await until(`innerWidth === 375 && document.querySelectorAll('.catalog-results .deck-card').length === 3`);
    expect(await page.evaluate(`document.querySelector('.workspace-main').scrollWidth <= document.querySelector('.workspace-main').clientWidth`)).toBe(true);
    const search = await page.evaluate(`(() => { const box = document.querySelector('.deck-gallery-search').getBoundingClientRect(); return [box.left >= 0, box.right <= innerWidth]; })()`);
    expect(search).toEqual([true, true]);
    await page.send('Emulation.clearDeviceMetricsOverride', {});
  });

  it('invites the first card when the project has none', async () => {
    await open(new URL('?empty=1', browserFixtureUrl('card-scope')).href);
    await clickPill('All cards');
    await until(`document.querySelector('.card-scope-empty h2')?.textContent === 'No cards yet'`);
    expect(await page.evaluate(`Boolean(document.querySelector('.card-filter-bar'))`)).toBe(false);
    await click('.card-scope-empty button');
    await until(`Boolean(document.querySelector('.deck-gallery .catalog-spaces'))`);
  });

  it('opens the home pulse in the shared control row and restores all cards and focus on removal', async () => {
    await home('&theme=dark');
    await pointer('[data-pulse="started"]');
    await cards(5);
    expect(await text('.card-scope-header .page-title')).toBe('All cards');
    expect(await text('.card-filter-count')).toBe('5 of 30 cards');
    expect(await text('.card-filter-remove')).toBe('State: Started');
    expect(await page.evaluate(`document.querySelector('.card-filter-remove').getAttribute('aria-label')`)).toBe('Remove filter: State: Started');
    await waitForLayout(page.evaluate, '.card-filter-bar, .deck-action-rail');
    // 2026-11-10: the Foil Rule — a control is a 2px rectangle (--control-radius), not the old 4px; compare against the
    // computed token so the next radius change does not break the test.
    const alignment = await page.evaluate(`(() => {
      const button = document.querySelector('.card-filter-remove');
      const rail = document.querySelector('.deck-action-rail button');
      const style = getComputedStyle(button);
      const probe = document.createElement('i'); probe.style.borderRadius = 'var(--control-radius)'; document.body.append(probe);
      const controlRadius = getComputedStyle(probe).borderRadius; probe.remove();
      return { offset: Math.round(button.getBoundingClientRect().top - rail.getBoundingClientRect().top),
        radius: style.borderRadius, controlRadius, focusVisible: button.matches(':focus-visible'), outlineStyle: style.outlineStyle };
    })()`);
    expect(alignment).toEqual({ offset: 0, radius: alignment.controlRadius, controlRadius: alignment.controlRadius,
      focusVisible: false, outlineStyle: 'none' });
    await pointer('.card-filter-remove');
    await cards(30);
    expect(await page.evaluate(`document.activeElement === document.querySelector('.deck-gallery-search input')`)).toBe(true);
    expect(await page.evaluate(`new URLSearchParams(location.search).has('lane')`)).toBe(false);
    expect(await page.evaluate(`Boolean(document.querySelector('.card-filter-bar'))`)).toBe(false);
    await page.evaluate('history.back()');
    await until(`Boolean(document.querySelector('[data-pulse="started"]'))`);
    expect(await page.evaluate(`document.activeElement?.getAttribute('data-pulse')`)).toBe('started');
    await page.evaluate('history.forward()');
    await cards(30);
    expect(await page.evaluate(`Boolean(document.querySelector('.card-filter-bar'))`)).toBe(false);
  });

  it('keeps review project-wide, restores it through Back/Forward and returns to the pulse with Escape', async () => {
    await home();
    await pointer('[data-pulse="review"]');
    await cards(3);
    expect(await text('.card-filter-remove')).toBe('State: Review');
    expect(await text('.card-filter-count')).toBe('3 of 30 cards');
    expect(await page.evaluate(`new URLSearchParams(location.search).get('scope')`)).toBe('all');
    await page.evaluate('history.back()');
    await until(`Boolean(document.querySelector('[data-pulse="review"]'))`);
    await page.evaluate('history.forward()');
    await cards(3);
    expect(await text('.card-filter-remove')).toBe('State: Review');
    await key('Escape');
    await until(`Boolean(document.querySelector('[data-pulse="review"]'))`);
    expect(await page.evaluate(`document.activeElement?.getAttribute('data-pulse')`)).toBe('review');
    await pointer('[data-pulse="unassigned"]');
    await cards(1);
    expect(await text('.card-scope-header .page-title')).toBe('No deck');
    expect(await page.evaluate(`Boolean(document.querySelector('.card-filter-bar'))`)).toBe(false);
  });

  it('combines pulse, priority and search filters, moves keyboard focus to the next filter and clears empty results', async () => {
    await home();
    await pointer('[data-pulse="started"]');
    await cards(5);
    await click('.catalog-group-filter');
    await cards(2);
    expect(await page.evaluate(`[...document.querySelectorAll('.card-filter-remove')].map(button => button.textContent)`)).toEqual(['State: Started', 'Priority: High']);
    await waitForLayout(page.evaluate, '.card-filter-bar');
    await key('Tab');
    await page.evaluate(`document.querySelector('.card-filter-remove').focus()`);
    await key('Enter');
    await until(`document.querySelectorAll('.card-filter-remove').length === 1`);
    expect(await page.evaluate(`document.activeElement?.textContent`)).toBe('Priority: High');
    expect(await page.evaluate(`document.activeElement.matches(':focus-visible') && getComputedStyle(document.activeElement).outlineWidth === '2px'`)).toBe(true);
    await type('.deck-gallery-search input', 'no matches');
    await cards(0);
    expect(await text('.card-filter-count')).toBe('0 of 30 cards');
    expect(await text('.ui-empty-filtered h2')).toBe('No matching cards');
    await pointer('.card-filter-clear');
    await cards(30);
    expect(await page.evaluate(`document.activeElement === document.querySelector('.deck-gallery-search input')`)).toBe(true);
    expect(await page.evaluate(`document.querySelector('.deck-gallery-search input').value`)).toBe('');
  });

  it('uses the same removable control for owner lanes and a tag link', async () => {
    await home();
    await clickPill('All cards');
    await cards(30);
    await click('.deck-action-rail button[aria-label="Ordering"]');
    await until(`Boolean(document.querySelector('.card-ordering-list'))`);
    await page.evaluate(`[...document.querySelectorAll('.card-ordering-list button')].find(button => button.textContent === 'Owner').click()`);
    await until(`Boolean([...document.querySelectorAll('.catalog-group-filter')].find(button => button.textContent.includes('Александра')))`);
    await page.evaluate(`[...document.querySelectorAll('.catalog-group-filter')].find(button => button.textContent.includes('Александра')).click()`);
    await cards(2);
    expect(await text('.card-filter-remove')).toBe('Owner: Александра Константинопольская');
    await pointer('.card-filter-remove');
    await cards(30);
    await open(browserFixtureUrl('card-scope') + '?pulse=1&scope=all&tag=' + encodeURIComponent('подготовка-выпуска-без-сокращений'));
    await cards(2);
    expect(await text('.card-filter-remove')).toBe('Tags: подготовка-выпуска-без-сокращений');
    await pointer('.card-filter-remove');
    await cards(30);
  });

  it('shows My cards in the same row and clears it even when owners use IDs or aliases', async () => {
    await open(browserFixtureUrl('card-scope') + '?pulse=1&scope=all&mine=1&ownerAliases=1');
    await cards(2);
    expect(await text('.card-filter-remove')).toBe('My cards');
    expect(await text('.card-filter-count')).toBe('2 of 30 cards');
    await pointer('.card-filter-clear');
    await cards(30);
    expect(await page.evaluate(`new URLSearchParams(location.search).has('mine')`)).toBe(false);
  });

  for (const theme of ['dark', 'light']) it(`wraps Russian filters at 375px and clears a zero-count pulse (${theme})`, async () => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
    const lane = JSON.stringify({ key: 'owner:Александра Константинопольская', title: 'Александра Константинопольская', order: 'order=owner' });
    await open(browserFixtureUrl('card-scope') + `?pulse=1&scope=all&lang=ru&theme=${theme}&lane=${encodeURIComponent(lane)}&tag=${encodeURIComponent('подготовка-выпуска-без-сокращений')}`);
    await cards(2);
    await waitForLayout(page.evaluate, '.card-filter-bar, .card-filter-remove');
    expect(await page.evaluate(`(() => {
      const workspace = document.querySelector('.workspace-main');
      return workspace.scrollWidth <= workspace.clientWidth && [...document.querySelectorAll('.card-filter-bar, .card-filter-remove, .card-filter-remove > span')]
        .every(element => element.scrollWidth <= element.clientWidth && element.getBoundingClientRect().right <= innerWidth);
    })()`)).toBe(true);
    expect(await page.evaluate(`[...document.querySelectorAll('.card-filter-remove')].map(button => button.textContent)`)).toEqual(['Исполнитель: Александра Константинопольская', 'Теги: подготовка-выпуска-без-сокращений']);
    await capture(`${theme}-375-ru-multiple`);
    await home(`&noStarted=1&lang=ru&theme=${theme}`);
    await pointer('[data-pulse="started"]');
    await until(`Boolean(document.querySelector('.card-scope-empty.ui-empty-filtered'))`);
    expect(await text('.card-filter-count')).toBe('0 из 30 карточек');
    expect(await text('.card-filter-remove')).toBe('Состояние: В работе');
    await capture(`${theme}-375-ru-empty`);
    await pointer('.card-scope-empty button');
    await cards(30);
    expect(await page.evaluate(`document.activeElement === document.querySelector('.deck-gallery-search input')`)).toBe(true);
    await page.send('Emulation.clearDeviceMetricsOverride', {});
    expect(page.consoleErrors).toEqual([]);
  });

  // The checklist stays in the owner's name and tooltip on tiles, the open card and Table; a save updates it in place.
  for (const theme of ['dark', 'light']) it(`names the owner checklist on tiles, preview and table without a ring (${theme})`, async () => {
    const lang = theme === 'dark' ? 'en' : 'ru';
    const label = (done: number) => lang === 'en' ? `Owner: Maya Chen · checklist ${done} of 3` : `Исполнитель: Maya Chen · чек-лист ${done} из 3`;
    const id = (number: number) => `card:5c0e0000-0000-4000-8000-00000000000${number}`;
    const tile = (number: number) => `[data-deck-card="${id(number)}"]`;
    const medallion = `${tile(1)} .deck-card-owner`;
    const rings = () => page.evaluate(`document.querySelectorAll('.owner-progress-ring').length`);
    const title = (selector: string) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).title`);
    await open(browserFixtureUrl('card-scope') + `?checklist=1&scope=all&theme=${theme}&lang=${lang}`);
    await cards(4);
    expect(await rings()).toBe(0);
    expect(await title(medallion)).toBe(label(1));
    await click(tile(1) + ' .deck-card-open');
    await until(`document.querySelectorAll('.card-preview .markdown input[type="checkbox"]:not(:disabled)').length === 3`);
    expect(await page.evaluate(`document.querySelector('.card-preview-owner-shortcut').getAttribute('aria-label')`)).toBe(label(1));
    expect(await rings()).toBe(0);
    // A save updates both medallions in place: the same elements, the same boxes, no fade.
    const saved = await page.evaluate(`new Promise((resolve, reject) => {
      const selectors = [${JSON.stringify(medallion)}, '.card-preview-owner-shortcut'];
      const originals = selectors.map(selector => document.querySelector(selector));
      const boxes = originals.map(element => { const r = element.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
      const frames = [];
      const timer = setTimeout(() => reject(new Error('Checklist label did not update')), 5000);
      document.querySelectorAll('.card-preview .markdown input[type="checkbox"]')[1].click();
      function sample() {
        frames.push(originals.map((element, index) => {
          const r = element.getBoundingClientRect();
          return { connected: element.isConnected && element === document.querySelector(selectors[index]),
            stable: JSON.stringify([r.x, r.y, r.width, r.height]) === JSON.stringify(boxes[index]), opacity: Number(getComputedStyle(element).opacity) };
        }));
        if (document.querySelector('.card-preview-owner-shortcut').title === ${JSON.stringify(label(2))}
          && document.querySelectorAll('.card-preview .markdown input[type="checkbox"]:not(:disabled)').length === 3) {
          clearTimeout(timer); resolve(frames);
        } else requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    })`) as Array<Array<{ connected: boolean; stable: boolean; opacity: number }>>;
    expect(saved.length).toBeGreaterThan(0);
    expect(saved.flat().every(frame => frame.connected && frame.stable && frame.opacity === 1), JSON.stringify(saved)).toBe(true);
    expect(await title(medallion)).toBe(label(2));
    await click('.card-preview .markdown li:last-child input[type="checkbox"]');
    await until(`document.querySelector('.card-preview-owner-shortcut').title === ${JSON.stringify(label(3))}`);
    expect(await title(medallion)).toBe(label(3));
    await until(`!document.querySelector('.card-preview-tools button').disabled`);
    await click('.card-preview-tools button');
    await until(`!document.querySelector('.card-preview')`);
    await click(tile(2) + ' .deck-card-open');
    await until(`Boolean(document.querySelector('.card-preview-owner-shortcut'))`);
    expect(await title('.card-preview-owner-shortcut')).toBe(lang === 'en' ? 'Owner: Maya Chen' : 'Исполнитель: Maya Chen');
    await click('.card-preview-tools button');
    await until(`!document.querySelector('.card-preview')`);
    await click('.deck-action-rail button:first-child');
    await until(`Boolean(document.querySelector('.deck-narrow-panel [role="switch"]'))`);
    await page.evaluate(`[...document.querySelectorAll('.card-ordering .control-segmented button')].find(item => item.textContent === ${JSON.stringify(lang === 'en' ? 'Table' : 'Таблица')}).click()`);
    await until(`document.querySelectorAll('.deck-table-row').length === 4`);
    const tableOwner = `.deck-table-row[data-card-id="${id(1)}"] .deck-table-owner .card-owner-avatar`;
    expect(await page.evaluate(`document.querySelector(${JSON.stringify(tableOwner)}).getAttribute('aria-label')`)).toBe(label(3));
    expect(await rings()).toBe(0);
    expect(page.consoleErrors).toEqual([]);
  }, 30000);
});
