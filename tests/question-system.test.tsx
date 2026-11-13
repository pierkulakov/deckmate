import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CatalogCard, CatalogView } from '../src/catalog-contracts.ts';
import { shortReference } from '../src/references.ts';
import { decisionsOf, pendingDecisions, pendingDecisionsOf, targetDetails, waitingOn, type Decision } from '../client/question-model.ts';
import { DecisionPool } from '../client/components/DecisionPool.tsx';
import { setLang } from '../client/i18n.ts';

vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
});

beforeEach(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  setLang('ru');
});

const decision = (changes: Partial<Decision> = {}): Decision => ({ index: 0, question: 'Как?', answer: 'Так.', by: 'Майя', date: '2026-11-12', target: null, applied: null, ...changes });
const card = (id: string, changes: object = {}): CatalogCard => ({ id, title: id, kind: 'task', path: 'cards/test.md', version: null, state: 'started', owner: null,
  markdown: '', sourceHash: 'hash', range: null, deckId: null, trackIds: [], parentId: null, ...changes });
const catalog = (cards: CatalogCard[]): CatalogView => ({ rootIdentity: 'root', documents: [], cards, spaces: [], decks: [], tracks: [], warnings: [], formatLanguage: 'ru', manifestHash: 'hash', configured: true, indexedAt: '' });

it('counts only active cards and unapplied decisions in the board pool', () => {
  const cards = [card('a', { decisions: [decision(), decision({ index: 1, applied: '2026-11-12' })] }), card('b', { archived: true, decisions: [decision()] }), card('c', { deleted: true, decisions: [decision()] })];
  expect(pendingDecisions(catalog(cards))).toHaveLength(1);
  const html = renderToStaticMarkup(<DecisionPool catalog={catalog(cards)} onOpen={() => {}} />);
  expect(html).toContain('Так.');
  expect(html).toContain('Вопрос: Как?');
  expect(html).not.toContain('Внести в:');
  expect(html).toContain('Ответ: Майя');
  expect(html).toContain('2026-11-12');
  expect(html).toContain('Агент автоматически не запускается');
  expect(renderToStaticMarkup(<DecisionPool catalog={catalog([card('d')])} onOpen={() => {}} />)).toContain('ответы, которые ещё нужно внести');
});

it('keeps legacy pending answers and their original card and decision in order', () => {
  const entries = [decision(), decision({ index: 1, question: null }), decision({ index: 2, applied: '' }),
    decision({ index: 3, applied: '2026-11-12' }), decision({ index: 4, question: null, applied: '2026-11-12' })];
  const source = card('source', { decisions: entries });
  const archived = card('archived', { archived: true, decisions: entries });
  const pending = pendingDecisions(catalog([source, archived]));
  expect(pending.map(entry => entry.decision)).toEqual(entries.slice(0, 3));
  pending.forEach((entry, index) => {
    expect(entry.card).toBe(source);
    expect(entry.decision).toBe(entries[index]);
  });
  expect(pendingDecisionsOf(archived)).toEqual(entries.slice(0, 3));
});

it('resolves targets, tolerates missing references and describes who a task waits for', () => {
  const source = card('a', { openQuestions: [{ text: 'Как?', taskRef: null, assignee: 'agent' }] });
  const target = card('b', { title: 'Правила боя' });
  const view = catalog([source, target]);
  expect(targetDetails(shortReference('c', target.id) + '#Камера', source, view, 'ru').label).toBe('Правила боя § Камера');
  expect(targetDetails(shortReference('c', target.id) + '#Камера', source, view, 'en')).toMatchObject({ caption: 'Apply to: Правила боя § Камера', isCurrent: false });
  expect(targetDetails(null, source, view, 'ru')).toMatchObject({ label: 'a', isCurrent: true });
  expect(targetDetails(shortReference('c', source.id) + '#Камера', source, view, 'ru').isCurrent).toBe(true);
  expect(targetDetails('c-1234567890#%broken', source, view, 'ru').label).toBe('c-1234567890 § %broken');
  expect(waitingOn(source, [{ id: 'agent', label: 'Агент', kind: 'agent', aliases: [] }], 'ru')).toBe('Ждёт ответа: @Агент');
  expect(waitingOn({ ...source, kind: 'doc' }, [], 'ru')).toBe('');
  const unanswered = { ...source, openQuestions: [{ text: 'Как?', taskRef: null, assignee: null, target: null }] };
  expect(waitingOn(unanswered, [], 'en')).toBe('Waiting on an answer');
  expect(waitingOn({ ...source, openQuestions: [] }, [], 'en')).toBe('');
  const repeated = { ...source, openQuestions: [
    { text: 'First', taskRef: null, assignee: 'agent', target: null },
    { text: 'Second', taskRef: null, assignee: null, target: null },
    { text: 'Third', taskRef: null, assignee: 'agent', target: null },
    { text: 'Fourth', taskRef: null, assignee: 'other', target: null },
  ] };
  expect(waitingOn(repeated, [{ id: 'agent', label: 'Builder', kind: 'agent', aliases: [] }], 'en')).toBe('Waiting on @Builder, @other');
});

it('names other targets but omits the source target even when it has a section', () => {
  const target = card('target', { title: 'Target card' });
  const source = card('source', { title: 'Source card', decisions: [decision({ target: shortReference('c', 'source') + '#section' }),
    decision({ index: 1, target: shortReference('c', target.id) + '#notes' }), decision({ index: 2, target: 'c-1234567890' })] });
  const html = renderToStaticMarkup(<DecisionPool catalog={catalog([source, target])} onOpen={() => {}} />);
  expect(html).not.toContain('Внести в: Source card');
  expect(html).not.toContain('§ section');
  expect(html).toContain('Внести в: Target card § notes');
  expect(html).toContain('Внести в: c-1234567890');
});

it('groups decisions by source card and describes missing metadata in English', () => {
  setLang('en');
  const cards = [card('source', { title: 'Source card', decisions: [decision({ question: null, by: null, date: null }), decision({ index: 1 })] }),
    card('other', { title: 'Other card', decisions: [decision()] })];
  const html = renderToStaticMarkup(<DecisionPool catalog={catalog(cards)} onOpen={() => {}} />);
  expect(html.match(/class="decision-pool-group"/gu)).toHaveLength(2);
  expect(html.match(/<li>/gu)).toHaveLength(3);
  expect(html).toContain('aria-label="Source card"');
  expect(html).toContain('Question not recorded');
  expect(html).toContain('Author not recorded');
  expect(html).toContain('Date not recorded');
  expect(html).toContain('No deck');
});

it('retains legacy decisions if no projected array is present', () => {
  const legacy = card('legacy', { markdown: '## Open questions\n\n## Decided\n\n- An answer — Maya, 2026-11-12\n' });
  expect(decisionsOf(legacy).map(entry => entry.answer)).toEqual(['An answer']);
  expect(pendingDecisions(catalog([legacy]))[0].decision).toBe(decisionsOf(legacy)[0]);
  expect(decisionsOf({ ...legacy, decisions: [] })).toEqual([]);
});
