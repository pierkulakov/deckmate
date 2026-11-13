import { createRoot } from 'react-dom/client';
import App from '../../client/App.tsx';
import type { CatalogView } from '../../src/catalog-contracts.ts';
import '../../client/styles.css';
import '../../client/motion.css';
import '../../client/select.css';
import '../../client/surface.css';
import '../../client/card-material.css';

const query = new URLSearchParams(location.search);
const state = query.get('scenario') ?? 'ready';
const long = query.has('long');
const releases = new Map<string, () => void>();
const gate = (name: string) => new Promise<void>(resolve => releases.set(name, resolve));
const initialCatalog = gate('catalog');
const retryCatalog = gate('retry');
const requests: string[] = [];
let retryFails = false;
const title = long ? 'Производство окружения и окончательная приёмка прибрежного поселения' : 'Deck';
const catalog: CatalogView = {
  rootIdentity: 'decks-loading', formatLanguage: 'en', manifestHash: 'manifest', optionsHash: 'options', configured: true, indexedAt: '',
  documents: Array.from({ length: 2 }, (_, index) => ({ path: `docs/${index}.md`, title: `Document ${index}`, hash: String(index) })),
  spaces: [{ id: 'studio', title: long ? 'Производство окружения, звука и инженерных систем для следующего игрового прототипа' : 'Moonwake Studio' }],
  decks: Array.from({ length: 5 }, (_, index) => ({ id: `deck-${index}`, title: `${title} ${index + 1}`, kind: 'task', spaceId: 'studio', description: '', color: '#9258e5', icon: 'layers' })),
  cards: Array.from({ length: 5 }, (_, index) => ({ id: `card:loading-${index}`, kind: 'task', title: `Card ${index}`, path: `cards/${index}.md`,
    version: null, state: 'not-started', owner: null, markdown: '', sourceHash: String(index), range: null,
    deckId: `deck-${index}`, trackIds: [], parentId: null, priority: 'medium' })),
  tracks: [], warnings: [], members: [], runs: [], milestones: [],
};
const emptyCatalog: CatalogView = { ...catalog, documents: [], spaces: [], decks: [], cards: [] };
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href);
  if (!url.pathname.startsWith('/api/')) return originalFetch(input, init);
  if (url.pathname === '/api/snapshot') return Response.json({
    projectName: long ? 'Restored — экспериментальное пространство разработки небольшой игровой команды' : 'Restored',
    source: 'sandbox', editMode: 'direct', writable: !query.has('readonly'), token: 'decks-loading-token', iteration: { number: 1, goal: '', start: '' },
  });
  if (url.pathname === '/api/catalog') {
    requests.push('catalog');
    if (requests.length === 1) {
      await initialCatalog;
      if (state === 'error') throw new TypeError('Controlled catalog connection failure');
    } else {
      await retryCatalog;
      if (retryFails) throw new TypeError('Controlled retry connection failure');
    }
    return Response.json(state === 'empty' ? emptyCatalog : catalog);
  }
  if (url.pathname === '/api/project-pulse') return Response.json({ inProgress: { count: 0, ownerIds: [] },
    review: { count: 0, oldestSince: null, deckId: null }, accepted: { days: Array(14).fill(0), total: 0 }, run: null, withoutDeck: 0 });
  if (url.pathname === '/api/notifications') return Response.json({ source: 'sandbox', member: null, members: [], stacks: [], total: 0, watching: [], warnings: [] });
  if (url.pathname === '/api/onboarding-facts') return Response.json({ agentSkill: false });
  return Response.json({ entries: [], warnings: [] });
};
class FixtureSocket {
  onopen: (() => void) | null = null;
  constructor() { setTimeout(() => this.onopen?.(), 0); }
  close() {}
}
window.WebSocket = FixtureSocket as unknown as typeof WebSocket;
Object.assign(window, { decksLoadingTest: {
  requests,
  release: () => releases.get('catalog')!(),
  releaseRetry: () => releases.get('retry')!(),
  failRetry: () => { retryFails = true; },
} });
createRoot(document.getElementById('root')!).render(<App />);
