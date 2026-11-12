import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';
import { expectPageStateDuring, waitForLayout } from './browser-layout.ts';
import type { CatalogJourney, CatalogView } from '../src/catalog-contracts.ts';
import { journeyRecoveryAction } from '../client/components/JourneyOperationNotice.tsx';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';

vi.hoisted(() => vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' }));

function view(state: 'pending' | 'conflict' | 'invalid' | null = 'pending'): CatalogView {
  const journey: CatalogJourney = {
    id: '11111111-2222-4333-8444-555555555555', title: 'Production Journey', path: 'tasks/journeys/one/index.md',
    version: 1, deckId: 'assets', fileHash: 'journey-hash', description: 'Description', zones: [],
    steps: [{ id: 'A', title: 'Plan', deckId: 'work', owner: null, dependsOn: [], markdown: 'Instructions' }],
    ...(state ? { pendingOperation: { id: null, journalHash: 'observed-journal-hash', state, ...(state === 'conflict' ? { file: 'steps/A.md' } : {}) } } : {}),
  };
  return {
    rootIdentity: 'operation-ui-test', formatLanguage: 'ru', manifestHash: 'manifest-hash', configured: true, indexedAt: '',
    spaces: [{ id: 'project', title: 'Project', kind: 'custom', icon: 'layers' }], documents: [], tracks: [], warnings: [],
    decks: ['assets', 'work'].map(id => ({ id, title: id, kind: id === 'assets' ? 'asset' : 'task', spaceId: 'project',
      description: '', color: '#878787', icon: 'layers', style: 'symbol', cover: null, coverPosition: 50 })),
    journeys: [journey], cards: [{ id: 'hero', title: 'Hero', kind: 'hero', deckId: 'assets', path: 'cards/hero.md',
      version: null, state: null, owner: null, parentId: null, markdown: '', sourceHash: 'hero-hash', range: null, trackIds: [] }],
  };
}

const browserPath = requireBrowser();
describe.skipIf(!browserPath)('Journey recovery interactions (real browser)', () => {
  let page: HeadlessPage;
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  async function until(expression: string) {
    for (let i = 0; i < 200; i++) { if (await page.evaluate(expression)) return; await delay(50); }
    throw new Error('Timed out: ' + expression + '\n' + page.consoleErrors.join('\n'));
  }
  async function render(state: Parameters<typeof view>[0], mode = 'apply') {
    await page.callFunction('function(catalog, mode) { window.journeyOperationTest.render(catalog, mode); }', view(state), mode);
    await until(`!!document.querySelector('.journey-operation-notice') === ${!!state}`);
    await waitForLayout(expression => page.evaluate(expression), '#root');
  }
  async function click(label: string, scope = '') {
    await page.callFunction(`function(label, scope) { const button = [...document.querySelectorAll(scope + ' button')].find(b => b.textContent === label || b.getAttribute('aria-label') === label); if (!button) throw Error(label); button.click(); }`, label, scope);
    await waitForLayout(expression => page.evaluate(expression), '#root');
  }
  beforeAll(async () => {
    vi.unstubAllGlobals();
    // 2026-11-10: the capture driver must launch the same executable validated by the test environment, including BROWSER discovery.
    vi.stubEnv('DECKMATE_BROWSER', browserPath!);
    page = await openHeadlessBrowser({ width: 375, height: 900, scale: 1 });
    await page.send('Page.navigate', { url: browserFixtureUrl('journey-operation') });
    await until('!!window.journeyOperationTest');
  }, 90000);
  afterAll(async () => {
    try { await page?.close(); }
    finally { vi.unstubAllEnvs(); }
  }, 20000);
  afterEach(async () => { await page.evaluate(`window.journeyOperationTest.metricsMode = 'empty'`); });

  it.each(['pending', 'conflict', 'invalid'] as const)('abandons %s only after confirmation, using the observed journal hash', async state => {
    await render(state);
    await click('Прекратить сохранение');
    expect(await page.evaluate('window.journeyOperationTest.actions')).toEqual([]);
    expect(await page.evaluate(`document.querySelector('.confirm-strip').textContent`)).toContain('Уже записанные файлы останутся как есть, оставшиеся изменения не будут записаны.');
    expect(await page.evaluate(`document.activeElement.textContent`)).toBe('Не прекращать');
    await click('Не прекращать');
    expect(await page.evaluate('window.journeyOperationTest.actions')).toEqual([]);
    await click('Прекратить сохранение');
    await page.callFunction('function(fresh) { window.journeyOperationTest.fresh = fresh; }', view(null));
    await click('Прекратить сохранение', '.confirm-strip');
    await until('window.journeyOperationTest.actions.length === 1');
    expect(await page.evaluate('window.journeyOperationTest.actions[0]')).toEqual({ action: 'abandon-journey-operation',
      journeyId: view().journeys![0].id, journalHash: 'observed-journal-hash', manifestHash: 'manifest-hash' });
    await until(`document.activeElement.classList.contains('journey-operation-notice')`);
  });
  it('finishes with update-journey even with no content changes and refreshes after a saved rejection', async () => {
    await render('pending');
    await page.callFunction(`function(fresh) { window.journeyOperationTest.fresh = fresh; window.journeyOperationTest.failure = {saved: true, message: 'Сохранение завершено, проверьте и повторите'}; }`, view(null));
    await click('Завершить сохранение');
    await until('window.journeyOperationTest.reads > 0');
    expect(await page.evaluate('window.journeyOperationTest.actions[0]')).toEqual(journeyRecoveryAction(view().journeys![0], 'manifest-hash'));
    expect(await page.evaluate(`document.querySelector('.journey-operation-notice').textContent`)).toContain('Сохранение завершено, проверьте и повторите');
  });
  it('refreshes conflicts without writing', async () => {
    await render('conflict'); await click('Обновить');
    await until('window.journeyOperationTest.reads > 0');
    expect(await page.evaluate('window.journeyOperationTest.actions')).toEqual([]);
  });
  it('shows recovery actions in the catalog too', async () => {
    await render('pending', 'catalog');
    expect(await page.evaluate(`document.querySelector('.journey-catalog .journey-operation-notice').getAttribute('role')`)).toBe('status');
    await click('Завершить сохранение');
    expect(await page.evaluate('window.journeyOperationTest.actions[0]')).toEqual(journeyRecoveryAction(view().journeys![0], 'manifest-hash'));
  });
  it('finishes from the editor without sending or discarding its unsaved draft', async () => {
    await render('pending', 'editor');
    await click('О Journey: название, описание, ссылка');
    await page.evaluate(`(() => { const input = document.querySelector('.journey-editor-settings input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'My draft'); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
    const recovered = view(null);
    recovered.journeys![0].fileHash = 'recovered-hash';
    recovered.journeys![0].version = 2;
    await page.callFunction('function(fresh) { window.journeyOperationTest.fresh = fresh; }', recovered);
    await click('Завершить сохранение');
    await until('window.journeyOperationTest.reads > 0');
    expect(await page.evaluate('window.journeyOperationTest.actions[0]')).toEqual(journeyRecoveryAction(view().journeys![0], 'manifest-hash'));
    expect(await page.evaluate(`document.querySelector('.journey-editor-settings input').value`)).toBe('My draft');
    await expectPageStateDuring(expression => page.evaluate(expression), 'window.journeyOperationTest.actions.length === 1', 550);
    expect(await page.evaluate('window.journeyOperationTest.actions.length')).toBe(1);
  });
  it.each(['pending', 'conflict', 'invalid'] as const)('locks step editing only for conflict/invalid, not %s', async state => {
    await render(state, 'editor');
    expect(await page.evaluate(`document.querySelector('.journey-add-step').disabled`)).toBe(state !== 'pending');
    await page.evaluate(`document.querySelector('.journey-mini').click()`);
    await until(`!!document.querySelector('.journey-step-sheet')`);
    expect(await page.evaluate(`document.querySelector('.journey-step-target select').disabled`)).toBe(state !== 'pending');
  });
  it('preserves an editor draft after a saved error, rereads and displays the server text', async () => {
    await render(null, 'editor');
    await click('О Journey: название, описание, ссылка');
    await page.callFunction(`function(fresh) { window.journeyOperationTest.fresh = fresh; window.journeyOperationTest.failure = { saved: true, message: 'Изменения Journey сохранены не полностью: steps/A.md' }; }`, view('conflict'));
    await page.evaluate(`(() => { const input = document.querySelector('.journey-editor-settings input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'My unsaved draft'); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
    await until('window.journeyOperationTest.actions.length === 1 && window.journeyOperationTest.reads > 0');
    expect(await page.evaluate(`document.querySelector('.journey-editor-settings input').value`)).toBe('My unsaved draft');
    expect(await page.evaluate(`document.querySelector('.journey-editor-error').textContent`)).toContain('Изменения Journey сохранены не полностью: steps/A.md');
    expect(await page.evaluate(`document.querySelector('.journey-operation-notice').getAttribute('role')`)).toBe('alert');
  });

  it('protects invalid step text on close and does not claim it was saved', async () => {
    await render(null, 'editor');
    await page.evaluate(`document.querySelector('.journey-mini').click()`);
    await until(`!!document.querySelector('.journey-step-sheet')`);
    await click('Изменить', '.journey-step-sheet');
    await page.evaluate(`(() => { const input = document.querySelector('.journey-step-sheet textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'X'.repeat(201)); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
    expect(await page.evaluate(`document.querySelector('.journey-step-feedback').textContent`)).not.toContain('Все изменения сохранены');
    expect(await page.evaluate(`document.querySelector('.journey-editor-footer').textContent`)).not.toContain('Все изменения сохранены');
    await click('Закрыть шаг');
    expect(await page.evaluate(`!!document.querySelector('.journey-step-sheet .confirm-strip')`)).toBe(true);
    await click('Продолжить правку', '.journey-step-sheet');
    expect(await page.evaluate(`document.querySelector('.journey-step-sheet textarea').value.length`)).toBe(201);
    await click('Закрыть шаг');
    await click('Отменить изменения', '.journey-step-sheet');
    expect(await page.evaluate(`!!document.querySelector('.journey-step-sheet')`)).toBe(false);
  });

  it('keeps Journey creation actions visible while the step list scrolls in a short touch viewport', async () => {
    const catalog = view(null);
    const step = catalog.journeys![0].steps[0];
    catalog.journeys![0].steps = Array.from({ length: 12 }, (_, index) => ({ ...step, id: `step-${index}`, title: `Step ${index}` }));
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 600, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      await page.callFunction('function(catalog) { window.journeyOperationTest.render(catalog, "apply"); }', catalog);
      await until(`!!document.querySelector('.journey-picker-footer')`);
      const measure = `(() => {
        const scroll = document.querySelector('.journey-picker-scroll');
        const header = document.querySelector('.journey-picker-heading').getBoundingClientRect();
        const footer = document.querySelector('.journey-picker-footer').getBoundingClientRect();
        return { scrollable: !!scroll && scroll.scrollHeight > scroll.clientHeight, headerTop: header.top, footerBottom: footer.bottom };
      })()`;
      const before = await page.evaluate(measure);
      expect(before.scrollable).toBe(true);
      expect(before.headerTop).toBeGreaterThanOrEqual(0);
      expect(before.footerBottom).toBeLessThanOrEqual(600);
      await page.evaluate(`document.querySelector('.journey-picker-scroll').scrollTop = 10000`);
      const after = await page.evaluate(measure);
      expect(after.headerTop).toBeCloseTo(before.headerTop, 0);
      expect(after.footerBottom).toBeCloseTo(before.footerBottom, 0);
      expect(await page.evaluate(`document.querySelector('.journey-picker-footer .action-mint').getBoundingClientRect().height`)).toBeGreaterThanOrEqual(44);
    } finally {
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 900, deviceScaleFactor: 1, mobile: false });
    }
  });

  it('asks before replacing a Journey and keeps the safe action as the default', async () => {
    const catalog = view(null);
    catalog.journeyTemplates = [{ id: 'template', source: 'project', title: 'Template', description: '', category: 'Test', tags: [], author: 'Team', updated: '2026-11-01', fileHash: 'template-hash', roles: [], zones: [], steps: [{ id: 'B', title: 'Build', roleId: '', dependsOn: [], markdown: '' }] }];
    await page.callFunction('function(catalog) { window.journeyOperationTest.render(catalog, "catalog"); }', catalog);
    await until(`!!document.querySelector('.journey-catalog-tile')`);
    await page.evaluate(`document.querySelector('.journey-catalog-tile').click()`);
    await until(`!!document.querySelector('.journey-catalog-replace')`);
    await page.evaluate(`document.querySelector('.journey-catalog-replace').click()`);
    expect(await page.evaluate('window.journeyOperationTest.imports.length')).toBe(0);
    const confirmation = await page.evaluate(`document.querySelector('.confirm-strip').textContent`);
    expect(confirmation).toContain('Journey «Production Journey»');
    expect(confirmation).toContain('удалено шагов: 1, зон: 1; добавлено шагов: 1, зон: 1');
    expect(confirmation).toContain('Будет создано колод: 0');
    expect(confirmation).toContain('Sub Cards не изменятся');
    expect(await page.evaluate(`document.activeElement.textContent`)).toBe('Вернуться');
    await click('Вернуться', '.confirm-strip');
    expect(await page.evaluate('window.journeyOperationTest.imports.length')).toBe(0);
    await page.evaluate(`document.querySelector('.journey-catalog-replace').click()`);
    await click('Заменить шаги', '.confirm-strip');
    await until('window.journeyOperationTest.imports.length === 1');
    expect(await page.evaluate('window.journeyOperationTest.imports[0][1]')).toBe('replace');
  });

  it('returns one level at a time with Escape and restores the opener', async () => {
    const catalog = view(null);
    catalog.journeyTemplates = [{ id: 'template', source: 'project', title: 'Template', description: '', category: 'Test', tags: [], author: 'Team', updated: '2026-11-01', fileHash: 'template-hash', roles: [], zones: [], steps: [{ id: 'B', title: 'Build', roleId: '', dependsOn: [], markdown: '' }] }];
    await page.callFunction('function(catalog) { window.journeyOperationTest.render(catalog, "editor"); }', catalog);
    await until(`!!document.querySelector('.journey-browse-button')`);
    await page.evaluate(`document.querySelector('.journey-browse-button').focus()`);
    for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: type === 'keyDown' ? '\r' : undefined });
    await until(`!!document.querySelector('.journey-catalog-tile')`);
    expect(await page.evaluate(`document.activeElement === document.querySelector('.journey-catalog-breadcrumbs > [aria-current="page"]')`)).toBe(true);
    for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    expect(await page.evaluate(`document.activeElement === document.querySelector('.journey-catalog-search input')`)).toBe(true);
    await page.evaluate(`document.querySelector('.journey-catalog-tile').focus()`);
    for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: type === 'keyDown' ? '\r' : undefined });
    await until(`!!document.querySelector('.journey-catalog-detail')`);
    expect(await page.evaluate(`document.activeElement === document.querySelector('.journey-catalog-detail-heading h2')`)).toBe(true);
    await page.evaluate(`document.querySelector('.journey-catalog-replace').click()`);
    await until(`!!document.querySelector('.confirm-strip')`);
    for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await until(`!document.querySelector('.confirm-strip')`);
    expect(await page.evaluate(`!!document.querySelector('.journey-catalog-detail')`)).toBe(true);
    expect(await page.evaluate('window.journeyOperationTest.actions.length')).toBe(0);
    for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await waitForLayout(expression => page.evaluate(expression), '#root');
    expect(await page.evaluate(`!!document.querySelector('.journey-catalog-tile')`)).toBe(true);
    expect(await page.evaluate(`document.activeElement.classList.contains('journey-catalog-tile')`)).toBe(true);
    for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await until(`!!document.querySelector('.journey-browse-button')`);
    await until(`document.activeElement.classList.contains('journey-browse-button')`);
  });

  it('keeps invalid step text through Escape and an outside click', async () => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    try {
      await render(null, 'editor');
      await page.evaluate(`document.querySelector('.journey-mini').click()`);
      await until(`!!document.querySelector('.journey-step-sheet')`);
      await click('Изменить', '.journey-step-sheet');
      await page.evaluate(`(() => { const input = document.querySelector('.journey-step-sheet textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Y'.repeat(201)); input.dispatchEvent(new Event('input', {bubbles:true})); input.focus(); })()`);
      for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await until(`!!document.querySelector('.journey-step-sheet .confirm-strip')`);
      await click('Продолжить правку', '.journey-step-sheet');
      for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: 1100, y: 400, button: 'left', clickCount: 1 });
      await until(`!!document.querySelector('.journey-step-sheet .confirm-strip')`);
      await click('Продолжить правку', '.journey-step-sheet');
      expect(await page.evaluate(`document.querySelector('.journey-step-sheet textarea').value.length`)).toBe(201);
    } finally {
      await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 900, deviceScaleFactor: 1, mobile: false });
    }
  });

  it('does not discard invalid step text through a remote conflict decision', async () => {
    const catalog = view(null);
    await page.callFunction('function(catalog) { window.journeyOperationTest.render(catalog, "editor"); }', catalog);
    await until(`!!document.querySelector('.journey-mini')`);
    await page.evaluate(`document.querySelector('.journey-mini').click()`);
    await until(`!!document.querySelector('.journey-step-sheet')`);
    await click('Изменить', '.journey-step-sheet');
    await page.evaluate(`(() => { const input = document.querySelector('.journey-step-sheet textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Z'.repeat(201)); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
    const remote = structuredClone(catalog);
    remote.journeys![0].fileHash = 'remote-hash';
    remote.journeys![0].version = 2;
    await page.callFunction('function(catalog) { window.journeyOperationTest.update(catalog); }', remote);
    await until(`!!document.querySelector('.journey-step-feedback .journey-editor-error')`);
    const disabled = await page.evaluate(`[...document.querySelectorAll('.journey-step-feedback button')].filter(button => ['Применить мои правки', 'Взять версию из файлов'].includes(button.textContent)).map(button => button.disabled)`);
    expect(disabled).toEqual([true, true]);
    expect(await page.evaluate(`document.querySelector('.journey-step-sheet textarea').value.length`)).toBe(201);
  });

  it('shows one import error beside the preserved mapping', async () => {
    const catalog = view(null);
    catalog.journeyTemplates = [{ id: 'template', source: 'project', title: 'Template', description: '', category: 'Test', tags: [], author: 'Team', updated: '2026-11-01', fileHash: 'template-hash', roles: [{ id: 'work', title: 'Work' }], zones: [], steps: [{ id: 'B', title: 'Build', roleId: 'work', dependsOn: [], markdown: '' }] }];
    await page.callFunction('function(catalog) { window.journeyOperationTest.render(catalog, "editor"); }', catalog);
    await until(`!!document.querySelector('.journey-browse-button')`);
    await page.evaluate(`document.querySelector('.journey-browse-button').click()`);
    await until(`!!document.querySelector('.journey-catalog-tile')`);
    await page.evaluate(`document.querySelector('.journey-catalog-tile').click()`);
    await until(`!!document.querySelector('.journey-catalog-mapping-toggle')`);
    await page.evaluate(`document.querySelector('.journey-catalog-mapping-toggle').click()`);
    await page.evaluate(`(() => { const select = document.querySelector('.journey-catalog-role select'); select.value = 'work'; select.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    await page.evaluate(`window.journeyOperationTest.failure = new Error('Import failed: check files')`);
    await page.evaluate(`document.querySelector('.journey-catalog-add').click()`);
    await until(`!!document.querySelector('.journey-catalog-error')`);
    expect(await page.evaluate(`document.querySelectorAll('[role="alert"]').length`)).toBe(1);
    expect(await page.evaluate(`document.querySelector('[role="alert"]').textContent`)).toContain('Import failed: check files');
    expect(await page.evaluate(`document.querySelector('[role="alert"]').textContent`)).toContain('Перед повтором проверьте Journey и колоды');
    expect(await page.evaluate(`document.querySelector('.journey-catalog-role select').value`)).toBe('work');
  });

  it('keeps import actions visible while five roles scroll in a short touch viewport', async () => {
    const catalog = view(null);
    const roles = Array.from({ length: 5 }, (_, index) => ({ id: `role-${index}`, title: `Role ${index}` }));
    catalog.journeyTemplates = [{ id: 'template', source: 'project', title: 'Template', description: '', category: 'Test', tags: [], author: 'Team', updated: '2026-11-01', fileHash: 'template-hash', roles, zones: [], steps: [{ id: 'B', title: 'Build', roleId: roles[0].id, dependsOn: [], markdown: '' }] }];
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 600, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      await page.callFunction('function(catalog) { window.journeyOperationTest.render(catalog, "editor"); }', catalog);
      await until(`!!document.querySelector('.journey-browse-button')`);
      await page.evaluate(`document.querySelector('.journey-browse-button').click()`);
      await until(`!!document.querySelector('.journey-catalog-tile')`);
      await page.evaluate(`document.querySelector('.journey-catalog-tile').click()`);
      await until(`!!document.querySelector('.journey-catalog-mapping-toggle')`);
      await page.evaluate(`document.querySelector('.journey-catalog-mapping-toggle').click()`);
      const layout = await page.evaluate(`(() => { const footer = document.querySelector('.journey-catalog-import'); const shell = document.querySelector('.journey-editor-shell'); const actions = document.querySelector('.journey-catalog-import-actions'); const roles = document.querySelector('.journey-catalog-roles'); const add = document.querySelector('.journey-catalog-add'); return {footer: footer.getBoundingClientRect().bottom, shell: shell.getBoundingClientRect().bottom, actions: actions.getBoundingClientRect().bottom, scrollable: roles.scrollHeight > roles.clientHeight, buttonHeight: add.getBoundingClientRect().height}; })()`);
      expect(layout.scrollable).toBe(true);
      expect(layout.actions).toBeLessThanOrEqual(layout.footer + 1);
      expect(layout.actions).toBeLessThanOrEqual(layout.shell + 1);
      expect(layout.buttonHeight).toBeGreaterThanOrEqual(44);
    } finally {
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 900, deviceScaleFactor: 1, mobile: false });
    }
  });

  it.each([[1, 'Будет создана 1 колода'], [2, 'Будут созданы 2 колоды'], [5, 'Будет создано 5 колод']] as const)('states that %s mapped decks will be created', async (count, expected) => {
    const catalog = view(null);
    const roles = Array.from({ length: count }, (_, index) => ({ id: `role-${index}`, title: `Role ${index}` }));
    catalog.journeyTemplates = [{ id: 'template', source: 'project', title: 'Template', description: '', category: 'Test', tags: [], author: 'Team', updated: '2026-11-01', fileHash: 'template-hash', roles, zones: [], steps: [{ id: 'B', title: 'Build', roleId: roles[0].id, dependsOn: [], markdown: '' }] }];
    await page.callFunction('function(catalog) { window.journeyOperationTest.render(catalog, "catalog"); }', catalog);
    await until(`!!document.querySelector('.journey-catalog-tile')`);
    await page.evaluate(`document.querySelector('.journey-catalog-tile').click()`);
    await until(`!!document.querySelector('.journey-catalog-import-actions > span')`);
    expect(await page.evaluate(`document.querySelector('.journey-catalog-import-actions > span').textContent`)).toBe(expected);
  });

  it('shows metrics loading and can retry a failed request without reopening the editor', async () => {
    await page.callFunction('function(catalog) { window.journeyOperationTest.metricsMode = "pending"; window.journeyOperationTest.render(catalog, "editor"); }', view(null));
    await until(`!!document.querySelector('.journey-editor-dialog')`);
    expect(await page.evaluate(`!!document.querySelector('.journey-metrics-toggle')`)).toBe(true);
    await page.evaluate(`document.querySelector('.journey-metrics-toggle').click()`);
    expect(await page.evaluate(`document.querySelector('.journey-metrics [role="status"]').textContent`)).toContain('Обновляем метрики');
    await page.callFunction('function(catalog) { window.journeyOperationTest.metricsMode = "error"; window.journeyOperationTest.render(catalog, "editor"); }', view(null));
    await until(`!!document.querySelector('.journey-metrics-toggle')`);
    await page.evaluate(`document.querySelector('.journey-metrics-toggle').click()`);
    await until(`!!document.querySelector('.journey-metrics [role="alert"]')`);
    expect(await page.evaluate(`document.querySelector('.journey-metrics [role="alert"]').textContent`)).toContain('Metrics unavailable');
    await page.evaluate(`window.journeyOperationTest.metricsMode = 'data'`);
    await click('Повторить', '.journey-metrics');
    await until(`!!document.querySelector('.journey-metrics tbody tr')`);
    expect(await page.evaluate(`document.querySelector('.journey-metrics tbody').textContent`)).toContain('Plan');
  });

  it('marks previous metrics as stale while refreshing and after a failed refresh', async () => {
    const catalog = view(null);
    const hero = catalog.cards[0];
    catalog.cards.push({ ...hero, id: 'task', kind: 'task', parentId: hero.id, state: 'started', journey: { journeyId: catalog.journeys![0].id, version: 1, stepId: 'A', instanceId: 'run' } });
    await page.callFunction('function(catalog) { window.journeyOperationTest.metricsMode = "data"; window.journeyOperationTest.render(catalog, "editor"); }', catalog);
    await until(`!!document.querySelector('.journey-metrics-toggle')`);
    await page.evaluate(`document.querySelector('.journey-metrics-toggle').click()`);
    await until(`!!document.querySelector('.journey-metrics tbody tr')`);
    const changed = structuredClone(catalog);
    changed.cards[1].state = 'review';
    await page.callFunction('function(catalog) { window.journeyOperationTest.metricsMode = "pending"; window.journeyOperationTest.update(catalog); }', changed);
    await until(`!!document.querySelector('.journey-metrics [role="status"]')`);
    expect(await page.evaluate(`document.querySelector('.journey-metrics').textContent`)).toContain('метрики могут быть неактуальны');
    expect(await page.evaluate(`document.querySelector('.journey-metrics tbody').textContent`)).toContain('Plan');
    changed.cards[1].state = 'done';
    await page.callFunction('function(catalog) { window.journeyOperationTest.metricsMode = "error"; window.journeyOperationTest.update(catalog); }', changed);
    await until(`!!document.querySelector('.journey-metrics [role="alert"]')`);
    expect(await page.evaluate(`document.querySelector('.journey-metrics').textContent`)).toContain('метрики могут быть неактуальны');
    expect(await page.evaluate(`document.querySelector('.journey-metrics tbody').textContent`)).toContain('Plan');
  });

  it('inspects without changing selection and announces dependent deselection', async () => {
    const catalog = view(null);
    catalog.journeys![0].steps.push({ ...catalog.journeys![0].steps[0], id: 'B', title: 'Build', dependsOn: ['A'] });
    await page.callFunction('function(catalog) { window.journeyOperationTest.render(catalog); }', catalog);
    await until(`document.querySelectorAll('.journey-step-card').length === 2`);
    await page.evaluate(`document.querySelectorAll('.journey-step-card')[1].click()`);
    expect(await page.evaluate(`document.querySelector('.journey-picker-footer [role="status"]').textContent`)).toContain('2 новые карточки');
    await page.evaluate(`document.querySelector('.journey-picker-grid input[type="checkbox"]').click()`);
    expect(await page.evaluate(`document.querySelector('.journey-picker-footer [role="status"]').textContent`)).toContain('0 новых карточек');
    expect(await page.evaluate(`document.querySelector('.journey-picker-selection-notice').textContent`)).toContain('Build');
  });

  it('shows only the selected Journey’s versions when changing the picker', async () => {
    const catalog = view(null);
    const first = catalog.journeys![0];
    const second = { ...first, id: '22222222-2222-4222-8222-222222222222', title: 'Another Journey', version: 3 };
    catalog.journeys!.push(second);
    const hero = catalog.cards[0];
    catalog.cards.push({ ...hero, id: 'first-step', kind: 'task', parentId: hero.id, journey: { journeyId: first.id, version: 1, stepId: 'A', instanceId: 'first' } });
    catalog.cards.push({ ...hero, id: 'second-step', kind: 'task', parentId: hero.id, journey: { journeyId: second.id, version: 2, stepId: 'A', instanceId: 'second' } });
    await page.callFunction('function(catalog) { window.journeyOperationTest.render(catalog); }', catalog);
    await until(`!!document.querySelector('.journey-picker-controls select')`);
    expect(await page.evaluate(`document.querySelector('.journey-apply').textContent`)).toContain('этого Journey: v1');
    await page.callFunction(`function(id) { const select = document.querySelector('.journey-picker-controls select'); select.value = id; select.dispatchEvent(new Event('change', {bubbles:true})); }`, second.id);
    expect(await page.evaluate(`document.querySelector('.journey-apply').textContent`)).toContain('этого Journey: v2');
    expect(await page.evaluate(`document.querySelector('.journey-apply').textContent`)).not.toContain('этого Journey: v1');
  });

  it('saves steps in the new visual zone order', async () => {
    const catalog = view(null);
    const journey = catalog.journeys![0];
    journey.zones = [{ id: 'a', title: 'Zone A' }, { id: 'b', title: 'Zone B' }];
    journey.steps = [{ ...journey.steps[0], zoneId: 'a' }, { ...journey.steps[0], id: 'B', title: 'Build', zoneId: 'b' }];
    await page.callFunction('function(catalog) { window.journeyOperationTest.render(catalog, "editor"); }', catalog);
    await until(`document.querySelectorAll('.journey-zone').length === 2`);
    await click('Зону Zone A вниз');
    await until('window.journeyOperationTest.actions.length > 0');
    expect(await page.evaluate(`window.journeyOperationTest.actions[0].steps.map(step => step.id)`)).toEqual(['B', 'A']);
  });

  it('keeps long zone names and touch controls visible without overlapping', async () => {
    const catalog = view(null);
    catalog.journeys![0].zones = [{ id: 'default', title: 'Long zone name '.repeat(8) }];
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      await page.callFunction('function(catalog) { window.journeyOperationTest.render(catalog, "editor"); }', catalog);
      await until(`!!document.querySelector('.journey-zone-heading')`);
      const result = await page.evaluate(`(() => {
        const heading = document.querySelector('.journey-zone-heading').getBoundingClientRect();
        const title = document.querySelector('.journey-zone-heading h3').getBoundingClientRect();
        const cards = document.querySelector('.journey-zone-cards').getBoundingClientRect();
        const select = document.querySelector('.journey-step-select').getBoundingClientRect();
        const handle = document.querySelector('.journey-drag-handle').getBoundingClientRect();
        return { headingBottom: heading.bottom, titleBottom: title.bottom, cardsTop: cards.top,
          select: {left: select.left, right: select.right, width: select.width, height: select.height},
          handle: {left: handle.left, width: handle.width, height: handle.height},
          toolsOpacity: getComputedStyle(document.querySelector('.journey-zone-tools')).opacity,
          handleOpacity: getComputedStyle(document.querySelector('.journey-drag-handle')).opacity,
          pressed: document.querySelector('.journey-mini').getAttribute('aria-pressed') };
      })()`);
      expect(result.titleBottom).toBeLessThanOrEqual(result.headingBottom + 1);
      expect(result.headingBottom).toBeLessThanOrEqual(result.cardsTop + 1);
      expect(result.select.width).toBeGreaterThanOrEqual(44);
      expect(result.select.height).toBeGreaterThanOrEqual(44);
      expect(result.handle.width).toBeGreaterThanOrEqual(44);
      expect(result.handle.height).toBeGreaterThanOrEqual(44);
      expect(result.select.right).toBeLessThanOrEqual(result.handle.left);
      expect(result.toolsOpacity).toBe('1');
      expect(result.handleOpacity).toBe('1');
      expect(result.pressed).toBeNull();
    } finally {
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
  });

  it('drags a step by its touch handle without opening the card', async () => {
    const catalog = view(null);
    const journey = catalog.journeys![0];
    journey.steps.push({ ...journey.steps[0], id: 'B', title: 'Build' });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      await page.callFunction('function(catalog) { window.journeyOperationTest.render(catalog, "editor"); }', catalog);
      await until(`document.querySelectorAll('.journey-sortable-step').length === 2`);
      await waitForLayout(expression => page.evaluate(expression), '.journey-sortable-step');
      const points = await page.evaluate(`(() => { const cards = document.querySelectorAll('.journey-sortable-step'); const source = cards[1].querySelector('.journey-drag-handle').getBoundingClientRect(); const target = cards[0].getBoundingClientRect(); return { start: { x: source.x + source.width / 2, y: source.y + source.height / 2 }, end: { x: target.x + target.width / 2, y: target.y + target.height / 2 } }; })()`);
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...points.start, id: 1 }] });
      await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: points.start.x - 20, y: points.start.y, id: 1 }] });
      await until(`!!document.querySelector('.journey-sortable-step.is-dragging')`);
      await page.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      await until(`!document.querySelector('.journey-sortable-step.is-dragging')`);
      expect(await page.evaluate('window.journeyOperationTest.actions.length')).toBe(0);
      await waitForLayout(expression => page.evaluate(expression), '.journey-sortable-step');
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...points.start, id: 1 }] });
      for (let index = 1; index <= 20; index++) {
        await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: points.start.x + (points.end.x - points.start.x) * index / 20, y: points.start.y + (points.end.y - points.start.y) * index / 20, id: 1 }] });
        await delay(20);
      }
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await until('window.journeyOperationTest.actions.length > 0');
      expect(await page.evaluate(`window.journeyOperationTest.actions[0].steps.map(step => step.id)`)).toEqual(['B', 'A']);
      expect(await page.evaluate(`!!document.querySelector('.journey-step-sheet')`)).toBe(false);
    } finally {
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
  });

  it('scrolls over a step face on touch without starting a drag', async () => {
    const catalog = view(null);
    const journey = catalog.journeys![0];
    journey.steps = Array.from({ length: 15 }, (_, index) => ({ ...journey.steps[0], id: `step-${index}`, title: `Step ${index}` }));
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 600, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      await page.callFunction('function(catalog) { window.journeyOperationTest.render(catalog, "editor"); }', catalog);
      await until(`document.querySelectorAll('.journey-sortable-step').length === 15`);
      await waitForLayout(expression => page.evaluate(expression), '.journey-sortable-step');
      const point = await page.evaluate(`(() => { const box = document.querySelector('.journey-mini').getBoundingClientRect(); return {x: box.x + box.width / 2, y: box.y + box.height * .7}; })()`);
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
      for (let index = 1; index <= 10; index++) {
        await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y - index * 12, id: 1 }] });
        await delay(20);
      }
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await until(`document.querySelector('.journey-editor-body').scrollTop > 0`);
      expect(await page.evaluate('window.journeyOperationTest.actions.length')).toBe(0);
      expect(await page.evaluate(`!!document.querySelector('.journey-step-sheet')`)).toBe(false);
    } finally {
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 900, deviceScaleFactor: 1, mobile: false });
    }
  });
});
