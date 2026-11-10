import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBrowserSession } from './browser-session.ts';
import { requireBrowser } from './browser-environment.ts';
import { expectPageStateDuring } from './browser-layout.ts';
const browserPath = requireBrowser();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 2026-11-10: the Inbox contract touches real selects, checkboxes and covers; drive the fixture page over CDP
// like card-preview-quick-settings does, without writing project data or relying on dist/.
describe.skipIf(!browserPath)('Inbox flows (browser)', () => {
  const session = createBrowserSession();
  const { send, evaluate, callFunction, until } = session;
  let errors: string[] = [];
  async function click(selector: string) {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await delay(60);
  }
  async function type(selector: string, text: string) {
    await callFunction(`(selector, text) => { const field = document.querySelector(selector);
      const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, text);
      field.dispatchEvent(new Event('input', { bubbles: true })); }`, selector, text);
    await delay(60);
  }
  async function key(key: string, code: number) {
    // 2026-11-10: native button activation needs Enter's text as well as keydown; React-only input handlers do not.
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: code,
      text: type === 'keyDown' && key === 'Enter' ? '\r' : undefined });
  }

  beforeAll(async () => {
    await session.open(browserPath!, { extraArgs: ['--disable-features=OverlayScrollbar'] });
    errors = session.errors;
    await session.navigate('inbox-flows', `Boolean(window.inboxTest && document.querySelector('.card-family-composer'))`, 600);
  }, 90000);

  afterAll(async () => {
    await session.close();
  }, 20000);

  it('creates a Sub Card with deckId null when no deck takes Tasks', async () => {
    await evaluate(`window.inboxTest.render('family', { decks: [{ id: 'deck:art', title: 'Concepts', kind: 'asset' }] })`);
    await until(`Boolean(document.querySelector('.card-family-composer-deck select option[value=""]'))`);
    expect(await evaluate(`document.querySelector('.card-family-composer-deck select option[value=""]').textContent`)).toBe('No deck (Unassigned)');
    expect(await evaluate(`document.querySelector('.card-family-composer-deck select').value`)).toBe('');
    expect(await evaluate(`document.querySelector('.card-family-composer-error') === null`)).toBe(true);
    await type('.card-family-composer-content textarea', 'Art pass\nDescribe the pass');
    await click('.card-family-composer footer button[type="submit"]');
    await until('window.inboxTest.actions.length === 1');
    expect(await evaluate('window.inboxTest.actions[0]')).toMatchObject({ action: 'create-card', deckId: null, kind: 'task', parentId: 'card:hero' });
    expect(await evaluate('window.inboxTest.created[0].deckId')).toBe('');
  });

  it('offers the Inbox by name as the automatic choice and lands the card in it', async () => {
    await evaluate(`window.inboxTest.render('family', { decks: [{ id: 'deck:art', title: 'Concepts', kind: 'asset' }, { id: 'deck:trips', title: 'Trips', kind: 'task' }], inboxDeckId: 'deck:trips', recent: [] })`);
    await until(`Boolean(document.querySelector('.card-family-composer-deck select option[value=""]'))`);
    expect(await evaluate(`document.querySelector('.card-family-composer-deck select option[value=""]').textContent`)).toBe('Auto: Inbox → Trips');
    expect(await evaluate(`document.querySelector('.card-family-composer-deck select').value`)).toBe('');
    await type('.card-family-composer-content textarea', 'Trips task');
    await click('.card-family-composer footer button[type="submit"]');
    await until('window.inboxTest.actions.length === 1');
    expect(await evaluate('window.inboxTest.actions[0]')).toMatchObject({ action: 'create-card', deckId: null, kind: 'task' });
    expect(await evaluate('window.inboxTest.created[0].deckId')).toBe('deck:trips');
  });

  it('prefers the last used deck over the automatic choice', async () => {
    await evaluate(`window.inboxTest.render('family', { decks: [{ id: 'deck:art', title: 'Concepts', kind: 'asset' }, { id: 'deck:trips', title: 'Trips', kind: 'task' }, { id: 'deck:sound', title: 'Sound', kind: 'task' }], inboxDeckId: 'deck:trips', recent: ['deck:sound'] })`);
    await until(`Boolean(document.querySelector('.card-family-composer-deck select'))`);
    expect(await evaluate(`document.querySelector('.card-family-composer-deck select').value`)).toBe('deck:sound');
  });

  it('marks the Inbox deck cover with a labelled tray and leaves other covers clean', async () => {
    await evaluate(`window.inboxTest.render('cover', { inbox: true })`);
    await until(`Boolean(document.querySelector('.catalog-cover-kind-badge.is-inbox'))`);
    expect(await evaluate(`document.querySelector('.catalog-cover-kind-badge.is-inbox').getAttribute('aria-label')`)).toBe('Inbox: cards with no deck chosen go here');
    expect(await evaluate(`document.querySelector('.catalog-cover-kind-badge.is-inbox').getAttribute('title')`)).toBe('Inbox: cards with no deck chosen go here');
    await evaluate(`window.inboxTest.render('cover', { inbox: false })`);
    await until(`!document.querySelector('.catalog-cover-kind-badge.is-inbox')`);
    expect(await evaluate(`document.querySelectorAll('.catalog-cover-kind-badge').length`)).toBe(1);
  });

  it('disables the Inbox checkbox for an Asset deck and keeps it live for a Task deck', async () => {
    await evaluate(`window.inboxTest.render('settings', { deckKind: 'asset' })`);
    await until(`Boolean(document.querySelector('.deck-settings-inbox input'))`);
    expect(await evaluate(`document.querySelector('.deck-settings-inbox input').disabled`)).toBe(true);
    expect(await evaluate(`document.querySelector('.deck-settings-inbox span').textContent`)).toBe('Inbox must take Tasks: Task or Mixed decks only');
    expect(await evaluate(`Boolean(document.querySelector('.deck-settings-more .deck-settings-inbox'))`)).toBe(false);
    await evaluate(`window.inboxTest.render('settings', { deckKind: 'task', inboxDeckId: 'deck:one' })`);
    await until(`document.querySelector('.deck-settings-inbox input')?.checked`);
    expect(await evaluate(`document.querySelector('.deck-settings-inbox input').disabled`)).toBe(false);
    expect(await evaluate(`document.querySelector('.deck-settings-inbox span').textContent`)).toBe('Cards with no deck selected go here. This setting saves immediately.');
  });

  it.each([[375, 812], [1440, 900]])('keeps deck settings inside %i × %i and the color row stable', async (width, height) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await evaluate(`window.inboxTest.render('settings', { deckKind: 'task', lang: 'ru' })`);
    await until(`Boolean(document.querySelector('.deck-settings-dialog'))`);
    expect(await evaluate(`document.querySelector('.deck-settings-dialog').classList.contains('dialog-panel')`)).toBe(true);
    expect(await evaluate(`document.querySelector('.deck-settings-picker').classList.contains('glass-panel')`)).toBe(true);
    const measure = `(() => { const dialog = document.querySelector('.deck-settings-dialog').getBoundingClientRect(); const row = document.querySelector('.deck-settings-color').getBoundingClientRect(); return { left: dialog.left, right: dialog.right, rowHeight: row.height, scrollWidth: document.querySelector('.deck-settings-dialog').scrollWidth, clientWidth: document.querySelector('.deck-settings-dialog').clientWidth }; })()`;
    const before = await evaluate(measure);
    await click('.deck-settings-color-toggle input');
    const after = await evaluate(measure);
    expect(before.left).toBeGreaterThanOrEqual(0);
    expect(before.right).toBeLessThanOrEqual(width);
    expect(after.scrollWidth).toBe(after.clientWidth);
    expect(after.rowHeight).toBe(before.rowHeight);
    expect(after.rowHeight).toBe(28);
  });

  it.each([[375, 812], [1280, 800]])('keeps gallery and space-form overflow inside the workspace at %i × %i (D01, D02)', async (width, height) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await evaluate(`window.inboxTest.render('gallery')`);
    await until(`document.querySelectorAll('.catalog-cover-item').length === 8 && !document.querySelector('.project-pulse-loading')`);
    const dimensions = `({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })`;
    expect(await evaluate(dimensions)).toEqual({ width, height });
    await click('.deck-gallery-add');
    await until(`document.activeElement === document.querySelector('.space-preset-form input') && document.querySelector('.space-preset-form').getBoundingClientRect().top < innerHeight - 100`);
    expect(await evaluate(dimensions)).toEqual({ width, height });
    await evaluate(`window.scrollTo({ top: 10000, left: 10000, behavior: 'instant' })`);
    expect(await evaluate(`({ x: scrollX, y: scrollY })`)).toEqual({ x: 0, y: 0 });
    await key('Escape', 27);
    await until(`!document.querySelector('.space-preset-form') && document.activeElement.matches('.deck-gallery-add')`);
    await click('.deck-gallery-add');
    await click('.space-preset-option input[value="custom"]');
    await type('.space-custom-fields input', 'Unsaved space');
    await key('Escape', 27);
    await delay(100);
    expect(await evaluate(`document.querySelector('.space-custom-fields input')?.value`)).toBe('Unsaved space');
    expect(await evaluate(dimensions)).toEqual({ width, height });
  });

  it('opens Create space as a fixed dialog popover anchored to «+», creates a Custom space and returns focus on Escape', async () => {
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await evaluate(`window.inboxTest.render('gallery')`);
    await until(`document.querySelectorAll('.catalog-cover-item').length === 8 && !document.querySelector('.project-pulse-loading')`);
    const spacesTop = `document.querySelector('.catalog-spaces').getBoundingClientRect().top`;
    const topBefore = await evaluate(spacesTop);
    await click('.deck-gallery-add');
    await until(`Boolean(document.querySelector('.space-form-popover'))`);
    // A fixed dialog under the button: near the opener and out of the gallery flow, so the spaces list does not move.
    expect(await evaluate(`document.querySelector('.space-form-popover').getAttribute('role')`)).toBe('dialog');
    expect(await evaluate(`getComputedStyle(document.querySelector('.space-form-popover')).position`)).toBe('fixed');
    expect(await evaluate(`(() => { const pop = document.querySelector('.space-form-popover').getBoundingClientRect();
      const button = document.querySelector('.deck-gallery-add').getBoundingClientRect();
      return pop.top >= button.bottom && pop.left >= button.left - 1 && pop.left <= button.right; })()`)).toBe(true);
    expect(await evaluate(spacesTop)).toBe(topBefore);
    await click('.space-preset-option input[value="custom"]');
    await type('.space-custom-fields input', 'Launch pad');
    await click('.space-preset-form button[type="submit"]');
    await until(`window.inboxTest.actions.length === 1`);
    expect(await evaluate('window.inboxTest.actions[0]')).toMatchObject({ action: 'create-space', title: 'Launch pad', kind: 'custom' });
    await until(`!document.querySelector('.space-form-popover')`);
    await until(`Array.from(document.querySelectorAll('.catalog-space-heading h2 span'), node => node.textContent).includes('Launch pad')`);
    await click('.deck-gallery-add');
    await until(`Boolean(document.querySelector('.space-form-popover'))`);
    await key('Escape', 27);
    await until(`!document.querySelector('.space-form-popover') && document.activeElement === document.querySelector('.deck-gallery-add')`);
  });

  it('shows the first-project action before the pulse within the mobile viewport (D03)', async () => {
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
    await evaluate(`window.inboxTest.render('gallery', { empty: true })`);
    await until(`Boolean(document.querySelector('.project-template-start')) && !document.querySelector('.project-pulse-loading')`);
    expect(await evaluate(`(() => { const start = document.querySelector('.project-template-start').getBoundingClientRect(); return start.top >= 0 && start.bottom <= innerHeight && start.bottom <= document.querySelector('.project-pulse').getBoundingClientRect().top; })()`)).toBe(true);
  });

  it('shows a clipped cover name on keyboard focus and hover, but not a short name (D09)', async () => {
    const title = 'Подготовка персонажей и предметов для первого релиза';
    await evaluate(`window.inboxTest.render('cover', { title: ${JSON.stringify(title)} })`);
    await until(`Boolean(document.querySelector('.catalog-deck-cover'))`);
    await evaluate('document.fonts.ready');
    await key('Tab', 9);
    await until(`Boolean(document.querySelector('[role="tooltip"]'))`);
    expect(await evaluate(`document.querySelector('[role="tooltip"]').textContent`)).toBe(title);
    await key('Escape', 27);
    await until(`!document.querySelector('[role="tooltip"]')`);
    const point = await evaluate(`(() => { const r = document.querySelector('.catalog-deck-cover').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await until(`Boolean(document.querySelector('[role="tooltip"]'))`);
    expect(await evaluate(`document.querySelector('[role="tooltip"]').textContent`)).toBe(title);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
    await evaluate(`window.inboxTest.render('cover')`);
    await until(`document.querySelector('.catalog-cover-title')?.textContent === 'Trips'`);
    await key('Tab', 9);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await expectPageStateDuring(evaluate, `!document.querySelector('[role="tooltip"]')`, 450);
    expect(await evaluate(`Boolean(document.querySelector('[role="tooltip"]'))`)).toBe(false);
  });

  const spaces = [
    { id: 'space:one', title: 'Work', kind: 'custom', icon: 'layers' },
    { id: 'qa', title: 'QA', kind: 'custom', icon: 'layers' },
    { id: 'empty', title: 'Empty', kind: 'custom', icon: 'layers' },
  ];
  const spaceOrder = `Array.from(document.querySelectorAll('.catalog-space-heading h2 span'), node => node.textContent)`;
  async function renderSpaces(options: Record<string, unknown> = {}) {
    await callFunction(`options => window.inboxTest.render('gallery', options)`, { spaces,
      decks: [
        { id: 'deck:w1', title: 'W1', kind: 'task', spaceId: 'space:one' },
        { id: 'deck:q1', title: 'Q1', kind: 'task', spaceId: 'qa' },
        { id: 'deck:e1', title: 'E1', kind: 'task', spaceId: 'empty' },
      ], ...options });
    const count = Array.isArray(options.spaces) ? options.spaces.length : spaces.length;
    await until(`document.querySelectorAll('.catalog-space').length === ${count} && !document.querySelector('.project-pulse-loading')`);
  }
  async function moveSpace(id: string, direction: 'up' | 'down') {
    await callFunction(`(id, direction) => document.getElementById('space-' + id).closest('.catalog-space')
      .querySelector('[aria-label="Move space ' + direction + '"]').click()`, id, direction);
  }

  it('moves spaces with the header arrows, disables the ends, and preserves collapse state', async () => {
    // 2026-11-10: a space without decks never collapses, so the collapsed space here holds a deck.
    await renderSpaces({ decks: [{ id: 'deck:trips', title: 'Trips', kind: 'task' }, { id: 'deck:bugs', title: 'Bugs', kind: 'task', spaceId: 'qa' }] });
    expect(await evaluate(`(() => { const heading = document.getElementById('space-empty').closest('.catalog-space');
      const toggle = heading.querySelector('h2 button');
      return { empty: heading.classList.contains('is-empty'), disabled: toggle.disabled, expanded: toggle.getAttribute('aria-expanded'), icons: toggle.querySelectorAll('svg').length }; })()`))
      .toEqual({ empty: true, disabled: true, expanded: null, icons: 1 });
    expect(await evaluate(`Array.from(document.querySelectorAll('[aria-label="Move space up"]'), node => node.disabled)`)).toEqual([true, false, false]);
    expect(await evaluate(`Array.from(document.querySelectorAll('[aria-label="Move space down"]'), node => node.disabled)`)).toEqual([false, false, true]);
    await callFunction(`() => document.getElementById('space-qa').closest('.catalog-space').querySelector('h2 button').click()`);
    await until(`document.getElementById('space-qa').hidden`);
    await moveSpace('qa', 'up');
    await until(`window.inboxTest.actions.length === 1 && document.querySelector('.catalog-space-heading h2 span')?.textContent === 'QA'`);
    expect(await evaluate('window.inboxTest.actions[0]')).toMatchObject({ action: 'move-space', spaceId: 'qa', beforeSpaceId: 'space:one', manifestHash: 'manifest-hash' });
    expect(await evaluate(spaceOrder)).toEqual(['QA', 'Work', 'Empty']);
    expect(await evaluate(`document.getElementById('space-qa').hidden`)).toBe(true);
    await moveSpace('qa', 'down');
    await until(`window.inboxTest.actions.length === 2 && document.querySelector('.catalog-space-heading h2 span')?.textContent === 'Work'`);
    expect(await evaluate('window.inboxTest.actions[1]')).toMatchObject({ action: 'move-space', spaceId: 'qa', beforeSpaceId: 'empty' });
    await moveSpace('qa', 'down');
    await until(`window.inboxTest.actions.length === 3 && document.querySelectorAll('.catalog-space-heading h2 span')[2]?.textContent === 'QA'`);
    expect(await evaluate('window.inboxTest.actions[2]')).toMatchObject({ action: 'move-space', spaceId: 'qa', beforeSpaceId: null });
    expect(await evaluate(`document.querySelectorAll('[aria-label="Move space down"]')[2].disabled`)).toBe(true);
    expect(await evaluate(`document.querySelectorAll('[aria-label="Move space up"]')[0].disabled`)).toBe(true);
  });

  it('saves Space position only when changed, using the hash returned by the settings update', async () => {
    await renderSpaces();
    await click('[aria-label="Configure space Work"]');
    await until(`Boolean(document.querySelector('.space-preset-form'))`);
    const select = '.space-custom-fields label:last-child select';
    expect(await callFunction(`selector => ({ value: document.querySelector(selector).value,
      options: Array.from(document.querySelector(selector).options, option => option.value) })`, select)).toEqual({ value: 'qa', options: ['', 'qa', 'empty'] });
    await click('.space-preset-form button[type="submit"]');
    await until(`!document.querySelector('.space-preset-form') && window.inboxTest.actions.length === 1`);
    expect(await evaluate('window.inboxTest.actions.map(action => action.action)')).toEqual(['update-space']);
    await click('[aria-label="Configure space Work"]');
    await until(`Boolean(document.querySelector('.space-preset-form'))`);
    await callFunction(`selector => { const select = document.querySelector(selector); select.value = ''; select.dispatchEvent(new Event('change', { bubbles: true })); }`, select);
    await click('.space-preset-form button[type="submit"]');
    await until(`!document.querySelector('.space-preset-form') && window.inboxTest.actions.length === 3`);
    expect(await evaluate('window.inboxTest.actions[2]')).toMatchObject({ action: 'move-space', spaceId: 'space:one', beforeSpaceId: null, manifestHash: 'manifest-hash-saved-saved' });
    expect(await evaluate(spaceOrder)).toEqual(['QA', 'Empty', 'Work']);
  });

  it('localizes the space arrows and hides them with the pencil in read-only mode, keeping Delete disabled', async () => {
    await renderSpaces({ lang: 'ru' });
    expect(await evaluate(`document.querySelectorAll('[aria-label="Переместить space выше"]').length`)).toBe(3);
    expect(await evaluate(`document.querySelectorAll('[aria-label="Переместить space ниже"]').length`)).toBe(3);
    await renderSpaces({ writable: false });
    expect(await evaluate(`document.querySelectorAll('.catalog-space-actions button').length`)).toBe(3);
    expect(await evaluate(`Array.from(document.querySelectorAll('.catalog-space-actions button'), button => ({ label: button.getAttribute('aria-label'), disabled: button.disabled, description: button.getAttribute('aria-description') }))`))
      .toEqual(Array(3).fill({ label: 'Delete space', disabled: true, description: 'This source is read-only' }));
  });

  async function openSpaceDelete(id: string, label = 'Delete space') {
    await callFunction(`(id, label) => { const button = document.getElementById('space-' + id).closest('.catalog-space').querySelector('[aria-label="' + label + '"]'); button.focus(); button.click(); }`, id, label);
    await until(`Boolean(document.querySelector('.catalog-space .confirm-strip'))`);
  }

  it('shows Delete after the arrows and explains why a Space containing Decks cannot be deleted', async () => {
    await renderSpaces({ decks: [{ id: 'deck:work', title: 'Work deck', kind: 'task' }] });
    expect(await evaluate(`Array.from(document.querySelectorAll('[aria-label="Delete space"]'), button => button.disabled)`)).toEqual([true, false, false]);
    const reason = "Move or delete this space's decks first";
    expect(await evaluate(`({ title: document.querySelector('[aria-label="Delete space"]').title, description: document.querySelector('[aria-label="Delete space"]').getAttribute('aria-description') })`))
      .toEqual({ title: reason, description: reason });
    expect(await evaluate(`document.querySelector('[aria-label="Delete space"]').previousElementSibling.getAttribute('aria-label')`)).toBe('Move space down');
    await click('[aria-label="Delete space"]');
    expect(await evaluate(`Boolean(document.querySelector('.confirm-strip'))`)).toBe(false);
    expect(await evaluate('window.inboxTest.actions')).toEqual([]);
  });

  it('cancels a Space deletion by Cancel or Escape without writes and restores the opener focus', async () => {
    await renderSpaces({ decks: [] });
    await openSpaceDelete('qa');
    expect(await evaluate(`document.querySelector('.confirm-strip-question').textContent`)).toBe('Delete the space “QA”? It has no decks.');
    expect(await evaluate(`document.activeElement.matches('.confirm-strip-keep')`)).toBe(true);
    await click('.confirm-strip-keep');
    await until(`!document.querySelector('.confirm-strip')`);
    expect(await evaluate(`document.activeElement === document.getElementById('space-qa').closest('.catalog-space').querySelector('[aria-label="Delete space"]')`)).toBe(true);
    await openSpaceDelete('qa');
    await key('Escape', 27);
    await until(`!document.querySelector('.confirm-strip')`);
    expect(await evaluate('window.inboxTest.actions')).toEqual([]);
    expect(await evaluate(spaceOrder)).toEqual(['Work', 'QA', 'Empty']);
  });

  it('deletes an empty Space with captured hashes and focuses the next Space heading', async () => {
    await renderSpaces({ decks: [{ id: 'deck:work', title: 'Work deck', kind: 'task' }] });
    await openSpaceDelete('qa');
    await click('.confirm-strip-confirm');
    await until(`document.querySelectorAll('.catalog-space').length === 2 && document.activeElement.id === 'space-heading-empty'`);
    expect(await evaluate('window.inboxTest.actions[0]')).toMatchObject({ action: 'delete-space', spaceId: 'qa', manifestHash: 'manifest-hash', optionsHash: '' });
    expect(await evaluate(spaceOrder)).toEqual(['Work', 'Empty']);
    expect(await evaluate(`document.querySelectorAll('.catalog-cover-item').length`)).toBe(1);
  });

  it('deletes the last Space in Russian, renders the empty state and focuses Create space', async () => {
    await renderSpaces({ spaces: [{ id: 'empty', title: 'Knowledge', kind: 'knowledge', icon: 'book' }], decks: [], lang: 'ru' });
    await openSpaceDelete('empty', 'Удалить пространство');
    expect(await evaluate(`document.querySelector('.confirm-strip-question').textContent`)).toBe('Удалить пространство «Knowledge»? Колод в нём нет.');
    expect(await evaluate(`document.querySelector('.confirm-strip-keep').textContent`)).toBe('Отмена');
    expect(await evaluate(`document.querySelector('.confirm-strip-confirm').textContent`)).toBe('Удалить');
    await click('.confirm-strip-confirm');
    await until(`!document.querySelector('.catalog-space') && document.activeElement.matches('.deck-gallery-add')`);
    expect(await evaluate(`document.querySelector('.catalog-spaces .catalog-empty').textContent`)).toBe('Пространств пока нет. Создайте первое пространство кнопкой + и добавьте в него колоды.');
    await click('.deck-gallery-add');
    await until(`Boolean(document.querySelector('.space-preset-form'))`);
  });

  it('keeps deletion errors inline and retains focus so the same confirmation can be retried', async () => {
    await renderSpaces({ decks: [], response: 'rejected' });
    await openSpaceDelete('empty');
    await click('.confirm-strip-confirm');
    await until(`document.querySelector('.catalog-space [role="alert"]')?.textContent === 'Space deletion rejected by server' && document.activeElement.matches('.confirm-strip-confirm')`);
    expect(await evaluate(spaceOrder)).toEqual(['Work', 'QA', 'Empty']);
    await evaluate(`window.inboxTest.gallery.response = 'success'`);
    await click('.confirm-strip-confirm');
    await until(`document.querySelectorAll('.catalog-space').length === 2 && document.activeElement.id === 'space-heading-qa'`);
    expect(await evaluate(`window.inboxTest.actions.length`)).toBe(2);
  });

  it('keeps the confirmation base across external refreshes and requires reopening after a conflict', async () => {
    await renderSpaces({ decks: [] });
    await openSpaceDelete('qa');
    await evaluate(`window.inboxTest.gallery.catalog.manifestHash = 'external-hash'; window.inboxTest.refreshCatalog()`);
    await click('.confirm-strip-confirm');
    await until(`Boolean(document.querySelector('.catalog-space [role="alert"]')) && document.activeElement.matches('.confirm-strip-confirm')`);
    expect(await evaluate('window.inboxTest.actions[0].manifestHash')).toBe('manifest-hash');
    expect(await evaluate(spaceOrder)).toEqual(['Work', 'QA', 'Empty']);
    await click('.confirm-strip-keep');
    await openSpaceDelete('qa');
    await click('.confirm-strip-confirm');
    await until(`document.querySelectorAll('.catalog-space').length === 2`);
    expect(await evaluate('window.inboxTest.actions[1].manifestHash')).toBe('external-hash');
  });

  it('drops stale Space choices from an open New Deck form, including the final removed Space', async () => {
    await renderSpaces({ decks: [] });
    await callFunction(`() => document.getElementById('space-qa').querySelector('.catalog-add-deck').click()`);
    await until(`document.querySelector('.deck-settings-more select')?.value === 'qa'`);
    await type('.deck-settings-modal-name input', 'Draft deck');
    await evaluate(`window.inboxTest.gallery.catalog.spaces = window.inboxTest.gallery.catalog.spaces.filter(space => space.id !== 'qa'); window.inboxTest.refreshCatalog()`);
    await until(`document.querySelector('.deck-settings-more select')?.value === 'space:one'`);
    await evaluate(`window.inboxTest.gallery.catalog.spaces = []; window.inboxTest.refreshCatalog()`);
    await until(`document.querySelector('.deck-settings-more select')?.options.length === 0 && document.querySelector('.deck-settings-form button[type="submit"]').disabled`);
    expect(await evaluate(`document.querySelector('.deck-settings-modal-name input').value`)).toBe('Draft deck');
    expect(await evaluate('window.inboxTest.actions')).toEqual([]);
  });

  it('ignores removed ordering targets and never recreates a Space deleted while its form is open', async () => {
    await renderSpaces({ decks: [] });
    await click('[aria-label="Configure space Work"]');
    await until(`document.querySelector('.space-custom-fields label:last-child select')?.value === 'qa'`);
    await evaluate(`window.inboxTest.gallery.catalog.spaces = window.inboxTest.gallery.catalog.spaces.filter(space => space.id !== 'qa'); window.inboxTest.refreshCatalog()`);
    await until(`document.querySelector('.space-custom-fields label:last-child select')?.value === ''`);
    await evaluate(`window.inboxTest.gallery.catalog.spaces = window.inboxTest.gallery.catalog.spaces.filter(space => space.id !== 'space:one'); window.inboxTest.refreshCatalog()`);
    await until(`document.querySelector('.space-preset-form button[type="submit"]')?.disabled && Boolean(document.querySelector('.space-preset-form [role="alert"]'))`);
    await click('.space-preset-form button[type="submit"]');
    expect(await evaluate('window.inboxTest.actions')).toEqual([]);
  });

  it('forgets the collapsed state of a removed Space', async () => {
    await renderSpaces();
    await callFunction(`() => document.getElementById('space-qa').closest('.catalog-space').querySelector('h2 button').click()`);
    await until(`document.getElementById('space-qa').hidden`);
    await evaluate(`(() => { const catalog = window.inboxTest.gallery.catalog;
      window.inboxTest.removedSpace = catalog.spaces.find(space => space.id === 'qa');
      window.inboxTest.removedDeck = catalog.decks.find(deck => deck.spaceId === 'qa');
      catalog.spaces = catalog.spaces.filter(space => space.id !== 'qa');
      catalog.decks = catalog.decks.filter(deck => deck.spaceId !== 'qa');
      return window.inboxTest.refreshCatalog(); })()`);
    await until(`!document.getElementById('space-qa')`);
    await evaluate(`(() => { const catalog = window.inboxTest.gallery.catalog;
      catalog.spaces = [...catalog.spaces, window.inboxTest.removedSpace];
      catalog.decks = [...catalog.decks, window.inboxTest.removedDeck];
      return window.inboxTest.refreshCatalog(); })()`);
    await until(`Boolean(document.getElementById('space-qa'))`);
    expect(await evaluate(`document.getElementById('space-qa').hidden`)).toBe(false);
  });

  it('localizes the non-empty Space explanation', async () => {
    await renderSpaces({ lang: 'ru' });
    expect(await evaluate(`document.querySelector('[aria-label="Удалить пространство"]').getAttribute('aria-description')`)).toBe('Сначала перенесите или удалите колоды этого пространства');
    expect(await evaluate(`document.querySelector('[aria-label="Удалить пространство"]').title`)).toBe('Сначала перенесите или удалите колоды этого пространства');
  });

  async function openCapture(options: Record<string, unknown> = {}) {
    const instance = await callFunction(`options => window.inboxTest.render('capture', options)`, options);
    await until(`document.querySelector('.capture-fixture')?.dataset.instance === '${instance}' && !document.querySelector('.quick-capture-panel')`);
    await click('.quick-capture-trigger');
    await until(`Boolean(document.querySelector('.quick-capture-input')) && window.inboxTest.capture.reads > 0`);
  }

  async function submitCapture() {
    const before = await evaluate('window.inboxTest.actions.length');
    await type('.quick-capture-input', 'Capture draft');
    await type('.quick-capture-text', 'Draft details\nSecond line');
    await evaluate(`document.querySelector('.quick-capture-input').focus()`);
    await key('Enter', 13);
    await until(`window.inboxTest.actions.length === ${before + 1} && !document.querySelector('.quick-capture-footer button .spin')`);
  }

  const captureSizes = [
    [375, 812, 'dark', 'ru'], [375, 812, 'light', 'ru'],
    [375, 812, 'dark', 'en'], [375, 812, 'light', 'en'],
    [1440, 900, 'dark', 'ru'], [1440, 900, 'light', 'ru'],
    [1440, 900, 'dark', 'en'], [1440, 900, 'light', 'en'],
  ] as const;

  it.each(captureSizes)('checks partial capture locally at %i × %i, %s, %s without minting a new ID', async (width, height, theme, lang) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    for (const response of ['saved-warning', 'saved-error']) {
      await openCapture({ response, theme, lang });
      await until(`document.activeElement === document.querySelector('.quick-capture-input')`);
      await submitCapture();
      await until(`Boolean(document.querySelector('.quick-capture-warning button')) && !document.querySelector('.quick-capture-footer button .spin')`);
      expect(await evaluate(`document.querySelector('.quick-capture-warning').textContent`)).toContain('Часть изменений записана');
      expect(await evaluate(`Boolean(document.querySelector('.quick-capture-saved'))`)).toBe(false);
      expect(await evaluate(`document.querySelector('.quick-capture-footer button').disabled`)).toBe(true);
      expect(await evaluate(`({ title: document.querySelector('.quick-capture-input').value, markdown: document.querySelector('.quick-capture-text').value })`))
        .toEqual({ title: 'Capture draft', markdown: 'Draft details\nSecond line' });
      await until(`document.activeElement === document.querySelector('.quick-capture-warning button')`);
      expect(await evaluate(`getComputedStyle(document.querySelector('.quick-capture-panel')).animationName`)).toBe('none');
      const fit = await evaluate(`(() => { const el = document.querySelector('.quick-capture-panel'); const rect = el.getBoundingClientRect();
        return { left: rect.left, right: rect.right, overflow: el.scrollWidth - el.clientWidth }; })()`);
      expect(fit.left).toBeGreaterThanOrEqual(0);
      expect(fit.right).toBeLessThanOrEqual(width);
      expect(fit.overflow).toBeLessThanOrEqual(0);
      const cardId = await evaluate(`window.inboxTest.actions[0].cardId`);
      const reads = await evaluate('window.inboxTest.capture.reads');
      await evaluate(`window.inboxTest.capture.holdReads = true`);
      await key('Enter', 13);
      await until(`window.inboxTest.capture.reads > ${reads}`);
      await key('Enter', 13);
      expect(await evaluate('window.inboxTest.capture.reads')).toBe(reads + 1);
      expect(await evaluate(`document.querySelector('.quick-capture-warning button').getAttribute('aria-disabled')`)).toBe('true');
      expect(await evaluate(`document.activeElement === document.querySelector('.quick-capture-warning button')`)).toBe(true);
      expect(await evaluate(`window.inboxTest.actions.length`)).toBe(1);
      await evaluate(`window.inboxTest.capture.holdReads = false; window.inboxTest.capture.releaseRead()`);
      await until(`Boolean(document.querySelector('.quick-capture-saved'))`);
      await until(`document.activeElement === document.querySelector('.quick-capture-footer button:last-child')`);
      expect(await evaluate(`window.inboxTest.created.map(card => card.cardId)`)).toEqual([cardId]);
      await key('Enter', 13);
      await until(`!document.querySelector('.quick-capture-panel')`);
      expect(await evaluate(`window.inboxTest.opened`)).toEqual([cardId]);
      await until(`document.activeElement === document.querySelector('.quick-capture-trigger')`);
    }
    await send('Emulation.setEmulatedMedia', { features: [] });
  });

  it('resolves a lost create response by reading, retaining the draft and never replaying the POST', async () => {
    await openCapture({ response: 'lost', lang: 'ru' });
    await submitCapture();
    await until(`Boolean(document.querySelector('.quick-capture-warning button'))`);
    expect(await evaluate(`document.querySelector('.quick-capture-warning').textContent`)).toContain('Результат создания не подтверждён');
    expect(await evaluate(`Boolean(document.querySelector('.quick-capture-saved'))`)).toBe(false);
    const cardId = await evaluate(`window.inboxTest.actions[0].cardId`);
    await evaluate(`window.inboxTest.capture.failReads = true`);
    await key('Enter', 13);
    await until(`document.querySelector('.quick-capture-warning button').getAttribute('aria-disabled') === 'false'`);
    expect(await evaluate(`Boolean(document.querySelector('.quick-capture-saved'))`)).toBe(false);
    expect(await evaluate(`document.querySelector('.quick-capture-input').value`)).toBe('Capture draft');
    await evaluate(`window.inboxTest.capture.failReads = false`);
    await key('Enter', 13);
    await until(`Boolean(document.querySelector('.quick-capture-saved'))`);
    expect(await evaluate(`window.inboxTest.actions.map(action => action.cardId)`)).toEqual([cardId]);
  });

  it.each(['rejected', 'lost-unsaved'])('retains an unsuccessful %s capture and reuses its ID after an explicit check', async response => {
    await openCapture({ response });
    await submitCapture();
    await until(`Boolean(document.querySelector('.quick-capture-warning button'))`);
    const cardId = await evaluate(`window.inboxTest.actions[0].cardId`);
    expect(await evaluate(`document.querySelector('.quick-capture-error').textContent`)).toContain(response === 'rejected' ? 'Capture rejected by server' : 'Deckmate is not responding');
    expect(await evaluate(`Boolean(document.querySelector('.quick-capture-saved'))`)).toBe(false);
    await key('Enter', 13);
    await until(`!document.querySelector('.quick-capture-warning button') && !document.querySelector('.quick-capture-input').disabled`);
    expect(await evaluate(`document.querySelector('.quick-capture-warning').textContent`)).toContain('card was not found');
    expect(await evaluate(`document.querySelector('.quick-capture-input').value`)).toBe('Capture draft');
    expect(await evaluate(`document.querySelector('.quick-capture-text').value`)).toBe('Draft details\nSecond line');
    expect(await evaluate(`window.inboxTest.actions.length`)).toBe(1);
    await evaluate(`window.inboxTest.capture.response = 'success'; document.querySelector('.quick-capture-input').focus()`);
    await key('Enter', 13);
    await until(`Boolean(document.querySelector('.quick-capture-saved'))`);
    expect(await evaluate(`window.inboxTest.actions.map(action => action.cardId)`)).toEqual([cardId, cardId]);
    expect(await evaluate(`window.inboxTest.created.length`)).toBe(1);
  });

  it('keeps the ordinary existing-Inbox fast flow, minting a new ID only for Capture another', async () => {
    await openCapture();
    await submitCapture();
    await until(`Boolean(document.querySelector('.quick-capture-saved'))`);
    const cardId = await evaluate(`window.inboxTest.actions[0].cardId`);
    expect(await evaluate(`window.inboxTest.actions[0]`)).toMatchObject({ deckId: 'deck:inbox', title: 'Capture draft', markdown: 'Draft details\nSecond line' });
    expect(await evaluate('window.inboxTest.capture.reads')).toBe(1);
    expect(await evaluate(`Boolean(document.querySelector('.quick-capture-warning'))`)).toBe(false);
    await click('.quick-capture-footer button:first-child');
    await until(`document.activeElement === document.querySelector('.quick-capture-input')`);
    expect(await evaluate(`document.querySelector('.quick-capture-input').value`)).toBe('');
    expect(await evaluate(`document.querySelector('.quick-capture-text').value`)).toBe('');
    await submitCapture();
    await until(`Boolean(document.querySelector('.quick-capture-saved')) && window.inboxTest.actions.length === 2`);
    expect(await evaluate(`window.inboxTest.actions[1].cardId`)).not.toBe(cardId);
  });

  it('explains zero spaces without promising or offering an impossible Inbox create', async () => {
    await openCapture({ spaces: [], decks: [], lang: 'ru' });
    await until(`Boolean(document.querySelector('.quick-capture-missing'))`);
    expect(await evaluate(`document.querySelector('.quick-capture-missing').textContent`)).toBe('Сначала создайте пространство в Decks.');
    expect(await evaluate(`Boolean(document.querySelector('.quick-capture-missing button'))`)).toBe(false);
    await type('.quick-capture-input', 'Keep first-run draft');
    await evaluate(`document.querySelector('.quick-capture-input').focus()`);
    await key('Enter', 13);
    expect(await evaluate(`window.inboxTest.actions`)).toEqual([]);
    expect(await evaluate(`document.querySelector('.quick-capture-input').value`)).toBe('Keep first-run draft');
    expect(await evaluate(`document.querySelector('.quick-capture-footer button').disabled`)).toBe(true);
  });

  it('creates only the requested Inbox in an existing space and keeps the draft', async () => {
    await openCapture({ decks: [] });
    await until(`Boolean(document.querySelector('.quick-capture-missing button'))`);
    expect(await evaluate('window.inboxTest.actions')).toEqual([]);
    await type('.quick-capture-input', 'Kept while creating Inbox');
    await click('.quick-capture-missing button');
    await until(`!document.querySelector('.quick-capture-missing')`);
    expect(await evaluate('window.inboxTest.actions')).toEqual([expect.objectContaining({ action: 'create-deck', title: 'Inbox', spaceId: 'space:one' })]);
    expect(await evaluate(`document.querySelector('.quick-capture-input').value`)).toBe('Kept while creating Inbox');
  });

  it('ends failed initial loading and retries reading once by keyboard without a second Loading state', async () => {
    await openCapture({ failReads: true, lang: 'ru' });
    await until(`Boolean(document.querySelector('.ui-error button'))`);
    await type('.quick-capture-input', 'Retained during retry');
    expect(await evaluate(`document.querySelector('.quick-capture-form').textContent.includes('Открываем каталог')`)).toBe(false);
    await evaluate(`window.inboxTest.capture.failReads = false; window.inboxTest.capture.holdReads = true;
      document.querySelector('.ui-error button').focus()`);
    const reads = await evaluate('window.inboxTest.capture.reads');
    await key('Enter', 13);
    await until(`window.inboxTest.capture.reads > ${reads}`);
    await key('Enter', 13);
    expect(await evaluate('window.inboxTest.capture.reads')).toBe(reads + 1);
    expect(await evaluate(`document.activeElement === document.querySelector('.ui-error button')`)).toBe(true);
    expect(await evaluate(`document.querySelector('.quick-capture-form').textContent.includes('Открываем каталог')`)).toBe(false);
    await evaluate(`window.inboxTest.capture.holdReads = false; window.inboxTest.capture.releaseRead()`);
    await until(`document.querySelector('.ui-error').hidden && !document.querySelector('.quick-capture-footer button').disabled`);
    expect(await evaluate(`document.querySelector('.quick-capture-input').value`)).toBe('Retained during retry');
    expect(await evaluate(`Boolean(document.activeElement.closest('.quick-capture-form'))`)).toBe(true);
    expect(await evaluate('window.inboxTest.actions')).toEqual([]);
  });

  it('keeps a global read-only project without a test copy non-writable', async () => {
    await openCapture({ writable: false, decks: [], lang: 'ru' });
    expect(await evaluate(`document.querySelector('.quick-capture-input').disabled && document.querySelector('.quick-capture-text').disabled`)).toBe(true);
    expect(await evaluate(`Boolean(document.querySelector('.quick-capture-missing button'))`)).toBe(false);
    expect(await evaluate(`document.querySelector('.quick-capture-form').textContent`)).toContain('только для чтения');
    expect(await evaluate('window.inboxTest.actions')).toEqual([]);
    await key('Escape', 27);
    await until(`!document.querySelector('.quick-capture-panel') && document.activeElement === document.querySelector('.quick-capture-trigger')`);
  });

  it('keeps the fixture free of page errors', () => {
    expect(errors).toEqual([]);
  });
});
