import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Deck } from '../../client/components/Deck.tsx';
import { catalogStore } from '../../client/catalog-store.ts';
import { setLang } from '../../client/i18n.ts';
import type { CatalogAction } from '../../client/useCatalog.ts';
import type { CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import '../../client/styles.css';
import '../../client/card-material.css';

const root = createRoot(document.getElementById('root')!);
const requests: CatalogAction[] = [];
let catalog: CatalogView;
let failure: 'conflict' | null = null;
let instance = 0;
interface Options { state?: CatalogCard['state']; owner?: string | null; writable?: boolean; lang?: 'en' | 'ru'; layout?: 'cards' | 'table' }

window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href);
  if (url.pathname === '/api/catalog') {
    if (init?.method === 'POST') {
      const action = JSON.parse(String(init.body)) as CatalogAction;
      requests.push(action);
      if (failure === 'conflict') {
        catalog = { ...catalog, cards: catalog.cards.map(card => ({ ...card, sourceHash: card.sourceHash + '-refreshed' })) };
        return Response.json({ message: 'Conflict' }, { status: 409 });
      }
      catalog = { ...catalog, cards: catalog.cards.map(card => {
        if (action.action === 'set-card-state' && card.id === action.cardId) return { ...card, state: action.state as CatalogCard['state'], sourceHash: card.sourceHash + '-saved' };
        if (action.action !== 'bulk-edit-cards' || !action.cards.some(target => target.cardId === card.id)) return card;
        if (action.change.kind === 'state') return { ...card, state: action.change.state as CatalogCard['state'] };
        if (action.change.kind === 'properties' && action.change.owner !== undefined) return { ...card, owner: action.change.owner };
        return card;
      }) };
    }
    return Response.json(catalog);
  }
  if (url.pathname === '/api/card-content') {
    const card = catalog.cards.find(card => card.id === url.searchParams.get('cardId'))!;
    return Response.json({ cardId: card.id, title: card.title, markdown: card.markdown, sourceHash: card.sourceHash });
  }
  return Response.json({ files: [], warnings: [], events: [], nextCursor: null, created: null });
};

async function render(options: Options = {}) {
  flushSync(() => root.render(null));
  requests.length = 0;
  failure = null;
  const card: CatalogCard = { id: 'card:review', kind: 'task', title: 'Review the result', state: options.state ?? 'review',
    owner: options.owner === undefined ? 'Leo Park' : options.owner, path: 'cards/review.md', markdown: 'Submitted result.',
    range: null, version: null, sourceHash: 'card-hash', deckId: 'tasks', trackIds: [], parentId: null };
  catalog = { rootIdentity: 'card-state-actions', documents: [], cards: [card, { ...card, id: 'card:other', title: 'Other work', state: 'not-started', sourceHash: 'other-hash' }],
    spaces: [{ id: 'work', title: 'Work' }], decks: [{ id: 'tasks', title: 'Tasks', kind: 'task', spaceId: 'work', description: '', color: '#446688', icon: 'box' }],
    tracks: [], warnings: [], formatLanguage: 'en', manifestHash: 'manifest-hash', optionsHash: 'options-hash', configured: true, indexedAt: '',
    members: [{ id: 'maya', label: 'Maya Chen', kind: 'human', aliases: [] }], runs: [], milestones: [] };
  await catalogStore('sandbox').refresh();
  setLang(options.lang ?? 'en');
  localStorage.setItem('deckmate-summary-collapsed', 'true');
  localStorage.setItem('deckmate-current-member', 'maya');
  history.replaceState(null, '', '?' + new URLSearchParams({ view: 'deck', deck: 'tasks', catalogSource: 'sandbox', layout: options.layout ?? 'cards' }));
  const snapshot = { projectName: 'Review actions', source: 'sandbox' as const, writable: options.writable ?? true,
    editMode: 'direct' as const, token: 'fixture-token', iteration: { number: 1, goal: '', start: '' } };
  root.render(<main className="workspace-main" style={{ height: '100vh', overflowY: 'auto' }}><Deck key={++instance} snapshot={snapshot} refreshKey={0} /></main>);
}

Object.assign(window, { cardStateTest: { render, requests, failEdit: (next: typeof failure) => { failure = next; }, cards: () => catalog.cards } });
void render();
