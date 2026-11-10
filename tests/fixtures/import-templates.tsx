import { createRoot } from 'react-dom/client';
import type { CatalogView, ProjectTemplate, ProjectTemplatePlan } from '../../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import { CsvImport } from '../../client/components/CsvImport.tsx';
import { ProjectTemplates } from '../../client/components/ProjectTemplates.tsx';
import { catalogStore } from '../../client/catalog-store.ts';
import { setLang } from '../../client/i18n.ts';
import '../../client/styles.css';
import '../../client/motion.css';
import '../../client/surface.css';
import '../../client/project-templates.css';
import '../../client/csv-import.css';
import '../../client/components/states.css';

// 2026-11-10: the shared-grammar pass over the CSV import dialog and the template picker — both dialogs rendered
// for real over a stubbed catalog, driven from import-templates.test.ts over CDP at phone and desk widths.
const root = createRoot(document.getElementById('root')!);
let instance = 0;
const noop = () => {};

const catalog: CatalogView = { rootIdentity: 'import-templates', documents: [], cards: [], warnings: [],
  spaces: [{ id: 'space:one', title: 'Work' }],
  decks: [
    { id: 'deck:one', title: 'Concepts', kind: 'task', spaceId: 'space:one', description: '', color: '#9258e5', icon: 'layers' },
    { id: 'deck:art', title: 'Art', kind: 'asset', spaceId: 'space:one', description: '', color: '#878787', icon: 'layers' },
  ],
  tracks: [], formatLanguage: 'en', manifestHash: 'manifest-hash', configured: true, indexedAt: '', inboxDeckId: null } as CatalogView;

const templates: ProjectTemplate[] = [
  { id: 'demo-rpg', title: 'RPG', description: 'A party of heroes with a production Journey.', category: 'games',
    genre: 'rpg', order: 1, spaces: [{ id: 'production', title: 'Production', kind: 'tasks' }],
    decks: [
      { id: 'party', space: 'production', title: 'Party', kind: 'asset', icon: 'users', color: '#9258e5', description: '', journey: 'party-units' },
      { id: 'quests', space: 'production', title: 'Quests', kind: 'task', icon: 'scroll', color: '#878787', description: '' },
    ],
    tags: [], samples: [], details: 'Two decks and one Journey.', fileHash: 'hash-rpg' },
  { id: 'demo-platformer', title: 'Platformer', description: 'Levels and a coding deck.', category: 'games',
    genre: 'platformer', order: 2, spaces: [{ id: 'production', title: 'Production', kind: 'tasks' }],
    decks: [
      { id: 'levels', space: 'production', title: 'Levels', kind: 'asset', icon: 'map', color: '#9258e5', description: '' },
      { id: 'code', space: 'production', title: 'Coding', kind: 'task', icon: 'code', color: '#878787', description: '' },
    ],
    tags: [], samples: [], details: '', fileHash: 'hash-platformer' },
];

const plans: Record<string, ProjectTemplatePlan> = {
  'demo-rpg': { templateId: 'demo-rpg', templateHash: 'hash-rpg', manifestHash: 'manifest-hash', items: [
    { kind: 'space', title: 'Production', status: 'create' },
    { kind: 'deck', title: 'Party', status: 'create' },
    { kind: 'deck', title: 'Quests', status: 'create' },
    { kind: 'journey', title: 'Party units', status: 'create' },
  ] },
  'demo-platformer': { templateId: 'demo-platformer', templateHash: 'hash-platformer', manifestHash: 'manifest-hash', items: [
    { kind: 'space', title: 'Production', status: 'reuse', reason: 'already exists' },
    { kind: 'deck', title: 'Levels', status: 'create' },
    { kind: 'deck', title: 'Coding', status: 'resume', reason: 'cover to repair' },
  ] },
};

const snapshot: WorkspaceSnapshot & { token: string } = { source: 'sandbox', token: 'test-token',
  projectName: 'Import templates', writable: true, editMode: 'direct', iteration: { number: 1, goal: '', start: '' } };

const realFetch = window.fetch.bind(window);
function stubFetch(failures: { list?: boolean; plan?: boolean } = {}) {
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/catalog?')) return Response.json(structuredClone(catalog));
    if (url.startsWith('/api/project-templates/') && url.includes('/plan')) {
      if (failures.plan) return Response.json({ message: 'plan unavailable' }, { status: 500 });
      const id = decodeURIComponent(new URL(url, location.origin).pathname.split('/')[3] ?? '');
      return Response.json(plans[id] ?? plans['demo-rpg']);
    }
    if (url.startsWith('/api/project-templates')) {
      // 2026-11-10: no server message, so the picker's own localized fallback text reaches the error state.
      if (failures.list) return Response.json({}, { status: 500 });
      return Response.json(structuredClone(templates));
    }
    return realFetch(input, init);
  };
}

/** Puts a real File on the hidden input and fires the change event, the way a file picker does. */
function chooseCsv(name: string, content: string) {
  const input = document.querySelector<HTMLInputElement>('.csv-import-file-label input');
  if (!input) return false;
  const transfer = new DataTransfer();
  transfer.items.add(new File([content], name, { type: 'text/csv' }));
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function render(scene: 'csv' | 'templates', options: Record<string, unknown> = {}) {
  setLang(options.lang === 'ru' ? 'ru' : 'en');
  stubFetch(options.failures as { list?: boolean; plan?: boolean } | undefined);
  const key = ++instance;
  if (scene === 'csv') {
    root.render(<CsvImport key={key} snapshot={snapshot} refreshKey={0} open initialDeckId={null}
      onOpenChange={noop} />);
    return;
  }
  root.render(<ProjectTemplates key={key} snapshot={snapshot} refreshKey={0} onClose={noop} onApplied={noop}
    testCopy={{ notice: 'read only', action: 'Open test copy', open: noop }} />);
}

Object.assign(window, { importTemplatesTest: { render, chooseCsv, actions: [] } });
render('templates');
