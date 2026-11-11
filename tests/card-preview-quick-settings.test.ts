import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createBrowserSession } from './browser-session.ts';
import { requireBrowser } from './browser-environment.ts';
import { shortReference } from '../src/references.ts';

const browserPath = requireBrowser();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
type PlateControlFrame = { tab: string; opacity: number; connected: boolean; rect: number[]; initialRect: number[] };
type PlateMeasurement = { frames: { at: number; controls: PlateControlFrame[] }[]; label: string; actionCount: number };

// 2026-11-08: no DOM shim can verify Radix's real Escape/focus behavior; use the installed headless browser over CDP.
describe.skipIf(!browserPath)('CardPreview Quick Settings (browser)', () => {
  const session = createBrowserSession();
  const { send, evaluate, callFunction: call, until } = session;
  let errors: string[] = [];
  async function click(selector: string) {
    await call('function(selector) { document.querySelector(selector).click(); }', selector);
    await delay(60);
  }
  async function key(key: string, code = key) {
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: ({ Escape: 27, ArrowLeft: 37, ArrowRight: 39 } as Record<string, number>)[key] });
    await delay(80);
  }
  async function render(kind = 'task', options: object = {}) {
    await call('function(kind, options) { window.previewTest.render(kind, options); }', kind, options);
    await until(() => call(`function(kind) { return document.querySelector('.card-preview-' + kind)
      && document.querySelector('[data-panel="content"]')?.textContent.includes('Card text remains visible.'); }`, kind));
  }
  const button = (tab: string) => `.card-preview [data-quick-settings-tab="${tab}"]`;
  async function expectPopup(tab: string, anchor: string) {
    await until(() => call(`function(tab) { return document.querySelector('.card-quick-settings')?.dataset.tab === tab; }`, tab));
    expect(await evaluate(`document.querySelectorAll('.card-quick-settings').length`)).toBe(1);
    expect(await call(`function(anchor) { return document.querySelector(anchor).getAttribute('aria-expanded'); }`, anchor)).toBe('true');
    expect(await evaluate(`document.querySelector('.card-preview-action-rail button').getAttribute('aria-pressed')`)).toBe('false');
    expect(await evaluate(`document.querySelector('.card-properties-slot').hidden`)).toBe(true);
    expect(await evaluate(`document.querySelector('[data-panel="content"]').getBoundingClientRect().height > 0`)).toBe(true);
    expect(await call(`function(anchor) {
      const button = document.querySelector(anchor).getBoundingClientRect();
      const popup = document.querySelector('.deck-picker-popover').getBoundingClientRect();
      return Math.abs(popup.left - button.left) <= 32 && (Math.abs(popup.bottom - button.top) <= 9 || Math.abs(popup.top - button.bottom) <= 9);
    }`, anchor)).toBe(true);
  }
  async function expectClosed(anchor: string) {
    await until(() => call(`function(anchor) { return !document.querySelector('.card-quick-settings')
      && document.activeElement === document.querySelector(anchor); }`, anchor));
    expect(await call(`function(anchor) { return document.querySelector(anchor).getAttribute('aria-expanded'); }`, anchor)).toBe('false');
  }

  beforeAll(async () => {
    await session.open(browserPath!, { viewport: { width: 1280, height: 1000, scale: 1 } });
    errors = session.errors;
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    // 2026-11-09: Windows CI can inherit disabled OS animations. Both the tile and flat bands ignore pointers in reduce.
    await setMotionPreference('no-preference');
    await session.navigate('card-preview-quick-settings', `Boolean(window.previewTest && document.querySelector('[data-panel="content"]'))`, 600);
    await send('Page.bringToFront');
    await evaluate(`document.addEventListener('pointermove', event => {
      window.previewPointerSample = { target: event.target, trusted: event.isTrusted, pointerType: event.pointerType,
        x: event.clientX, y: event.clientY };
    }, true)`);
    expect(await evaluate(`matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)').matches`),
      'The browser fixture requires a fine hovering pointer with motion enabled').toBe(true);
  }, 90000);

  afterAll(async () => {
    await session.close();
  }, 20000);

  it.each([1440, 375])('keeps long tile estimates clear of the owner and priority at %s px in both themes', async width => {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    try {
      for (const dark of [true, false]) {
        await call('function(dark) { document.documentElement.classList.toggle("dark", dark); }', dark);
        for (const kind of ['task', 'hero']) for (const effort of [12, 123]) {
          const card = { owner: 'Sam', effort: kind === 'hero' ? effort - 2 : effort, priority: 'high' };
          const children = kind === 'hero' ? [{ effort: 2, state: 'done' }] : [];
          await call('function(kind, options) { window.previewTest.render(kind, options); }', kind, { card, children, familyOnly: true, lang: 'ru' });
          await until(`Boolean(document.querySelector('.deck-card-metrics strong'))`);
          const metrics = await evaluate(`(async () => {
            await document.fonts.ready;
            const box = selector => document.querySelector(selector).getBoundingClientRect();
            const number = box('.deck-card-metrics strong'), owner = box('.deck-card-owner-medallion');
            const priority = box('.deck-card-metrics .priority-icon'), row = box('.deck-card-metrics');
            const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
            const value = document.querySelector('.deck-card-metrics strong');
            return { text: value.textContent, size: getComputedStyle(value).fontSize,
              clearOwner: !intersects(number, owner), clearPriority: !intersects(number, priority),
              fits: value.scrollWidth <= value.clientWidth && number.right <= row.right,
              mark: Boolean(document.querySelector('.deck-card-metrics .effort-icon')),
              priorityWidth: priority.width, crown: Boolean(document.querySelector('.deck-card-band .lucide-crown')) };
          })()`);
          expect(metrics).toMatchObject({ text: String(effort), size: '13px', clearOwner: true, clearPriority: true, fits: true,
            mark: true, priorityWidth: 12, crown: false });
        }
      }
    } finally { await send('Emulation.clearDeviceMetricsOverride'); }
  });

  async function openActions() {
    await evaluate(`document.querySelector('.card-preview-more').focus()`);
    await key('Enter');
    await until(`Boolean(document.querySelector('.card-more-menu'))`);
  }
  const handAction = '.card-preview-hand';
  async function toggleHand(modifier: 'ctrlKey' | 'metaKey' = 'ctrlKey') {
    await call(`function(selector, modifier) { document.querySelector(selector).dispatchEvent(new MouseEvent('click', { bubbles: true, [modifier]: true })); }`, handAction, modifier);
    await delay(60);
  }

  it('adds and removes only the acting member’s Hand with guarded hashes, preserving Owner and other Hands', async () => {
    await render('task', { card: { owner: 'Sam', handMemberIds: ['sam'], handOrder: { sam: 3 } }, holdSave: true });
    expect(await evaluate(`Boolean(document.querySelector('.card-preview-hand.is-on'))`)).toBe(true);
    await toggleHand();
    expect(await evaluate('window.previewTest.actions')).toEqual([{ action: 'bulk-edit-cards', manifestHash: 'manifest-hash', optionsHash: 'options-hash',
      cards: [{ cardId: 'card:preview', sourceHash: 'card-hash' }], change: { kind: 'hand', memberId: 'alex', mode: 'add' } }]);
    expect(await evaluate(`document.querySelector('.card-preview-more').disabled`)).toBe(true);
    await toggleHand();
    await key('h', 'KeyH');
    expect(await evaluate('window.previewTest.actions.length')).toBe(1);
    await evaluate('window.previewTest.finishSave()');
    await until(`!document.querySelector('.card-preview-more').disabled`);
    expect(await evaluate('window.previewTest.card()')).toMatchObject({ owner: 'Sam', handMemberIds: ['sam', 'alex'], handOrder: { sam: 3 } });
    await toggleHand('metaKey');
    await evaluate('window.previewTest.finishSave()');
    await until(`!document.querySelector('.card-preview-more').disabled`);
    expect(await evaluate('window.previewTest.card()')).toMatchObject({ owner: 'Sam', handMemberIds: ['sam'], handOrder: { sam: 3 } });
    expect(await evaluate('window.previewTest.actions[1]')).toMatchObject({ cards: [{ cardId: 'card:preview', sourceHash: 'card-hash-saved' }], change: { kind: 'hand', memberId: 'alex', mode: 'remove' } });
  });

  it.each(['conflict', 'network', 'saved-warning'])('Hand label follows the confirmed catalog after %s, not the save boolean', async saveFailure => {
    await render('task', { saveFailure, card: { owner: 'Sam', handMemberIds: ['sam'] } });
    await toggleHand();
    await until(`!document.querySelector('.card-preview-more').disabled`);
    expect(await evaluate('window.previewTest.card().handMemberIds')).toEqual(['sam']);
    expect(await evaluate('window.previewTest.card().owner')).toBe('Sam');
    if (saveFailure !== 'saved-warning') expect(await evaluate(`document.querySelector('.card-preview-state-notice')?.textContent`)).toMatch(/not confirmed|Could not save/);
    else expect(await evaluate(`document.querySelector('.card-preview-state-notice')?.textContent ?? ''`)).toBe('');
    await toggleHand();
    expect(await evaluate('window.previewTest.actions.at(-1).change.mode')).toBe('add');
  });

  it.each(['readonly', 'pending', 'no-member'])('disables the Hand action for %s', async reason => {
    await render('task', { writable: reason !== 'readonly', noMembers: reason === 'no-member' });
    if (reason === 'pending') await evaluate('window.previewTest.setPending(true)');
    await until(`document.querySelector('${handAction}').getAttribute('aria-disabled') === 'true'`);
    await toggleHand();
    await key('h', 'KeyH');
    expect(await evaluate('window.previewTest.actions')).toEqual([]);
  });

  it('uses the latest acting member and revision from the header instead of a menu snapshot', async () => {
    await render();
    await evaluate(`window.previewTest.refresh(); window.previewTest.rememberMember('sam')`);
    await toggleHand();
    expect(await evaluate('window.previewTest.actions[0]')).toMatchObject({ cards: [{ sourceHash: 'card-hash-refreshed' }], change: { kind: 'hand', memberId: 'sam', mode: 'add' } });
  });

  it.each([1440, 375])('restores the Hero header, three band zones and dock actions at %s px', async width => {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    try {
      await render('hero', { card: { deckId: 'assets' }, children: [{ effort: 2, state: 'done' }, { effort: 4, state: 'started' }] });
      const geometry = await evaluate(`(() => {
        const box = selector => document.querySelector(selector)?.getBoundingClientRect();
        const band = box('.card-preview-material-band'), owner = box('.card-preview-owner-shortcut');
        const effort = box('.card-preview-material-band [data-quick-settings-tab="effort"]'), priority = box('.card-preview-material-band [data-quick-settings-tab="priority"]');
        const chip = box('.card-preview-subcards-toggle'), tools = box('.card-preview-subcards-bar .card-preview-subcards-actions');
        return { chip: document.querySelector('.card-preview-subcards-toggle')?.textContent,
          headerAligned: Boolean(chip && tools && Math.abs(chip.top - tools.top) < 5),
          bandHeight: band.height, ownerSize: owner.width, centered: Math.abs(owner.x + owner.width / 2 - band.x - band.width / 2) < 1,
          protrudes: Math.abs(owner.top + owner.height / 2 - band.top) < 1,
          zones: effort.right < owner.left && priority.left > owner.right,
          actions: Boolean(document.querySelector('.card-preview-dock .card-preview-journey') && document.querySelector('.card-preview-dock .card-content-edit-action')),
          id: document.querySelector('.card-preview-dock .card-id-chip')?.textContent,
          progress: [...document.querySelectorAll('.card-preview-material-band .sub-card-progress-segment')].map(step => step.dataset.state),
          overflow: document.documentElement.scrollWidth > innerWidth };
      })()`);
      expect(geometry).toMatchObject({ chip: '2 Sub Cards', headerAligned: true, centered: true, protrudes: true, zones: true, actions: true, id: shortReference('c', 'card:preview'), progress: ['accepted', 'working'], overflow: false });
      expect(geometry.bandHeight).toBeGreaterThanOrEqual(58);
      expect(geometry.ownerSize).toBeGreaterThanOrEqual(52);
      await click('.card-preview-subcards-toggle');
      expect(await evaluate(`document.querySelector('.card-preview-subcards-toggle').getAttribute('aria-pressed')`)).toBe('true');
      await click('.card-preview-subcards-toggle');
      await evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.copiedReference = value; } } })`);
      await click('.card-id-chip');
      expect(await evaluate('window.copiedReference')).toBe(shortReference('c', 'card:preview'));
      await click('.card-preview-journey');
      await until(`Boolean(document.querySelector('.card-journey-dialog'))`);
      await key('Escape');
      await until(`!document.querySelector('.card-journey-dialog')`);
      await openActions();
      expect(await evaluate(`Boolean(document.querySelector('.card-more-menu .lucide-hand, .card-more-menu .lucide-route'))`)).toBe(false);
      await key('Escape');
    } finally { await send('Emulation.clearDeviceMetricsOverride'); }
  });

  it.each(['task', 'doc'])('keeps %s free of Hero progress and the Sub Cards chip', async kind => {
    await render(kind);
    expect(await evaluate(`Boolean(document.querySelector('.card-preview-subcards-toggle, .card-preview-material-band .sub-card-progress'))`)).toBe(false);
    if (kind === 'doc') expect(await evaluate(`document.querySelector('.card-preview-word-count')?.textContent`)).toMatch(/\d+ words/);
    await render('task', { child: true });
    expect(await evaluate(`Boolean(document.querySelector('.card-preview-subcards-toggle'))`)).toBe(false);
  });

  it('shows every Hand holder and actual queue positions on hover and keyboard focus', async () => {
    await render('task', { card: { handMemberIds: ['sam', 'alex'], handOrder: { sam: 800, alex: 20 } }, extraCards: [
      { handMemberIds: ['sam'], handOrder: { sam: 100 } }, { handMemberIds: ['sam'], handOrder: { sam: 500 } },
    ] });
    await moveOver(handAction, .5);
    await until(`Boolean(document.querySelector('.card-hand-tooltip'))`);
    const holders = () => evaluate(`[...document.querySelectorAll('.card-hand-tooltip > ul > li')].map(row => [...row.children].filter(node => !node.classList.contains('card-owner-avatar')).map(node => node.textContent).join(''))`);
    expect(await holders()).toEqual(['Sam#3', 'Alex#1']);
    expect(await evaluate(`document.querySelectorAll('.card-hand-tooltip > ul .card-owner-avatar').length`)).toBe(2);
    expect(await evaluate(`document.querySelector('.card-hand-tooltip').textContent`)).toContain('Ctrl+click — remove from my Hand');
    expect(await evaluate(`document.querySelector('.card-hand-tooltip > header kbd').textContent`)).toBe('H');
    expect(await evaluate(`document.querySelector('.card-hand-tooltip > header .hand-icon > path:last-child').getAttribute('fill')`)).toBe('currentColor');
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    await key('Tab');
    await evaluate(`document.querySelector('.card-preview-hand').focus()`);
    await until(`Boolean(document.querySelector('[role="tooltip"]'))`);
    expect(await holders()).toEqual(['Sam#3', 'Alex#1']);
  });

  it.each(['dark', 'light'])('keeps the Hand icon, external slots and ownership legible in %s', async theme => {
    await call(`theme => document.documentElement.classList.toggle('dark', theme === 'dark')`, theme);
    const colors = theme === 'dark'
      ? { mine: 'rgb(116, 220, 200)', foreign: 'rgb(205, 200, 220)' }
      : { mine: 'rgb(12, 85, 71)', foreign: 'rgb(81, 74, 102)' };
    try {
      for (const mine of [false, true]) {
        const member = mine ? 'alex' : 'sam';
        await render('task', { card: { handMemberIds: [member], handOrder: { [member]: 100 } } });
        const icon = await evaluate(`(() => {
          const button = document.querySelector('.card-preview-hand');
          const svg = button.querySelector('.hand-icon');
          return { label: button.getAttribute('aria-label'), hidden: svg.getAttribute('aria-hidden'),
            fill: svg.querySelector(':scope > path:last-child').getAttribute('fill'), color: getComputedStyle(svg).color,
            width: svg.getBoundingClientRect().width, handFill: getComputedStyle(svg.querySelector(':scope > path')).fill };
        })()`);
        expect(icon).toMatchObject({ label: `Open Hand: ${mine ? 'Alex' : 'Sam'}`, hidden: 'true',
          fill: mine ? 'currentColor' : 'none', handFill: 'none', width: 16 });
        expect(icon.color).toBe(mine ? colors.mine : colors.foreign);
        const tile = await evaluate(`(() => {
          const indicator = document.querySelector('.deck-card .card-hand-indicator');
          const number = indicator.querySelector('.card-hand-number');
          const style = getComputedStyle(number);
          return { size: indicator.querySelector('svg').getBoundingClientRect().width,
            font: style.fontFamily, fontSize: style.fontSize, weight: style.fontWeight };
        })()`);
        expect(tile).toMatchObject({ size: 16, fontSize: '11px', weight: '600' });
        expect(tile.font).toContain('Geist Mono');
      }
    } finally { await evaluate(`document.documentElement.classList.add('dark')`); }
  });

  it.each([
    { holders: ['sam'], member: 'sam', queued: false },
    { holders: ['sam', 'alex'], member: 'alex', queued: true },
  ])('opens $member’s real Hand, highlights the card and returns through history (queued: $queued)', async ({ holders, member, queued }) => {
    await render('task', { card: { handMemberIds: holders, handOrder: { sam: 100, alex: 100 } },
      extraCards: Array.from({ length: queued ? 8 : 0 }, (_, index) => ({ handMemberIds: [member], handOrder: { [member]: index } })) });
    const before = await evaluate('location.href');
    await evaluate(`localStorage.setItem('deckmate-hand-all', 'true')`);
    await click(handAction);
    await until(`Boolean(document.querySelector('.hand-view [data-card-revealed="true"]'))`);
    expect(await evaluate(`document.querySelector('.hand-member-picker select').value`)).toBe(member);
    expect(await evaluate(`document.activeElement.closest('[data-hand-card]')?.dataset.handCard`)).toBe('card:preview');
    expect(await evaluate(`document.activeElement.classList.contains('hand-queue-open')`)).toBe(queued);
    expect(await evaluate('window.previewTest.actions')).toEqual([]);
    await evaluate('history.back()');
    await until(`Boolean(document.querySelector('.card-preview'))`);
    expect(await evaluate('location.href')).toBe(before);
    expect(await evaluate('window.previewTest.card().handMemberIds')).toEqual(holders);
  });

  it('gives hovered tiles and bulk selection precedence over open-card H, and ignores repeat or dialogs', async () => {
    await render();
    await moveOver('.deck-card-space', .5);
    await key('h', 'KeyH');
    expect(await evaluate('window.previewTest.actions')).toEqual([]);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    await evaluate(`document.body.append(Object.assign(document.createElement('div'), { className: 'card-selection-toolbar', textContent: 'Selected' }))`);
    try { await key('h', 'KeyH'); expect(await evaluate('window.previewTest.actions')).toEqual([]); }
    finally { await evaluate(`document.querySelector('.card-selection-toolbar').remove()`); }
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', code: 'KeyH', repeat: true }))`);
    await openActions();
    await key('h', 'KeyH');
    expect(await evaluate('window.previewTest.actions')).toEqual([]);
    await key('Escape');
    await evaluate(`document.querySelector('.card-preview-title').focus()`);
    await key('h', 'KeyH');
    expect(await evaluate('window.previewTest.actions.length')).toBe(1);
  });

  it('keeps the Russian Hero chip and all Task header actions on one touch row at 375 px', async () => {
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true });
    try {
      for (const kind of ['hero', 'task']) {
        await render(kind, { lang: 'ru', card: { deckId: 'assets' } });
        const layout = await evaluate(`(() => {
          const row = document.querySelector('.card-preview-sheet > .card-preview-subcards-bar, .card-preview-sheet > .card-preview-state-actions');
          const boxes = [...row.querySelectorAll('button')].filter(button => button.getClientRects().length).map(button => button.getBoundingClientRect());
          return { aligned: boxes.every(box => Math.abs(box.top - boxes[0].top) < 5), fits: boxes.every(box => box.left >= 0 && box.right <= innerWidth),
            targets: boxes.every(box => box.width >= 44 && box.height >= 44) };
        })()`);
        expect(layout).toEqual({ aligned: true, fits: true, targets: true });
      }
    } finally {
      await send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await send('Emulation.clearDeviceMetricsOverride');
    }
  });

  it.each([1440, 375])('H and a click add an unheld card, but H never edits text at %s px', async width => {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    try {
      await render();
      await evaluate(`document.querySelector('.card-preview-hand').focus()`);
      await until(`Boolean(document.querySelector('.card-hand-tooltip'))`);
      expect(await evaluate(`document.querySelector('.card-hand-tooltip').textContent`)).toContain('Not in Hand');
      await click(handAction);
      expect(await evaluate('window.previewTest.actions[0].change')).toEqual({ kind: 'hand', memberId: 'alex', mode: 'add' });
      await evaluate(`document.querySelector('.card-preview-title').focus()`);
      await key('р', 'KeyH');
      expect(await evaluate('window.previewTest.actions[1].change')).toEqual({ kind: 'hand', memberId: 'alex', mode: 'remove' });
      await click('.card-content-edit-action');
      await key('h', 'KeyH');
      expect(await evaluate('window.previewTest.actions.length')).toBe(2);
      await key('Escape');
    } finally { await send('Emulation.clearDeviceMetricsOverride'); }
  });

  it('keeps accepted Hero gold and its rainbow border around a matte reading face', async () => {
    await render('hero', { children: [{ state: 'done' }] });
    expect(await evaluate(`getComputedStyle(document.querySelector('.card-preview-material-band')).getPropertyValue('--card-metal').trim() === getComputedStyle(document.documentElement).getPropertyValue('--hero-metal').trim()`)).toBe(true);
    const finish = () => evaluate(`(() => { const sheet = document.querySelector('.card-preview-sheet'); return {
      layers: ['::before', '::after'].map(pseudo => getComputedStyle(sheet, pseudo).content),
      background: getComputedStyle(sheet).backgroundImage, border: getComputedStyle(sheet).borderTopWidth,
      x: sheet.style.getPropertyValue('--glare-x') }; })()`);
    expect(await finish()).toMatchObject({ layers: ['none', 'none'], border: '2px' });
    expect((await finish()).background).toContain('conic-gradient');
    await moveOver('.card-preview-sheet', .2);
    await delay(350);
    const left = await finish();
    await moveOver('.card-preview-sheet', .8);
    await delay(350);
    expect((await finish()).x).not.toBe(left.x);
    await setMotionPreference('reduce');
    try {
      await moveOver('.card-preview-sheet', .4);
      await delay(100);
      const reduced = await finish();
      await moveOver('.card-preview-sheet', .9);
      await delay(100);
      expect((await finish()).x).toBe(reduced.x);
      expect(await evaluate(`getComputedStyle(document.querySelector('.card-preview-sheet'), '::after').animationName`)).toBe('none');
    } finally { await setMotionPreference('no-preference'); }
  });

  it('shows every Hand participant with its actual queue slot and the card version in readable properties', async () => {
    await render('task', { writable: false, card: { version: 'v2.3', handMemberIds: ['alex', 'sam', 'missing-member'], handOrder: { alex: 20, sam: 800 } },
      extraCards: [{ handMemberIds: ['sam'], handOrder: { sam: 100 } }, { handMemberIds: ['sam'], handOrder: { sam: 500 } }] });
    await click('.card-preview-action-rail button');
    expect(await evaluate(`[...document.querySelectorAll('.card-properties-hand li')].map(item => item.innerText)`)).toEqual(['Alex\nSlot 1', 'Sam\nSlot 3', 'missing-member\nNo slot']);
    expect(await evaluate(`document.querySelector('[data-property="version"]').innerText`)).toContain('v2.3');
  });

  it('keeps planning out of the body and labels Run, milestone and due date in Russian properties', async () => {
    await render('hero', { lang: 'ru', card: { dueDate: '2026-12-12' } });
    expect(await evaluate(`Boolean(document.querySelector('.card-preview-sheet .card-indicators, .card-preview-relations, .card-preview-relation-actions'))`)).toBe(false);
    await click('.card-preview-action-rail button');
    const properties = await evaluate(`['run', 'milestone', 'dueDate'].map(field => {
      const section = document.querySelector('[data-property="' + field + '"]');
      return [section.querySelector('h3').textContent, section.querySelector('.card-properties-value').textContent];
    })`);
    expect(properties).toEqual([['Run', 'Run 1 · Harbor prototype'], ['Веха', 'First playable'], ['Срок', '12 дек. 2026 г.']]);
  });

  it.each(['en', 'ru'])('copies ID with local, transient feedback and keyboard-only focus (%s)', async lang => {
    await render('hero', { lang, card: { deckId: 'assets' } });
    await evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.copiedReference = value; } } })`);
    const point = await evaluate(`(() => { const r = document.querySelector('.card-id-chip').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
    await until(`document.querySelector('.card-id-control .card-id-feedback')?.textContent === ${JSON.stringify(lang === 'ru' ? 'Скопировано' : 'Copied')}`);
    expect(await evaluate('window.copiedReference')).toBe(shortReference('c', 'card:preview'));
    expect(await evaluate(`Boolean(document.querySelector('.card-preview-state-notice'))`)).toBe(false);
    expect(await evaluate(`document.querySelector('.card-id-chip').matches(':focus-visible')`)).toBe(false);
    expect(await evaluate(`getComputedStyle(document.querySelector('.card-id-chip')).outlineStyle`)).toBe('none');
    expect(await evaluate(`Boolean(document.querySelector('.card-id-chip[data-copied]') && document.querySelector('.card-id-feedback svg'))`)).toBe(true);
    await delay(900);
    await click('.card-id-chip');
    await delay(700);
    expect(await evaluate(`Boolean(document.querySelector('.card-id-chip[data-copied]'))`)).toBe(true);
    await until(`!document.querySelector('.card-id-chip[data-copied]') && document.querySelector('.card-id-feedback').textContent === ''`);
    await key('Tab');
    await evaluate(`document.querySelector('.card-id-chip').focus()`);
    expect(await evaluate(`getComputedStyle(document.querySelector('.card-id-chip')).outlineStyle`)).toBe('solid');
  });

  it('shows clipboard rejection beside the ID and ignores a late response after changing cards', async () => {
    await render();
    await evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Denied'); } } })`);
    await click('.card-id-chip');
    expect(await evaluate(`document.querySelector('.card-id-feedback')?.textContent`)).toBe('Could not copy');
    expect(await evaluate(`Boolean(document.querySelector('.card-preview-state-notice'))`)).toBe(false);
    await evaluate(`navigator.clipboard.writeText = () => new Promise(resolve => { window.finishCopy = resolve; })`);
    await click('.card-id-chip');
    await render('doc', { card: { id: 'card:other' } });
    await evaluate('window.finishCopy()');
    expect(await evaluate(`document.querySelector('.card-id-feedback')?.textContent`)).toBe('');
    expect(await evaluate(`document.querySelector('.card-id-chip').textContent`)).toBe(shortReference('c', 'card:other'));
  });

  it.each([12, 248])('keeps the family popover inside a touch viewport at x=%s and restores keyboard focus', async left => {
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 600, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true });
    try {
      await evaluate(`window.previewTest.render('task', { child: true, familyOnly: true })`);
      await until(`Boolean(document.querySelector('.card-family-trigger'))`);
      await call(`function(left) { document.querySelector('.deck-card-space').parentElement.style.left = left + 'px'; document.querySelector('.card-family-trigger').focus(); }`, left);
      await key('Enter');
      await until(`Boolean(document.querySelector('.card-family-popover'))`);
      await until(`document.querySelector('.card-family-popover').getAnimations().every(animation => animation.playState === 'finished')`);
      expect(await evaluate(`(() => { const box = document.querySelector('.card-family-popover').getBoundingClientRect(); return box.left >= 8 && box.right <= innerWidth - 8 && box.top >= 8 && box.bottom <= innerHeight - 8; })()`)).toBe(true);
      await key('Escape');
      await until(`document.activeElement === document.querySelector('.card-family-trigger')`);
    } finally {
      await send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await send('Emulation.clearDeviceMetricsOverride');
    }
  });

  it.each(['hero', 'task'])('%s: Effort keeps the text panel, tabs work, Escape restores the clicked anchor', async kind => {
    await render(kind);
    await click(button('effort'));
    await expectPopup('effort', button('effort'));
    const shots = process.env.DECKMATE_QUICK_SETTINGS_SHOTS;
    if (shots) {
      await mkdir(shots, { recursive: true });
      const screenshot = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(path.join(shots, `quick-${kind}.png`), Buffer.from(screenshot.data, 'base64'));
    }
    await click('[role="tab"][aria-label="Priority"]');
    await expectPopup('priority', button('effort'));
    await key('Escape');
    await expectClosed(button('effort'));
  });

  it.each([1440, 375].flatMap(width => ['dark', 'light'].flatMap(theme => ['en', 'ru'].map(lang => ({ width, theme, lang })))))
  ('separates Hero own effort from its total at $width px in $theme / $lang', async ({ width, theme, lang }) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    try {
      await call(`theme => document.documentElement.classList.toggle('dark', theme === 'dark')`, theme);
      await render('hero', { lang, card: { effort: null }, children: [
        { effort: 5 }, { effort: 8 }, { effort: null }, { effort: 100, archived: true }, { effort: 100, deleted: true },
      ] });
      await click(button('effort'));
      await expectPopup('effort', button('effort'));
      expect(await evaluate(`document.querySelector('.deck-choice-title').textContent`)).toBe(lang === 'en' ? 'Choose Own effort' : 'Выбрать: Своя оценка');
      expect(await evaluate(`document.querySelector('.card-quick-total').textContent`)).toBe(lang === 'en' ? 'Total effort incl. Sub Cards: 14' : 'Суммарная оценка с Sub Cards: 14');
      expect(await evaluate(`document.querySelector('[role="option"][aria-selected="true"] .deck-choice-name').textContent`)).toBe(lang === 'en' ? 'None' : 'Нет');
      await call(`() => [...document.querySelectorAll('[role="option"]')].find(option => option.querySelector('.deck-choice-name').textContent === '3').click()`);
      await expectClosed(button('effort'));
      expect(await evaluate('window.previewTest.card().effort')).toBe(3);
      await click(button('effort'));
      expect(await evaluate(`document.querySelector('.card-quick-total').textContent`)).toContain('17');
      await key('Escape');
      await expectClosed(button('effort'));
    } finally { await send('Emulation.clearDeviceMetricsOverride'); }
  });

  it.each(['en', 'ru'] as const)('keeps punctuation adjacent to an accessible confirm control in %s', async lang => {
    for (const touch of [false, true]) {
      await send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 1 });
      try {
        await render('task', { lang });
        await click(button('priority'));
        const geometry = await evaluate(`(() => {
          const button = document.querySelector('.deck-choice-confirm');
          const text = document.createRange(), punctuation = document.createRange();
          text.selectNodeContents(button); punctuation.selectNodeContents(button.nextSibling);
          const b = button.getBoundingClientRect();
          return { gap: punctuation.getBoundingClientRect().left - text.getBoundingClientRect().right,
            width: b.width, height: b.height, name: button.textContent, total: Boolean(document.querySelector('.card-quick-total')) };
        })()`);
        expect(geometry.gap).toBeLessThanOrEqual(1);
        expect(geometry.name).toBe(lang === 'en' ? 'confirm' : 'подтвердить');
        expect(geometry.total).toBe(false);
        if (touch) { expect(geometry.width).toBeGreaterThanOrEqual(44); expect(geometry.height).toBeGreaterThanOrEqual(44); }
        await click('.deck-choice-confirm');
        await expectClosed(button('priority'));
      } finally { await send('Emulation.setTouchEmulationEnabled', { enabled: false }); }
    }
  });

  // 2026-11-11: the New Card deck picker renders the same hint outside .card-quick-settings,
  // so its punctuation follows the shared base rule, not the quick-settings wrapper.
  it.each(['en', 'ru'] as const)('keeps the New Card deck picker hint punctuation adjacent in %s', async lang => {
    await render('task', { lang });
    await evaluate(`history.replaceState(null, '', location.pathname + '?view=picker'); window.dispatchEvent(new PopStateEvent('popstate'));`);
    await until(`Boolean(document.querySelector('.deck-picker-pill'))`);
    await click('.deck-picker-pill');
    await until(`Boolean(document.querySelector('.deck-picker-popover .deck-choice-confirm'))`);
    expect(await evaluate(`Boolean(document.querySelector('.deck-picker-popover .card-quick-settings'))`)).toBe(false);
    const geometry = await evaluate(`(() => {
      const button = document.querySelector('.deck-picker-popover .deck-choice-confirm');
      const text = document.createRange(), punctuation = document.createRange();
      text.selectNodeContents(button); punctuation.selectNodeContents(button.nextSibling);
      const b = button.getBoundingClientRect();
      return { gap: punctuation.getBoundingClientRect().left - text.getBoundingClientRect().right,
        width: b.width, height: b.height, name: button.textContent };
    })()`);
    expect(geometry.gap).toBeLessThanOrEqual(1);
    expect(geometry.name).toBe(lang === 'en' ? 'confirm' : 'подтвердить');
    expect(geometry.width).toBeGreaterThanOrEqual(44);
    await click('.deck-choice-confirm');
    await until(`!document.querySelector('.deck-picker-popover')`);
    await evaluate(`history.replaceState(null, '', location.pathname); window.dispatchEvent(new PopStateEvent('popstate'));`);
  });

  it.each(['owner', 'priority', 'deck'])('clicking %s anchors its own tab without switching panels', async tab => {
    await render();
    await click(button(tab));
    await expectPopup(tab, button(tab));
    await key('Escape');
    await expectClosed(button(tab));
  });

  it.each(['dark', 'light'])('distinguishes and saves every Quick Settings priority in %s', async theme => {
    await call(`theme => document.documentElement.classList.toggle('dark', theme === 'dark')`, theme);
    await render();
    await click(button('priority'));
    await expectPopup('priority', button('priority'));
    const choices = await evaluate(`[...document.querySelectorAll('.deck-choice-option')].map(option => ({
      label: option.querySelector('.deck-choice-name').textContent,
      paths: [...option.querySelectorAll('.priority-icon path')].map(path => path.getAttribute('d')).join(' '),
      color: getComputedStyle(option.querySelector('.priority-icon')).color,
      rowColor: getComputedStyle(option).color
    }))`);
    expect(choices.map((choice: { label: string }) => choice.label)).toEqual(['None', 'Low', 'Medium', 'High']);
    expect(new Set(choices.map((choice: { paths: string }) => choice.paths)).size).toBe(4);
    expect(choices.every((choice: { color: string; rowColor: string }) => choice.color === choice.rowColor)).toBe(true);
    for (const priority of ['high', 'low', null, 'medium']) {
      await call(`priority => {
        const label = priority ? priority[0].toUpperCase() + priority.slice(1) : 'None';
        [...document.querySelectorAll('.deck-choice-option')].find(option => option.querySelector('.deck-choice-name').textContent === label).click();
      }`, priority);
      await expectClosed(button('priority'));
      expect(await evaluate('window.previewTest.card().priority')).toBe(priority);
      if (priority !== 'medium') await click(button('priority'));
    }
  });

  it.each(['run', 'milestone'])('edits %s from its labelled properties row and restores focus', async tab => {
    await render();
    await click('.card-preview-action-rail button');
    const anchor = `.card-properties-section[data-property="${tab}"] .card-properties-pick`;
    await click(anchor);
    await until(`document.querySelector('.card-quick-settings')?.dataset.tab === '${tab}'`);
    expect(await evaluate(`document.querySelector('.card-properties-slot').hidden`)).toBe(false);
    await key('Escape');
    await until(`!document.querySelector('.card-quick-settings') && document.activeElement === document.querySelector('${anchor}')`);
  });

  it('keeps horizontal arrows in search and navigates tabs with focus on the tablist', async () => {
    await render();
    await click(button('owner'));
    await expectPopup('owner', button('owner'));
    await until(`document.activeElement === document.querySelector('.deck-choice-search')`);
    await send('Input.insertText', { text: 'Alex' });
    await key('ArrowLeft');
    expect(await evaluate(`({ tab:document.querySelector('.card-quick-settings').dataset.tab, value:document.activeElement.value, caret:document.activeElement.selectionStart })`))
      .toEqual({ tab: 'owner', value: 'Alex', caret: 3 });
    await evaluate(`document.querySelector('.card-quick-tabs [aria-selected="true"]').focus()`);
    await key('ArrowRight');
    await until(`document.querySelector('.card-quick-settings').dataset.tab === 'run'`);
    expect(await evaluate(`document.activeElement.getAttribute('role')`)).toBe('tab');
    expect(await evaluate(`document.activeElement.getAttribute('aria-selected')`)).toBe('true');
    await key('Escape');
    await expectClosed(button('owner'));
  });

  it.each([['e', 'KeyE', 'effort'], ['p', 'KeyP', 'priority'], ['o', 'KeyO', 'owner'], [',', 'Comma', 'run'], ['m', 'KeyM', 'milestone']])('%s shortcut uses the matching preview button', async (character, code, tab) => {
    await render();
    const anchor = button(tab === 'run' || tab === 'milestone' ? 'owner' : tab);
    await key(character, code);
    await expectPopup(tab, anchor);
    await key('Escape');
    await expectClosed(anchor);
  });

  it.each([{ child: true }, { child: true, journey: true }])('Sub Cards and Journey cards retain Quick Settings: %j', async options => {
    await render('task', options);
    await click(button('effort'));
    await expectPopup('effort', button('effort'));
    await key('Escape');
    await expectClosed(button('effort'));
  });

  it('saves through onEdit with the existing hashes and returns focus after selection', async () => {
    await render();
    await click(button('effort'));
    await click('[role="option"]:last-child');
    await expectClosed(button('effort'));
    expect(await evaluate('window.previewTest.actions')).toEqual([{ action: 'set-card-properties', cardId: 'card:preview',
      sourceHash: 'card-hash', manifestHash: 'manifest-hash', owner: null, priority: 'medium', effort: 8 }]);
  });

  it.each([0, 9])('keeps immediate numeric Effort assignment (%s) without a popup', async amount => {
    await render();
    await moveOver(button('effort'), .5);
    await key(String(amount), `Digit${amount}`);
    expect(await evaluate(`document.querySelector('.card-quick-settings') === null`)).toBe(true);
    expect(await evaluate('window.previewTest.actions[0].change')).toEqual({ kind: 'properties', effort: amount });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
  });

  it.each([
    { theme: 'dark', tab: 'priority', choice: 'Medium', label: 'Priority: Medium', card: { priority: 'low' } },
    { theme: 'dark', tab: 'effort', choice: '3', label: 'Effort: 3', card: {} },
    { theme: 'dark', tab: 'owner', choice: 'Alex', label: 'Owner: Alex', card: {} },
    { theme: 'light', tab: 'priority', choice: 'Medium', label: 'Priority: Medium', card: { priority: 'low' } },
    { theme: 'light', tab: 'effort', choice: '3', label: 'Effort: 3', card: {} },
    { theme: 'light', tab: 'owner', choice: 'Alex', label: 'Owner: Alex', card: {} },
  ])('keeps the material plate stable throughout a $tab save in the $theme theme', async ({ theme, tab, choice, label, card }) => {
    await call(`function(theme) { document.documentElement.classList.toggle('dark', theme === 'dark'); }`, theme);
    await render('task', { holdSave: true, card });
    await click(button(tab));
    await expectPopup(tab, button(tab));
    const measurement = await call(`async function(tab, choice) {
      const controls = [...document.querySelectorAll('.card-preview-material-band button')].map(element => {
        const rect = element.getBoundingClientRect();
        return { element, tab: element.dataset.quickSettingsTab, rect: [rect.x, rect.y, rect.width, rect.height] };
      });
      const option = [...document.querySelectorAll('[role="option"]')].find(item => item.querySelector('.deck-choice-name')?.textContent === choice);
      if (!option) throw new Error('Missing Quick Settings choice: ' + choice);
      const frames = [];
      const started = performance.now();
      option.click();
      setTimeout(() => window.previewTest.finishSave(), 120);
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Quick Settings save did not finish')), 3000);
        function sample(now) {
          if (document.querySelector('.card-quick-settings')) option.click();
          frames.push({ at: now - started, controls: controls.map(({ element, tab, rect }) => {
            const next = element.getBoundingClientRect();
            return { tab, opacity: Number(getComputedStyle(element).opacity), connected: element.isConnected,
              rect: [next.x, next.y, next.width, next.height], initialRect: rect };
          }) });
          if (!document.querySelector('.card-quick-settings')) {
            clearTimeout(timer);
            resolve({ frames, label: document.querySelector('[data-quick-settings-tab="' + tab + '"]').getAttribute('aria-label'),
              actionCount: window.previewTest.actions.length });
          } else requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      });
    }`, tab, choice) as PlateMeasurement;
    const summary = measurement.frames[0].controls.map(control => ({
      tab: control.tab,
      opacity: Math.min(...measurement.frames.flatMap(frame => frame.controls.filter(item => item.tab === control.tab).map(item => item.opacity))),
      connected: measurement.frames.every(frame => frame.controls.find(item => item.tab === control.tab)?.connected),
      rects: [...new Set(measurement.frames.map(frame => JSON.stringify(frame.controls.find(item => item.tab === control.tab)?.rect)))],
    }));
    const frames = measurement.frames.flatMap(frame => frame.controls);
    expect(measurement.frames.length).toBeGreaterThan(3);
    expect(frames.every(control => control.opacity === 1), JSON.stringify(summary)).toBe(true);
    expect(frames.every(control => control.connected), 'The plate controls must not remount').toBe(true);
    expect(frames.every(control => JSON.stringify(control.rect) === JSON.stringify(control.initialRect)), JSON.stringify(summary)).toBe(true);
    expect(measurement.label).toBe(label);
    expect(measurement.actionCount).toBe(1);
  });

  it('retains the anchor when tabs change and replaces the popup when another property is clicked', async () => {
    await render();
    await click(button('effort'));
    await click(button('owner'));
    await expectPopup('owner', button('owner'));
    expect(await call(`function(selector) { return document.querySelector(selector).getAttribute('aria-expanded'); }`, button('effort'))).toBe('false');
    await key('Escape');
    await expectClosed(button('owner'));
  });

  it.each(['effort', 'run', 'milestone'])('keeps %s open and its anchor mounted during an in-flight save', async tab => {
    await render('hero', { holdSave: true });
    let anchor = button(tab);
    if (tab !== 'effort') {
      await click('.card-preview-action-rail button');
      anchor = `.card-properties-section[data-property="${tab}"] .card-properties-pick`;
    }
    await click(anchor);
    await click('[role="option"][aria-selected="false"]');
    await key('Escape');
    expect(await evaluate(`document.querySelector('.deck-picker-popover').getAttribute('aria-busy')`)).toBe('true');
    expect(await evaluate(`document.querySelector('.card-preview-action-rail button').disabled`)).toBe(true);
    expect(await call('function(selector) { return document.querySelector(selector).disabled; }', button('owner'))).toBe(true);
    await evaluate('window.previewTest.finishSave()');
    await expectClosed(anchor);
  });

  it('leaves the full panel available and shares one popup with its own selectors', async () => {
    await render();
    await click('.card-preview-action-rail button');
    expect(await evaluate(`document.querySelector('.card-properties-slot').hidden`)).toBe(false);
    await click('.card-properties-owner');
    await until(`document.querySelector('.card-quick-settings')?.dataset.tab === 'owner'`);
    await key('Escape');
    await expectClosed('.card-properties-owner');
    expect(await evaluate(`document.querySelector('.card-properties-slot').hidden`)).toBe(false);
    await click(button('effort'));
    await until(`document.querySelector('.card-quick-settings')?.dataset.tab === 'effort'`);
    expect(await evaluate(`document.querySelectorAll('.card-quick-settings').length`)).toBe(1);
    expect(await evaluate(`document.querySelector('.card-properties-slot').hidden`)).toBe(false);
    await key('Escape');
  });

  it.each(['dark', 'light'] as const)('keeps all four property priorities distinct and legible in %s', async theme => {
    await evaluate(`document.documentElement.classList.toggle('dark', ${theme === 'dark'})`);
    await render('task', { writable: false, card: { effort: 0, priority: 'medium' } });
    expect(await evaluate(`getComputedStyle(document.querySelector('.card-preview-property-shortcut')).opacity`)).toBe('1');
    await click('.card-preview-action-rail button');
    const values = await evaluate(`Array.from(document.querySelectorAll('.card-properties-priorities button')).map(button => {
      const svg = button.querySelector('svg');
      return { shape: svg.innerHTML, width: svg.getBoundingClientRect().width, stroke: svg.getAttribute('stroke-width'), font: parseFloat(getComputedStyle(button).fontSize) };
    })`);
    expect(values).toHaveLength(4);
    expect(new Set(values.map((value: { shape: string }) => value.shape)).size).toBe(4);
    expect(values.every((value: { width: number; stroke: string; font: number }) => value.width >= 16 && value.stroke === '2' && value.font >= 13)).toBe(true);
    expect(await evaluate(`parseFloat(getComputedStyle(document.querySelector('.card-properties-effort-scale button')).fontSize)`)).toBeGreaterThanOrEqual(13);
    await evaluate(`document.documentElement.classList.add('dark')`);
  });

  it.each([{ writable: false }, { pending: true }])('blocks click and keyboard actions while unavailable: %j', async options => {
    await render('task', options);
    await click(button('effort'));
    await key('e', 'KeyE');
    expect(await evaluate(`document.querySelector('.card-quick-settings') === null`)).toBe(true);
  });

  it('blocks Quick Settings while the full properties panel holds an Effort draft', async () => {
    await render();
    await click('.card-preview-action-rail button');
    await evaluate(`document.querySelector('.card-properties-effort-custom input').focus()`);
    await send('Input.insertText', { text: '4' });
    await until(() => call('function(selector) { return document.querySelector(selector).disabled; }', button('effort')));
    await click(button('effort'));
    await evaluate('document.activeElement.blur()');
    await key('e', 'KeyE');
    expect(await evaluate(`document.querySelector('.card-quick-settings') === null`)).toBe(true);
  });

  it('does not expose Effort or Priority for Doc, but still opens Owner', async () => {
    await render('doc');
    expect(await call('function(selector) { return document.querySelector(selector) === null; }', button('effort'))).toBe(true);
    expect(await call('function(selector) { return document.querySelector(selector) === null; }', button('priority'))).toBe(true);
    await key('e', 'KeyE');
    expect(await evaluate(`document.querySelector('.card-quick-settings') === null`)).toBe(true);
    await click(button('owner'));
    await expectPopup('owner', button('owner'));
    await key('Escape');
    await expectClosed(button('owner'));
    expect(errors).toEqual([]);
  });

  async function setMotionPreference(value: 'reduce' | 'no-preference') {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value }] });
  }
  async function pointerDiagnostics(selector: string, point: { x: number; y: number } | null = null) {
    return call(`function(selector, point) {
      const element = document.querySelector(selector);
      const bounds = element?.getBoundingClientRect();
      const sample = window.previewPointerSample;
      point ??= { x: sample?.x ?? bounds?.x ?? 0, y: sample?.y ?? bounds?.y ?? 0 };
      const hit = document.elementFromPoint(point.x, point.y);
      const describe = node => node ? node.tagName + '#' + node.id + '.' + [...node.classList].join('.') : null;
      return { selector, point, bounds: bounds?.toJSON(),
        viewport: { width: innerWidth, height: innerHeight }, window: { width: outerWidth, height: outerHeight },
        scroll: { x: scrollX, y: scrollY }, visibility: document.visibilityState, focused: document.hasFocus(),
        hoverCapable: matchMedia('(hover: hover) and (pointer: fine)').matches,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        hit: describe(hit), hitMatches: Boolean(element && hit && element.contains(hit)), hovered: element?.matches(':hover'),
        event: sample ? { target: describe(sample.target), trusted: sample.trusted, pointerType: sample.pointerType,
          x: sample.x, y: sample.y, hitMatches: Boolean(element?.contains(sample.target)) } : null };
    }`, selector, point);
  }
  async function moveOver(selector: string, fraction: number) {
    await send('Page.bringToFront');
    const point = await call(`function(selector, fraction) {
      const element = document.querySelector(selector);
      if (!element) throw new Error('Pointer target not found: ' + selector);
      element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      const box = element.getBoundingClientRect();
      window.previewPointerSample = null;
      return { x: box.x + box.width * fraction, y: box.y + box.height / 2 };
    }`, selector, fraction);
    const before = await pointerDiagnostics(selector, point);
    expect(before.hitMatches, 'Pointer hit test failed: ' + JSON.stringify(before)).toBe(true);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, button: 'none', buttons: 0, pointerType: 'mouse' });
    const started = Date.now();
    let state;
    let received;
    do {
      state = await pointerDiagnostics(selector, point);
      received = state.event?.hitMatches && state.event.trusted && state.event.pointerType === 'mouse'
        && Math.abs(state.event.x - point.x) < 1 && Math.abs(state.event.y - point.y) < 1;
      if (received && state.hovered && state.visibility === 'visible' && state.focused) break;
      await delay(40);
    } while (Date.now() - started < 2000);
    expect({ received: Boolean(received), hovered: state.hovered, visibility: state.visibility, focused: state.focused },
      'CDP mouse did not reach the visible, focused target: ' + JSON.stringify(state))
      .toEqual({ received: true, hovered: true, visibility: 'visible', focused: true });
  }
  async function reflection(selector: string) {
    return call(`function(selector) {
      const layer = document.querySelector(selector).querySelector('.card-material-glare');
      const style = getComputedStyle(layer);
      const card = layer.closest('.deck-card');
      return { opacity: Number(style.opacity), display: style.display, willChange: style.willChange,
        layers: card ? getComputedStyle(card).willChange + ' / ' + getComputedStyle(layer, '::before').willChange : null,
        x: new DOMMatrix(getComputedStyle(layer, '::before').transform).m41 };
    }`, selector);
  }
  // 2026-11-09: polling with a 2s ceiling instead of fixed delays — a CI runner can be several times slower than a desktop.
  async function reflectionWhen(selector: string, accept: (value: Awaited<ReturnType<typeof reflection>>) => boolean, timeout = 2000) {
    const started = Date.now();
    let value = await reflection(selector);
    while (!accept(value) && Date.now() - started < timeout) {
      await delay(40);
      value = await reflection(selector);
    }
    if (!accept(value)) throw new Error('Reflection did not reach the expected state: '
      + JSON.stringify({ selector, value, pointer: await pointerDiagnostics(selector) }) + '\n' + errors.join('\n'));
    return value;
  }
  async function reflectionSettled(selector: string, timeout = 2000) {
    const started = Date.now();
    let value = await reflection(selector);
    while (Date.now() - started < timeout) {
      await delay(120);
      const next = await reflection(selector);
      if (next.x === value.x && next.opacity === value.opacity) return next;
      value = next;
    }
    throw new Error('Reflection did not settle: ' + JSON.stringify({ selector, value, pointer: await pointerDiagnostics(selector) }));
  }
  // 2026-11-09: sample throughout a hold, rather than sleeping and missing an intermediate drift.
  async function reflectionHolds(selector: string, accept: (value: Awaited<ReturnType<typeof reflection>>) => void, duration: number) {
    const started = Date.now();
    do {
      accept(await reflection(selector));
      await delay(40);
    } while (Date.now() - started < duration);
  }

  // 2026-11-08: the open card's band glows softly at rest and drifts towards the pointer.
  it('.card-preview-material-band keeps a soft glow at rest and drifts towards the pointer', async () => {
    const selector = '.card-preview-material-band';
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    await render('hero');
    const rest = await reflectionSettled(selector);
    expect(rest.display).not.toBe('none');
    expect(rest.opacity).toBeCloseTo(.7, 2);
    await moveOver(selector, .15);
    await reflectionWhen(selector, value => value.opacity > rest.opacity);
    const left = await reflectionSettled(selector);
    expect(left.opacity).toBeGreaterThan(rest.opacity);
    await moveOver(selector, .85);
    await reflectionWhen(selector, value => value.x > left.x);
    const right = await reflectionSettled(selector);
    expect(right.x).toBeGreaterThan(left.x);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    const after = await reflectionWhen(selector, value => Math.abs(value.opacity - .7) < .001);
    expect(after.opacity).toBeCloseTo(.7, 2);
    expect(after.x).toBeCloseTo(right.x, 1);
  }, 15000);

  // 2026-11-09: the gold parent bar above a Sub Card carries the open card's soft light, in the metal under its ink.
  it('.card-preview-parent glows softly at rest, brightens under the pointer and keeps the light under its ink', async () => {
    const selector = '.card-preview-parent';
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    await render('task', { child: true });
    const rest = await reflectionSettled(selector);
    expect(rest.opacity).toBeCloseTo(.7, 2);
    expect(await call(`function(selector) { return getComputedStyle(document.querySelector(selector + ' > .card-material-glare')).zIndex; }`, selector)).toBe('-1');
    await moveOver(selector, .5);
    expect((await reflectionWhen(selector, value => value.opacity > rest.opacity)).opacity).toBeGreaterThan(rest.opacity);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    expect((await reflectionWhen(selector, value => Math.abs(value.opacity - .7) < .001)).opacity).toBeCloseTo(.7, 2);
  }, 15000);

  // 2026-11-08: the tile ribbon rests beyond the right edge, sweeps in once,
  // moves against the pointer horizontally (with the tilt) and sweeps back out on leave.
  it.each(['.deck-card-space'])('%s ribbon sweeps in, follows the tilt, holds while paused and sweeps out on leave', async selector => {
    // Without a hovering fine pointer the ribbon is pinned by design; fail on the environment, not on the motion.
    expect(await evaluate(`matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)').matches`)).toBe(true);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    await render('hero');
    const rest = await reflectionSettled(selector);
    expect(rest.display).not.toBe('none');
    expect(rest.opacity).toBe(1);
    // 2026-11-09: compositing hints never change with hover — layers made and dropped per hover made the ink jump.
    expect(rest.willChange).toBe('auto');
    expect(rest.layers).toMatch(/ \/ auto$/);
    await moveOver(selector, .2);
    await reflectionWhen(selector, value => value.x < rest.x - 60);
    const left = await reflectionSettled(selector);
    expect(left.x).toBeLessThan(rest.x - 60);
    expect([left.willChange, left.layers]).toEqual([rest.willChange, rest.layers]);
    await moveOver(selector, .8);
    await reflectionWhen(selector, value => value.x < left.x - 30);
    const right = await reflectionSettled(selector);
    expect(right.x).toBeLessThan(left.x - 30);
    await reflectionHolds(selector, value => expect(value).toEqual(right), 1400);
    await moveOver(selector, .3);
    const reversed = await reflectionWhen(selector, value => value.x > right.x + 20);
    expect(reversed.x).toBeGreaterThan(right.x + 20);
    await reflectionSettled(selector);
    const before = await reflection(selector);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    // The first sample that has moved is mid-sweep: the ribbon goes back to rest gradually, not in one jump.
    const leaving = await reflectionWhen(selector, value => value.x > before.x + 1);
    expect(leaving.x).toBeGreaterThan(before.x);
    expect(leaving.x).toBeLessThan(rest.x - 1);
    const idle = await reflectionWhen(selector, value => Math.abs(value.x - rest.x) < .05);
    expect(idle.x).toBeCloseTo(rest.x, 1);
    expect([idle.willChange, idle.layers]).toEqual([rest.willChange, rest.layers]);
  }, 15000);

  it.each([[113, 144], [180, 210]])('keeps both ribbon cuts on one diagonal across a %s × %s tile', async (width, height) => {
    await render('task', { child: true });
    await call(`function(width, height) {
      const style = document.querySelector('.deck-card').style;
      style.setProperty('--tile-width', width + 'px'); style.setProperty('--tile-height', height + 'px');
    }`, width, height);
    try {
      await moveOver('.deck-card-space', .6);
      await reflectionSettled('.deck-card-space');
      // The hot cut sits at the middle of a ribbon five band widths long.
      const bands = await evaluate(`['.card-family-trigger', '.deck-card-band'].map(selector => {
        const band = document.querySelector('.deck-card > ' + selector);
        const layer = band.querySelector('.card-material-glare');
        const matrix = new DOMMatrix(getComputedStyle(layer, '::before').transform);
        return { x: band.offsetLeft + layer.offsetLeft + matrix.m41 + layer.clientWidth * 2.5,
          y: band.offsetTop + band.clientTop + layer.offsetTop + layer.clientHeight / 2, slope: matrix.m21 };
      })`);
      const [top, bottom] = bands;
      const slope = Math.tan(22 * Math.PI / 180);
      expect(top.x).toBeGreaterThan(bottom.x);
      for (const band of bands) expect(band.slope).toBeCloseTo(-slope, 5);
      expect(top.x + top.y * slope).toBeCloseTo(bottom.x + bottom.y * slope, 1);
    } finally {
      await evaluate(`document.querySelector('.deck-card').style.removeProperty('--tile-width'); document.querySelector('.deck-card').style.removeProperty('--tile-height')`);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    }
  });

  it('shares the ribbon with Sub Card affiliation and keeps checked or disabled tiles at rest', async () => {
    await render('task', { child: true });
    await moveOver('.deck-card-space', .6);
    await reflectionSettled('.deck-card-space');
    expect((await reflection('.card-family-trigger')).opacity).toBeGreaterThan((await reflection('.deck-card-band')).opacity);
    for (const options of [{ checked: true }, { pending: true }]) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
      await render('hero', options);
      const rest = await reflectionSettled('.deck-card-space');
      await moveOver('.deck-card-space', .7);
      await reflectionHolds('.deck-card-space', value => expect(value.x).toBeCloseTo(rest.x, 1), 350);
    }
  });

  it('ignores touch and reduced motion and cancels a pointer frame when leaving immediately', async () => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    await render('hero');
    // The tile's ribbon stays where it rests; the open card's band keeps its resting glow (0.7) instead of reacting.
    const tileRest = (await reflectionSettled('.deck-card-space')).x;
    const resting = (selector: string, value: Awaited<ReturnType<typeof reflection>>) => {
      if (selector === '.deck-card-space') expect(value.x).toBeCloseTo(tileRest, 1);
      else expect(value.opacity).toBeCloseTo(.7, 2);
    };
    for (const selector of ['.deck-card-space', '.card-preview-material-band']) {
      await call(`function(selector) { const el = document.querySelector(selector); el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch', clientX: 80, clientY: 80 })); }`, selector);
      await reflectionHolds(selector, value => resting(selector, value), 450);
      await call(`function(selector) { const el = document.querySelector(selector); el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: 80, clientY: 80 })); el.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: document.body })); }`, selector);
      await reflectionHolds(selector, value => resting(selector, value), 450);
    }
    await setMotionPreference('reduce');
    try {
      // Under reduced motion the ribbon is still the band's material; it stays pinned where it rests.
      await moveOver('.deck-card-space', .8);
      expect((await reflection('.deck-card-space')).display).not.toBe('none');
      await reflectionHolds('.deck-card-space', value => resting('.deck-card-space', value), 350);
      // Under reduced motion the open card's glow is still part of the material; it just stops drifting.
      await moveOver('.card-preview-material-band', .8);
      expect((await reflection('.card-preview-material-band')).display).not.toBe('none');
      await reflectionHolds('.card-preview-material-band', value => resting('.card-preview-material-band', value), 350);
    } finally {
      await setMotionPreference('no-preference');
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    }
    expect(await evaluate(`matchMedia('(prefers-reduced-motion: no-preference)').matches`)).toBe(true);
    expect(errors).toEqual([]);
  });
});
