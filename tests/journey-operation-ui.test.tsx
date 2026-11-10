import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';
import { expectPageStateDuring, waitForLayout } from './browser-layout.ts';
import type { CatalogJourney, CatalogView } from '../src/catalog-contracts.ts';
import { setLang } from '../client/i18n.ts';
import { JourneyOperationNotice, JourneyOption, journeyRecoveryAction } from '../client/components/JourneyOperationNotice.tsx';
import { ApplyJourneyPanel } from '../client/components/JourneyPanel.tsx';
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

describe('unfinished Journey presentation', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('location', { origin: 'http://localhost' });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
  });
  afterEach(() => vi.unstubAllGlobals());
  it.each([
    ['pending', 'status', 'Предыдущее сохранение Journey не завершилось.', 'The previous Journey save did not finish.'],
    ['conflict', 'alert', 'Сохранение остановлено: файл изменён вне этого сохранения.', 'Saving stopped because a file was changed outside this save.'],
    ['invalid', 'alert', 'Не удалось прочитать незавершённое сохранение Journey.', 'The unfinished Journey save cannot be read.'],
  ] as const)('renders %s calmly in both languages, with role and file', (state, role, ru, en) => {
    const catalog = view(state);
    for (const [lang, message] of [['ru', ru], ['en', en]] as const) {
      setLang(lang);
      const html = renderToStaticMarkup(<JourneyOperationNotice journey={catalog.journeys![0]} catalog={catalog} source="sandbox" writable onEdit={async () => true} />);
      expect(html).toContain(`role="${role}"`);
      expect(html).toContain(message);
      expect(html.includes('steps/A.md')).toBe(state === 'conflict');
      expect(html.includes(lang === 'ru' ? 'Завершить сохранение' : 'Finish saving')).toBe(state === 'pending');
      expect(renderToStaticMarkup(<JourneyOption journey={catalog.journeys![0]} />)).toContain(lang === 'ru' ? 'Сохранение не завершено' : 'Unfinished save');
    }
  });
  it.each(['pending', 'conflict', 'invalid'] as const)('blocks applying %s with an explanation', state => {
    setLang('ru');
    const catalog = view(state);
    const html = renderToStaticMarkup(<ApplyJourneyPanel catalog={catalog} card={catalog.cards[0]} source="sandbox" pending={false} writable onEdit={async () => true} onClose={() => {}} />);
    expect(html).toMatch(/title="Завершите или бросьте[^"]+" disabled=""/u);
    expect(html).toContain('Создать 1 карточку');
    expect(html).toContain('journey-picker-details glass-panel');
    expect(html).toContain('journey-picker-footer dialog-foot');
    expect(html).toContain('action-mint');
  });
  it('uses the shared first-run state when the deck has no Journey', () => {
    setLang('ru');
    const catalog = view(null);
    catalog.journeys = [];
    const html = renderToStaticMarkup(<ApplyJourneyPanel catalog={catalog} card={catalog.cards[0]} source="sandbox" pending={false} writable onEdit={async () => true} onClose={() => {}} onManageJourney={() => {}} />);
    expect(html).toContain('ui-empty-first-run');
    expect(html).toContain('Journey ещё нет');
    expect(html).toContain('Создать Journey');
  });
  it('sends the full observed snapshot, not a no-op skipped by the editor', () => {
    const catalog = view();
    expect(journeyRecoveryAction(catalog.journeys![0], catalog.manifestHash)).toEqual({ action: 'update-journey',
      journeyId: catalog.journeys![0].id, journeyHash: 'journey-hash', manifestHash: 'manifest-hash',
      title: 'Production Journey', description: 'Description', zones: [], steps: catalog.journeys![0].steps });
  });
});

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

  it.each(['pending', 'conflict', 'invalid'] as const)('abandons %s only after confirmation, using the observed journal hash', async state => {
    await render(state);
    await click('Бросить незавершённое сохранение');
    expect(await page.evaluate('window.journeyOperationTest.actions')).toEqual([]);
    expect(await page.evaluate(`document.querySelector('.confirm-strip').textContent`)).toContain('Файлы останутся как есть, ничего не откатывается. Несохранённая часть правки потеряна.');
    expect(await page.evaluate(`document.activeElement.textContent`)).toBe('Оставить незавершённое сохранение');
    await click('Оставить незавершённое сохранение');
    expect(await page.evaluate('window.journeyOperationTest.actions')).toEqual([]);
    await click('Бросить незавершённое сохранение');
    await page.callFunction('function(fresh) { window.journeyOperationTest.fresh = fresh; }', view(null));
    await click('Бросить незавершённое сохранение', '.confirm-strip');
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
});
