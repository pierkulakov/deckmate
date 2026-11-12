import { createRoot } from 'react-dom/client';
import { Deck } from '../../client/components/Deck.tsx';
import { setLang } from '../../client/i18n.ts';
import { catalogStore } from '../../client/catalog-store.ts';
import { shortReference } from '../../src/references.ts';
import type { CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import '../../client/styles.css';
import '../../client/card-material.css';
import '../../client/motion.css';

const root = createRoot(document.getElementById('root')!);
const requests: unknown[] = [];
let instance = 0;
const base: CatalogCard = { id: 'card:hero', kind: 'hero', title: 'Test Hero', path: 'cards/hero.md', version: null,
  state: null, owner: null, markdown: '', sourceHash: 'hero-hash', range: null, deckId: 'mixed', trackIds: [], parentId: null };
const child = (id: string, title: string, state: CatalogCard['state']): CatalogCard => ({ ...base, id: 'card:' + id,
  kind: 'task', title, state, path: `cards/${id}.md`, parentId: base.id, markdown: 'Sub Card content.',
  journey: { journeyId: 'pipeline', version: 1, stepId: id, instanceId: 'run' } });
const children = [child('design', 'Design Hero', 'done'), child('build', 'Build Hero', 'started'), child('review', 'Review Hero', 'not-started')];
const link = (card: CatalogCard) => `[${card.title}](/r/${shortReference('c', card.id)}?source=sandbox)`;
children[1].markdown += '\n\n' + link(children[2]);
const buildMarkdown = children[1].markdown;
children[1].tags = ['related'];
const hero: CatalogCard = { ...base, markdown: Array.from({ length: 24 }, (_, index) => `Paragraph ${index + 1}: the Hero keeps its reading position.`).join('\n\n') + '\n\n' + link(children[0]) };
const catalog: CatalogView = { rootIdentity: 'hero-return-test', documents: [], cards: [hero, ...children],
  spaces: [{ id: 'work', title: 'Work' }],
  decks: ['mixed', 'other'].map(id => ({ id, title: id, kind: 'mixed', spaceId: 'work', description: '', color: '#446688', icon: 'box' })),
  tracks: [], warnings: [], formatLanguage: 'en', manifestHash: 'manifest-hash', optionsHash: 'options-hash', configured: true, indexedAt: '',
  members: [{ id: 'alex', label: 'Alex', kind: 'human', aliases: [] }], runs: [], milestones: [],
  projectTags: [{ name: 'related', color: '#687e9c', cardId: children[2].id }, { name: 'unlinked', color: '#687e9c', emoji: '🌊' }],
  journeys: [{ id: 'pipeline', title: 'Hero pipeline', version: 1, deckId: 'mixed', path: 'journeys/pipeline/index.md', fileHash: 'journey-hash',
    steps: children.map(card => ({ id: card.journey!.stepId, title: card.title, markdown: '', deckId: 'mixed', owner: null, dependsOn: [] })) }] };

// 2026-11-08: the real Deck owns navigation and Escape; only the HTTP data source is a fixture.
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin);
  if (url.pathname === '/api/catalog') {
    if (init?.method === 'POST') requests.push(JSON.parse(String(init.body)));
    return Response.json(catalog);
  }
  if (url.pathname === '/api/card-content') {
    const card = catalog.cards.find(card => card.id === url.searchParams.get('cardId'))!;
    return Response.json({ cardId: card.id, title: card.title, markdown: card.markdown, sourceHash: card.sourceHash });
  }
  if (url.pathname === '/api/notifications') return Response.json({ watching: [], watchHash: 'watch-hash' });
  if (url.pathname === '/api/attachments') return Response.json({ hash: '', files: [], warnings: [] });
  return Response.json({ files: [], warnings: [], events: [], nextCursor: null, created: null });
};

async function render(options: { card?: string; query?: string; lang?: 'en' | 'ru'; theme?: 'light' | 'dark'; width?: number; longContent?: boolean;
  kind?: CatalogCard['kind']; tags?: string[]; withoutJourney?: boolean; review?: boolean; family?: boolean } = {}) {
  requests.length = 0;
  children[2].state = options.review ? 'review' : 'not-started';
  hero.kind = options.kind ?? 'hero';
  hero.state = hero.kind === 'task' ? 'not-started' : null;
  hero.tags = options.tags;
  children[1].tags = options.tags ?? ['related'];
  catalog.cards = options.withoutJourney ? [hero] : [hero, ...children];
  if (options.family) catalog.cards = [hero,
    { ...children[0], journey: undefined, effort: 2 },
    { ...children[1], journey: undefined, owner: 'Alex', effort: 5, priority: 'high', handMemberIds: ['alex'], handOrder: { alex: 90 }, dueDate: '2000-01-01' },
    { ...children[2], journey: undefined, state: 'review', effort: 3 },
    { ...child('planned', 'Plan Arena', 'not-started'), journey: undefined, effort: 1 },
    { ...child('blocked', 'Integrate Arena', 'not-started'), journey: undefined, dependsOn: [children[1].id] },
    { ...child('question', 'Input decisions', null), kind: 'doc', journey: undefined, openQuestions: [{ text: 'Which input?', taskRef: null, assignee: null, target: null }] },
    { ...base, id: 'card:unrelated', title: 'Other Hero', path: 'cards/unrelated.md' },
  ];
  children[1].markdown = options.longContent
    ? Array.from({ length: 30 }, (_, index) => `Paragraph ${index + 1}: long card text must leave its editor actions visible.`).join('\n\n')
    : buildMarkdown;
  await catalogStore('sandbox').refresh();
  setLang(options.lang ?? 'en');
  document.documentElement.classList.toggle('dark', options.theme !== 'light');
  localStorage.setItem('deckmate-summary-collapsed', 'true');
  localStorage.setItem('deckmate-left-panel-width-v5', String(options.width ?? 503));
  const query = new URLSearchParams(options.query ?? { view: 'deck', deck: 'mixed', catalogSource: 'sandbox', layout: 'cards' });
  if (options.card) query.set('card', options.card);
  history.replaceState(null, '', '?' + query);
  const snapshot = { projectName: 'Hero return', source: 'sandbox' as const, writable: true, editMode: 'direct' as const,
    token: 'fixture-token', iteration: { number: 1, goal: '', start: '' } };
  root.render(<main className="workspace-main" style={{ height: '100vh', overflowY: 'auto' }}><Deck key={++instance} refreshKey={0}
    snapshot={snapshot} /></main>);
}

Object.assign(window, { heroReturnTest: { render, requests, async removeHero() {
  catalog.cards = catalog.cards.filter(card => card.id !== hero.id);
  await catalogStore('sandbox').refresh();
} } });
render();
