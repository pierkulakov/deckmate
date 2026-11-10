import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';
import { waitForLayout } from './browser-layout.ts';

const browserPath = requireBrowser();
describe.skipIf(!browserPath)('open-deck chrome', () => {
  let page: HeadlessPage;
  async function until(expression: string) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await page.evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(expression + '\n' + page.consoleErrors.join('\n'));
  }
  async function navigate(deck = 'work', activity = 'empty') {
    await page.send('Page.navigate', { url: browserFixtureUrl('open-deck-chrome') + `?view=deck&catalogSource=sandbox&deck=${deck}&activity=${activity}` });
    await until(`Boolean(document.querySelector('.deck-action-rail'))`);
  }
  async function panel(index: number) {
    await page.callFunction(`function(index) { const button = document.querySelectorAll('.deck-action-rail button[aria-pressed]')[index]; if (button.getAttribute('aria-pressed') !== 'true') button.click(); }`, index);
    await waitForLayout(page.evaluate, '.deck-open-toolbar, .catalog-workbench, .deck-panel, .deck-overview');
  }
  async function expectNoOverflow() {
    expect(await page.evaluate(`(() => { const workspace = document.querySelector('.workspace-main'); return workspace.scrollWidth <= workspace.clientWidth && document.documentElement.scrollWidth <= innerWidth; })()`)).toBe(true);
    expect(await page.evaluate(`[...document.querySelectorAll('.deck-panel, .deck-overview, .deck-activity')].every(el => el.scrollWidth <= el.clientWidth)`)).toBe(true);
  }
  beforeAll(async () => {
    page = await openHeadlessBrowser({ width: 1440, height: 900, scale: 1 });
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('deckmate-language', 'ru');` });
  }, 60000);
  afterAll(async () => { await page?.close(); }, 20000);

  it.each([{ width: 2560, height: 1440 }, { width: 1440, height: 900 }])(
    'matches the 4K shelf and toolbar proportions at $width×$height', async ({ width, height }) => {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await navigate();
      await waitForLayout(page.evaluate, '.deck-neighbor-rail, .deck-open-toolbar, .catalog-card-group-heading');
      const measured = await page.evaluate(`(() => {
        const rail = document.querySelector('.deck-neighbor-rail');
        const button = rail.querySelector(':scope > .catalog-deck-cover');
        const face = button.querySelector('.deck-neighbor-window > .catalog-deck-cover');
        const toolbar = document.querySelector('.deck-open-toolbar');
        const title = toolbar.querySelector('h1');
        const railStyle = getComputedStyle(rail), titleStyle = getComputedStyle(title), rootStyle = getComputedStyle(document.documentElement);
        const box = element => { const r = element.getBoundingClientRect(); return { width:r.width, height:r.height }; };
        return {
          face:box(face), window:box(button), railHeight:box(rail).height, gap:parseFloat(railStyle.gap), left:parseFloat(railStyle.paddingLeft),
          baseCover:[rootStyle.getPropertyValue('--cover-width').trim(), rootStyle.getPropertyValue('--cover-height').trim()],
          toolbarHeight:box(toolbar).height, title:[titleStyle.fontSize, titleStyle.fontWeight, titleStyle.lineHeight],
          controls:[...toolbar.querySelectorAll('.ui-button, .deck-toolbar-search')].every(element => box(element).height === 32),
          iconButtons:[...toolbar.querySelectorAll('.ui-button.button-size-icon')].every(element => box(element).width === 32),
          icons:[...toolbar.querySelectorAll('.ui-button > svg, .deck-toolbar-search > svg')].every(icon => box(icon).width === 20 && box(icon).height === 20),
          groupHeading:getComputedStyle(document.querySelector('.catalog-card-group-heading')).fontSize,
        };
      })()`);
      // 2026-11-10: only the shelf scales; the settings preview keeps the base 132×180 tokens.
      expect(measured).toEqual({ face:{ width:165, height:225 }, window:{ width:165, height:120 }, railHeight:120, gap:20, left:35,
        baseCover:['132px', '180px'], toolbarHeight:64, title:['22px', '600', '24px'], controls:true, iconButtons:true, icons:true, groupHeading:'13px' });
    });

  it('keeps the list free of a focus strip across view changes', async () => {
    const key = async (name: string, code: string, virtualKey: number, modifiers = 0) => {
      for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: name, code, windowsVirtualKeyCode: virtualKey, modifiers });
    };
    const noStrip = async () => {
      expect(await page.evaluate(`(() => { const s = getComputedStyle(document.querySelector('.catalog-results')); return [s.outlineStyle, s.boxShadow, s.borderLeftWidth]; })()`)).toEqual(['none', 'none', '0px']);
    };
    for (const scope of ['deck', 'all']) for (const dark of [true, false]) {
      if (scope === 'deck') {
        await navigate();
        await panel(1);
      } else {
        await page.send('Page.navigate', { url: browserFixtureUrl('card-scope') });
        await until(`Boolean(document.querySelector('.card-scope-view .catalog-results'))`);
        await page.evaluate(`[...document.querySelectorAll('.catalog-nav-section button')].find(button => /^(Все карточки|All cards)/.test(button.textContent)).click()`);
        await until(`document.querySelectorAll('.catalog-results .deck-card').length === 3`);
        await page.evaluate(`document.querySelector('.deck-action-rail button').click()`);
        await until(`Boolean(document.querySelector('.card-ordering'))`);
      }
      await page.callFunction(`function(dark) { document.documentElement.classList.toggle('dark', dark); }`, dark);
      // The switch row is last, while the switch itself is the last child of its row.
      const switchExpr = `[...document.querySelectorAll('.card-ordering [role=switch]')].at(-1)`;
      for (const checked of ['true', 'false']) {
        const rect = await page.evaluate(`(() => { const b = ${switchExpr}; b.scrollIntoView({block:'center', behavior:'instant'}); const r = b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
        for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, ...rect, button: 'left', clickCount: 1 });
        await until(`${switchExpr}.getAttribute('aria-checked') === '${checked}'`);
        await noStrip();
      }
      await page.evaluate(`(() => { const switches = [...document.querySelectorAll('.card-ordering [role=switch]:not(:disabled)')]; switches.at(-2).focus(); })()`);
      await key('Tab', 'Tab', 9);
      expect(await page.evaluate(`${switchExpr} === document.activeElement && ${switchExpr}.matches(':focus-visible') && getComputedStyle(${switchExpr}).outlineStyle !== 'none'`)).toBe(true);
      for (const checked of ['true', 'false']) {
        await key(' ', 'Space', 32);
        await until(`${switchExpr}.getAttribute('aria-checked') === '${checked}'`);
        await noStrip();
      }
      await page.evaluate(`document.querySelector('.catalog-results').focus()`);
      expect(await page.evaluate(`document.querySelector('.catalog-results').matches(':focus-visible')`)).toBe(true);
      for (const checked of ['true', 'false']) {
        await key('V', 'KeyV', 86, 8);
        await until(`${switchExpr}.getAttribute('aria-checked') === '${checked}'`);
        await noStrip();
      }
    }
  }, 60000);

  it('draws outlined rail and panel controls with violet pressed states', async () => {
    await navigate();
    // 2026-11-10: the Foil Rule — a resting control shows the quiet --control-line hairline (full --button-line only on
    // hover), a 2px --control-radius rectangle, and the chosen state is --mark over --mark-tint, never --violet-fill.
    const idle = await page.evaluate(`(() => { const b = document.querySelector('.deck-action-rail button'); const s = getComputedStyle(b); const probe = document.createElement('i'); probe.style.color = 'var(--control-line)'; document.body.append(probe); const line = getComputedStyle(probe).color; probe.style.borderRadius = 'var(--control-radius)'; const controlRadius = getComputedStyle(probe).borderRadius; probe.remove(); return { width: s.borderTopWidth, color: s.borderTopColor, line, radius: s.borderRadius, controlRadius, background: s.backgroundColor }; })()`) as { width: string; color: string; line: string; radius: string; controlRadius: string; background: string };
    expect(parseFloat(idle.width)).toBeGreaterThan(0);
    expect(idle.color).toBe(idle.line);
    expect(idle.radius).toBe(idle.controlRadius);
    expect(idle.background).toBe('rgba(0, 0, 0, 0)');
    await panel(1);
    expect(await page.evaluate(`(() => { const b = document.querySelector('.deck-action-rail button[aria-pressed="true"]'); const probe = document.createElement('i'); probe.style.background = 'var(--mark-tint)'; document.body.append(probe); const fill = getComputedStyle(probe).backgroundColor; probe.remove(); return getComputedStyle(b).backgroundColor === fill; })()`)).toBe(true);
  });

  for (const width of [1440, 375]) for (const dark of [true, false]) {
    it(`keeps readable panels without horizontal scroll at ${width}px, dark=${dark}`, async () => {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: width === 375 ? 812 : 900, deviceScaleFactor: 1, mobile: false });
      await navigate();
      await page.callFunction(`function(dark) { document.documentElement.classList.toggle('dark', dark); }`, dark);
      for (const index of [0, 1, 2, 3]) {
        await panel(index);
        await expectNoOverflow();
        // 2026-11-10: the Foil Rule — the panel title is 15px (was 17px).
        expect(await page.evaluate(`getComputedStyle(document.querySelector('.panel-title')).fontSize`)).toBe('15px');
      }
      await panel(2);
      expect(await page.evaluate(`(() => { const tag = document.querySelector('.deck-tag-row .tag-badge-name'); return tag.textContent === '#очень-длинный-русский-тег-без-сокращений' && getComputedStyle(tag).whiteSpace === 'normal' && tag.scrollWidth <= tag.clientWidth; })()`)).toBe(true);
      await page.evaluate(`document.querySelector('.deck-tags-panel button.deck-tag-row:not([disabled])').click()`);
      await until(`Boolean(document.querySelector('.card-selection-bar'))`);
      expect(await page.evaluate(`getComputedStyle(document.querySelector('.deck-open-toolbar')).paddingTop`)).toBe('0px');
      await expectNoOverflow();
    }, 20000);
  }
  it('uses common quiet states for an empty deck and loading/error activity', async () => {
    await navigate('empty');
    await panel(0);
    await until(`Boolean(document.querySelector('.deck-activity-empty'))`);
    expect(await page.evaluate(`Boolean(document.querySelector('.deck-empty.ui-empty-first-run') && document.querySelector('.deck-overview-empty.ui-empty-quiet'))`)).toBe(true);
    expect(await page.evaluate(`Boolean(document.querySelector('.deck-overview-stats, .deck-activity-filters, .deck-overview-files'))`)).toBe(false);
    await navigate('empty', 'loading');
    await panel(3);
    await until(`Boolean(document.querySelector('.deck-activity-loading'))`);
    expect(await page.evaluate(`document.querySelector('.deck-activity').getAttribute('aria-busy')`)).toBe('true');
    expect(await page.evaluate(`document.querySelector('.deck-activity-loading').getAttribute('role')`)).toBe('status');
    await navigate('empty', 'error');
    await panel(3);
    await until(`Boolean(document.querySelector('.deck-activity-error [role=alert]'))`);
    expect(await page.evaluate(`document.querySelector('.deck-activity-error button').disabled`)).toBe(false);
    await expectNoOverflow();
    expect(page.consoleErrors).toEqual([]);
  }, 20000);
  it('keeps lane filters, removable chips and reset functional', async () => {
    await navigate();
    await page.evaluate(`document.querySelector('.catalog-card-group-heading .catalog-group-filter').click()`);
    await until(`Boolean(document.querySelector('.card-filter-remove'))`);
    expect(await page.evaluate(`document.querySelector('.card-filter-count').textContent`)).toBe('2 из 8 карточек');
    await expectNoOverflow();
    await page.evaluate(`document.querySelector('.card-filter-remove').click()`);
    await until(`!document.querySelector('.card-filter-bar')`);
    expect(await page.evaluate(`document.activeElement === document.querySelector('.deck-toolbar-search input')`)).toBe(true);
    await page.evaluate(`const input = document.querySelector('.deck-toolbar-search input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'нет совпадений'); input.dispatchEvent(new Event('input', { bubbles: true }));`);
    // 2026-11-10: the control row remains usable with no matches; the empty state's reset clears the same filters.
    await until(`Boolean(document.querySelector('.catalog-results .ui-empty-filtered button'))`);
    expect(await page.evaluate(`Boolean(document.querySelector('.card-filter-clear'))`)).toBe(true);
    await expectNoOverflow();
    await page.evaluate(`document.querySelector('.catalog-results .ui-empty-filtered button').click()`);
    await until(`!document.querySelector('.card-filter-bar')`);
    await until(`document.querySelectorAll('.deck-card').length === 8`);
    expect(await page.evaluate(`document.querySelectorAll('.deck-card').length`)).toBe(8);
  }, 20000);
});
