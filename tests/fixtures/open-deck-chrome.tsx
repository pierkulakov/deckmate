import { createRoot } from 'react-dom/client';
import App from '../../client/App.tsx';
import type { CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import '../../client/styles.css';
import '../../client/motion.css';
import '../../client/card-material.css';
import '../../client/surface.css';

const cards: CatalogCard[] = Array.from({ length: 8 }, (_, index) => ({
  id: `card:${index}`, kind: 'task', title: `Карточка ${index}`, path: `cards/${index}.md`, version: null,
  state: 'started', owner: null, markdown: 'Текст карточки.', sourceHash: 'hash', range: null,
  deckId: 'work', trackIds: [], parentId: null, effort: index + 1, priority: index < 2 ? 'high' : 'medium',
  tags: index < 4 ? ['очень-длинный-русский-тег-без-сокращений'] : [],
}));
const catalog: CatalogView = {
  rootIdentity: 'open-deck-chrome', configured: true, formatLanguage: 'en', manifestHash: 'hash', indexedAt: '',
  documents: [], cards, spaces: [{ id: 'space', title: 'Пространство' }],
  decks: ['work', 'empty'].map(id => ({ id, title: 'Колода с очень длинным русским названием без сокращений',
    kind: 'mixed', spaceId: 'space', description: 'Описание колоды с длинными русскими словами.', color: '#607d98', icon: 'box' })),
  tracks: [], warnings: [], members: [], runs: [], milestones: [], projectTags: [], journeys: [],
};
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
  if (url.pathname === '/api/snapshot') return Response.json({ projectName: 'Проверка колоды', source: 'sandbox',
    writable: true, editMode: 'direct', token: 'test', iteration: { number: 1, goal: '', start: '' } });
  if (url.pathname === '/api/catalog') return Response.json(catalog);
  if (url.pathname === '/api/activity') {
    const mode = new URLSearchParams(location.search).get('activity');
    if (mode === 'loading') return new Promise<Response>(() => {});
    if (mode === 'error') return Response.json({ message: 'Не удалось загрузить журнал.' }, { status: 503 });
    return Response.json({ events: [], nextCursor: null, warnings: [] });
  }
  if (url.pathname === '/api/notifications') return Response.json({ source: 'sandbox', member: null, members: [], stacks: [], total: 0, watching: [], warnings: [] });
  if (url.pathname === '/api/project-pulse') return Response.json({ inProgress: { count: 0, ownerIds: [] }, review: { count: 0, oldestSince: null, deckId: null }, accepted: { days: Array(14).fill(0), total: 0 }, run: null, withoutDeck: 0 });
  return Response.json({ files: [], events: [], nextCursor: null, warnings: [] });
};
createRoot(document.getElementById('root')!).render(<App />);
