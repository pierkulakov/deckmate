import { createRoot } from 'react-dom/client';
import { TimelineView } from '../../client/components/TimelineView.tsx';
import { BulkActions } from '../../client/components/BulkActions.tsx';
import { localIsoDate } from '../../src/catalog-hand.ts';
import type { CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import { setLang } from '../../client/i18n.ts';
import '../../client/styles.css';
import '../../client/motion.css';
import '../../client/surface.css';

const parameters = new URLSearchParams(location.search);
setLang('en');
document.documentElement.classList.toggle('dark', parameters.get('theme') === 'dark');
const card: CatalogCard = { id: 'card:handoff', title: 'Planned card', kind: 'task', path: 'cards/planned.md',
  markdown: '', state: 'not-started', owner: null, sourceHash: 'card-hash', version: null, range: null,
  deckId: null, trackIds: [], parentId: null };
const catalog: CatalogView = { rootIdentity: 'planning-menu-handoff', documents: [], cards: [card], spaces: [], decks: [], tracks: [],
  warnings: [], formatLanguage: 'en', manifestHash: 'manifest', configured: true, indexedAt: '',
  members: [{ id: 'builder', label: 'Builder', kind: 'human', aliases: [] }], runs: [],
  milestones: [1, 2].map(index => ({ id: `milestone-${index}`, title: `Milestone ${index}`, date: localIsoDate(), color: '#687e9c' })) };
const snapshot: WorkspaceSnapshot = { source: 'sandbox', writable: true, projectName: 'Planning', editMode: 'direct',
  iteration: { number: 1, goal: '', start: '' } };
window.fetch = async () => Response.json(catalog);
createRoot(document.getElementById('root')!).render(<main style={{ padding: 16 }}>
  {parameters.get('screen') === 'bulk'
    ? <BulkActions cards={[card]} catalog={catalog} pending={false} onAction={async () => true} source="sandbox" />
    : <TimelineView snapshot={snapshot} refreshKey={0} onOpenCard={() => {}} />}
</main>);
