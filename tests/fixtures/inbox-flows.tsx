import { createRoot } from 'react-dom/client';
import { useRef } from 'react';
import type { CatalogAction } from '../../client/useCatalog.ts';
import type { CatalogCard, CatalogDeck, CatalogView, DeckKind } from '../../src/catalog-contracts.ts';
import { CardFamilyComposer } from '../../client/components/CardFamilyComposer.tsx';
import { QuickCapture } from '../../client/components/QuickCapture.tsx';
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
const opened: string[] = [];
const capture = { response: 'success', failReads: false, holdReads: false, reads: 0, releaseRead: () => {} };
const gallery = { response: 'success', catalog: null as CatalogView | null };
const noop = () => {};
const realFetch = window.fetch.bind(window);

interface DeckSpec { id: string; title: string; kind: DeckKind; spaceId?: string }

function catalogOf(decks: DeckSpec[], inboxDeckId: string | null | undefined, parent?: CatalogCard): CatalogView {
  return { rootIdentity: 'inbox-flows', documents: [], cards: parent ? [parent] : [], spaces: [{ id: 'space:one', title: 'Work' }],
    decks: decks.map(deck => ({ id: deck.id, title: deck.title, kind: deck.kind, spaceId: deck.spaceId ?? 'space:one', description: '', color: '#878787', icon: 'layers' })),
    tracks: [], warnings: [], formatLanguage: 'en', manifestHash: 'manifest-hash', optionsHash: '', configured: true, indexedAt: '', inboxDeckId } as CatalogView;
}

const parent: CatalogCard = { id: 'card:hero', kind: 'hero', title: 'Hero card', path: 'cards/hero.md', version: null,
  state: null, owner: null, markdown: '', sourceHash: 'hero-hash', range: null, deckId: 'deck:art', trackIds: [], parentId: null };

function SettingsShell({ catalog, source }: { catalog: CatalogView; source: 'sandbox' }) {
  const opener = useRef<HTMLElement>(null);
  return <DeckSettingsForm opener={opener} dirty={false} creation={{ kind: 'deck', deckId: 'deck:one', editing: true }}
    catalog={catalog} source={source} disabled={false} pending={false} onCancel={noop} onSaved={noop}
    onSubmit={async action => { actions.push(action); return true; }} onDirtyChange={noop} />;
}

function render(scene: 'family' | 'cover' | 'settings' | 'gallery' | 'capture', options: Record<string, unknown> = {}) {
  setLang(options.lang === 'ru' ? 'ru' : 'en');
  window.fetch = realFetch;
  actions.length = 0;
  created.length = 0;
  opened.length = 0;
  if (scene === 'capture') {
    document.documentElement.classList.toggle('dark', options.theme !== 'light');
    Object.assign(capture, { response: options.response ?? 'success', failReads: Boolean(options.failReads), holdReads: false, reads: 0 });
    const inboxDeckId = 'inboxDeckId' in options ? options.inboxDeckId as string | null : 'deck:inbox';
    const catalog = catalogOf((options.decks as DeckSpec[]) ?? [{ id: 'deck:inbox', title: 'Inbox', kind: 'task' }], inboxDeckId);
    if (options.spaces) catalog.spaces = options.spaces as CatalogView['spaces'];
    window.fetch = async (input, init) => {
      const url = new URL(String(input), location.origin);
      if (url.pathname !== '/api/catalog') return realFetch(input, init);
      if (init?.method !== 'POST') {
        capture.reads++;
        if (capture.holdReads) await new Promise<void>(resolve => { capture.releaseRead = resolve; });
        if (capture.failReads) throw new TypeError('Failed to fetch');
        return Response.json(structuredClone(catalog));
      }
      const action = JSON.parse(String(init.body)) as CatalogAction;
      actions.push(action);
      if (capture.response === 'rejected') return Response.json({ message: 'Capture rejected by server' }, { status: 400 });
      if (capture.response === 'conflict' || capture.response === 'conflict-assigned') {
        if (capture.response === 'conflict-assigned' && action.action === 'set-inbox-deck') catalog.inboxDeckId = action.deckId;
        return Response.json({ message: 'Catalog changed externally' }, { status: 409 });
      }
      if (capture.response === 'lost-unsaved') throw new TypeError('Failed to fetch');
      if (action.action === 'set-inbox-deck') catalog.inboxDeckId = action.deckId;
      if (action.action === 'create-card' && !catalog.cards.some(card => card.id === action.cardId)) {
        catalog.cards.push({ id: action.cardId, kind: 'task', title: action.title, markdown: action.markdown,
          path: `cards/${action.cardId}.md`, state: null, owner: null, version: null, range: null, sourceHash: 'saved-hash',
          deckId: action.deckId, trackIds: [], parentId: null });
        created.push({ cardId: action.cardId, deckId: action.deckId ?? '' });
      }
      catalog.manifestHash += '-saved';
      if (capture.response === 'lost') throw new TypeError('Failed to fetch');
      const warning = 'Часть изменений записана, но индекс не обновлён. Перечитайте проект перед продолжением.';
      if (capture.response === 'saved-error') return Response.json({ saved: true, message: warning }, { status: 503 });
      if (capture.response === 'saved-warning') return Response.json({ ...structuredClone(catalog), savedWarning: warning });
      return Response.json(structuredClone(catalog));
    };
    const snapshot: WorkspaceSnapshot & { token: string } = { source: 'sandbox', token: 'capture-' + ++instance,
      projectName: 'Capture test', writable: options.writable !== false, editMode: options.writable === false ? 'read-only' : 'direct',
      iteration: { number: 1, goal: '', start: '' } };
    root.render(<div key={instance} className="capture-fixture" data-instance={instance}>
      <QuickCapture snapshot={snapshot} refreshKey={0} onOpenCard={id => opened.push(id)} />
    </div>);
    return instance;
  }
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
      counts={{ open: 0, accepted: 0, tasks: 0, review: 0 }} source="sandbox" disabled={false} writable={false} inbox={Boolean(options.inbox)}
      canOpen={() => true} onOpen={noop} onSettings={noop} /></div>);
    return;
  }
  if (scene === 'gallery') {
    history.replaceState(null, '', '/');
    const generated: DeckSpec[] = options.empty ? [] : Array.from({ length: 8 }, (_, index) => ({ id: `deck:${index}`, title: `Deck ${index}`, kind: 'task' }));
    const catalog = catalogOf((options.decks as DeckSpec[] | undefined) ?? generated, null);
    if (options.spaces) catalog.spaces = options.spaces as CatalogView['spaces'];
    Object.assign(gallery, { response: options.response ?? 'success', catalog });
    const pulse: ProjectPulse = { inProgress: { count: 0, ownerIds: [] }, review: { count: 0, oldestSince: null, deckId: null }, accepted: { days: Array(14).fill(0), total: 0 }, run: null, withoutDeck: 0 };
    window.fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith('/api/catalog?')) return Response.json(catalog);
      if (url.startsWith('/api/project-pulse?')) return Response.json(pulse);
      if (url === '/api/catalog' && init?.method === 'POST') {
        const action = JSON.parse(String(init.body)) as CatalogAction;
        actions.push(action);
        if (action.action === 'delete-space') {
          if (action.manifestHash !== catalog.manifestHash) return Response.json({ message: 'The catalog changed. Reopen the confirmation.' }, { status: 409 });
          if (gallery.response === 'rejected') return Response.json({ message: 'Space deletion rejected by server' }, { status: 422 });
          catalog.spaces = catalog.spaces.filter(space => space.id !== action.spaceId);
        }
        if (action.action === 'move-space') {
          const space = catalog.spaces.find(space => space.id === action.spaceId)!;
          catalog.spaces = catalog.spaces.filter(candidate => candidate !== space);
          const index = action.beforeSpaceId === null ? catalog.spaces.length : catalog.spaces.findIndex(space => space.id === action.beforeSpaceId);
          catalog.spaces.splice(index, 0, space);
        }
        if (action.action === 'update-space') Object.assign(catalog.spaces.find(space => space.id === action.spaceId)!, { title: action.title, kind: action.kind, icon: action.icon });
        // 2026-11-10: the popover test creates a space and expects it in the refreshed gallery.
        if (action.action === 'create-space') catalog.spaces = [...catalog.spaces, { id: `space:created-${catalog.spaces.length}`, title: action.title, kind: action.kind, icon: action.icon }];
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
        <main className="workspace-main board-main"><Deck snapshot={snapshot} refreshKey={0} onEditing={noop} onStartFromTemplate={() => opened.push('template')} /></main>
      </div></div></DocumentPreviewProvider>);
    });
  }
  const kind = (options.deckKind as DeckKind) ?? 'asset';
  root.render(<div style={{ width: 420, padding: 16 }}><SettingsShell key={++instance} catalog={catalogOf([{ id: 'deck:one', title: 'The deck', kind }], options.inboxDeckId as string | null ?? null)} source="sandbox" /></div>);
}

Object.assign(window, { inboxTest: { render, actions, created, opened, capture, gallery, refreshCatalog: () => catalogStore('sandbox').refresh() } });
render('family');
