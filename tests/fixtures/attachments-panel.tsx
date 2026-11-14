import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { AttachmentsPanel } from '../../client/components/AttachmentsPanel.tsx';
import { setLang } from '../../client/i18n.ts';
import type { CardAttachment, CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import type { CatalogAction } from '../../client/useCatalog.ts';
import '../../client/styles.css';
import '../../client/card-preview.css';
import '../../client/motion.css';

const root = createRoot(document.getElementById('root')!);
let instance = 0;
const card: CatalogCard = { id: 'card:test', kind: 'task', title: 'Attachments', path: 'tasks/features/ferry.md', version: null,
  state: 'not-started', owner: null, markdown: 'Card text', sourceHash: 'source-hash', range: null, deckId: null, trackIds: [], parentId: null };
const catalog: CatalogView = { rootIdentity: 'attachments-panel-test', documents: [], cards: [card], spaces: [], decks: [], tracks: [],
  warnings: [], formatLanguage: 'en', manifestHash: '', configured: true, indexedAt: '', members: [] };
const base = 'tasks/deckmate-assets/cards/ca1d0000-0000-4000-8000-000000000001/';
const files: CardAttachment[] = [
  { file: base + '00000000-0000-4000-8000-000000000001.png', name: 'Silhouette [v2].png', kind: 'image', mime: 'image/png', bytes: 68, addedAt: '2026-11-09T00:00:00Z', addedBy: null },
  { file: base + '00000000-0000-4000-8000-000000000002.pdf', name: 'Brief.pdf', kind: 'pdf', mime: 'application/pdf', bytes: 128, addedAt: '2026-11-08T00:00:00Z', addedBy: null },
  { file: base + '00000000-0000-4000-8000-000000000003.png', name: 'Missing.png', kind: 'image', mime: 'image/png', bytes: 68, addedAt: '2026-11-07T00:00:00Z', addedBy: null, missing: true },
];
const projectFiles: CardAttachment[] = [
  { file: 'ArtSource/Props/Birch/Birch.blend', name: 'Birch.blend', kind: 'project-file', mime: 'application/octet-stream', bytes: 32 * 1024 * 1024, addedAt: '2026-11-14T00:00:00Z', addedBy: null, canOpen: true, openBlockedReason: null },
  { file: 'ArtSource/Covers/A very long folder name/Missing.blend', name: 'Missing.blend', kind: 'project-file', mime: 'application/octet-stream', bytes: 128, addedAt: '2026-11-13T00:00:00Z', addedBy: null, missing: true, canOpen: false, openBlockedReason: 'FILE_UNAVAILABLE' },
];
const blockedFile: CardAttachment = { ...projectFiles[0], file: 'ArtSource/invoice.pdf.exe', name: 'invoice.pdf.exe', canOpen: false, openBlockedReason: 'UNSAFE_FILE_TYPE' };
const state = { actions: [] as CatalogAction[], copies: [] as string[], failCopy: false, malformed: false, links: false, blocked: false, launchMissing: false,
  requests: [] as { url: string; headers: Record<string, string>; body: unknown }[] };
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async writeText(value: string) {
  if (state.failCopy) throw new Error('Clipboard denied');
  state.copies.push(value);
} } });
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin);
  if (url.pathname === '/api/attachments') return Response.json(state.malformed ? { title: 'Wrong response' } : { hash: 'attachment-hash', files,
    ...(state.links ? { projectFiles: [...projectFiles.map((file, index) => index === 0 && state.launchMissing
      ? { ...file, missing: true, canOpen: false, openBlockedReason: 'FILE_UNAVAILABLE' } : file), ...(state.blocked ? [blockedFile] : [])] } : {}), warnings: [] });
  if (url.pathname.startsWith('/api/attachments/')) {
    state.requests.push({ url: url.pathname, headers: Object.fromEntries(new Headers(init?.headers)), body: JSON.parse(String(init?.body)) });
    return Response.json(state.launchMissing ? { message: 'File not found' } : { ok: true }, { status: state.launchMissing ? 404 : 200 });
  }
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhVEAAAAASUVORK5CYII=';
  return new Response(Uint8Array.from(atob(png), char => char.charCodeAt(0)), { headers: { 'content-type': 'image/png' } });
};

function render(options: { writable?: boolean; lang?: 'en' | 'ru'; theme?: 'light' | 'dark'; malformed?: boolean; links?: boolean; blocked?: boolean } = {}) {
  state.actions = [];
  state.copies = [];
  state.failCopy = false;
  state.malformed = options.malformed ?? false;
  state.links = options.links ?? false;
  state.blocked = options.blocked ?? false;
  state.launchMissing = false;
  state.requests = [];
  setLang(options.lang ?? 'en');
  document.documentElement.classList.toggle('dark', options.theme !== 'light');
  flushSync(() => root.render(<AttachmentsPanel key={++instance} token="test-token" card={card} catalog={catalog} writable={options.writable ?? true}
    onEdit={async action => { state.actions.push(action); return true; }} />));
}
Object.assign(window, { attachmentsTest: { state, render } });
render();
