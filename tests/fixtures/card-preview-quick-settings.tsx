import { createRoot } from 'react-dom/client';
import type { CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import type { CatalogAction } from '../../client/useCatalog.ts';
import { CardPreview } from '../../client/components/CardPreview.tsx';
import { CatalogCardTile } from '../../client/components/CatalogCardTile.tsx';
import { buildCatalogLookups } from '../../client/catalog-lookups.ts';
import { setLang } from '../../client/i18n.ts';
import '../../client/styles.css';
import '../../client/card-material.css';

const root = createRoot(document.getElementById('root')!);
let instance = 0;
let selected: CatalogCard;
let finishSave: ((saved: boolean) => void) | undefined;
const actions: CatalogAction[] = [];
const noop = () => {};

// 2026-11-08: exercise the actual preview and Radix focus handling without a filesystem write or a built dist/.
window.fetch = async () => Response.json({ cardId: selected.id, title: selected.title, markdown: selected.markdown, sourceHash: selected.sourceHash });

function render(kind: CatalogCard['kind'] = 'task', options: { writable?: boolean; pending?: boolean; child?: boolean; journey?: boolean; holdSave?: boolean; saveResult?: boolean; checked?: boolean } = {}) {
  setLang('en');
  actions.length = 0;
  selected = { id: 'card:preview', kind, title: `${kind} preview`, path: 'cards/preview.md', version: null,
    state: kind === 'task' ? 'not-started' : null, owner: null, markdown: 'Card text remains visible.',
    sourceHash: 'card-hash', range: null, deckId: null, trackIds: [], parentId: options.child ? 'card:parent' : null,
    effort: kind === 'doc' ? null : 2, priority: kind === 'doc' ? null : 'medium', run: 'run-one', milestone: 'milestone-one',
    ...(options.journey ? { journey: { journeyId: 'pipeline', instanceId: 'instance', stepId: 'step', version: 1 } } : {}) };
  const catalog: CatalogView = { rootIdentity: 'preview-test', documents: [], cards: [selected], spaces: [], decks: [], tracks: [], warnings: [],
    formatLanguage: 'en', manifestHash: 'manifest-hash', optionsHash: 'options-hash', configured: true, indexedAt: '',
    members: [{ id: 'alex', label: 'Alex', kind: 'human', aliases: [] }], runs: [], milestones: [] };
  if (options.child) catalog.cards.push({ ...selected, id: 'card:parent', kind: 'hero', parentId: null, title: 'Parent Hero' });
  instance++;
  root.render(<><div style={{ position: 'absolute', left: 40, top: 40, width: 115 }}><CatalogCardTile key={instance} card={selected}
    lookups={buildCatalogLookups(catalog.cards)} members={catalog.members ?? []} selected={false} checked={options.checked ?? false}
    selectionActive={false} disabled={options.pending ?? false} onOpen={noop} onToggle={noop} onFamilyOpen={noop} /></div>
    <div style={{ width: 496, margin: '40px auto' }}><CardPreview key={instance} card={selected} catalog={catalog}
    snapshot={{ projectName: 'Quick Settings', source: 'sandbox', writable: true, editMode: 'direct', iteration: { number: 1, goal: '', start: '' } }}
    writable={options.writable ?? true} pending={options.pending ?? false} onClose={noop} onSelect={noop} onDirtyChange={noop}
    onEdit={async action => {
      actions.push(action);
      if (options.holdSave) return new Promise<boolean>(resolve => { finishSave = resolve; });
      return options.saveResult ?? true;
    }} /></div></>);
}

Object.assign(window, { previewTest: { render, actions, finishSave: (saved = true) => finishSave?.(saved) } });
render();
