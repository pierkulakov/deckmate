import { createRoot } from 'react-dom/client';
import App from '../../client/App.tsx';
import { catalogStore } from '../../client/catalog-store.ts';
import { cachedProjectPulse } from '../../client/pulse-cache.ts';
import type { CatalogView } from '../../src/catalog-contracts.ts';
import '../../client/styles.css';
import '../../client/motion.css';
import '../../client/select.css';
import '../../client/surface.css';
import '../../client/card-material.css';

type Stage = 'snapshot' | 'catalog' | 'pulse' | 'fonts';
const stages: Stage[] = ['snapshot', 'catalog', 'pulse', 'fonts'];
const releases = new Map<Stage, () => void>();
const gates = new Map(stages.map(stage => [stage, new Promise<void>(resolve => releases.set(stage, resolve))]));
const requests: string[] = [];
const responses: string[] = [];
let fontsLoaded = 0;
const failure = new URLSearchParams(location.search).get('failure');
const empty = new URLSearchParams(location.search).has('empty');
const catalog: CatalogView = {
  rootIdentity: 'initial-load', formatLanguage: 'en', manifestHash: 'manifest', optionsHash: 'options',
  configured: true, indexedAt: '', documents: [], warnings: [], members: [], runs: [], milestones: [], tracks: [],
  spaces: empty ? [] : [{ id: 'studio', title: 'Studio / Студия' }],
  decks: empty ? [] : ['world', 'production', 'notes'].map(id => ({ id, title: id + ' / Колода', kind: 'task',
    spaceId: 'studio', description: '', color: '#9258e5', icon: 'layers' })),
  cards: empty ? [] : ['world', 'production', 'notes'].map((deckId, index) => ({
    id: `card:initial-${index}`, kind: 'task', title: 'First card / Первая карточка', path: `cards/${index}.md`,
    version: null, state: 'not-started', owner: null, markdown: '', sourceHash: String(index), range: null,
    deckId, trackIds: [], parentId: null, priority: 'medium',
  })),
};

const fetchResource = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href);
  if (!url.pathname.startsWith('/api/')) return fetchResource(input, init);
  const stage = ({ '/api/snapshot': 'snapshot', '/api/catalog': 'catalog', '/api/project-pulse': 'pulse' } as const)[url.pathname];
  // 2026-11-13: a delayed response retains the data from its own request, even after an external edit.
  const pulse = { inProgress: { count: catalog.cards.filter(card => card.state === 'started').length, ownerIds: [] },
    review: { count: 0, oldestSince: null, deckId: null }, accepted: { days: Array(14).fill(0), total: 0 }, run: null, withoutDeck: 0 };
  if (stage) {
    requests.push(stage);
    await gates.get(stage);
    responses.push(stage);
    if (failure === stage) return Response.json({ message: 'Unavailable: ' + stage }, { status: 503 });
  }
  if (stage === 'snapshot') return Response.json({ projectName: 'Studio / Студия', source: 'sandbox', editMode: 'direct',
    writable: true, token: 'initial-load-token', iteration: { number: 1, goal: '', start: '' } });
  if (stage === 'catalog') return Response.json(catalog);
  if (stage === 'pulse') return Response.json(pulse);
  if (url.pathname === '/api/boards') return Response.json([]);
  if (url.pathname === '/api/notifications') return Response.json({ source: 'sandbox', member: null, members: [], stacks: [], total: 0, watching: [], warnings: [] });
  if (url.pathname === '/api/onboarding-facts') return Response.json({ agentSkill: false });
  return Response.json({ entries: [], warnings: [] });
};
const loadFont = document.fonts.load.bind(document.fonts);
document.fonts.load = async (font, sample) => {
  const faces = await loadFont(font, sample);
  await gates.get('fonts');
  if (failure === 'fonts') throw new Error('Font unavailable');
  fontsLoaded++;
  return faces;
};
class FixtureSocket {
  onopen: (() => void) | null = null;
  constructor() { setTimeout(() => this.onopen?.(), 0); }
  close() {}
}
window.WebSocket = FixtureSocket as unknown as typeof WebSocket;
Object.assign(window, { initialLoadTest: {
  requests,
  responses,
  get fontsLoaded() { return fontsLoaded; },
  catalog: () => catalogStore('sandbox').getSnapshot().catalog,
  cachedPulse: () => cachedProjectPulse('sandbox'),
  addStartedCard: () => {
    catalog.cards.push({ id: 'card:external', kind: 'task', title: 'External card', path: 'cards/external.md',
      version: null, state: 'started', owner: null, markdown: '', sourceHash: 'external', range: null,
      deckId: null, trackIds: [], parentId: null, priority: 'medium' });
  },
  hold: (stage: Stage) => {
    const previous = releases.get(stage)!;
    gates.set(stage, new Promise<void>(resolve => releases.set(stage, resolve)));
    return previous;
  },
  release: (stage: Stage) => releases.get(stage)!(),
  releaseAll: () => releases.forEach(release => release()),
} });
createRoot(document.getElementById('root')!).render(<App />);
