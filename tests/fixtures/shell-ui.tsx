import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import App from '../../client/App.tsx';
import { BulkActions } from '../../client/components/BulkActions.tsx';
import { SelectionToolbar } from '../../client/components/CardSelection.tsx';
import type { BulkChange } from '../../src/bulk-contracts.ts';
import { setLang, type Lang } from '../../client/i18n.ts';
import { beginSave } from '../../client/save-activity.ts';
import { invalidateCatalogs } from '../../client/catalog-store.ts';
import type { CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import type { NotificationStack, NotificationsView } from '../../src/notification-contracts.ts';
import type { DesktopRecentProject, DesktopWorkspaceProject, DesktopProjectsResult } from '../../client/desktop-bridge.ts';
import '../../client/styles.css';
import '../../client/surface.css';
import '../../client/motion.css';
import '../../client/select.css';
import '../../client/card-material.css';

const root = createRoot(document.getElementById('root')!);
const bulkChanges: BulkChange[] = [];
const cards: CatalogCard[] = Array.from({ length: 40 }, (_, index) => ({
  id: `card:shell-${index}`, kind: 'task', title: `Task ${index}`, path: `cards/${index}.md`, version: null,
  state: 'not-started', owner: null, markdown: 'Card text.', sourceHash: `hash-${index}`, range: null,
  deckId: 'tasks', trackIds: [], parentId: null, priority: 'medium',
}));
const catalog: CatalogView = { rootIdentity: 'shell-ui', formatLanguage: 'en', manifestHash: 'manifest', optionsHash: 'options',
  configured: true, indexedAt: '', documents: [], cards, spaces: [{ id: 'work', title: 'Work' }],
  decks: ['tasks', 'neighbors'].map(id => ({ id, title: id, kind: 'task', spaceId: 'work', description: '', color: '#9258e5', icon: 'layers' })),
  tracks: [], warnings: [], members: [], runs: [], milestones: [] };
// 2026-11-10: simulate a manifest written before deck piles were removed; the public CatalogDeck type no longer carries the key.
Object.assign(catalog.decks[1], { piled: true });
const recent: DesktopRecentProject[] = [
  { path: 'D:\\Work\\Shared\\Игровая-команда\\Подготовка-первого-релиза', name: 'Подготовка-первого-релиза', lastOpened: new Date(Date.now() - 7200000).toISOString(), current: false, missing: false },
  { path: 'D:\\WWWWWWWWWWWWWWWWWWWW\\WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW', name: 'Wide glyphs', lastOpened: new Date(Date.now() - 86400000).toISOString(), current: false, missing: false },
];
const current: DesktopWorkspaceProject = { path: 'C:\\Work\\Shell test', name: 'Shell test', current: true, missing: false };
const initialWorkspace: DesktopWorkspaceProject[] = [current,
  { ...recent[0], name: 'Подготовка первого большого релиза и локализации', missing: false },
  { ...recent[1], missing: false },
  { path: 'E:\\Archive\\Lost project', name: 'Lost project', current: false, missing: true },
];
let workspaceProjects: DesktopWorkspaceProject[] = [];
let workspaceCalls: { method: string; args: unknown[] }[] = [];
let workspaceResult: DesktopProjectsResult | 'throw' | null = null;
let navigationFailure: string | null = null;
let workspaceLoadFails: boolean | string = false;
let recentFails: boolean | string = false;
function workspaceReply(next: DesktopWorkspaceProject[]): DesktopProjectsResult {
  if (workspaceResult === 'throw') throw new Error('Bridge unavailable');
  const reply = workspaceResult ?? { ok: true, projects: next, current: current.path };
  if (reply.ok) workspaceProjects = reply.projects;
  return reply;
}
function configureBridge(workspace?: boolean | DesktopWorkspaceProject[]) {
  workspaceProjects = Array.isArray(workspace) ? workspace : initialWorkspace.map(project => ({ ...project }));
  workspaceCalls = []; workspaceResult = null; navigationFailure = null; workspaceLoadFails = false; recentFails = false;
  window.deckmateBoard = {
    recentProjects: async () => {
      if (typeof recentFails === 'string') return { ok: false, code: recentFails };
      if (recentFails) throw new Error('Recent unavailable');
      return { ok: true, projects: [...recent, { path: 'C:\\Work\\Field Notes', name: 'Field Notes', current: false, missing: false, lastOpened: '' }], current: current.path };
    },
    switchProject: async path => { workspaceCalls.push({ method: 'switch', args: [path] }); return navigationFailure ? { ok: false, code: navigationFailure } : { ok: true }; },
    showStartScreen: async () => { workspaceCalls.push({ method: 'start', args: [] }); return navigationFailure ? { ok: false, code: navigationFailure } : { ok: true }; },
    workspaceProjects: async () => {
      if (typeof workspaceLoadFails === 'string') return { ok: false, code: workspaceLoadFails };
      if (workspaceLoadFails) throw new Error('Workspace unavailable');
      return { ok: true, projects: workspaceProjects, current: current.path };
    },
    addToWorkspace: async source => {
      workspaceCalls.push({ method: 'add', args: [source] });
      let project = current;
      if (source.kind === 'dialog') project = { path: 'C:\\Chosen', name: 'Chosen project', current: false, missing: false };
      if (source.kind === 'recent') {
        const result = await window.deckmateBoard!.recentProjects();
        if (!result.ok) return result;
        project = result.projects.find(entry => entry.path === source.path)!;
      }
      return workspaceReply([...workspaceProjects, project]);
    },
    removeFromWorkspace: async path => {
      workspaceCalls.push({ method: 'remove', args: [path] });
      return workspaceReply(workspaceProjects.filter(project => project.path !== path));
    },
    moveInWorkspace: async (path, index) => {
      workspaceCalls.push({ method: 'move', args: [path, index] });
      const next = [...workspaceProjects];
      const [project] = next.splice(next.findIndex(entry => entry.path === path), 1);
      next.splice(index, 0, project);
      return workspaceReply(next);
    },
  };
}

// 2026-11-08: exercise the real useWorkspace shutdown/reconnect race without stopping a shared server.
const sockets = new Set<FakeSocket>();
let holdReconnect = false;
class FakeSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { sockets.add(this); setTimeout(() => { if (!holdReconnect) this.onopen?.(); }, 0); }
  close() { sockets.delete(this); }
  disconnect() { this.onclose?.(); }
}
window.WebSocket = FakeSocket as unknown as typeof WebSocket;
let snapshotFails = false;
let shutdownFails = false;
let shutdownCalls = 0;
let notificationCalls = 0;
let notifications = false;
let searchMetadata = false;
let editMode = 'direct';
let bulkStateRefusal = false;
let fixtureLang: Lang = 'en';
const notificationMember = { id: 'maya', label: 'Maya', kind: 'human' } as const;
const notificationStacks: NotificationStack[] = (['owned', 'watching', 'due'] as const).map(id => ({
  id, title: { owned: 'Cards you own', watching: 'Cards you watch', due: 'Due Cards' }[id],
  dismissible: id !== 'due', total: 3, hidden: 0, latestAt: id === 'due' ? null : '2026-11-08T12:00:00Z',
  cards: cards.slice(0, 3).map(card => ({ cardId: card.id, title: card.title, deckTitle: 'Tasks',
    latestAt: id === 'due' ? null : '2026-11-08T12:00:00Z', state: card.state, hiddenChanges: 0,
    changes: id === 'due' ? [] : [{ eventId: card.id, actor: 'Alex', at: '2026-11-08T12:00:00Z', lines: ['Card changed'] }] })),
}));
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href);
  if (!url.pathname.startsWith('/api/')) return realFetch(input, init);
  if (url.pathname === '/api/shutdown') {
    shutdownCalls++;
    if (shutdownFails) return Response.json({ message: 'Shutdown refused' }, { status: 503 });
    snapshotFails = true;
    sockets.forEach(socket => socket.disconnect());
    return Response.json({ ok: true });
  }
  if (url.pathname === '/api/snapshot') {
    if (snapshotFails) throw new TypeError('Offline');
    return Response.json({ projectName: 'Shell test', source: 'sandbox', editMode, writable: true, token: 'shell-token', iteration: { number: 1, goal: '', start: '' } });
  }
  if (url.pathname === '/api/catalog') {
    if (bulkStateRefusal && init?.method === 'POST') {
      const request = JSON.parse(String(init.body));
      bulkChanges.push(request.change);
      return Response.json({ message: fixtureLang === 'ru'
        ? 'Агент не может принять собственную работу. Передайте карточку независимому проверяющему.'
        : 'An agent cannot accept its own work. Pass the card to an independent reviewer.' }, { status: 422 });
    }
    return Response.json(searchMetadata ? { ...catalog,
    members: [{ id: 'maya', label: 'Maya Chen', kind: 'human', aliases: ['MC'] }],
    projectTags: [{ name: 'art', color: '#9258e5', emoji: '🎨' }],
    cards: cards.map((card, index) => index === 0 ? { ...card, owner: 'MC', dueDate: '2020-01-01', dependsOn: [cards[1].id], tags: ['art'] } : card),
  } : catalog);
  }
  if (url.pathname === '/api/card-content') {
    const card = cards.find(card => card.id === url.searchParams.get('cardId')) ?? cards[0];
    return Response.json({ cardId: card.id, title: card.title, markdown: card.markdown, sourceHash: card.sourceHash });
  }
  if (url.pathname === '/api/project-pulse') return Response.json({ inProgress: { count: 0, ownerIds: [] }, review: { count: 0, oldestSince: null, deckId: null }, accepted: { days: Array(14).fill(0), total: 0 }, run: null, withoutDeck: 0 });
  if (url.pathname === '/api/notifications') {
    notificationCalls++;
    if (snapshotFails) throw new TypeError('Offline');
    if (notifications) return Response.json({ source: 'sandbox', member: notificationMember, members: [notificationMember],
      writable: true, stacks: notificationStacks, total: 9, watching: [], watchHash: null, today: '2026-11-08', warnings: [] } satisfies NotificationsView);
    return Response.json({ source: 'sandbox', member: null, members: [], stacks: [], total: 0, watching: [], warnings: [] });
  }
  if (url.pathname === '/api/onboarding-facts') return Response.json({ agentSkill: false });
  return Response.json({ entries: [], warnings: [] });
};

function render(scene: 'app' | 'bulk' = 'app', options: { lang?: Lang; theme?: string; view?: string; deck?: boolean; layout?: string; editMode?: string; failSnapshot?: boolean; failShutdown?: boolean; notifications?: boolean; searchMetadata?: boolean; workspace?: boolean | DesktopWorkspaceProject[]; selectionCount?: number; bulkResult?: boolean; bulkStateRefusal?: boolean } = {}) {
  flushSync(() => root.render(null));
  holdReconnect = false;
  snapshotFails = options.failSnapshot ?? false;
  shutdownFails = options.failShutdown ?? false;
  shutdownCalls = 0;
  notificationCalls = 0;
  notifications = options.notifications ?? false;
  const nextSearchMetadata = options.searchMetadata ?? false;
  if (searchMetadata !== nextSearchMetadata) invalidateCatalogs();
  searchMetadata = nextSearchMetadata;
  editMode = options.editMode ?? 'direct';
  bulkStateRefusal = options.bulkStateRefusal ?? false;
  fixtureLang = options.lang ?? 'en';
  bulkChanges.length = 0;
  configureBridge(options.workspace);
  setLang(options.lang ?? 'en');
  localStorage.setItem('deckmate-theme', options.theme ?? 'dark');
  document.documentElement.classList.toggle('dark', options.theme !== 'light');
  history.replaceState(null, '', `/?view=${options.view ?? 'deck'}&catalogSource=sandbox${options.deck ? '&deck=tasks&layout=' + (options.layout ?? 'table') : ''}`);
  if (scene === 'bulk') {
    bulkChanges.length = 0;
    const onAction = async (change: BulkChange) => { bulkChanges.push(change); return options.bulkResult !== false; };
    const bulkCatalog = { ...catalog, tracks: [{ id: 'release', title: 'First release', description: '' }] };
    const selection = Array.from({ length: options.selectionCount ?? 1 }, (_, index) => ({ ...cards[0], id: `card:bulk-${index}` }));
    root.render(<div style={{ width: '100%', padding: 16 }}>{options.selectionCount
      ? <SelectionToolbar selectedCards={selection} totalShown={2000} catalog={bulkCatalog} source="sandbox" pending={false} writable
          onClear={() => {}} onSelectAll={() => {}} onMove={async () => true}
          onAddTrack={trackId => onAction({ kind: 'track', trackId, mode: 'add' })} onAction={onAction} />
      : <BulkActions cards={selection} catalog={bulkCatalog} source="sandbox" pending={false} onAction={onAction} />}</div>);
  } else root.render(<App />);
}
Object.assign(window, { shellTest: {
  render,
  bulkChanges,
  startSave: (duration: number | null = 200) => {
    const finish = beginSave();
    if (duration !== null) setTimeout(() => finish(true), duration);
    return () => finish(true);
  },
  disconnect: (hold = false) => { holdReconnect = hold; snapshotFails = true; sockets.forEach(socket => socket.disconnect()); },
  setLang,
  get shutdownCalls() { return shutdownCalls; },
  get notificationCalls() { return notificationCalls; },
  get workspaceCalls() { return workspaceCalls; },
  setWorkspaceResult: (result: DesktopProjectsResult | 'throw' | null) => { workspaceResult = result; },
  setNavigationFailure: (code: string | null) => { navigationFailure = code; },
  setWorkspaceLoadFails: (value: boolean | string) => { workspaceLoadFails = value; },
  setRecentFails: (value: boolean | string) => { recentFails = value; },
  setSnapshotFails: (value: boolean) => { snapshotFails = value; },
} });
render();
