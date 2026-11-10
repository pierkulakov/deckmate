import { createRoot } from 'react-dom/client';
import { Deck } from '../../client/components/Deck.tsx';
import { setLang } from '../../client/i18n.ts';
import { catalogStore } from '../../client/catalog-store.ts';
import type { CatalogView } from '../../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import '../../client/styles.css';
import '../../client/card-material.css';
import '../../client/motion.css';

const snapshot: WorkspaceSnapshot & { token: string } = { projectName: 'Test', source: 'sandbox', writable: true, editMode: 'direct', token: 'test', iteration: { number: 1, goal: '', start: '' } };
const catalog: CatalogView = { rootIdentity: 'empty-deck-test', documents: [], cards: [], spaces: [{ id: 'work', title: 'Work' }],
  decks: [{ id: 'empty', title: 'Empty', kind: 'task', spaceId: 'work', description: '', color: '#446688', icon: 'box' }],
  tracks: [], warnings: [], formatLanguage: 'en', manifestHash: 'hash', optionsHash: 'hash', configured: true, indexedAt: '', members: [], runs: [], milestones: [], projectTags: [], journeys: [] };
window.fetch = async input => new URL(String(input), location.origin).pathname === '/api/catalog' ? Response.json(catalog) : Response.json({ files: [], warnings: [], events: [], nextCursor: null, created: null });
async function render() {
  await catalogStore('sandbox').refresh();
  setLang('en');
  history.replaceState(null, '', '?view=deck&deck=empty&catalogSource=sandbox');
  createRoot(document.getElementById('root')!).render(<main className="workspace-main" style={{ height: '100vh' }}><Deck refreshKey={0} snapshot={snapshot} /></main>);
}
void render();
