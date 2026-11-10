import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { CatalogCardTile, CardAttachmentRefreshContext } from '../../client/components/CatalogCardTile.tsx';
import { CardFocusMode } from '../../client/components/CardFocusMode.tsx';
import { Hand } from '../../client/components/Hand.tsx';
import { buildCatalogLookups } from '../../client/catalog-lookups.ts';
import { publishWorkspaceFileChange } from '../../client/workspace-file-events.ts';
import { setLang } from '../../client/i18n.ts';
import type { CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import '../../client/styles.css';

setLang('en');
const cards: CatalogCard[] = Array.from({ length: 2 }, (_, index) => ({
  id: 'card:ca1d0000-0000-4000-8000-' + String(index + 1).padStart(12, '0'), kind: 'task', title: `Card ${index + 1}`,
  path: `cards/${index}.md`, version: null, state: 'not-started', owner: null, markdown: '', sourceHash: 'hash',
  range: null, deckId: null, trackIds: [], parentId: null, handMemberIds: ['maya'],
}));
const catalog: CatalogView = { rootIdentity: 'audit', documents: [], cards, spaces: [], decks: [], tracks: [], warnings: [],
  formatLanguage: 'en', manifestHash: 'manifest', configured: true, indexedAt: 'initial',
  members: [{ id: 'maya', label: 'Maya', kind: 'human', aliases: [] }] };
const snapshot: WorkspaceSnapshot = { projectName: 'Audit', source: 'sandbox', writable: true, editMode: 'direct', iteration: { number: 1, goal: '', start: '' } };
const state = { reads: {} as Record<string, number>, counts: [2, 1], fail: false, revision: 'initial', opened: 0,
  showOpener: true, hold: false, release: () => {}, mode: 'tiles' };
window.fetch = async input => {
  const url = new URL(String(input), location.origin);
  if (url.pathname !== '/api/attachments') return Response.json(catalog);
  const id = url.searchParams.get('cardId')!;
  state.reads[id] = (state.reads[id] ?? 0) + 1;
  if (state.fail) throw new TypeError('Network unavailable');
  const response = Response.json({ hash: 'confirmed', files: Array.from({ length: state.counts[cards.findIndex(card => card.id === id)] ?? 0 }, () => ({})), warnings: [] });
  if (state.hold) await new Promise<void>(resolve => { state.release = resolve; });
  return response;
};
const root = createRoot(document.getElementById('root')!);
const lookups = buildCatalogLookups(cards);
const noop = () => {};
function Tiles() {
  return <CardAttachmentRefreshContext.Provider value={state.revision}><div style={{ display: 'flex', gap: 32 }}>{cards.map(card =>
    <CatalogCardTile key={card.id} card={card} lookups={lookups} members={[]} catalog={{ ...catalog, indexedAt: state.revision }}
      selected={false} checked={false} selectionActive={false} disabled={false} onOpen={noop} onToggle={noop} onFamilyOpen={noop} />)}</div></CardAttachmentRefreshContext.Provider>;
}
function Editor() {
  const [menu, setMenu] = useState(false);
  const [toolbar, setToolbar] = useState(false);
  return <><textarea id="editor" autoFocus aria-label="Editor" onKeyDown={event => {
    if (event.key === 'Escape' && toolbar) { event.preventDefault(); event.stopPropagation(); setToolbar(false); }
  }} /><button id="portal-open" onClick={() => setMenu(true)}>Settings</button>
    <button id="toolbar-open" onClick={() => setToolbar(true)}>Commands</button>
    <button hidden>Hidden</button><button disabled>Disabled</button><button id="last">Save</button>
    {toolbar && createPortal(<div className="editor-command-menu"><button id="command" tabIndex={-1}>Command</button></div>, document.body)}
    <Dialog.Root open={menu} modal={false} onOpenChange={setMenu}><Dialog.Portal><Dialog.Content id="settings" aria-label="Settings" aria-describedby={undefined}>
      <input id="setting" aria-label="Setting" /><button id="settings-last">Apply</button>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </>;
}
function FocusProbe() {
  const [open, setOpen] = useState(false);
  return <>{state.showOpener && <button id="opener" onClick={() => setOpen(true)}>Focus</button>}
    <div data-card-id={cards[0].id}><button className="deck-card-open" id="fallback">Card 1</button></div>
    {open && <CardFocusMode title="Card 1" onBack={() => setOpen(false)}><Editor /></CardFocusMode>}</>;
}
function render(mode = state.mode) {
  state.mode = mode;
  history.replaceState(null, '', '?catalogSource=sandbox&card=' + encodeURIComponent(cards[0].id));
  if (mode === 'focus') root.render(<FocusProbe />);
  else if (mode === 'hand') root.render(<Hand snapshot={snapshot} refreshKey={0} onOpenMembers={noop} onOpenCard={() => { state.opened++; }} />);
  else root.render(<Tiles />);
}
function change(index?: number, prefix = 'deckmate', source: 'sandbox' | 'live' = 'sandbox') {
  publishWorkspaceFileChange({ source, relativePath: index === undefined ? undefined : `tasks/${prefix}-assets/cards/${cards[index].id.slice(5)}/attachments.md` });
}
Object.assign(window, { audit: { state, cards, render, change } });
render();
