import { createRoot } from 'react-dom/client';
import App from '../../client/App.tsx';
import type { CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import '../../client/styles.css';
import '../../client/motion.css';
import '../../client/select.css';
import '../../client/surface.css';
import '../../client/card-material.css';

document.documentElement.classList.add('dark');
document.documentElement.style.colorScheme = 'dark';

const decks = ['top', 'neighbor', 'middle', 'lower', 'last'];
const cards: CatalogCard[] = decks.flatMap(deckId => Array.from({ length: 12 }, (_, index) => ({
  id: `card:${deckId}-${index}`, kind: 'task', title: `Task ${index}`, path: `cards/${deckId}-${index}.md`,
  version: null, state: 'not-started', owner: null, markdown: 'Card text.', sourceHash: 'hash', range: null,
  deckId, trackIds: [], parentId: null,
})));
const catalog: CatalogView = {
  rootIdentity: 'deck-transition', formatLanguage: 'en', manifestHash: 'manifest', optionsHash: 'options',
  configured: true, indexedAt: '', documents: [], cards,
  spaces: ['top', 'middle', 'lower', 'last'].map(id => ({ id, title: id })),
  decks: decks.map(id => ({ id, title: id, kind: 'task', spaceId: id === 'neighbor' ? 'top' : id,
    description: '', color: '#9258e5', icon: 'layers' })),
  tracks: [], warnings: [], members: [], runs: [], milestones: [],
};

// 2026-11-10: keep the real shell and scroll owner; only project data and its notification socket are synthetic.
class FixtureSocket {
  onopen: (() => void) | null = null;
  constructor() { setTimeout(() => this.onopen?.(), 0); }
  close() {}
}
window.WebSocket = FixtureSocket as unknown as typeof WebSocket;
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href);
  if (!url.pathname.startsWith('/api/')) return realFetch(input, init);
  if (url.pathname === '/api/snapshot') return Response.json({ projectName: 'Transition test', source: 'sandbox',
    editMode: 'direct', writable: true, token: 'test', iteration: { number: 1, goal: '', start: '' } });
  if (url.pathname === '/api/catalog') return Response.json(catalog);
  if (url.pathname === '/api/project-pulse') return Response.json({ inProgress: { count: 0, ownerIds: [] },
    review: { count: 0, oldestSince: null, deckId: null }, accepted: { days: Array(14).fill(0), total: 0 }, run: null, withoutDeck: 0 });
  if (url.pathname === '/api/notifications') return Response.json({ source: 'sandbox', member: null, members: [], stacks: [],
    total: 0, watching: [], warnings: [] });
  if (url.pathname === '/api/onboarding-facts') return Response.json({ agentSkill: false });
  return Response.json({ entries: [], warnings: [] });
};
createRoot(document.getElementById('root')!).render(<App />);
