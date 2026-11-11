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
  async function navigateTo(url: string, ready: string) {
    // 2026-11-11: controls in the old document must not satisfy readiness before navigation commits.
    await page.evaluate(`window.openDeckNavigationPending = true`);
    await page.send('Page.navigate', { url });
    await until(`!window.openDeckNavigationPending && Boolean(${ready})`);
  }
  async function navigate(deck = 'work', activity = 'empty') {
    await navigateTo(browserFixtureUrl('open-deck-chrome') + `?view=deck&catalogSource=sandbox&deck=${deck}&activity=${activity}`,
      `document.querySelector('.deck-action-rail')`);
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

  async function automation() {
    await page.send('Page.navigate', { url: browserFixtureUrl('open-deck-chrome') + '?automationTest=1' });
    await until(`Boolean(document.querySelector('.deck-automation-toggle'))`);
    await page.evaluate(`document.querySelector('.deck-automation-toggle').click()`);
    await until(`Boolean(document.querySelector('.deck-automation-menu textarea'))`);
    await page.evaluate(`(() => { const field = document.querySelector('.deck-automation-menu textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, 'My draft'); field.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  }
  it('does not rebase an automation draft onto an external manifest revision', async () => {
    await automation();
    await page.evaluate(`window.automationTest.external()`);
    await page.evaluate(`document.querySelector('.deck-settings-actions button:last-child').click()`);
    expect(await page.evaluate(`window.automationTest.saved`)).toEqual([]);
    expect(await page.evaluate(`document.querySelector('.deck-automation-menu textarea').value`)).toBe('My draft');
    expect(await page.evaluate(`document.querySelector('.deck-automation-menu [role=alert]').textContent`)).toContain('Каталог изменился');
    await page.evaluate(`document.querySelector('.deck-automation-reload').click()`);
    await until(`document.querySelector('.deck-automation-menu textarea').value === 'external template'`);
    await page.evaluate(`document.querySelector('.deck-settings-actions button:last-child').click()`);
    await until(`window.automationTest.saved.length === 1`);
    expect(await page.evaluate(`window.automationTest.saved[0]`)).toMatchObject({ hash: 'external', settings: { templateMarkdown: 'external template' } });
  });
  it('keeps automation input through Escape and exposes its form to Tab', async () => {
    await automation();
    const key = async (key: string, code: number) => { for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key, windowsVirtualKeyCode: code }); };
    await page.evaluate(`document.querySelector('.deck-automation-menu input[type=text]').focus()`);
    await key('Tab', 9);
    expect(await page.evaluate(`document.activeElement === document.querySelector('.deck-automation-menu textarea')`)).toBe(true);
    await key('Escape', 27);
    await until(`!document.querySelector('.deck-automation-menu') && document.activeElement.matches('.deck-automation-toggle')`);
    expect(await page.evaluate(`document.activeElement.matches('.deck-automation-toggle')`)).toBe(true);
    await page.evaluate(`document.querySelector('.deck-automation-toggle').click()`);
    await until(`Boolean(document.querySelector('.deck-automation-menu textarea'))`);
    expect(await page.evaluate(`document.querySelector('.deck-automation-menu textarea').value`)).toBe('My draft');
    await page.evaluate(`window.automationTest.fail()`);
    await page.evaluate(`document.querySelector('.deck-settings-actions button:last-child').click()`);
    await until(`Boolean(document.querySelector('.deck-automation-menu [role=alert]'))`);
    expect(await page.evaluate(`document.querySelector('.deck-settings-actions button:last-child').disabled`)).toBe(false);
  });

  it.each(['sandbox', 'original'])('copies a URL-safe deck link for %s and reports clipboard rejection', async source => {
    const id = 'work &/тест?';
    await page.send('Page.navigate', { url: browserFixtureUrl('open-deck-chrome') + '?' + new URLSearchParams({ linkTest: '1', view: 'deck', catalogSource: source, deck: id }) });
    await until(`Boolean(document.querySelector('.deck-actions-toggle'))`);
    await page.evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.copiedDeckUrl = value; } } }); document.querySelector('.deck-actions-toggle').click()`);
    await until(`Boolean(document.querySelector('.deck-actions-menu'))`);
    const copy = `[...document.querySelectorAll('.deck-actions-menu button')].find(button => button.textContent.includes('Копировать ссылку'))`;
    await page.evaluate(`${copy}.click()`);
    await until(`Boolean(document.querySelector('.deck-actions-feedback[role=status]'))`);
    const copied = new URL(await page.evaluate('window.copiedDeckUrl'));
    expect(copied.pathname).toBe('/');
    expect(Object.fromEntries(copied.searchParams)).toEqual({ view: 'deck', catalogSource: source, deck: id });
    await page.evaluate(`navigator.clipboard.writeText = async () => { throw new Error('Denied'); }; ${copy}.click()`);
    await until(`Boolean(document.querySelector('.deck-actions-feedback[role=alert]'))`);
    await page.send('Page.navigate', { url: browserFixtureUrl('open-deck-chrome') + copied.search + '&linkTest=1' });
    await until(`Boolean(document.querySelector('.deck-neighbor-rail [aria-current=page]'))`);
    expect(await page.evaluate(`document.querySelector('.deck-neighbor-rail [aria-current=page]').dataset.deckCover`)).toBe(id);
  });

  it('retains the automation draft when its parent menu unmounts and keeps short-window actions reachable', async () => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 600, deviceScaleFactor: 1, mobile: false });
    await navigate();
    await page.evaluate(`document.querySelector('.deck-tools-toggle').click()`);
    await page.evaluate(`document.querySelector('.deck-actions-toggle').click()`);
    await until(`Boolean(document.querySelector('.deck-actions-menu'))`);
    await page.evaluate(`document.querySelector('.deck-delete-toggle').scrollIntoView({ block: 'nearest' })`);
    expect(await page.evaluate(`(() => { const b = document.querySelector('.deck-delete-toggle').getBoundingClientRect(); const p = document.querySelector('.deck-picker-popover').getBoundingClientRect(); return b.top >= p.top && b.bottom <= p.bottom && b.bottom <= innerHeight; })()`)).toBe(true);
    await page.evaluate(`document.querySelector('.deck-automation-toggle').click()`);
    await until(`Boolean(document.querySelector('.deck-automation-menu textarea'))`);
    await page.evaluate(`(() => { const input = document.querySelector('.deck-automation-menu textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Nested draft'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const escape = async () => { for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'Escape', windowsVirtualKeyCode: 27 }); };
    await escape();
    await until(`!document.querySelector('.deck-automation-menu') && document.activeElement.matches('.deck-automation-toggle')`);
    await escape();
    await until(`!document.querySelector('.deck-actions-menu') && document.activeElement.matches('.deck-actions-toggle')`);
    await page.evaluate(`document.querySelector('.deck-actions-toggle').click()`);
    await until(`Boolean(document.querySelector('.deck-automation-toggle'))`);
    await page.evaluate(`document.querySelector('.deck-automation-toggle').click()`);
    await until(`Boolean(document.querySelector('.deck-automation-menu textarea'))`);
    expect(await page.evaluate(`document.querySelector('.deck-automation-menu textarea').value`)).toBe('Nested draft');
    expect(await page.evaluate(`(() => { const box = document.querySelector('.deck-automation-menu .dialog-head').getBoundingClientRect(); const foot = document.querySelector('.deck-automation-menu .dialog-foot').getBoundingClientRect(); return box.top >= 0 && foot.bottom <= innerHeight; })()`)).toBe(true);
  });

  it('shows the saved type above compact choices and reveals incompatible card examples on selection', async () => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 600, deviceScaleFactor: 1, mobile: false });
    await navigate();
    await page.evaluate(`document.querySelector('.deck-type-trigger').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0 }))`);
    await until(`Boolean(document.querySelector('.deck-type-current'))`);
    expect(await page.evaluate(`document.querySelector('.deck-type-current').textContent`)).toContain('Mixed');
    expect(await page.evaluate(`document.querySelectorAll('.deck-type-option').length`)).toBe(4);
    await page.evaluate(`document.querySelector('.deck-type-option.is-blocked').click()`);
    await until(`Boolean(document.querySelector('.deck-type-error'))`);
    expect(await page.evaluate(`document.querySelector('.deck-type-error').textContent`)).toContain('Карточка 0');
    expect(await page.evaluate(`document.querySelector('.deck-type-menu').scrollWidth <= document.querySelector('.deck-type-menu').clientWidth`)).toBe(true);
  });

  it.each([0, 1, 3])('counts %i active review tasks without including documents, heroes or shelved cards', async count => {
    await page.send('Page.navigate', { url: browserFixtureUrl('open-deck-chrome') + '?view=deck&catalogSource=sandbox&deck=work&reviewCount=' + count });
    await until(`Boolean(document.querySelector('.deck-neighbor-rail [aria-current=page]'))`);
    const result = await page.evaluate(`(() => { const cover = document.querySelector('.deck-neighbor-rail [aria-current=page]'); return { label: cover.getAttribute('aria-label'), review: cover.querySelector('.is-review')?.textContent ?? null, open: cover.querySelector('.catalog-cover-count').textContent }; })()`);
    expect(result.open).toBe('10');
    expect(result.review).toBe(count ? String(count) : null);
    if (count) expect(result.label).toContain('Задач на приёмке: ' + count);
  });

  it.each([{ order: 'state', compact: false, state: false, priority: true },
    { order: 'priority', compact: false, state: true, priority: false },
    { order: 'state', compact: true, state: true, priority: true }])(
    'suppresses only metadata repeated by a visible $order heading, compact=$compact', async ({ order, compact, state, priority }) => {
      await navigateTo(browserFixtureUrl('open-deck-chrome') + `?view=deck&catalogSource=sandbox&deck=work&order=${order}${compact ? '&compact=1' : ''}`,
        `document.querySelector('.deck-card')`);
      expect(await page.evaluate(`Boolean(document.querySelector('.deck-card .card-face-state'))`)).toBe(state);
      expect(await page.evaluate(`Boolean(document.querySelector('.deck-card .deck-card-priority'))`)).toBe(priority);
    });

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
          controls:[...toolbar.querySelectorAll('.ui-button:not(.deck-tools-toggle), .deck-toolbar-search')].every(element => box(element).height === 32),
          iconButtons:[...toolbar.querySelectorAll('.ui-button.button-size-icon:not(.deck-tools-toggle)')].every(element => box(element).width === 32),
          icons:[...toolbar.querySelectorAll('.ui-button:not(.deck-tools-toggle) > svg, .deck-toolbar-search > svg')].every(icon => box(icon).width === 20 && box(icon).height === 20),
          groupHeading:getComputedStyle(document.querySelector('.catalog-card-group-heading')).fontSize,
        };
      })()`);
      // 2026-11-10: only the shelf scales; the settings preview keeps the base 132×180 tokens.
      expect(measured).toEqual({ face:{ width:165, height:225 }, window:{ width:165, height:120 }, railHeight:120, gap:20, left:35,
        baseCover:['132px', '180px'], toolbarHeight:64, title:['22px', '600', '24px'], controls:true, iconButtons:true, icons:true, groupHeading:'13px' });
    });

  it('folds the whole phone toolbar and restores search focus after removing a filter', async () => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    try {
      await navigate();
      expect(await page.evaluate(`Boolean(document.querySelector('.deck-tools-toggle[aria-expanded="false"]'))`)).toBe(true);
      expect(await page.evaluate(`document.querySelector('.deck-open-tools').getBoundingClientRect().height`)).toBe(0);
      expect(await page.evaluate(`[...document.querySelectorAll('.catalog-card-group-heading')].every(heading => { const box = heading.getBoundingClientRect(); const add = heading.querySelector('.catalog-group-add').getBoundingClientRect(); const select = heading.querySelector('.catalog-group-select').getBoundingClientRect(); const filter = heading.querySelector('.catalog-group-filter').getBoundingClientRect(); return add.width >= 44 && add.right <= box.right && select.width >= 44 && select.height >= 44 && select.right <= filter.left; })`)).toBe(true);
      await page.evaluate(`document.querySelector('.deck-tools-toggle').click()`);
      await waitForLayout(page.evaluate, '.deck-open-toolbar');
      expect(await page.evaluate(`(() => { const tools = document.querySelector('.deck-open-tools'); const buttons = [...tools.querySelectorAll(':scope > button')]; return buttons.every(b => b.getBoundingClientRect().height >= 44) && new Set(buttons.map(b => b.getBoundingClientRect().top)).size === 1; })()`)).toBe(true);
      await page.evaluate(`document.querySelector('.deck-tools-toggle').click(); document.querySelector('.catalog-group-filter').click()`);
      await until(`Boolean(document.querySelector('.card-filter-remove'))`);
      await page.evaluate(`document.querySelector('.card-filter-remove').click()`);
      await until(`document.activeElement === document.querySelector('.deck-toolbar-search input')`);
      expect(await page.evaluate(`document.querySelector('.deck-tools-toggle').getAttribute('aria-expanded')`)).toBe('true');
      await expectNoOverflow();
    } finally { await page.send('Emulation.setTouchEmulationEnabled', { enabled: false }); }
  });

  it('keeps manual zone controls separate and reachable with touch-sized targets', async () => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 600, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    try {
      await navigateTo(browserFixtureUrl('open-deck-chrome') + '?view=deck&catalogSource=sandbox&deck=work&order=manual&zonesTest=1',
        `document.querySelector('.catalog-zone-heading')`);
      await page.evaluate(`document.querySelector('.catalog-zone-heading .is-danger').click()`);
      await until(`Boolean(document.querySelector('.catalog-zone-heading .confirm-strip'))`);
      await waitForLayout(page.evaluate, '.catalog-zone-heading');
      await expectNoOverflow();
      expect(await page.evaluate(`[...document.querySelectorAll('.catalog-zone-heading')].every(heading => { const targets = [...heading.querySelectorAll('button,.catalog-group-select')].map(el => el.getBoundingClientRect()).filter(r => r.width && r.height); return targets.every((a, i) => a.height >= 44 && targets.slice(i + 1).every(b => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)); })`)).toBe(true);
      await page.evaluate(`document.querySelector('.catalog-zone-heading .confirm-strip-keep').click(); document.querySelector('.catalog-zone-tools .ui-button:not(.is-danger)').click()`);
      await until(`Boolean(document.querySelector('.catalog-zone-title-input'))`);
      expect(await page.evaluate(`document.querySelector('.catalog-zone-title-input').getBoundingClientRect().height`)).toBeGreaterThanOrEqual(44);
      await expectNoOverflow();
    } finally { await page.send('Emulation.setTouchEmulationEnabled', { enabled: false }); }
  });

  it('switches one phone drag dock between decks and groups and cleans up cancellation', async () => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 600, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const point = (selector: string) => page.callFunction(`selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, id: 1 }; }`, selector);
    const move = async (selector: string) => { await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [await point(selector)] }); };
    try {
      for (const ending of ['touchCancel', 'Escape', 'group', 'deck']) {
        await navigateTo(browserFixtureUrl('open-deck-chrome') + '?view=deck&catalogSource=sandbox&deck=work&order=priority',
          `document.querySelector('.card-transfer-handle')`);
        await page.evaluate(`document.querySelector('.deck-action-rail button[aria-pressed="true"]')?.click(); document.querySelector('.card-transfer-handle').scrollIntoView({block:'center',behavior:'instant'})`);
        await waitForLayout(page.evaluate, '.catalog-workbench');
        const start = await point('.card-transfer-handle');
        await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
        await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...start, x: start.x + 20 }] });
        await until(`Boolean(document.querySelector('.deck-drop-mode-switch'))`);
        await waitForLayout(page.evaluate, '.card-transfer-targets');
        expect(await page.evaluate(`document.querySelector('.card-transfer-targets').getBoundingClientRect().height <= Math.min(320, innerHeight * .4)`)).toBe(true);
        await move('[data-drop-mode="group"]');
        await until(`Boolean(document.querySelector('.card-transfer-targets .card-group-drop-panel')) && !document.querySelector('.card-transfer-target-group')`);
        await move('[data-drop-mode="deck"]');
        await until(`Boolean(document.querySelector('.card-transfer-target-group')) && !document.querySelector('.card-group-drop-panel')`);
        await move('[data-drop-mode="group"]');
        await until(`Boolean(document.querySelector('.card-transfer-targets .card-group-drop-target:not(:disabled)'))`);
        await move('.card-transfer-targets .card-group-drop-target:not(:disabled)');
        await until(`Boolean(document.querySelector('.card-group-drop-target.is-over'))`);
        if (ending === 'deck') {
          await move('[data-drop-mode="deck"]');
          await until(`Boolean(document.querySelector('.card-transfer-targets .card-transfer-target.is-none'))`);
          await move('.card-transfer-targets .card-transfer-target.is-none');
          await until(`Boolean(document.querySelector('.card-transfer-target.is-none.is-over'))`);
        }
        if (ending === 'Escape') {
          for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
          await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else await page.send('Input.dispatchTouchEvent', { type: ending === 'touchCancel' ? 'touchCancel' : 'touchEnd', touchPoints: [] });
        await until(`!document.querySelector('.card-transfer-targets,.card-group-drop-panel,.card-drag-tabs,.card-drag-face')`);
        if (ending === 'group' || ending === 'deck') {
          await until(`window.deckEdits.length === 1`);
          const request = await page.evaluate('window.deckEdits[0]');
          expect(request).toMatchObject({ cards: [{ cardId: 'card:0', sourceHash: 'hash' }] });
          expect(request).toMatchObject(ending === 'group'
            ? { action: 'bulk-edit-cards', change: { kind: 'properties', priority: 'medium' } }
            : { action: 'bulk-assign-deck', deckId: null });
        } else expect(await page.evaluate('window.deckEdits'), ending).toEqual([]);
        expect(await page.evaluate(`document.documentElement.classList.contains('is-transfer-target-over')`)).toBe(false);
      }
    } finally { await page.send('Emulation.setTouchEmulationEnabled', { enabled: false }); }
  }, 30000);

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
        await navigateTo(browserFixtureUrl('card-scope'), `document.querySelector('.card-scope-view .catalog-results')`);
        await page.evaluate(`[...document.querySelectorAll('.catalog-nav-section button')].find(button => /^(Все карточки|All cards)/.test(button.textContent)).click()`);
        await until(`document.querySelectorAll('.catalog-results .deck-card').length === 3`);
        await page.evaluate(`document.querySelector('.deck-action-rail button').click()`);
        await until(`Boolean(document.querySelector('.card-ordering'))`);
      }
      await page.callFunction(`function(dark) { document.documentElement.classList.toggle('dark', dark); }`, dark);
      const viewButton = (table: boolean) => `document.querySelectorAll('.card-ordering .control-segmented button')[${table ? 1 : 0}]`;
      for (const table of [true, false]) {
        const rect = await page.evaluate(`(() => { const b = ${viewButton(table)}; b.scrollIntoView({block:'center', behavior:'instant'}); const r = b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
        for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, ...rect, button: 'left', clickCount: 1 });
        await until(`${viewButton(table)}.getAttribute('aria-pressed') === 'true'`);
        await noStrip();
      }
      await page.evaluate(`${viewButton(false)}.focus()`);
      await key('Tab', 'Tab', 9);
      expect(await page.evaluate(`${viewButton(true)} === document.activeElement && ${viewButton(true)}.matches(':focus-visible') && getComputedStyle(${viewButton(true)}).outlineStyle !== 'none'`)).toBe(true);
      for (const table of [true, false]) {
        if (!table) await key('Tab', 'Tab', 9, 8);
        await key(' ', 'Space', 32);
        await until(`${viewButton(table)}.getAttribute('aria-pressed') === 'true'`);
        await noStrip();
      }
      await page.evaluate(`document.querySelector('.catalog-results').focus()`);
      expect(await page.evaluate(`document.querySelector('.catalog-results').matches(':focus-visible')`)).toBe(true);
      for (const table of [true, false]) {
        await key('V', 'KeyV', 86, 8);
        await until(`${viewButton(table)}.getAttribute('aria-pressed') === 'true'`);
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
      const before = await page.evaluate(`document.querySelector('.catalog-workbench').getBoundingClientRect().top`);
      await page.evaluate(`document.querySelector('.deck-tags-panel button.deck-tag-row:not([disabled])').click()`);
      await until(`Boolean(document.querySelector('.card-selection-bar'))`);
      expect(await page.evaluate(`document.querySelector('.catalog-workbench').getBoundingClientRect().top`)).toBe(before);
      expect(await page.evaluate(`document.querySelector('.deck-toolbar-content').inert`)).toBe(true);
      for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'Escape', windowsVirtualKeyCode: 27 });
      await until(`!document.querySelector('.card-selection-bar')`);
      expect(await page.evaluate(`document.querySelector('.catalog-workbench').getBoundingClientRect().top`)).toBe(before);
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
