import { createRoot } from 'react-dom/client';
import { Deck } from '../../client/components/Deck.tsx';
import { setLang } from '../../client/i18n.ts';
import { catalogStore } from '../../client/catalog-store.ts';
import type { CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import type { ProjectPulse } from '../../src/pulse-contracts.ts';
import '../../client/styles.css';
import '../../client/surface.css';
import '../../client/card-material.css';
import '../../client/motion.css';

// 2026-11-10: the card scopes (All cards, Unassigned, a track) in a project whose cards all sit in one deck;
// ?empty=1 serves the same project without cards.
const query = new URLSearchParams(location.search);
const empty = query.has('empty');
const pulseFixture = query.has('pulse');
const card = (id: number, title: string): CatalogCard => ({ id: `card:5c0e0000-0000-4000-8000-00000000000${id}`, title, kind: 'task',
  path: `cards/${id}.md`, markdown: `# ${title}\n`, state: 'not-started', owner: null, sourceHash: `hash-${id}`, version: null,
  range: null, deckId: 'work', trackIds: [], parentId: null, effort: 2, priority: 'low' });
const snapshot: WorkspaceSnapshot & { token: string } = { projectName: 'Harbor', source: 'sandbox', writable: true, editMode: 'direct', token: 'test', iteration: { number: 1, goal: '', start: '' } };
const catalog: CatalogView = { rootIdentity: 'card-scope-test', documents: [],
  cards: empty ? [] : [card(1, 'Ring the ferry bell'), card(2, 'Draw the harbor map'), card(3, 'Light the lantern')],
  spaces: [{ id: 'studio', title: 'Studio' }],
  decks: [{ id: 'work', title: 'Work', kind: 'task', spaceId: 'studio', description: '', color: '#446688', icon: 'box' }],
  tracks: [{ id: 'route', title: 'Ferry route', description: '' }], warnings: [], formatLanguage: 'en', manifestHash: 'hash', optionsHash: 'hash',
  configured: true, indexedAt: '', members: [{ id: 'alex', label: 'Alex', kind: 'human', aliases: [] }], runs: [], milestones: [], projectTags: [], journeys: [] };
if (pulseFixture) {
  snapshot.projectName = 'Deckmate';
  catalog.cards = Array.from({ length: 30 }, (_, index) => {
    let state: CatalogCard['state'] = 'not-started';
    if (index < 5 && !query.has('noStarted')) state = 'started';
    else if (index >= 5 && index < 8) state = 'review';
    return { ...card(index + 1, `Задача ${index + 1}: подготовить выпуск`), state,
      deckId: index === 29 ? null : 'work', priority: index < 2 ? 'high' : 'medium',
      owner: index < 2 ? 'Александра Константинопольская' : null,
      tags: index < 2 ? ['подготовка-выпуска-без-сокращений'] : [] };
  });
  catalog.cards.push({ ...card(31, 'Archived task'), state: 'started', archived: true });
  if (query.has('ownerAliases')) {
    catalog.members = [{ id: 'alexandra', label: 'Александра Константинопольская', kind: 'human', aliases: ['Sasha'] }];
    catalog.cards[0].owner = 'alexandra';
    catalog.cards[1].owner = 'Sasha';
  }
}
if (query.has('checklist')) {
  const markdown = '- [x] Complete main work\n- [ ] Review the work\n- [ ] Ship the work\n';
  catalog.members = [{ id: 'maya', label: 'Maya Chen', kind: 'human', aliases: [] }];
  catalog.cards = [
    { ...card(1, 'Checklist progress'), owner: 'Maya Chen', markdown },
    { ...card(2, 'Without a checklist'), owner: 'Maya Chen' },
    { ...card(3, 'Golden checklist'), owner: 'Maya Chen', markdown, kind: 'hero' },
    { ...card(4, 'Accepted checklist'), owner: 'Maya Chen', markdown: markdown.replaceAll('[ ]', '[x]'), state: 'done' },
  ];
}
const active = catalog.cards.filter(item => !item.archived && !item.deleted);
const pulse: ProjectPulse = {
  inProgress: { count: active.filter(item => item.state === 'started').length, ownerIds: [] },
  review: { count: active.filter(item => item.state === 'review').length, oldestSince: null, deckId: 'work' },
  accepted: { days: Array(14).fill(0), total: 0 }, run: null,
  withoutDeck: active.filter(item => !item.deckId).length,
};
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin);
  if (url.pathname === '/api/catalog' && init?.method === 'POST') {
    const action = JSON.parse(String(init.body));
    await new Promise(resolve => setTimeout(resolve, 120));
    if (action.action === 'set-card-properties') {
      catalog.cards = catalog.cards.map(card => card.id === action.cardId
        ? { ...card, owner: action.owner, effort: action.effort, priority: action.priority, sourceHash: card.sourceHash + '-saved' } : card);
    }
    if (action.action === 'update-card-content') {
      catalog.cards = catalog.cards.map(card => card.id === action.cardId
        ? { ...card, title: action.title, markdown: action.markdown, sourceHash: card.sourceHash + '-saved' } : card);
    }
    return Response.json(catalog);
  }
  if (url.pathname === '/api/catalog') return Response.json(catalog);
  if (url.pathname === '/api/project-pulse') return Response.json(pulse);
  if (url.pathname === '/api/card-content') {
    const opened = catalog.cards.find(item => item.id === url.searchParams.get('cardId')) ?? catalog.cards[0];
    return Response.json({ cardId: opened.id, title: opened.title, markdown: opened.markdown, sourceHash: opened.sourceHash });
  }
  return Response.json({ files: [], warnings: [], events: [], nextCursor: null, created: null });
};
async function render() {
  await catalogStore('sandbox').refresh();
  setLang(query.get('lang') === 'ru' ? 'ru' : 'en');
  document.documentElement.classList.toggle('dark', query.get('theme') === 'dark');
  query.set('view', 'deck');
  query.set('catalogSource', 'sandbox');
  if (!query.has('scope') && !pulseFixture) query.set('scope', 'unassigned');
  history.replaceState(null, '', '?' + query.toString());
  createRoot(document.getElementById('root')!).render(<main className="workspace-main" style={{ height: '100vh', overflow: 'auto' }}><Deck refreshKey={0} snapshot={snapshot} /></main>);
}
void render();
