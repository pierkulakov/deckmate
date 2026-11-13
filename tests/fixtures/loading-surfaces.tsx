import { lazy, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { LazySection } from '../../client/components/LazySection.tsx';
import { LoadingState } from '../../client/components/LoadingState.tsx';
import { preparedResource } from '../../client/prepared-resource.ts';
import { setLang } from '../../client/i18n.ts';
import type { CatalogView } from '../../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import '../../client/styles.css';
import '../../client/surface.css';
import '../../client/workspace.css';
import '../../client/motion.css';

const params = new URLSearchParams(location.search);
const screen = params.get('screen') ?? 'hand';
const dark = params.get('theme') === 'dark';
setLang('ru');
document.documentElement.classList.toggle('dark', dark);
localStorage.setItem('deckmate-current-member', 'maya');
localStorage.setItem('deckmate-vision-board-sandbox', 'loading-board');
let releaseCode!: () => void, releaseData!: () => void;
const code = new Promise<void>(resolve => { releaseCode = resolve; });
const data = new Promise<void>(resolve => { releaseData = resolve; });
const snapshot: WorkspaceSnapshot = { source: 'sandbox', writable: true, editMode: 'direct', projectName: 'Загрузка', iteration: { number: 1, goal: '', start: '' } };
const catalog: CatalogView = { rootIdentity: 'loading-surfaces', formatLanguage: 'ru', manifestHash: 'manifest', configured: true, indexedAt: '',
  cards: [], documents: [], decks: [], spaces: [], tracks: [], warnings: [], runs: [], milestones: [],
  members: [{ id: 'maya', label: 'Майя', kind: 'human', aliases: [] }] };
const board = { id: 'loading-board', title: 'Доска проекта', path: 'boards/loading.excalidraw', hash: 'board-hash',
  access: 'editable', linkedCardIds: [], warnings: [], updatedAt: '',
  scene: { type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} } };
let reads = 0;
const fetchOriginal = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href);
  if (!url.pathname.startsWith('/api/')) return fetchOriginal(input, init);
  reads++;
  await data;
  if (url.pathname === '/api/catalog') return Response.json(params.has('empty') ? { ...catalog, members: [] } : catalog);
  if (url.pathname === '/api/boards') return Response.json([board]);
  if (url.pathname.startsWith('/api/boards/')) return Response.json(board);
  return Response.json({});
};
const loaders = {
  hand: () => import('../../client/components/Hand.tsx').then(module => ({ default: () => <module.Hand snapshot={snapshot} refreshKey={0} onOpenCard={() => {}} onOpenMembers={() => {}} /> })),
  timeline: () => import('../../client/components/TimelineView.tsx').then(module => ({ default: () => <module.TimelineView snapshot={snapshot} refreshKey={0} onOpenCard={() => {}} /> })),
  vision: () => import('../../client/components/Vision.tsx').then(module => ({ default: () => <module.default snapshot={snapshot} refreshKey={0} dark={dark} onEditing={() => {}} onOpenCard={() => {}} /> })),
  members: () => import('../../client/components/MembersEditor.tsx').then(module => ({ default: () => <module.MembersEditor snapshot={snapshot} refreshKey={0} open onOpenChange={() => {}} /> })),
};
const resource = preparedResource(async () => {
  await code;
  return loaders[screen as keyof typeof loaders]();
});
const Screen = lazy(resource.load);
function Probe() {
  const [active, setActive] = useState(true);
  const [attempt, setAttempt] = useState(0);
  Object.assign(window, { startProbe: () => flushSync(() => { setActive(true); setAttempt(value => value + 1); }), finishProbe: () => setActive(false) });
  return <><LoadingState key={attempt} active={active} variant={params.has('skeleton') ? 'skeleton' : 'plate'} /><button id="anchor">Действие</button></>;
}
function Surface() {
  const [open, setOpen] = useState(true);
  return <><p id="retained" style={{ position: 'fixed', bottom: 0, left: 0 }}>Рабочая область</p>
    {open && <LazySection mode={screen === 'members' ? 'dialog' : 'page'} onClose={() => setOpen(false)}><Screen /></LazySection>}
  </>;
}
Object.assign(window, { loadingTest: { releaseCode, releaseData, get reads() { return reads; } } });
if (params.has('auto')) { releaseCode(); releaseData(); }
createRoot(document.getElementById('root')!).render(<main className="workspace-main" style={{ height: '100dvh', position: 'relative' }}>
  {screen === 'probe' ? <Probe /> : <Surface />}
</main>);
