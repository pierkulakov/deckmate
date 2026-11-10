import { createRoot } from 'react-dom/client';
import Vision from '../../client/components/Vision.tsx';
import { setLang } from '../../client/i18n.ts';
import { catalogStore } from '../../client/catalog-store.ts';
import type { CatalogView } from '../../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import type { BoardDocument, BoardSummary } from '../../src/board-contracts.ts';
import '../../client/styles.css';
import '../../client/surface.css';
import '../../client/workspace.css';
import '../../client/motion.css';

// The chrome suite needs a real saved board: the caption, the access pill and the reference link only exist with one.
const board: BoardDocument = { id: 'board-1', title: 'Chrome board', hash: 'hash-1', path: 'boards/chrome.excalidraw', linkedCardIds: ['c-1'],
  updatedAt: '2026-11-10T00:00:00.000Z', access: 'editable', warnings: [],
  scene: { type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} } };
const list: BoardSummary[] = [board];
const catalog: CatalogView = { rootIdentity: 'vision-chrome-test', documents: [], cards: [
  { id: 'c-1', kind: 'task', path: 'cards/one.md', version: null, title: 'One', state: 'not-started', owner: null, markdown: '',
    sourceHash: 'h1', range: null, deckId: 'd-1', trackIds: [], parentId: null, tags: [] },
], spaces: [{ id: 's-1', title: 'Showcase' }], decks: [{ id: 'd-1', spaceId: 's-1', title: 'Deck one', kind: 'task', description: '', color: '#446688', icon: 'box' }],
  tracks: [], warnings: [], formatLanguage: 'en', manifestHash: 'hash', optionsHash: 'hash', configured: true, indexedAt: '', members: [], runs: [], milestones: [], projectTags: [], journeys: [] };
const snapshot: WorkspaceSnapshot & { token: string } = { projectName: 'Chrome', source: 'sandbox', writable: true, editMode: 'direct', token: 'test', iteration: { number: 1, goal: '', start: '' } };
window.fetch = async input => {
  const path = new URL(String(input), location.origin).pathname;
  if (path === '/api/catalog') return Response.json(catalog);
  if (path === '/api/boards/board-1') return Response.json(board);
  return Response.json(list);
};
async function render() {
  await catalogStore('sandbox').refresh();
  setLang('en');
  // Dark is the product default; ?theme=light flips the html class and the prop the same way the app's toggle does.
  const dark = new URLSearchParams(location.search).get('theme') !== 'light';
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem('deckmate-vision-board-sandbox', 'board-1');
  createRoot(document.getElementById('root')!).render(<main className="workspace-main" style={{ height: '100vh' }}>
    <Vision snapshot={snapshot} refreshKey={0} dark={dark} onEditing={() => {}} onOpenCard={() => {}} />
  </main>);
}
void render();
