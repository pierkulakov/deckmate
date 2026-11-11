import { createRoot } from 'react-dom/client';
import type { CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import type { CatalogAction } from '../../client/useCatalog.ts';
import { CardPreview } from '../../client/components/CardPreview.tsx';
import { CatalogCardTile } from '../../client/components/CatalogCardTile.tsx';
import { DeckPicker } from '../../client/components/DeckPicker.tsx';
import { Hand } from '../../client/components/Hand.tsx';
import { invalidateCatalogs } from '../../client/catalog-store.ts';
import { buildCatalogLookups } from '../../client/catalog-lookups.ts';
import { catalogHandPositions } from '../../src/catalog-hand.ts';
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
let familyVisible = false;
const actions: CatalogAction[] = [];
const noop = () => {};
const snapshot = { projectName: 'Quick Settings', source: 'sandbox' as const, writable: true, editMode: 'direct' as const, iteration: { number: 1, goal: '', start: '' } };

type RenderOptions = { familyOnly?: boolean; writable?: boolean; pending?: boolean; child?: boolean; journey?: boolean; holdSave?: boolean; saveResult?: boolean; saveFailure?: 'conflict' | 'network' | 'saved-warning'; noMembers?: boolean; checked?: boolean; card?: Partial<CatalogCard>; children?: Partial<CatalogCard>[]; extraCards?: Partial<CatalogCard>[]; lang?: 'en' | 'ru' };

// 2026-11-08: exercise the actual preview and Radix focus handling without a filesystem write or a built dist/.
window.fetch = async input => {
  if (String(input).startsWith('/api/catalog')) return Response.json(catalog);
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
  if (new URLSearchParams(location.search).get('view') === 'hand') {
    root.render(<Hand snapshot={snapshot} refreshKey={instance} onOpenCard={noop} onOpenMembers={noop} />);
    return;
  }
  if (new URLSearchParams(location.search).get('view') === 'picker') {
    // 2026-11-11: the New Card composer's deck picker shows the shared hint without the quick-settings wrapper.
    root.render(<div style={{ position: 'absolute', left: 40, top: 40 }}><DeckPicker catalog={catalog}
      decks={catalog.decks.length ? catalog.decks : [{ id: 'deck-one', spaceId: 'space-one', title: 'Harbor', kind: 'task', description: '', color: '#687e9c', icon: '' }]}
      shown={undefined} current={null} noneLabel="No deck" text="Deck" onChoose={noop} /></div>);
    return;
  }
  root.render(<><div style={{ position: 'absolute', left: 40, top: 40, width: 'var(--tile-width)' }}><CatalogCardTile key={instance} card={selected}
    lookups={buildCatalogLookups(catalog.cards)} members={catalog.members ?? []} handPositions={catalogHandPositions(catalog).get(selected.id)} selected={false} checked={options.checked ?? false}
    selectionActive={false} disabled={options.pending ?? false} onOpen={noop} onToggle={noop} onFamilyOpen={noop} /></div>
    {!options.familyOnly && <div style={{ width: 'min(496px, 100%)', margin: '40px auto' }}><CardPreview key={instance} card={selected} catalog={catalog}
    snapshot={snapshot}
    writable={options.writable ?? true} pending={options.pending ?? false} onClose={noop} onSelect={noop} onDirtyChange={noop}
    onShowFamily={() => { familyVisible = true; paint(); }} onToggleFamily={() => { familyVisible = !familyVisible; paint(); }} familyVisible={familyVisible}
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
  history.replaceState(null, '', location.pathname);
  invalidateCatalogs();
  setLang(nextOptions.lang ?? 'en');
  rememberMember('alex');
  options = nextOptions;
  actions.length = 0;
  finishSave = undefined;
  familyVisible = false;
  selected = { id: 'card:preview', kind, title: `${kind} preview`, path: 'cards/preview.md', version: null,
    state: kind === 'task' ? 'not-started' : null, owner: null, markdown: 'Card text remains visible.',
    sourceHash: 'card-hash', range: null, deckId: null, trackIds: [], parentId: options.child ? 'card:parent' : null,
    effort: kind === 'doc' ? null : 2, priority: kind === 'doc' ? null : 'medium', run: 'run-one', milestone: 'milestone-one',
    ...(options.journey ? { journey: { journeyId: 'pipeline', instanceId: 'instance', stepId: 'step', version: 1 } } : {}), ...options.card };
  catalog = { rootIdentity: 'preview-test', documents: [], cards: [selected], spaces: [], decks: [], tracks: [], warnings: [],
    formatLanguage: 'en', manifestHash: 'manifest-hash', optionsHash: 'options-hash', configured: true, indexedAt: '',
    members: options.noMembers ? [] : [{ id: 'alex', label: 'Alex', kind: 'human', aliases: [] }, { id: 'sam', label: 'Sam', kind: 'human', aliases: [] }],
    runs: [{ id: 'run-one', number: 1, goal: 'Harbor prototype', start: '2026-11-01', end: '2026-12-15' }],
    milestones: [{ id: 'milestone-one', title: 'First playable', date: '2026-12-20', color: '#687e9c' }] };
  if (options.child) catalog.cards.push({ ...selected, id: 'card:parent', kind: 'hero', parentId: null, title: 'Parent Hero' });
  for (const [index, child] of (options.children ?? []).entries()) catalog.cards.push({ ...selected, id: `card:child-${index}`, kind: 'task', parentId: selected.id, ...child });
  for (const [index, extra] of (options.extraCards ?? []).entries()) catalog.cards.push({ ...selected, id: `card:extra-${index}`, ...extra });
  instance++;
  paint();
}

Object.assign(window, { previewTest: { render, actions, finishSave: (saved = true) => finishSave?.(saved), card: () => selected,
  refresh,
  setPending: (pending: boolean) => { options.pending = pending; paint(); }, rememberMember } });
window.addEventListener('popstate', paint);
render();
