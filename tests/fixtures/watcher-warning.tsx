import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import App from '../../client/App.tsx';
import { setLang } from '../../client/i18n.ts';
import type { CatalogView } from '../../src/catalog-contracts.ts';
import type { DataSource } from '../../src/workspace-contracts.ts';
import '../../client/styles.css';
import '../../client/surface.css';
import '../../client/motion.css';
import '../../client/select.css';
import '../../client/card-material.css';

const root = createRoot(document.getElementById('root')!);
const sockets = new Set<FixtureSocket>();
const failedSources = new Set<DataSource>();
const holds = new Set<string>();
const releases = new Map<string, Array<() => void>>();
let reads: Record<string, number> = {};
let token = 0;
let twoSources = false;
let failSnapshot = false;
let catalog: CatalogView;

class FixtureSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor() {
    sockets.add(this);
    setTimeout(() => {
      if (!sockets.has(this)) return;
      this.onopen?.();
      for (const source of failedSources) this.fail(source);
    }, 0);
  }
  fail(source: DataSource) { this.onmessage?.({ data: JSON.stringify({ type: 'watcher-error', source }) }); }
  close() { sockets.delete(this); }
}
window.WebSocket = FixtureSocket as unknown as typeof WebSocket;

function release(route: string) {
  holds.delete(route);
  for (const resolve of releases.get(route) ?? []) resolve();
  releases.delete(route);
}
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href);
  const route = url.pathname;
  if (!route.startsWith('/api/')) return realFetch(input, init);
  reads[route] = (reads[route] ?? 0) + 1;
  if (holds.has(route)) await new Promise<void>(resolve => releases.set(route, [...(releases.get(route) ?? []), resolve]));
  if (route === '/api/snapshot') {
    if (failSnapshot) throw new TypeError('Offline');
    const source = twoSources && url.searchParams.get('source') === 'live' ? 'live' : 'sandbox';
    return Response.json({ projectName: 'Пустой проект', source, editMode: twoSources ? 'sandbox' : 'direct', writable: source === 'sandbox', token: `watcher-${token}`, iteration: { number: 1, goal: '', start: '' } });
  }
  if (route === '/api/catalog') return Response.json({ ...catalog, warnings: failedSources.has(url.searchParams.get('source') as DataSource)
    ? ['Наблюдение за файлами остановилось. Каталог перечитывается при каждом запросе; для автоматических обновлений перезапустите Deckmate.'] : [] });
  if (route === '/api/project-pulse') return Response.json({ inProgress: { count: 0, ownerIds: [] }, review: { count: 0, oldestSince: null, deckId: null }, accepted: { days: Array(14).fill(0), total: 0 }, run: null, withoutDeck: 0 });
  if (route === '/api/notifications') return Response.json({ source: 'sandbox', member: null, members: [], stacks: [], total: 0, watching: [], warnings: [] });
  if (route === '/api/onboarding-facts') return Response.json({ agentSkill: false });
  return Response.json({ entries: [], files: [], events: [], warnings: [], nextCursor: null, created: null });
};

function render(options: { theme?: string; scene?: 'empty' | 'deck' | 'cards'; failed?: boolean; holdCatalog?: boolean; twoSources?: boolean } = {}) {
  flushSync(() => root.render(null));
  for (const route of holds) release(route);
  failedSources.clear();
  if (options.failed) failedSources.add('sandbox');
  if (options.holdCatalog) holds.add('/api/catalog');
  reads = {};
  token++;
  failSnapshot = false;
  twoSources = options.twoSources ?? false;
  const hasDeck = options.scene === 'deck' || options.scene === 'cards';
  catalog = { rootIdentity: `watcher-${token}`, formatLanguage: 'ru', manifestHash: 'manifest', optionsHash: 'options',
    configured: hasDeck, indexedAt: '', documents: [], cards: options.scene === 'cards' ? [{
      id: 'card:watcher', kind: 'task', title: 'Первая карточка', path: 'cards/watcher.md', version: null,
      state: 'not-started', owner: null, markdown: 'Текст карточки.', sourceHash: 'hash', range: null,
      deckId: 'empty', trackIds: [], parentId: null, priority: 'medium',
    }] : [], spaces: hasDeck ? [{ id: 'work', title: 'Работа' }] : [],
    decks: hasDeck ? [{ id: 'empty', title: 'Новая колода', kind: 'task', spaceId: 'work', description: '', color: '#9258e5', icon: 'layers' }] : [],
    tracks: [], warnings: [], members: [], runs: [], milestones: [] };
  setLang('ru');
  document.documentElement.classList.toggle('dark', options.theme !== 'light');
  history.replaceState(null, '', `/?view=deck&catalogSource=sandbox${hasDeck ? '&deck=empty' : ''}`);
  root.render(<App />);
}
Object.assign(window, { watcherTest: {
  render,
  get reads() { return reads; },
  get connected() { return sockets.size > 0; },
  stop(source: DataSource = 'sandbox') {
    failedSources.add(source);
    for (const socket of sockets) socket.fail(source);
  },
  hold: (route: string) => holds.add(route),
  release,
  failSnapshot: (value: boolean) => { failSnapshot = value; },
  restart: () => { token++; failedSources.clear(); },
} });
render();
