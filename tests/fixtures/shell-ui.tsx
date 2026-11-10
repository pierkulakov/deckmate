import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import App from '../../client/App.tsx';
import { BulkActions } from '../../client/components/BulkActions.tsx';
import { setLang, type Lang } from '../../client/i18n.ts';
import { beginSave } from '../../client/save-activity.ts';
import type { CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import type { NotificationStack, NotificationsView } from '../../src/notification-contracts.ts';
import type { DesktopRecentProject, DesktopWorkspaceProject, DesktopWorkspaceResult } from '../../client/desktop-bridge.ts';
import '../../client/styles.css';
import '../../client/surface.css';
import '../../client/motion.css';
import '../../client/card-material.css';

const root = createRoot(document.getElementById('root')!);
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
  { path: 'D:\\Work\\Shared\\Игровая-команда\\Подготовка-первого-релиза', name: 'Подготовка-первого-релиза', lastOpened: new Date(Date.now() - 7200000).toISOString(), current: false },
  { path: 'D:\\WWWWWWWWWWWWWWWWWWWW\\WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW', name: 'Wide glyphs', lastOpened: new Date(Date.now() - 86400000).toISOString(), current: false },
];
const current: DesktopWorkspaceProject = { path: 'C:\\Work\\Shell test', name: 'Shell test', current: true, missing: false };
const initialWorkspace: DesktopWorkspaceProject[] = [current,
  { ...recent[0], name: 'Подготовка первого большого релиза и локализации', missing: false },
  { ...recent[1], missing: false },
  { path: 'E:\\Archive\\Lost project', name: 'Lost project', current: false, missing: true },
];
let workspaceProjects: DesktopWorkspaceProject[] = [];
let workspaceCalls: { method: string; args: unknown[] }[] = [];
let workspaceResult: DesktopWorkspaceResult | 'throw' | null = null;
let navigationFailure: string | null = null;
let workspaceLoadFails = false;
let recentFails = false;
function workspaceReply(next: DesktopWorkspaceProject[]): DesktopWorkspaceResult {
  if (workspaceResult === 'throw') throw new Error('Bridge unavailable');
  const reply = workspaceResult ?? { ok: true, projects: next };
  if (reply.ok) workspaceProjects = reply.projects;
  return reply;
}
function configureBridge(workspace?: boolean | DesktopWorkspaceProject[], partial = false) {
  workspaceProjects = Array.isArray(workspace) ? workspace : initialWorkspace.map(project => ({ ...project }));
  workspaceCalls = []; workspaceResult = null; navigationFailure = null; workspaceLoadFails = false; recentFails = false;
  window.deckmateBoard = {
    recentProjects: async () => {
      if (recentFails) throw new Error('Recent unavailable');
      return [ ...recent, { path: 'C:\\Work\\Field Notes', name: 'Field Notes', current: false, lastOpened: '' } ];
    },
    switchProject: async path => { workspaceCalls.push({ method: 'switch', args: [path] }); return navigationFailure ? { ok: false, code: navigationFailure } : { ok: true }; },
    showStartScreen: async () => { workspaceCalls.push({ method: 'start', args: [] }); return navigationFailure ? { ok: false, code: navigationFailure } : { ok: true }; },
  };
  // Preserve the legacy fixture's two recent rows for the existing shell-layout checks.
  if (!workspace && !partial) window.deckmateBoard.recentProjects = async () => recent;
  if (!workspace && !partial) return;
  window.deckmateBoard.workspaceProjects = async () => {
    if (workspaceLoadFails) throw new Error('Workspace unavailable');
    return workspaceProjects;
  };
  if (partial) return;
  window.deckmateBoard.addToWorkspace = async source => {
    workspaceCalls.push({ method: 'add', args: [source] });
    let project = current;
    if (source.kind === 'dialog') project = { path: 'C:\\Chosen', name: 'Chosen project', current: false, missing: false };
    if (source.kind === 'recent') project = { ...(await window.deckmateBoard!.recentProjects()).find(entry => entry.path === source.path)!, missing: false };
    return workspaceReply([...workspaceProjects, project]);
  };
  window.deckmateBoard.removeFromWorkspace = async path => {
    workspaceCalls.push({ method: 'remove', args: [path] });
    return workspaceReply(workspaceProjects.filter(project => project.path !== path));
  };
  window.deckmateBoard.moveInWorkspace = async (path, index) => {
    workspaceCalls.push({ method: 'move', args: [path, index] });
    const next = [...workspaceProjects];
    const [project] = next.splice(next.findIndex(entry => entry.path === path), 1);
    next.splice(index, 0, project);
    return workspaceReply(next);
  };
}

// 2026-11-08: exercise the real useWorkspace shutdown/reconnect race without stopping a shared server.
const sockets = new Set<FakeSocket>();
class FakeSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { sockets.add(this); setTimeout(() => this.onopen?.(), 0); }
  close() { sockets.delete(this); }
  disconnect() { this.onclose?.(); }
}
window.WebSocket = FakeSocket as unknown as typeof WebSocket;
let snapshotFails = false;
let shutdownFails = false;
let shutdownCalls = 0;
let notificationCalls = 0;
let notifications = false;
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
    return Response.json({ projectName: 'Shell test', source: 'sandbox', editMode: 'direct', writable: true, token: 'shell-token', iteration: { number: 1, goal: '', start: '' } });
  }
  if (url.pathname === '/api/catalog') return Response.json(catalog);
  if (url.pathname === '/api/card-content') {
    const card = cards.find(card => card.id === url.searchParams.get('cardId')) ?? cards[0];
    return Response.json({ ...card, markdown: card.markdown, content: card.markdown });
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

function render(scene: 'app' | 'bulk' = 'app', options: { lang?: Lang; theme?: string; view?: string; deck?: boolean; layout?: string; failShutdown?: boolean; notifications?: boolean; workspace?: boolean | DesktopWorkspaceProject[]; partialBridge?: boolean } = {}) {
  flushSync(() => root.render(null));
  snapshotFails = false;
  shutdownFails = options.failShutdown ?? false;
  shutdownCalls = 0;
  notificationCalls = 0;
  notifications = options.notifications ?? false;
  configureBridge(options.workspace, options.partialBridge);
  setLang(options.lang ?? 'en');
  localStorage.setItem('deckmate-theme', options.theme ?? 'dark');
  document.documentElement.classList.toggle('dark', options.theme !== 'light');
  history.replaceState(null, '', `/?view=${options.view ?? 'deck'}&catalogSource=sandbox${options.deck ? '&deck=tasks&layout=' + (options.layout ?? 'table') : ''}`);
  if (scene === 'bulk') {
    root.render(<div style={{ width: '100%', padding: 16 }}><BulkActions cards={[cards[0]]} catalog={catalog} source="sandbox" pending={false} onAction={async () => true} /></div>);
  } else root.render(<App />);
}
Object.assign(window, { shellTest: {
  render,
  startSave: () => { const finish = beginSave(); setTimeout(() => finish(true), 200); },
  disconnect: () => { snapshotFails = true; sockets.forEach(socket => socket.disconnect()); },
  get shutdownCalls() { return shutdownCalls; },
  get notificationCalls() { return notificationCalls; },
  get workspaceCalls() { return workspaceCalls; },
  setWorkspaceResult: (result: DesktopWorkspaceResult | 'throw' | null) => { workspaceResult = result; },
  setNavigationFailure: (code: string | null) => { navigationFailure = code; },
  setWorkspaceLoadFails: (value: boolean) => { workspaceLoadFails = value; },
  setRecentFails: (value: boolean) => { recentFails = value; },
} });
render();
