import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createBrowserSession } from './browser-session.ts';
import { requireBrowser } from './browser-environment.ts';
import { waitForLayout } from './browser-layout.ts';

const browserPath = requireBrowser();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 2026-11-08: test the actual Deck capture listener, native focus and scrolling with CDP keyboard/mouse input.
describe.skipIf(!browserPath)('one-step Hero return (browser)', () => {
  const session = createBrowserSession();
  const { send, evaluate, callFunction } = session;
  const until = (expression: string, attempts = 100) => session.until(`Boolean(${expression})`, attempts);
  let errors: string[] = [];
  const tile = (id: string) => `.catalog-results [data-card-id="card:${id}"] .deck-card-open`;
  const mini = (id: string) => `[data-journey-card-id="card:${id}"]`;
  const row = (id: string) => `.card-family-list [data-card-id="card:${id}"] .card-family-row-open`;
  const selected = (id: string) => `new URLSearchParams(location.search).get('card') === 'card:${id}'`;

  async function click(selector: string) {
    const point = await callFunction(`selector => { const element = document.querySelector(selector); element.scrollIntoView({ block: 'nearest' });
      const box = element.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; }`, selector);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
    await delay(80);
  }
  async function key(key: string, code = key) {
    const codes: Record<string, number> = { Escape: 27, Enter: 13, Tab: 9, ' ': 32 };
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: codes[key],
      text: type === 'keyDown' && key === 'Enter' ? '\r' : undefined });
    await delay(80);
  }
  async function render(options: object = {}) {
    await evaluate(`window.heroReturnTest.render(${JSON.stringify(options)})`);
    await until(`Boolean(document.querySelector(${JSON.stringify(tile('hero'))}))`);
    await delay(80);
  }
  async function openHero(familyVisible = false) {
    await click(tile('hero'));
    await until(`${selected('hero')} && document.querySelector('.card-title-edit:not(:disabled)')`);
    if (familyVisible) await click('.card-preview-action-rail [data-card-family]');
    await evaluate(`document.querySelector('.card-preview-panels').scrollTop = 10000`);
    await delay(100);
    const scroll = await evaluate(`document.querySelector('.card-preview-panels').scrollTop`);
    expect(scroll).toBeGreaterThan(0);
    return scroll as number;
  }
  async function expectHero(scroll: number, focus: string, familyVisible: boolean) {
    await until(`${selected('hero')} && document.activeElement === document.querySelector(${JSON.stringify(focus)})`);
    await waitForLayout(evaluate, '.card-preview-panels');
    expect(await evaluate(`document.querySelector('.card-preview-panels').scrollTop`)).toBeCloseTo(scroll, 0);
    expect(await evaluate(`Boolean(document.querySelector('.card-family-panel'))`)).toBe(familyVisible);
  }
  async function expectClosed(focus = tile('hero')) {
    await until(`!document.querySelector('.card-preview')`);
    expect(await evaluate(`document.activeElement === document.querySelector(${JSON.stringify(focus)})`)).toBe(true);
  }

  beforeAll(async () => {
    await session.open(browserPath!, { viewport: { width: 1700, height: 900, scale: 1 }, extraArgs: ['--disable-features=OverlayScrollbar'] });
    errors = session.errors;
    await session.navigate('hero-return', `Boolean(window.heroReturnTest && document.querySelector(${JSON.stringify(tile('hero'))}))`, 600);
  }, 90000);

  afterAll(async () => {
    await session.close();
  }, 20000);

  beforeEach(async () => {
    await send('Emulation.setDeviceMetricsOverride', { width: 1700, height: 900, deviceScaleFactor: 1, mobile: false });
    await render();
  });

  it.each([false, true])('mini-card → Escape restores scroll/focus and family visibility (%s); second Escape closes', async visible => {
    const scroll = await openHero(visible);
    await click(mini('design'));
    await until(selected('design'));
    expect(await evaluate(`document.querySelector('.card-preview-parent kbd')?.textContent`)).toBe('Esc');
    expect(await evaluate(`document.querySelector('.card-preview-parent').getAttribute('aria-keyshortcuts')`)).toBe('Escape');
    expect(await evaluate(`(() => { const style = getComputedStyle(document.querySelector('.card-preview-parent kbd'));
      return { family: style.fontFamily, weight: style.fontWeight, size: style.fontSize, line: style.lineHeight }; })()`))
      .toEqual({ family: '"Geist Mono", monospace', weight: '600', size: '10px', line: '10px' });
    await key('Escape');
    await expectHero(scroll, mini('design'), visible);
    expect(await evaluate(`document.querySelector(${JSON.stringify(mini('design'))}).tabIndex`)).toBe(0);
    expect(await evaluate(`document.querySelectorAll('.journey-track-open[tabindex="0"]').length`)).toBe(1);
    await key('Escape');
    await expectClosed();
  });

  it('Next and the parent strip share the one-step return', async () => {
    const scroll = await openHero();
    await click('.journey-track-next');
    await until(selected('build'));
    expect(await evaluate(`document.querySelector('.card-preview-parent').title`)).toBe('Back to Hero: Test Hero · Esc');
    await click('.card-preview-parent');
    await expectHero(scroll, mini('build'), false);
    await key('Escape');
    await expectClosed();
  });

  it('returns focus to the Sub Cards row and restores the shown list', async () => {
    const scroll = await openHero(true);
    await click(row('build'));
    await until(selected('build'));
    await click('.card-preview-action-rail button');
    await until(`!document.querySelector('.card-family-panel')`);
    // 2026-11-10: direct card panels consume Escape before navigation; closing Properties must retain the Sub Card.
    await until(`document.querySelector('.card-properties-slot')?.hidden === false`);
    await key('Escape');
    await until(`document.querySelector('.card-properties-slot')?.hidden === true`);
    expect(await evaluate(selected('build'))).toBe(true);
    await key('Escape');
    await expectHero(scroll, row('build'), true);
    await key('Escape');
    await expectClosed();
  });

  it('deck opening has no keycap and Escape closes immediately; its strip still opens the family', async () => {
    await click(tile('build'));
    await until(selected('build'));
    expect(await evaluate(`document.querySelector('.card-preview-parent kbd')`)).toBeNull();
    expect(await evaluate(`document.querySelector('.card-preview-parent').getAttribute('aria-keyshortcuts')`)).toBeNull();
    await key('Escape');
    await expectClosed(tile('build'));
    await click(tile('build'));
    await click('.card-preview-parent');
    await until(`${selected('hero')} && document.querySelector('.card-family-panel')`);
  });

  it('menus and card selection are dismissed before returning', async () => {
    await openHero();
    await click(mini('build'));
    // 2026-11-09: a Journey step opens its Sub Card inside the Sub Cards tab; closing the tab keeps the return target.
    await until(`document.querySelector('[data-card-family]')?.getAttribute('aria-pressed') === 'true'`);
    await click('[data-card-family]');
    await until(`Boolean(document.querySelector('.catalog-results [data-card-id="card:hero"] input[type="checkbox"]'))`);
    await click('.catalog-results [data-card-id="card:hero"] input[type="checkbox"]');
    await until(`Boolean(document.querySelector('.card-selection-toolbar'))`);
    await click('.card-preview-more');
    await until(`Boolean(document.querySelector('[role="menu"]'))`);
    await key('Escape');
    await until(`!document.querySelector('[role="menu"]')`);
    expect(await evaluate(`Boolean(document.querySelector('.card-selection-toolbar')) && ${selected('build')}`)).toBe(true);
    await key('Escape');
    await until(`!document.querySelector('.card-selection-toolbar')`);
    expect(await evaluate(selected('build'))).toBe(true);
    await key('Escape');
    await until(selected('hero'));
  });

  it('editor Escape consumes its own step before Hero return', async () => {
    await openHero();
    await click(mini('build'));
    await until(`Boolean(document.querySelector('.card-title-edit:not(:disabled)'))`);
    await click('.card-title-edit');
    await until(`Boolean(document.querySelector('.card-edit textarea'))`);
    await key('Escape');
    await until(`!document.querySelector('.card-edit textarea')`);
    expect(await evaluate(selected('build'))).toBe(true);
    await key('Escape');
    await until(selected('hero'));
  });

  it('Review Space is safe twice; Escape closes its menu before returning to Hero', async () => {
    await render({ review: true });
    const scroll = await openHero();
    await click(mini('review'));
    await until(selected('review'));
    await evaluate(`document.querySelector('.card-preview-title').focus()`);
    await key(' ', 'Space');
    await until(`document.activeElement === document.querySelector('.card-review-menu')`);
    await key(' ', 'Space');
    expect(await evaluate(`document.activeElement === document.querySelector('.card-review-menu')`)).toBe(true);
    expect(await evaluate('window.heroReturnTest.requests')).toEqual([]);
    await key('Escape');
    await until(`!document.querySelector('.card-review-menu')`);
    expect(await evaluate(selected('review'))).toBe(true);
    expect(await evaluate(`document.activeElement === document.querySelector('.card-state-review')`)).toBe(true);
    await key('Escape');
    await expectHero(scroll, mini('review'), false);
  });

  it.each(['tile', 'link', 'tag', 'family'])('%s navigation to another card clears the return target', async origin => {
    await openHero(origin === 'family');
    await click(mini('build'));
    if (origin === 'tile') {
      await click('[data-card-family]');
      await until(`Boolean(document.querySelector(${JSON.stringify(tile('review'))}))`);
      await click(tile('review'));
    }
    if (origin === 'link') await click('.card-preview-document a');
    if (origin === 'tag') {
      await click('.card-preview-relations > summary');
      await click('.card-preview-meta-row .tag-badge-link');
    }
    if (origin === 'family') await click(row('review'));
    await until(selected('review'));
    expect(await evaluate(`Boolean(document.querySelector('.card-preview-parent kbd'))`)).toBe(false);
    await key('Escape');
    await until(`!document.querySelector('.card-preview')`);
  });

  it('closing and reopening the same Sub Card does not resurrect the target', async () => {
    await openHero();
    await click(mini('build'));
    await click('.card-preview-tools button');
    await click(tile('build'));
    expect(await evaluate(`Boolean(document.querySelector('.card-preview-parent kbd'))`)).toBe(false);
    await key('Escape');
    await expectClosed(tile('build'));
  });

  it('a direct card URL and a Hero content link do not create a return target', async () => {
    await render({ card: 'card:build' });
    await until(selected('build'));
    expect(await evaluate(`Boolean(document.querySelector('.card-preview-parent kbd'))`)).toBe(false);
    await key('Escape');
    await until(`!document.querySelector('.card-preview')`);
    await openHero();
    await click('.card-preview-document a');
    await until(selected('design'));
    expect(await evaluate(`Boolean(document.querySelector('.card-preview-parent kbd'))`)).toBe(false);
  });

  it('search and switching decks clear the target', async () => {
    await openHero();
    await click(mini('build'));
    await click('.deck-toolbar-search input');
    await send('Input.insertText', { text: 'Build' });
    await until(`!document.querySelector('.card-preview-parent kbd')`);
    await evaluate(`document.querySelector('.card-preview-title').focus()`);
    await key('Escape');
    await until(`!document.querySelector('.card-preview')`);
    await render();
    await openHero();
    await click(mini('build'));
    await click('[data-deck-cover="other"]');
    await until(`new URLSearchParams(location.search).get('deck') === 'other' && !document.querySelector('.card-preview')`);
  });

  it('uses the Russian return hint', async () => {
    await render({ lang: 'ru' });
    await openHero();
    await click(mini('build'));
    expect(await evaluate(`document.querySelector('.card-preview-parent').title`)).toBe('Вернуться к Hero: Test Hero · Esc');
  });

  it.each(['hero', 'task', 'doc', 'subcard'].flatMap(kind =>
    [[kind, 1700, 1000, 'en'], [kind, 375, 812, 'ru']] as const))('%s: unlinked tags reveal and focus the tags section at %s×%s (%s)', async (kind, width, height, lang) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    const card = kind === 'subcard' ? 'build' : 'hero';
    await render({ card: 'card:' + card, kind: kind === 'subcard' ? 'hero' : kind, tags: ['unlinked', 'personal'], lang });
    await until(`Boolean(document.querySelector('.card-title-edit:not(:disabled)'))`);
    await click('.card-preview-relations > summary');
    for (const name of ['unlinked', 'personal', 'unlinked']) {
      const tag = `.card-preview-meta-row .tag-badge-link[aria-label="${name}"]`;
      // 2026-11-08: returning from the stacked properties panel must reveal the tag below the sticky toolbar before clicking.
      if (width <= 760) await evaluate(`document.querySelector(${JSON.stringify(tag)}).scrollIntoView({ block: 'center', behavior: 'instant' })`);
      await click(tag);
      // 2026-11-10: the bounded tag strip opens the full section on its first actionable chip, not its container.
      await until(`document.activeElement === document.querySelector('section[data-property="tags"] .card-properties-tag-chip:not(:disabled)')`);
      const section = await evaluate(`(() => {
        const target = document.querySelector('section[data-property="tags"]');
        const heading = target.querySelector('h3');
        const box = heading.getBoundingClientRect();
        return { visible: !target.closest('.card-properties-slot').hidden,
          top: box.top, bottom: box.bottom, toolbarBottom: innerWidth <= 760 ? document.querySelector('.card-preview-action-rail').getBoundingClientRect().bottom : document.querySelector('.deck-open-toolbar').getBoundingClientRect().bottom,
          hit: heading.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) };
      })()`);
      expect(section.visible).toBe(true);
      expect(section.top).toBeGreaterThanOrEqual(section.toolbarBottom + 8);
      expect(section.bottom).toBeLessThan(height);
      expect(section.hit).toBe(true);
      expect(await evaluate(selected(card))).toBe(true);
      // 2026-11-10: the open panel lies over the card and the card is inert; Escape closes it before the next tag.
      await key('Escape');
      await until(`document.querySelector('.card-properties-slot')?.hidden === true`);
    }
  });

  it.each(['hero', 'task', 'doc', 'subcard'])('%s copies ID and URL independently from its menu', async kind => {
    const card = kind === 'subcard' ? 'build' : 'hero';
    await render({ card: 'card:' + card, kind: kind === 'subcard' ? 'hero' : kind, tags: [] });
    await until(`Boolean(document.querySelector('.card-title-edit:not(:disabled)'))`);
    expect(await evaluate(`document.querySelector('.card-id-chip')`)).toBe(null);
    await evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copiedCardId = text; } } })`);
    await click('.card-preview-more');
    const id = await evaluate(`document.querySelector('.card-more-menu [role="menuitem"]:nth-child(2)').textContent.replace('Copy ID ', '')`);
    await click('.card-more-menu [role="menuitem"]:nth-child(2)');
    await until(`document.querySelector('.card-preview-state-notice')?.textContent === 'Copied'`);
    expect(await evaluate(`window.copiedCardId`)).toBe(id);
    await click('.card-preview-more');
    await click('.card-more-menu [role="menuitem"]:nth-child(3)');
    expect(await evaluate(`window.copiedCardId`)).toBe(await evaluate(`location.origin + '/r/${id}?source=sandbox'`));
  });

  // 2026-11-10: every section of the open card (Properties … History, and Sub Cards) opens as one
  // full-height column right against the card's rail, over the deck's cards, which are dimmed and inert; a press on them
  // closes the column and the card stays open and live.
  it('lays every card section over the dimmed, inert deck cards in one column that a press on them closes', async () => {
    await send('Emulation.setDeviceMetricsOverride', { width: 1700, height: 1000, deviceScaleFactor: 1, mobile: false });
    await render();
    await openHero();
    const state = () => evaluate(`(() => {
      const results = document.querySelector('.catalog-results');
      const layer = document.querySelector('.card-properties-slot:not([hidden]), .catalog-family-layer > .card-family-panel');
      const rail = document.querySelector('.card-preview-action-rail').getBoundingClientRect();
      return { offset: layer ? Math.round(layer.getBoundingClientRect().left - rail.right) : null,
        top: layer ? Math.round(layer.getBoundingClientRect().top - document.querySelector('.card-preview-layout').getBoundingClientRect().top) : null,
        dimmed: getComputedStyle(results, '::after').content !== 'none',
        inert: Boolean(results.inert || document.querySelector('.catalog-results-body')?.inert),
        cardLive: !document.querySelector('.card-preview-sheet').inert };
    })()`);
    // The column appears without motion; this also waits out any running animation before measuring.
    const settled = (selector: string) => until(`(() => { const layer = document.querySelector(${JSON.stringify(selector)});
      return Boolean(layer) && layer.getAnimations().every(animation => animation.playState === 'finished'); })()`);
    const pressDeck = async () => {
      const point = await evaluate(`(() => { const box = document.querySelector('.catalog-results').getBoundingClientRect(); return { x: box.right - 24, y: box.top + 120 }; })()`) as { x: number; y: number };
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
      await delay(120);
    };
    const properties = '.card-preview-action-rail button[aria-controls$="-properties"]';
    await click(properties);
    await until(`document.querySelector('.card-properties-slot')?.hidden === false`);
    await settled('.card-properties-slot:not([hidden])');
    // 2026-11-10: the regression is panel/rail alignment; its gap belongs to the shared visual system.
    const railGap = await evaluate(`parseFloat(getComputedStyle(document.querySelector('.card-preview')).getPropertyValue('--preview-rail-gap'))`);
    expect(await state()).toEqual({ offset: railGap, top: -8, dimmed: true, inert: true, cardLive: true });
    await pressDeck();
    await until(`document.querySelector('.card-properties-slot')?.hidden === true`);
    expect(await evaluate(selected('hero'))).toBe(true);
    expect(await evaluate(`document.activeElement === document.querySelector('${properties}')`)).toBe(true);
    expect(await state()).toEqual({ offset: null, top: null, dimmed: false, inert: false, cardLive: true });
    // Sub Cards opens in the same column.
    await click('.card-preview-action-rail [data-card-family]');
    await until(`Boolean(document.querySelector('.catalog-family-layer > .card-family-panel'))`);
    await settled('.catalog-family-layer > .card-family-panel');
    expect(await state()).toEqual({ offset: railGap, top: -8, dimmed: true, inert: true, cardLive: true });
    await pressDeck();
    await until(`!document.querySelector('.card-family-panel')`);
    expect(await evaluate(selected('hero'))).toBe(true);
  });

  // 2026-11-10: the running Journey is pinned in the dock above the band, over the row with the reading footer.
  it('pins a running Journey in the dock above the reading footer and opens it from the title menu', async () => {
    await openHero();
    expect(await evaluate(`Boolean(document.querySelector('.card-content-reading .card-preview-journey-progress'))`)).toBe(false);
    expect(await evaluate(`Boolean(document.querySelector('.card-preview-dock-journey > .card-preview-journey-progress'))`)).toBe(true);
    expect(await evaluate(`document.querySelector('.card-preview-dock-journey').nextElementSibling.matches('.card-preview-dock-row')`)).toBe(true);
    expect(await evaluate(`Boolean(document.querySelector('.card-content-reading-footer .card-preview-journey-action'))`)).toBe(false);
    await click('.journey-track-title-button');
    await until(`Boolean(document.querySelector('.journey-track-menu-open'))`);
    await click('.journey-track-menu-open');
    await until(`Boolean(document.querySelector('.card-journey-dialog'))`);
    await key('Escape');
  });

  it('keeps Journey creation in the menu for a Hero without a run', async () => {
    await render({ card: 'card:hero', withoutJourney: true });
    await until(`Boolean(document.querySelector('.card-title-edit:not(:disabled)'))`);
    expect(await evaluate(`Boolean(document.querySelector('.card-preview-journey-progress'))`)).toBe(false);
    await click('.card-preview-more');
    await click('.card-more-menu [role="menuitem"]:has(.lucide-route)');
    await until(`Boolean(document.querySelector('.card-journey-dialog'))`);
    await key('Escape');
    await until(`!document.querySelector('.card-journey-dialog') && document.body.style.pointerEvents !== 'none'`);
    expect(await evaluate(`document.activeElement === document.querySelector('.card-preview-more')`)).toBe(true);
    await click('.card-preview-action-rail button');
    await until(`document.querySelector('.card-properties-slot')?.hidden === false`);
    await key('Escape');
  });

  it.each(['properties', 'attachments'])('reveals the %s heading inside the phone focus shell', async panel => {
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
    await render({ card: 'card:build', longContent: true, lang: 'ru' });
    await until(`Boolean(document.querySelector('.card-title-edit:not(:disabled)'))`);
    const selector = `.card-preview-action-rail button[aria-controls$="-${panel}"]`;
    await click(selector);
    await until(`Boolean(document.querySelector('.card-properties-slot:not([hidden])'))`);
    await until(`document.activeElement === document.querySelector('.card-properties-slot:not([hidden])')`);
    await waitForLayout(evaluate, '.card-properties-slot, .card-preview-panels');
    const geometry = await evaluate(`(() => {
      const slot = document.querySelector('.card-properties-slot:not([hidden])');
      const heading = slot.querySelector('h2, h3');
      const box = heading.getBoundingClientRect();
      const toolbar = document.querySelector('.card-preview-action-rail').getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, toolbarBottom: toolbar.bottom, height: innerHeight,
        focused: document.activeElement === slot, hit: heading.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) };
    })()`);
    expect(geometry.top).toBeGreaterThanOrEqual(geometry.toolbarBottom + 8);
    expect(geometry.bottom).toBeLessThan(geometry.height);
    expect(geometry.focused).toBe(true);
    expect(geometry.hit).toBe(true);
    expect(await evaluate(`document.querySelector('.card-preview-sheet').inert`)).toBe(true);
  });

  it('keeps a new phone card draft through Properties with Save in the viewport', async () => {
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 900, deviceScaleFactor: 1, mobile: false });
    await render({ lang: 'ru' });
    await click('.deck-action-rail button:has(.lucide-plus)');
    await until(`Boolean(document.querySelector('.card-composer .card-edit-text'))`);
    await send('Input.insertText', { text: 'Новая карточка\n\n' + 'Описание следующего шага.\n'.repeat(50) });
    await waitForLayout(evaluate, '.card-edit-text');
    const draft = await evaluate(`document.querySelector('.card-edit-text').value`);
    const geometry = await evaluate(`(() => {
      const editor = document.querySelector('.card-edit-text').getBoundingClientRect();
      const save = document.querySelector('.card-edit-save'), box = save.getBoundingClientRect();
      return { top: editor.top, height: editor.height, width: editor.width, saveBottom: box.bottom, saveRight: box.right,
        hit: save.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)), overflow: document.documentElement.scrollWidth > innerWidth };
    })()`);
    expect(geometry.top).toBeLessThanOrEqual(300);
    expect(geometry.height).toBeGreaterThanOrEqual(360);
    expect(geometry.width).toBeGreaterThanOrEqual(300);
    expect(geometry.saveBottom).toBeLessThanOrEqual(900);
    expect(geometry.saveRight).toBeLessThanOrEqual(375);
    expect(geometry.hit).toBe(true);
    expect(geometry.overflow).toBe(false);
    await click('.card-composer .card-preview-action-rail button');
    await until(`document.querySelector('.card-composer-settings')?.hidden === false`);
    await click('.card-composer .card-preview-action-rail button');
    await until(`document.querySelector('.card-composer-content')?.hidden === false`);
    expect(await evaluate(`document.querySelector('.card-edit-text').value`)).toBe(draft);
  });

  // 2026-11-10: the pinned state icons and saved/draft row need room above the editor's minimum in this resize exercise.
  it.each([[1024, 1000, 'en'], [1280, 1000, 'ru']] as const)('refits editor actions after a late panels resize at %s×%s (%s)', async (width, height, lang) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await render({ card: 'card:build', longContent: true, width: 420, lang });
    await until(`Boolean(document.querySelector('.card-title-edit:not(:disabled)'))`);
    await click('.card-title-edit');
    await until(`Boolean(document.querySelector('.card-edit-text'))`);
    await waitForLayout(evaluate, '.card-edit-text, .card-preview-panels');
    const original = await evaluate(`document.querySelector('.card-edit-text').clientHeight`);
    const originalPanels = await evaluate(`document.querySelector('.card-preview-panels').clientHeight`);
    expect(original).toBeGreaterThan(204);
    // 2026-11-08: resize only the scroll area, after the draft's initial layout; no window resize or input event.
    await evaluate(`(() => { const panels = document.querySelector('.card-preview-panels'); panels.style.flex = 'none'; panels.style.height = '${originalPanels - 60}px'; })()`);
    await until(`document.querySelector('.card-edit-text').clientHeight < ${original - 40}`);
    const geometry = await evaluate(`(() => {
      const panels = document.querySelector('.card-preview-panels');
      const bounds = document.querySelector('.card-preview-dock').getBoundingClientRect();
      return { excess: panels.scrollHeight - panels.clientHeight, buttons: [...document.querySelectorAll('.card-edit-footer button')].map(button => {
        const box = button.getBoundingClientRect();
        return { inside: box.top >= bounds.top && box.bottom <= bounds.bottom + 1,
          hit: button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) };
      }) };
    })()`);
    expect(geometry.excess).toBeLessThanOrEqual(1);
    expect(geometry.buttons).toHaveLength(3);
    expect(geometry.buttons.every((button: { inside: boolean; hit: boolean }) => button.inside && button.hit)).toBe(true);
    await evaluate(`document.querySelector('.card-preview-panels').style.height = '${originalPanels}px'`);
    await until(`document.querySelector('.card-edit-text').clientHeight >= ${original - 1}`);
  });

  it.each([[1024, 768, 'en'], [1280, 800, 'ru']] as const)('keeps editor actions reachable below the preferred text minimum at %s×%s (%s)', async (width, height, lang) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await render({ card: 'card:build', longContent: true, width: 420, lang });
    await until(`Boolean(document.querySelector('.card-title-edit:not(:disabled)'))`);
    await click('.card-title-edit');
    await until(`Boolean(document.querySelector('.card-edit-text'))`);
    await waitForLayout(evaluate, '.card-edit-text, .card-preview-panels');
    // 2026-11-11: constrain the scrollport directly; the actions belong to the pinned dock outside it.
    await evaluate(`(() => { const panels = document.querySelector('.card-preview-panels'); panels.style.flex = 'none'; panels.style.height = '210px'; })()`);
    await waitForLayout(evaluate, '.card-edit-text, .card-preview-panels');
    const geometry = await evaluate(`(() => {
      const panels = document.querySelector('.card-preview-panels'), bounds = document.querySelector('.card-preview-dock').getBoundingClientRect();
      return { excess: panels.scrollHeight - panels.clientHeight, text: document.querySelector('.card-edit-text').clientHeight,
        buttons: [...document.querySelectorAll('.card-edit-footer button')].map(button => {
          const box = button.getBoundingClientRect();
          return box.top >= bounds.top && box.bottom <= bounds.bottom + 1
            && button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
        }) };
    })()`);
    expect(geometry.excess).toBeLessThanOrEqual(1);
    expect(geometry.text).toBeGreaterThan(0);
    expect(geometry.text).toBeLessThan(144);
    expect(geometry.buttons).toEqual([true, true, true]);
  });

  it('a missing Hero invalidates the return instead of opening a stale card', async () => {
    await openHero();
    await click(mini('build'));
    await evaluate('window.heroReturnTest.removeHero()');
    await until(`!document.querySelector('.card-preview-parent')`);
    await key('Escape');
    await until(`!document.querySelector('.card-preview')`);
    expect(errors).toEqual([]);
  });
});
