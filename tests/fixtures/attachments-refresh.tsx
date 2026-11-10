import { useWorkspace } from '../../client/useWorkspace.ts';
import { createRoot } from 'react-dom/client';
import { AttachmentsPanel } from '../../client/components/AttachmentsPanel.tsx';
import type { CardAttachment, CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import '../../client/styles.css';

const id = 'card:ca1d0000-0000-4000-8000-000000000001';
const base = 'tasks/deckmate-assets/cards/' + id.slice(5) + '/';
const file: CardAttachment = { file: base + '00000000-0000-4000-8000-000000000001.pdf', name: 'Original.pdf', kind: 'pdf',
  mime: 'application/pdf', bytes: 128, addedAt: '2026-11-09T00:00:00Z', addedBy: null };
const card: CatalogCard = { id, kind: 'task', title: 'Attachments', path: 'tasks/features/ferry.md', version: null,
  state: 'not-started', owner: null, markdown: '', sourceHash: 'source-hash', range: null, deckId: null, trackIds: [], parentId: null };
const catalog: CatalogView = { rootIdentity: 'attachments-refresh', documents: [], cards: [card], spaces: [], decks: [], tracks: [],
  warnings: [], formatLanguage: 'en', manifestHash: '', configured: true, indexedAt: '', members: [] };
const state = { reads: 0, files: [file], fail: false, holdEdit: false, holdRead: false, actions: [] as unknown[], releaseEdit: () => {},
  releaseRead: () => {}, socketCount: 0 };
let deliver: ((event: { data: string }) => void) | undefined;
class TestSocket {
  static OPEN = 1;
  onopen?: () => void;
  onclose?: () => void;
  onerror?: () => void;
  set onmessage(listener: (event: { data: string }) => void) { deliver = listener; }
  constructor() { state.socketCount++; setTimeout(() => this.onopen?.(), 0); }
  close() {}
}
Object.assign(window, { WebSocket: TestSocket });
window.fetch = async input => {
  const url = new URL(String(input), location.origin);
  if (url.pathname === '/api/attachments') {
    state.reads++;
    if (state.fail) throw new TypeError('Network unavailable');
    const response = Response.json({ hash: 'hash-' + state.reads, files: state.files, warnings: [] });
    if (state.holdRead) await new Promise<void>(resolve => { state.releaseRead = resolve; });
    return response;
  }
  if (url.pathname === '/api/snapshot') return Response.json({ source: 'sandbox', token: 'refresh-token', projectName: 'Test', writable: true });
  return Response.json(catalog);
};
function Probe() { useWorkspace(); return null; }
const root = createRoot(document.getElementById('root')!);
let instance = 0;
function render(cardId = id, visible = true) {
  root.render(<><Probe />{visible && <AttachmentsPanel key={++instance} card={{ ...card, id: cardId }} catalog={catalog} writable
    onEdit={async action => {
      state.actions.push(action);
      if (state.holdEdit) await new Promise<void>(resolve => { state.releaseEdit = resolve; });
      return true;
    }} />}</>);
}
function change(relativePath?: string, source = 'sandbox') {
  deliver?.({ data: JSON.stringify({ type: 'changed', relativePath, source, detectedAt: Date.now() }) });
}
Object.assign(window, { refreshTest: { state, render, change, id, base, file } });
render();
