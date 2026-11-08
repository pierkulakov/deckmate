import { createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { CardContentEditor } from '../../client/components/CardContentEditor.tsx';
import { setLang, type Lang } from '../../client/i18n.ts';
import type { CardAttachment, CardContent, CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import type { DataSource, WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import '../../client/styles.css';

const card: CatalogCard = { id: 'card:attachment-test', path: 'tasks/features/example.md', title: 'Attachment test',
  markdown: 'Before AFTER', kind: 'task', state: 'not-started', sourceHash: 'original', version: null,
  owner: null, deckId: null, trackIds: [], parentId: null, range: null };
const catalog = { cards: [card], members: [], decks: [], projectTags: [], manifestHash: 'manifest' } as unknown as CatalogView;
const files: CardAttachment[] = [
  { file: 'tasks/deckmate-assets/cards/example/sketch.png', name: 'Sketch [v2].png', kind: 'image', mime: 'image/png', bytes: 2048, addedAt: '', addedBy: null },
  { file: 'tasks/deckmate-assets/cards/example/brief.pdf', name: 'Brief.pdf', kind: 'pdf', mime: 'application/pdf', bytes: 1024, addedAt: '', addedBy: null },
];
const root = createRoot(document.querySelector('#root')!);
let revision = 0;
const api = {
  files, failure: false, delay: 30, requests: [] as string[], dirty: [] as boolean[], saves: [] as unknown[],
  content: { cardId: card.id, title: card.title, markdown: card.markdown, sourceHash: card.sourceHash } as CardContent,
  render(options: { lang?: Lang; source?: DataSource; writable?: boolean; busy?: boolean } = {}) {
    api.files = files; api.failure = false; api.delay = 30; api.requests = []; api.dirty = []; api.saves = [];
    api.content = { cardId: card.id, title: card.title, markdown: card.markdown, sourceHash: card.sourceHash };
    setLang(options.lang ?? 'en');
    root.render(<CardContentEditor key={++revision} card={card} catalog={catalog}
      snapshot={{ source: options.source ?? 'sandbox' } as WorkspaceSnapshot} writable={options.writable ?? true}
      pending={options.busy ?? false} blocked={false} headingRef={createRef()} onEditingChange={dirty => api.dirty.push(dirty)}
      onEdit={async action => {
        api.saves.push(action);
        if (action.action === 'update-card-content') api.content = { ...api.content, title: action.title, markdown: action.markdown };
        return true;
      }} />);
  },
};
const originalFetch = window.fetch;
window.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith('/api/card-content?')) return Response.json(api.content);
  if (url.startsWith('/api/attachments?')) {
    api.requests.push(url);
    const result = { hash: '', files: api.files, cover: null, warnings: [] };
    const fail = api.failure;
    await new Promise(resolve => setTimeout(resolve, api.delay));
    return fail ? Response.json({ message: 'offline' }, { status: 503 }) : Response.json(result);
  }
  return originalFetch(input, init);
};
Object.assign(window, { attachmentEditorTest: api });
api.render();
