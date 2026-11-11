import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import { CardPreview } from '../../client/components/CardPreview.tsx';
import { Deck } from '../../client/components/Deck.tsx';
import { Hand } from '../../client/components/Hand.tsx';
import { catalogStore } from '../../client/catalog-store.ts';
import { setLang } from '../../client/i18n.ts';
import '../../client/styles.css';
import '../../client/card-material.css';
import '../../client/surface.css';
import '../../client/motion.css';

const cards: CatalogCard[] = ['First', 'Second'].map((title, index) => ({
  id: `card:loading-${index}`, kind: 'task', title, markdown: `Indexed ${title}`, path: `cards/${index}.md`,
  range: null, version: null, state: 'not-started', owner: 'Maya', sourceHash: `index-${index}`, deckId: 'work', trackIds: [], parentId: null,
  handMemberIds: ['maya'], handOrder: { maya: index },
}));
const catalog: CatalogView = { rootIdentity: 'loading-test', cards, documents: [], spaces: [{ id: 'studio', title: 'Studio' }],
  decks: [{ id: 'work', title: 'Work', kind: 'task', spaceId: 'studio', description: '', color: '#9258e5', icon: 'layers' }], tracks: [], warnings: [],
  formatLanguage: 'en', manifestHash: 'manifest', optionsHash: 'options', configured: true, indexedAt: '',
  members: [{ id: 'maya', label: 'Maya', kind: 'human', aliases: [] }], runs: [], milestones: [] };
const snapshot = { projectName: 'Loading', source: 'sandbox', writable: true, editMode: 'direct', token: 'test', iteration: { number: 1, goal: '', start: '' } } as const;
const api = {
  delay: 180, fail: false, revision: 0, startedAt: 0, finishedAt: 0, completed: 0, requests: [] as string[], saves: [] as unknown[],
  select: (_index: number) => {}, refresh: () => {}, focus: () => {},
};
window.fetch = async input => {
  const url = new URL(String(input), location.origin);
  if (url.pathname === '/api/catalog') return Response.json(catalog);
  if (url.pathname === '/api/card-content') {
    const card = cards.find(card => card.id === url.searchParams.get('cardId'))!;
    api.requests.push(card.id);
    api.startedAt = performance.now();
    const result = { cardId: card.id, title: `File ${card.title}`, markdown: `File body ${card.title}\r\n`, sourceHash: `${card.sourceHash}-${api.revision}` };
    await new Promise(resolve => setTimeout(resolve, api.delay));
    // 2026-11-10: let abandoned responses settle too, so navigation tests exercise the component's stale-result guard.
    api.completed++;
    if (api.fail) return Response.json({ message: 'Test load failure' }, { status: 503 });
    api.finishedAt = performance.now();
    return Response.json(result);
  }
  return Response.json({ files: [], events: [], warnings: [], nextCursor: null, created: null });
};
function Fixture() {
  const [index, setIndex] = useState(0);
  const [revision, setRevision] = useState(0);
  api.revision = revision;
  const [writable, setWritable] = useState(true);
  api.select = setIndex;
  api.refresh = () => setRevision(value => value + 1);
  api.focus = () => document.querySelector<HTMLButtonElement>('.card-preview-focus')?.click();
  const card = { ...cards[index], sourceHash: cards[index].sourceHash + '-' + revision };
  return <div style={{ width: 'min(496px, 100%)', margin: '24px auto' }}>
    <button onClick={() => setIndex(value => 1 - value)}>Switch card</button>
    <button onClick={() => setWritable(value => !value)}>Toggle read-only</button>
    <CardPreview card={card} catalog={catalog} snapshot={{ projectName: 'Loading', source: 'sandbox', writable, editMode: 'direct', iteration: { number: 1, goal: '', start: '' } }}
      writable={writable} pending={false} onClose={() => {}} onSelect={next => setIndex(cards.findIndex(card => card.id === next.id))}
      onDirtyChange={() => {}} onEdit={async action => { api.saves.push(action); return true; }} />
  </div>;
}
setLang('en');
Object.assign(window, { loadingTest: api });
const context = new URLSearchParams(location.search).get('context');
function NavigationFixture() {
  const [hand, setHand] = useState(context === 'hand');
  return <main className="workspace-main" style={{ height: '100vh', overflow: 'auto' }}>
    {hand ? <Hand snapshot={snapshot} refreshKey={0} onOpenMembers={() => {}} onOpenCard={id => {
      // 2026-11-10: Hand uses App's existing route into the All cards preview, not a separate editor.
      history.replaceState(null, '', `?view=deck&catalogSource=sandbox&scope=all&card=${encodeURIComponent(id)}`);
      setHand(false);
    }} /> : <Deck snapshot={snapshot} refreshKey={0} />}
  </main>;
}
if (context) {
  await catalogStore('sandbox').refresh();
  let destination = '?view=deck&catalogSource=sandbox&scope=all';
  if (context === 'deck') destination = '?view=deck&catalogSource=sandbox&deck=work';
  if (context === 'hand') destination = '?view=hand&handMember=maya';
  history.replaceState(null, '', destination);
}
createRoot(document.getElementById('root')!).render(context ? <NavigationFixture /> : <Fixture />);
