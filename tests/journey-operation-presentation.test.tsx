import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CatalogJourney, CatalogView } from '../src/catalog-contracts.ts';
import { setLang } from '../client/i18n.ts';
import { JourneyOperationNotice, JourneyOption, journeyRecoveryAction } from '../client/components/JourneyOperationNotice.tsx';
import { ApplyJourneyPanel } from '../client/components/JourneyPanel.tsx';

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
    expect(html).toMatch(/title="Завершите или прекратите[^"]+" disabled=""/u);
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
  it('distinguishes previous and current Journey versions from ordinary Sub Cards', () => {
    const catalog = view(null);
    const journey = catalog.journeys![0];
    journey.version = 2;
    const hero = catalog.cards[0];
    catalog.cards.push({ ...hero, id: 'old', kind: 'task', parentId: hero.id, journey: { journeyId: journey.id, version: 1, stepId: 'A', instanceId: 'old-instance' } });
    catalog.cards.push({ ...hero, id: 'ordinary', kind: 'task', parentId: hero.id });
    catalog.cards.push({ ...hero, id: 'other', kind: 'task', parentId: hero.id, journey: { journeyId: 'other-journey', version: 99, stepId: 'A', instanceId: 'other-instance' } });
    for (const lang of ['ru', 'en'] as const) {
      setLang(lang);
      const render = () => renderToStaticMarkup(<ApplyJourneyPanel catalog={catalog} card={hero} source="sandbox" pending={false} writable onEdit={async () => true} onClose={() => {}} />);
      const fresh = render();
      expect(fresh).toContain('v1.');
      expect(fresh).toContain(lang === 'ru' ? 'отдельный набор' : 'separate set');
      expect(fresh).not.toContain('v99');
      catalog.cards.push({ ...catalog.cards[1], id: 'current', journey: { ...catalog.cards[1].journey!, version: 2, instanceId: 'current-instance' } });
      const repeated = render();
      expect(repeated).toContain('v1, v2');
      expect(repeated).toContain(lang === 'ru' ? 'не создаст дубликаты' : 'does not create duplicates');
      catalog.cards.pop();
    }
  });
  it.each(['live', 'sandbox'] as const)('uses neutral read-only wording for %s', source => {
    const catalog = view(null);
    setLang('ru');
    const html = renderToStaticMarkup(<ApplyJourneyPanel catalog={catalog} card={catalog.cards[0]} source={source} pending={false} writable={false} onEdit={async () => true} onClose={() => {}} />);
    expect(html).toContain('Проект открыт только для чтения.');
    expect(html).not.toContain('sandbox');
    expect(html).not.toContain('тестовую копию');
  });
  it('presents steps in zone order even when the saved step array differs', () => {
    const catalog = view(null);
    const journey = catalog.journeys![0];
    journey.zones = [{ id: 'b', title: 'Zone B' }, { id: 'a', title: 'Zone A' }];
    journey.steps = [{ ...journey.steps[0], zoneId: 'a' }, { ...journey.steps[0], id: 'B', title: 'Build', zoneId: 'b' }];
    setLang('en');
    const html = renderToStaticMarkup(<ApplyJourneyPanel catalog={catalog} card={catalog.cards[0]} source="sandbox" pending={false} writable onEdit={async () => true} onClose={() => {}} />);
    expect(html.indexOf('aria-label="Build — show details"')).toBeLessThan(html.indexOf('aria-label="Plan — show details"'));
    expect(html).toContain('aria-label="Build — show details"');
    expect(html).toContain('aria-label="Plan — show details"');
  });
  it('sends the full observed snapshot, not a no-op skipped by the editor', () => {
    const catalog = view();
    expect(journeyRecoveryAction(catalog.journeys![0], catalog.manifestHash)).toEqual({ action: 'update-journey',
      journeyId: catalog.journeys![0].id, journeyHash: 'journey-hash', manifestHash: 'manifest-hash',
      title: 'Production Journey', description: 'Description', zones: [], steps: catalog.journeys![0].steps });
  });
});
