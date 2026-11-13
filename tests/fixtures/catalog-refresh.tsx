import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../client/App.tsx';
import { catalogStore } from '../../client/catalog-store.ts';
import { VirtualCardGrid } from '../../client/components/VirtualCardGrid.tsx';
import type { CatalogCard } from '../../src/catalog-contracts.ts';
import '../../client/styles.css';
import '../../client/motion.css';
import '../../client/select.css';
import '../../client/surface.css';
import '../../client/card-material.css';

const probe = {
  delay: 0, notificationDelay: 0, reads: 0, contentReads: 0,
  refresh: () => catalogStore('sandbox').refresh(),
  catalog: () => catalogStore('sandbox').getSnapshot().catalog,
  resize: (_count: number) => {}, rebind: () => {},
};
const nativeFetch = window.fetch;
window.fetch = async (input, init) => {
  const response = await nativeFetch(input, init);
  const pathname = new URL(String(input), location.origin).pathname;
  if (pathname === '/api/catalog' && !init?.method) {
    probe.reads++;
    if (probe.delay) await new Promise(resolve => setTimeout(resolve, probe.delay));
  }
  if (pathname === '/api/card-content') probe.contentReads++;
  if (pathname === '/api/notifications' && probe.notificationDelay) await new Promise(resolve => setTimeout(resolve, probe.notificationDelay));
  return response;
};
Object.assign(window, { refreshTest: probe });

const cards: CatalogCard[] = Array.from({ length: 80 }, (_, index) => ({
  id: `card:refresh-${index}`, title: `Card ${index}`, markdown: '', kind: 'task', path: `cards/${index}.md`,
  state: 'not-started', sourceHash: `${index}`, version: null, range: null, owner: null, deckId: null, parentId: null, trackIds: [],
}));
function GridProbe() {
  const [count, setCount] = useState(49);
  const [, setRevision] = useState(0);
  probe.resize = setCount;
  probe.rebind = () => setRevision(value => value + 1);
  return <main className="workspace-main" style={{ height: '100vh', padding: 24 }}>
    <VirtualCardGrid cards={cards.slice(0, count)} enabled={count >= 50} pinnedIds={[]}>
      {card => <button className="deck-card" data-deck-card={card.id}>{card.title}</button>}
    </VirtualCardGrid>
  </main>;
}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('gridProbe') ? <GridProbe /> : <App />);
