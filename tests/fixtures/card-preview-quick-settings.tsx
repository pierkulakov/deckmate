import { createRoot } from 'react-dom/client';
import type { CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import type { CatalogAction } from '../../client/useCatalog.ts';
import { CardPreview } from '../../client/components/CardPreview.tsx';
import { CatalogCardTile } from '../../client/components/CatalogCardTile.tsx';
import { buildCatalogLookups } from '../../client/catalog-lookups.ts';
import { setLang } from '../../client/i18n.ts';
import { rememberMember } from '../../client/current-member.ts';
import '../../client/styles.css';
import '../../client/card-material.css';

const root = createRoot(document.getElementById('root')!);
let instance = 0;
let selected: CatalogCard;
let catalog: CatalogView;
let finishSave: ((saved: boolean) => void) | undefined;
let options: RenderOptions = {};
const actions: CatalogAction[] = [];
const noop = () => {};

type RenderOptions = { familyOnly?: boolean; writable?: boolean; pending?: boolean; child?: boolean; journey?: boolean; holdSave?: boolean; saveResult?: boolean; saveFailure?: 'conflict' | 'network' | 'saved-warning'; noMembers?: boolean; checked?: boolean; card?: Partial<CatalogCard> };

// 2026-11-08: exercise the actual preview and Radix focus handling without a filesystem write or a built dist/.
window.fetch = async input => {
  if (String(input).startsWith('/api/attachments')) return Response.json({ hash: '', files: [], warnings: [] });
  if (String(input).startsWith('/api/notifications')) return Response.json({ watching: [], watchHash: 'watch-hash' });
  return Response.json({ cardId: selected.id, title: selected.title, markdown: selected.markdown, sourceHash: selected.sourceHash });
};

function apply(action: CatalogAction) {
  if (action.action === 'set-card-properties') selected = { ...selected, owner: action.owner, priority: action.priority, effort: action.effort, sourceHash: selected.sourceHash + '-saved' };
  else if (action.action === 'bulk-edit-cards' && action.change.kind === 'hand') {
    const { memberId, mode } = action.change;
    const members = new Set(selected.handMemberIds ?? []);
    if (mode === 'add') members.add(memberId);
    else members.delete(memberId);
    selected = { ...selected, handMemberIds: [...members], sourceHash: selected.sourceHash + '-saved' };
  } else return;
  catalog = { ...catalog, cards: catalog.cards.map(card => card.id === selected.id ? selected : card) };
}

function paint() {
  root.render(<><div style={{ position: 'absolute', left: 40, top: 40, width: 'var(--tile-width)' }}><CatalogCardTile key={instance} card={selected}
    lookups={buildCatalogLookups(catalog.cards)} members={catalog.members ?? []} selected={false} checked={options.checked ?? false}
    selectionActive={false} disabled={options.pending ?? false} onOpen={noop} onToggle={noop} onFamilyOpen={noop} /></div>
    {!options.familyOnly && <div style={{ width: 496, margin: '40px auto' }}><CardPreview key={instance} card={selected} catalog={catalog}
    snapshot={{ projectName: 'Quick Settings', source: 'sandbox', writable: true, editMode: 'direct', iteration: { number: 1, goal: '', start: '' } }}
    writable={options.writable ?? true} pending={options.pending ?? false} onClose={noop} onSelect={noop} onDirtyChange={noop}
    onEdit={async action => {
      actions.push(action);
      if (options.saveFailure === 'network') throw new TypeError('Offline');
      if (options.saveFailure === 'conflict') { refresh(); return false; }
      // 2026-11-11: a saved-warning can resolve true before a refreshed catalog confirms membership.
      if (options.saveFailure === 'saved-warning') return true;
      const save = (saved: boolean) => {
        if (saved) { apply(action); paint(); }
        return saved;
      };
      if (options.holdSave) return new Promise<boolean>(resolve => { finishSave = (saved = true) => resolve(save(saved)); });
      return save(options.saveResult ?? true);
    }} /></div>}</>);
}

function refresh() {
  selected = { ...selected, sourceHash: selected.sourceHash + '-refreshed' };
  catalog = { ...catalog, cards: catalog.cards.map(card => card.id === selected.id ? selected : card) };
  paint();
}

function render(kind: CatalogCard['kind'] = 'task', nextOptions: RenderOptions = {}) {
  setLang('en');
  rememberMember('alex');
  options = nextOptions;
  actions.length = 0;
  finishSave = undefined;
  selected = { id: 'card:preview', kind, title: `${kind} preview`, path: 'cards/preview.md', version: null,
    state: kind === 'task' ? 'not-started' : null, owner: null, markdown: 'Card text remains visible.',
    sourceHash: 'card-hash', range: null, deckId: null, trackIds: [], parentId: options.child ? 'card:parent' : null,
    effort: kind === 'doc' ? null : 2, priority: kind === 'doc' ? null : 'medium', run: 'run-one', milestone: 'milestone-one',
    ...(options.journey ? { journey: { journeyId: 'pipeline', instanceId: 'instance', stepId: 'step', version: 1 } } : {}), ...options.card };
  catalog = { rootIdentity: 'preview-test', documents: [], cards: [selected], spaces: [], decks: [], tracks: [], warnings: [],
    formatLanguage: 'en', manifestHash: 'manifest-hash', optionsHash: 'options-hash', configured: true, indexedAt: '',
    members: options.noMembers ? [] : [{ id: 'alex', label: 'Alex', kind: 'human', aliases: [] }, { id: 'sam', label: 'Sam', kind: 'human', aliases: [] }], runs: [], milestones: [] };
  if (options.child) catalog.cards.push({ ...selected, id: 'card:parent', kind: 'hero', parentId: null, title: 'Parent Hero' });
  instance++;
  paint();
}

Object.assign(window, { previewTest: { render, actions, finishSave: (saved = true) => finishSave?.(saved), card: () => selected,
  refresh,
  setPending: (pending: boolean) => { options.pending = pending; paint(); }, rememberMember } });
render();
