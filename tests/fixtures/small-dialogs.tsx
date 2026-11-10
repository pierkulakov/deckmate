import { createRoot } from 'react-dom/client';
import { MembersEditor } from '../../client/components/MembersEditor.tsx';
import { QuickCapture } from '../../client/components/QuickCapture.tsx';
import { ShortcutsHelp } from '../../client/components/ShortcutsHelp.tsx';
import { setLang } from '../../client/i18n.ts';
import type { CatalogAction } from '../../client/useCatalog.ts';
import type { CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import '../../client/styles.css';

// 2026-11-10: the three small dialogs — Members editor, Quick capture, Shortcuts help — in the shared dialog
// grammar; rendered for real and measured over CDP by small-dialogs.test.ts.
const root = createRoot(document.getElementById('root')!);
let instance = 0;
const actions: CatalogAction[] = [];
const opened: string[] = [];

const catalog: CatalogView = {
  rootIdentity: 'small-dialogs', documents: [], cards: [], tracks: [], warnings: [], formatLanguage: 'en',
  manifestHash: 'manifest-hash', configured: true, indexedAt: '', runs: [], milestones: [],
  spaces: [{ id: 'space:tasks', title: 'Tasks', kind: 'tasks' }],
  decks: [{ id: 'deck:inbox', title: 'Inbox', kind: 'task', spaceId: 'space:tasks', description: '', icon: 'box', color: '#5258b9' }],
  members: [
    { id: 'builder', label: 'Builder', kind: 'human', aliases: [] },
    { id: 'glm', label: 'GLM', kind: 'agent', aliases: ['glm-5'] },
  ],
};
const snapshot = { source: 'sandbox', token: 'test-token', writable: true, projectName: 'Small dialogs' } as unknown as WorkspaceSnapshot;

window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin);
  if (url.pathname === '/api/catalog' && init?.method === 'POST') {
    const action = JSON.parse(String(init.body)) as CatalogAction;
    actions.push(action);
    // A saved capture becomes a Task card in the Inbox deck, so the saved state can be reached in tests.
    if (action.action === 'create-card') catalog.cards = [...catalog.cards, { id: action.cardId, kind: 'task', title: action.title,
      path: `cards/${action.cardId}.md`, markdown: '', state: 'not-started', owner: null, sourceHash: 'card-hash', version: null,
      range: null, deckId: action.deckId, trackIds: [], parentId: null } satisfies CatalogCard];
    catalog.manifestHash += '-saved';
    return Response.json(structuredClone(catalog));
  }
  if (url.pathname === '/api/catalog') return Response.json(structuredClone(catalog));
  return Response.json({});
};

function render(scene: 'members' | 'quick' | 'shortcuts', options: { lang?: 'en' | 'ru'; theme?: 'light' | 'dark' } = {}) {
  setLang(options.lang === 'ru' ? 'ru' : 'en');
  document.documentElement.classList.toggle('dark', options.theme !== 'light');
  const key = ++instance;
  if (scene === 'members') root.render(<MembersEditor key={key} snapshot={snapshot} refreshKey={0} open onOpenChange={() => {}} />);
  else if (scene === 'quick') root.render(<QuickCapture key={key} snapshot={snapshot} refreshKey={0} onOpenCard={id => opened.push(id)} />);
  else root.render(<>
    <div id="topbar-shortcuts" />
    <ShortcutsHelp key={key} screens={['app', 'deck']} writable />
  </>);
}

Object.assign(window, { smallDialogsTest: { render, actions, opened } });
render('members');
