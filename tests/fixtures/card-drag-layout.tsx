import { createRoot } from 'react-dom/client';
import { Deck } from '../../client/components/Deck.tsx';
import { setLang } from '../../client/i18n.ts';
import { catalogStore } from '../../client/catalog-store.ts';
import type { CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import '../../client/styles.css';
import '../../client/card-material.css';
import '../../client/motion.css';

const root = createRoot(document.getElementById('root')!);
const snapshot: WorkspaceSnapshot & { token: string } = { projectName: 'Drag layout', source: 'sandbox', writable: true,
  editMode: 'direct', token: 'test-token', iteration: { number: 1, goal: '', start: '' } };
const priorities = ['high', 'high', 'high', 'high', 'low', 'low'] as const;
const cards: CatalogCard[] = priorities.map((priority, index) => ({
  id: index === 0 ? 'card:ferry' : `card:${priority}-${index}`,
  kind: 'task', title: index === 0 ? 'Record the ferry bell' : `${priority} task ${index}`,
  path: `cards/${index}.md`, version: null, state: 'not-started', owner: null,
  markdown: 'A task used to keep the card preview open during a pointer transfer.',
  sourceHash: `hash-${index}`, range: null, deckId: 'tasks', trackIds: [], parentId: null, priority,
}));
const catalog: CatalogView = {
  rootIdentity: 'card-drag-layout', documents: [], cards,
  spaces: [{ id: 'work', title: 'Work' }],
  decks: [{ id: 'tasks', title: 'Tasks', kind: 'task', spaceId: 'work', description: '', color: '#446688', icon: 'box' }],
  tracks: [], warnings: [], formatLanguage: 'en', manifestHash: 'manifest-hash', optionsHash: 'options-hash',
  configured: true, indexedAt: '', members: [], runs: [], milestones: [], projectTags: [], journeys: [],
};

window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin);
  if (url.pathname === '/api/catalog' && init?.method === 'POST') {
    const action = JSON.parse(String(init.body));
    if (action.action === 'bulk-edit-cards' && action.change.kind === 'properties') {
      for (const card of cards) {
        if (action.cards.some((entry: { cardId: string }) => entry.cardId === card.id)) card.priority = action.change.priority;
      }
      catalog.manifestHash = 'manifest-after-drop';
    }
    return Response.json(catalog);
  }
  if (url.pathname === '/api/catalog') return Response.json(catalog);
  if (url.pathname === '/api/card-content') {
    const card = cards.find(candidate => candidate.id === url.searchParams.get('cardId'))!;
    return Response.json({ cardId: card.id, title: card.title, markdown: card.markdown, sourceHash: card.sourceHash });
  }
  if (url.pathname === '/api/notifications') return Response.json({ watching: [], watchHash: 'watch-hash' });
  return Response.json({ files: [], warnings: [], events: [], nextCursor: null, created: null });
};

async function render() {
  await catalogStore('sandbox').refresh();
  setLang('en');
  localStorage.setItem('deckmate-summary-collapsed', 'true');
  localStorage.setItem('deckmate-left-panel-width-v5', '503');
  history.replaceState(null, '', '?view=deck&deck=tasks&card=card:ferry&catalogSource=sandbox&layout=cards');
  root.render(<main className="workspace-main" style={{ height: '100vh' }}><Deck refreshKey={0}
    snapshot={snapshot} /></main>);
}

Object.assign(window, { cardDragLayoutTest: { render } });
render();
