import { createRoot } from 'react-dom/client';
import Vision from '../../client/components/Vision.tsx';
import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import { DocumentPreviewProvider } from '../../client/components/DocumentPreview.tsx';
import VisionCardNode, { visionCardSize } from '../../client/components/VisionCardNode.tsx';
import { buildCatalogLookups } from '../../client/catalog-lookups.ts';
import { setLang } from '../../client/i18n.ts';
import { catalogStore } from '../../client/catalog-store.ts';
import type { CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import type { BoardDocument, BoardSummary } from '../../src/board-contracts.ts';
import '../../client/styles.css';
import '../../client/surface.css';
import '../../client/workspace.css';
import '../../client/motion.css';

// The chrome suite needs a real saved board: the caption, the access pill and the reference link only exist with one.
const board: BoardDocument = { id: 'board-1', title: 'Chrome board', hash: 'hash-1', path: 'boards/chrome.excalidraw', linkedCardIds: ['c-1'],
  updatedAt: '2026-11-10T00:00:00.000Z', access: 'editable', warnings: [],
  scene: { type: 'excalidraw', version: 2, elements: convertToExcalidrawElements([
    { id: 'near', type: 'rectangle', x: 0, y: 0, width: 280, height: 110, link: 'deckmate://card/c-1', customData: { deckmateCardId: 'c-1', deckmateCardView: 'mini' } },
    { id: 'far', type: 'rectangle', x: 1000, y: 300, width: 200, height: 100 },
  ], { regenerateIds: false }).map(element => element.id === 'near' ? { ...element, type: 'embeddable' } : element) as unknown as Record<string, unknown>[], appState: {}, files: {} } };
const list: BoardSummary[] = [board];
const nodeOpened: string[] = [];
const catalog: CatalogView = { rootIdentity: 'vision-chrome-test', documents: [], cards: [
  { id: 'c-1', kind: 'task', path: 'cards/one.md', version: null, title: 'One', state: 'not-started', owner: null, markdown: '',
    sourceHash: 'h1', range: null, deckId: 'd-1', trackIds: [], parentId: null, tags: [] },
], spaces: [{ id: 's-1', title: 'Showcase' }], decks: [{ id: 'd-1', spaceId: 's-1', title: 'Deck one', kind: 'task', description: '', color: '#446688', icon: 'box' }],
  tracks: [], warnings: [], formatLanguage: 'en', manifestHash: 'hash', optionsHash: 'hash', configured: true, indexedAt: '', members: [], runs: [], milestones: [], projectTags: [], journeys: [] };
const snapshot: WorkspaceSnapshot & { token: string } = { projectName: 'Chrome', source: 'sandbox', writable: true, editMode: 'direct', token: 'test', iteration: { number: 1, goal: '', start: '' } };
window.fetch = async input => {
  const path = new URL(String(input), location.origin).pathname;
  if (path === '/api/file') return new Response('# Направление игры\n\nОбычный **важный** текст и [ссылка](#проверка).\n\n' +
    '## Проверка\n\n- [x] Готово\n- [ ] Проверить\n\n> Тихая цитата.\n\n' +
    '```json\n' + 'long_source_line_'.repeat(24) + '\n```\n\n' +
    '| Имя | Оценка |\n| :--- | ---: |\n| Паром | 0 |\n\n' +
    Array.from({ length: 30 }, (_, i) => `### Раздел ${i + 1}\n\nТекст для проверки прокрутки.`).join('\n\n'));
  if (path === '/api/catalog') return Response.json(catalog);
  if (path === '/api/boards/board-1') return Response.json(board);
  return Response.json(list);
};
async function render() {
  await catalogStore('sandbox').refresh();
  const params = new URLSearchParams(location.search);
  setLang(params.get('lang') === 'ru' ? 'ru' : 'en');
  // Dark is the product default; ?theme=light flips the html class and the prop the same way the app's toggle does.
  const dark = params.get('theme') !== 'light';
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem('deckmate-vision-board-sandbox', 'board-1');
  Object.assign(window, { visionTest: { setLang, nodeOpened } });
  if (params.get('mode') === 'nodes') {
    const base = { ...catalog.cards[0], title: 'Длинное название карточки о вечернем пароме и его маршруте', owner: 'Очень длинное имя участника проекта',
      effort: 0, priority: 'high' as const, iteration: 14, tags: ['Очень длинное название русского тега для проверки локализации', 'audio', 'lighting'], markdown: 'Описание с подробностями маршрута и результата. '.repeat(12) };
    const cards: CatalogCard[] = [
      { ...base, id: 'blocked', dependsOn: ['c-1'], dueDate: '2020-01-01' },
      { ...base, id: 'started', state: 'started' },
      { ...base, id: 'on-review', state: 'review' },
      { ...base, id: 'questions', kind: 'doc', state: null, dependsOn: ['c-1'], openQuestions: [{ text: 'Когда?', taskRef: null, assignee: null, target: null }] },
      { ...base, id: 'questions-only', kind: 'doc', state: null, openQuestions: [{ text: 'Когда?', taskRef: null, assignee: null, target: null }] },
      { ...base, id: 'hero', kind: 'hero', state: null },
    ];
    const lookups = buildCatalogLookups([...catalog.cards, ...cards]);
    createRoot(document.getElementById('root')!).render(<div style={{ display: 'flex', gap: 24, padding: 24 }}>
      {(['lane', 'mini', 'full'] as const).map(view => <div key={view} style={{ display: 'grid', gap: 24, alignContent: 'start' }}>
        {cards.map(card => <div key={card.id} data-node-case={`${view}-${card.id}`} style={visionCardSize[view]}>
          <VisionCardNode card={card} cardId={card.id} view={view} catalog={catalog} lookups={lookups} interactive onOpen={id => nodeOpened.push(id)} />
        </div>)}
      </div>)}
    </div>);
    return;
  }
  if (params.get('mode') === 'document') {
    createRoot(document.getElementById('root')!).render(<DocumentPreviewProvider>
      <a id="document-opener" href="/api/file?source=sandbox&path=docs/reading.md">Открыть документ</a>
    </DocumentPreviewProvider>);
    return;
  }
  createRoot(document.getElementById('root')!).render(<main className="workspace-main" style={{ height: '100vh' }}>
    <Vision snapshot={snapshot} refreshKey={0} dark={dark} onEditing={() => {}} onOpenCard={() => {}} />
  </main>);
}
void render();
