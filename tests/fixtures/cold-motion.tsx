import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import App from '../../client/App.tsx';
import { prepareEntrance } from '../../client/prepared-motion.ts';
import type { CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import '../../client/styles.css';
import '../../client/motion.css';
import '../../client/select.css';
import '../../client/surface.css';
import '../../client/card-material.css';

// 2026-11-13: keep the real lazy boundaries and navigation; only the project data is synthetic.
document.documentElement.classList.add('dark');
localStorage.setItem('deckmate-summary-collapsed', 'true');
const cards: CatalogCard[] = Array.from({ length: 10 }, (_, index) => ({
  id: `card:${index}`, kind: index === 0 ? 'hero' : 'task', title: index === 0 ? 'Motion Hero' : `Task ${index}`,
  path: `cards/${index}.md`, version: null, state: index === 0 ? null : 'not-started', owner: 'Leo',
  markdown: 'Card content.\n\n' + 'A stable paragraph for the motion measurement.\n\n'.repeat(8),
  sourceHash: `hash-${index}`, range: null, deckId: 'top', trackIds: [], parentId: index === 1 ? 'card:0' : null,
  handMemberIds: ['leo'], handOrder: { leo: index }, bookmarked: true,
  ...(index === 1 ? { journey: { journeyId: 'pipeline', version: 1, stepId: 'build', instanceId: 'run' } } : {}),
}));
const catalog: CatalogView = {
  rootIdentity: 'cold-motion', formatLanguage: 'en', manifestHash: 'manifest', optionsHash: 'options',
  configured: true, indexedAt: '', documents: [], cards,
  spaces: [{ id: 'work', title: 'Work' }],
  decks: ['top', 'neighbor'].map(id => ({ id, title: id, kind: 'mixed', spaceId: 'work', description: '', color: '#9258e5', icon: 'layers' })),
  tracks: [], warnings: [], members: [{ id: 'leo', label: 'Leo', kind: 'human', aliases: [] }],
  runs: [{ id: 'run', number: 1, goal: 'Motion', start: '2026-11-01', end: '2026-11-30' }], milestones: [],
  journeys: [{ id: 'pipeline', title: 'Pipeline', version: 1, deckId: 'top', path: 'journeys/pipeline/index.md', fileHash: 'journey-hash',
    steps: [{ id: 'build', title: 'Build', markdown: '', deckId: 'top', owner: null, dependsOn: [] }] }],
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
  if (url.pathname === '/api/snapshot') return Response.json({ projectName: 'Cold motion', source: 'sandbox',
    editMode: 'direct', writable: true, token: 'test', iteration: { number: 1, goal: '', start: '' } });
  if (url.pathname === '/api/catalog') {
    if (init?.method === 'POST') {
      const action = JSON.parse(String(init.body));
      if (action.action === 'reorder-hand') action.cards.forEach((entry: { cardId: string }, index: number) => {
        cards.find(card => card.id === entry.cardId)!.handOrder = { leo: index };
      });
    }
    return Response.json(catalog);
  }
  if (url.pathname === '/api/card-content') {
    const card = cards.find(card => card.id === url.searchParams.get('cardId'))!;
    return Response.json({ cardId: card.id, title: card.title, markdown: card.markdown, sourceHash: card.sourceHash });
  }
  if (url.pathname === '/api/project-pulse') return Response.json({ inProgress: { count: 0, ownerIds: [] },
    review: { count: 0, oldestSince: null, deckId: null }, accepted: { days: Array(14).fill(0), total: 0 }, run: null, withoutDeck: 0 });
  if (url.pathname === '/api/notifications') return Response.json({ source: 'sandbox', member: catalog.members![0], members: catalog.members,
    stacks: [], total: 0, watching: [], watchHash: 'watch-hash', warnings: [] });
  if (url.pathname === '/api/boards') return Response.json([]);
  if (url.pathname === '/api/onboarding-facts') return Response.json({ agentSkill: false });
  return Response.json({ entries: [], files: [], hash: '', warnings: [], events: [], nextCursor: null, created: null });
};
function EntranceProbe() {
  const [open, setOpen] = useState(false);
  return <>
    <button id="show" onClick={() => {
      document.fonts.add(new FontFace('Motion probe font', `url(${new URL('../../assets/fonts/geist/GeistMono-Regular.ttf', import.meta.url).href}?cold-font)`));
      setOpen(true);
    }}>Show</button>
    <button id="hide" onClick={() => setOpen(false)}>Hide</button>
    {open && <div ref={prepareEntrance} id="entrance-root" style={{ position: 'absolute', left: 100, top: 100 }}>
      <div id="entrance-target" style={{ font: '24px "Motion probe font"', animation: 'dialog-drop var(--motion-spring-firm) var(--ease-spring-firm)' }}>Motion 0123456789</div>
    </div>}
  </>;
}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('entrance') ? <EntranceProbe /> : <App />);
