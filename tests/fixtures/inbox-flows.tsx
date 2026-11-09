import { createRoot } from 'react-dom/client';
import { useRef } from 'react';
import type { CatalogAction } from '../../client/useCatalog.ts';
import type { CatalogCard, CatalogDeck, CatalogView, DeckKind } from '../../src/catalog-contracts.ts';
import { CardFamilyComposer } from '../../client/components/CardFamilyComposer.tsx';
import { Deck, DeckCoverTile, DeckSettingsForm } from '../../client/components/Deck.tsx';
import { catalogStore } from '../../client/catalog-store.ts';
import { DocumentPreviewProvider } from '../../client/components/DocumentPreview.tsx';
import type { ProjectPulse } from '../../src/pulse-contracts.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import { setLang } from '../../client/i18n.ts';
import '../../client/styles.css';
import '../../client/deck-cover.css';
import '../../client/deck-settings.css';
import '../../client/card-family.css';
import '../../client/workspace.css';
import '../../client/project-templates.css';

// 2026-11-08: Inbox flows — the Sub Card composer's automatic deck choice, the Inbox mark on a cover,
// and the Inbox checkbox of deck settings; rendered for real, driven from inbox-flows.test.ts over CDP.
const root = createRoot(document.getElementById('root')!);
let instance = 0;
const actions: CatalogAction[] = [];
const created: Array<{ cardId: string; deckId: string }> = [];
const noop = () => {};
const realFetch = window.fetch.bind(window);

interface DeckSpec { id: string; title: string; kind: DeckKind }

function catalogOf(decks: DeckSpec[], inboxDeckId: string | null | undefined, parent?: CatalogCard): CatalogView {
  return { rootIdentity: 'inbox-flows', documents: [], cards: parent ? [parent] : [], spaces: [{ id: 'space:one', title: 'Work' }],
    decks: decks.map(deck => ({ id: deck.id, title: deck.title, kind: deck.kind, spaceId: 'space:one', description: '', color: '#878787', icon: 'layers' })),
    tracks: [], warnings: [], formatLanguage: 'en', manifestHash: 'manifest-hash', configured: true, indexedAt: '', inboxDeckId } as CatalogView;
}

const parent: CatalogCard = { id: 'card:hero', kind: 'hero', title: 'Hero card', path: 'cards/hero.md', version: null,
  state: null, owner: null, markdown: '', sourceHash: 'hero-hash', range: null, deckId: 'deck:art', trackIds: [], parentId: null };

function SettingsShell({ catalog, source }: { catalog: CatalogView; source: 'sandbox' }) {
  const opener = useRef<HTMLElement>(null);
  return <DeckSettingsForm opener={opener} dirty={false} creation={{ kind: 'deck', deckId: 'deck:one', editing: true }}
    catalog={catalog} source={source} disabled={false} pending={false} onCancel={noop} onSaved={noop}
    onSubmit={async action => { actions.push(action); return true; }} onDirtyChange={noop} />;
}

function render(scene: 'family' | 'cover' | 'settings' | 'gallery', options: Record<string, unknown> = {}) {
  setLang(options.lang === 'ru' ? 'ru' : 'en');
  window.fetch = realFetch;
  actions.length = 0;
  created.length = 0;
  if (scene === 'family') {
    const decks = (options.decks as DeckSpec[]) ?? [{ id: 'deck:trips', title: 'Trips', kind: 'task' }];
    try { localStorage.setItem('deckmate:recent-decks:inbox-flows', JSON.stringify(options.recent ?? [])); } catch { /* storage is optional */ }
    root.render(<div style={{ width: 379, padding: '16px' }}><CardFamilyComposer key={++instance} parent={parent}
      catalog={catalogOf(decks, options.inboxDeckId as string | null ?? null, parent)} initialDeckId={options.initialDeckId as string | undefined}
      pending={false} onCreate={async action => { actions.push(action); return true; }} onCancel={noop}
      onCreated={(cardId, deckId) => created.push({ cardId, deckId })} onDirtyChange={noop} /></div>);
    return;
  }
  if (scene === 'cover') {
    const deck: CatalogDeck = { id: 'deck:trips', title: String(options.title ?? 'Trips'), kind: 'task', spaceId: 'space:one', description: '', color: '#9258e5', icon: 'layers' };
    root.render(<div className="catalog-deck-grid" style={{ padding: 24 }}><DeckCoverTile key={++instance} deck={deck}
      counts={{ open: 0, accepted: 0, tasks: 0 }} source="sandbox" disabled={false} writable={false} inbox={Boolean(options.inbox)}
      canOpen={() => true} onOpen={noop} onSettings={noop} /></div>);
    return;
  }
  if (scene === 'gallery') {
    history.replaceState(null, '', '/');
    const catalog = catalogOf(options.empty ? [] : Array.from({ length: 8 }, (_, index) => ({ id: `deck:${index}`, title: `Deck ${index}`, kind: 'task' })), null);
    if (options.spaces) catalog.spaces = options.spaces as CatalogView['spaces'];
    const pulse: ProjectPulse = { inProgress: { count: 0, ownerIds: [] }, review: { count: 0, oldestSince: null, deckId: null }, accepted: { days: Array(14).fill(0), total: 0 }, run: null, withoutDeck: 0 };
    window.fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith('/api/catalog?')) return Response.json(catalog);
      if (url.startsWith('/api/project-pulse?')) return Response.json(pulse);
      if (url === '/api/catalog' && init?.method === 'POST') {
        const action = JSON.parse(String(init.body)) as CatalogAction;
        actions.push(action);
        if (action.action === 'move-space') {
          const space = catalog.spaces.find(space => space.id === action.spaceId)!;
          catalog.spaces = catalog.spaces.filter(candidate => candidate !== space);
          const index = action.beforeSpaceId === null ? catalog.spaces.length : catalog.spaces.findIndex(space => space.id === action.beforeSpaceId);
          catalog.spaces.splice(index, 0, space);
        }
        if (action.action === 'update-space') Object.assign(catalog.spaces.find(space => space.id === action.spaceId)!, { title: action.title, kind: action.kind, icon: action.icon });
        catalog.manifestHash += '-saved';
        return Response.json(structuredClone(catalog));
      }
      return realFetch(input, init);
    };
    const snapshot: WorkspaceSnapshot & { token: string } = { source: 'sandbox', token: 'test-token', projectName: 'Gallery test',
      writable: options.writable !== false, editMode: 'direct', iteration: { number: 1, goal: '', start: '' } };
    return catalogStore('sandbox').refresh().then(() => {
      root.render(<DocumentPreviewProvider><div key={++instance} className="app-shell global-shell"><div className="workspace">
        <header className="topbar global-topbar">Deckmate</header>
        <main className="workspace-main board-main"><Deck snapshot={snapshot} refreshKey={0} onEditing={noop} onStartFromTemplate={noop} /></main>
      </div></div></DocumentPreviewProvider>);
    });
  }
  const kind = (options.deckKind as DeckKind) ?? 'asset';
  root.render(<div style={{ width: 420, padding: 16 }}><SettingsShell key={++instance} catalog={catalogOf([{ id: 'deck:one', title: 'The deck', kind }], options.inboxDeckId as string | null ?? null)} source="sandbox" /></div>);
}

Object.assign(window, { inboxTest: { render, actions, created } });
render('family');
