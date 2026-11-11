import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import App from '../../client/App.tsx';
import { DeckAutomation, type DeckAutomationSettings } from '../../client/components/DeckAutomation.tsx';
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
const params = new URLSearchParams(location.search);
if (params.has('zonesTest')) {
  catalog.deckOrder = { work: { zones: [{ id: 'long', title: 'Зона с длинным русским названием' }, { id: 'empty', title: 'Пустая зона' }],
    zoneOrder: { long: cards.map(card => card.id), empty: [] } } };
}
if (params.has('linkTest')) {
  catalog.decks[0].id = 'work &/тест?';
  for (const card of cards) card.deckId = catalog.decks[0].id;
}
if (params.has('reviewCount')) {
  const count = Number(params.get('reviewCount'));
  cards.forEach((card, index) => { card.state = index < count ? 'review' : 'started'; });
  cards.push(...[{ kind: 'hero' }, { kind: 'doc' }, { archived: true }, { deleted: true }].map((extra, index) =>
    ({ ...cards[0], id: 'excluded:' + index, state: 'review', ...extra } as CatalogCard)));
}
class FixtureSocket {
  onopen: (() => void) | null = null;
  constructor() { setTimeout(() => this.onopen?.(), 0); }
  close() {}
}
window.WebSocket = FixtureSocket as unknown as typeof WebSocket;
const realFetch = window.fetch.bind(window);
const edits: unknown[] = [];
Object.assign(window, { deckEdits: edits });
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href);
  if (!url.pathname.startsWith('/api/')) return realFetch(input, init);
  if (url.pathname === '/api/snapshot') return Response.json({ projectName: 'Проверка колоды', source: params.get('catalogSource') ?? 'sandbox',
    writable: true, editMode: 'direct', token: 'test', iteration: { number: 1, goal: '', start: '' } });
  if (url.pathname === '/api/catalog') {
    if (init?.method === 'POST') edits.push(JSON.parse(String(init.body)));
    return Response.json(catalog);
  }
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
function AutomationFixture() {
  const [revision, setRevision] = useState('opened');
  const [failure, setFailure] = useState(false);
  const saved: { settings: DeckAutomationSettings; hash: string }[] = [];
  Object.assign(window, { automationTest: { external: () => setRevision('external'), fail: () => setFailure(true), saved } });
  return <Tooltip.Provider><DeckAutomation draftKey="fixture:sandbox:work" deck={{ ...catalog.decks[0], templateMarkdown: revision + ' template' }}
    members={[]} tagNames={[]} manifestHash={revision} pending={false} writable
    onSave={async (_id, settings, hash) => { saved.push({ settings, hash }); if (failure) throw new Error('Write failed'); return true; }} /></Tooltip.Provider>;
}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('automationTest') ? <AutomationFixture /> : <App />);
