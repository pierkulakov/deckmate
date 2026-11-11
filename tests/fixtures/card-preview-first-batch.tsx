import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import type { CatalogAction } from '../../client/useCatalog.ts';
import { CardPreview } from '../../client/components/CardPreview.tsx';
import { CardFamilyPanel } from '../../client/components/CardFamily.tsx';
import { setLang } from '../../client/i18n.ts';
import { shortcutTargetBlocked } from '../../client/keyboard-shortcuts.ts';
import { shortReference } from '../../src/references.ts';
import '../../client/styles.css';
import '../../client/card-material.css';

const root = createRoot(document.getElementById('root')!);
const requests: unknown[] = [];
const selections: string[] = [];
const historyCursors: (string | null)[] = [];
let current: CatalogCard;
let historyFails = false;
let holdHistory = false;
let finishHistory: (() => void) | undefined;
let instance = 0;
let editFailure: 'conflict' | 'network' | null = null;
let holdEdit = false;
let finishEdit: (() => void) | undefined;
let refreshCard: (() => void) | undefined;
interface Options { backlinks?: number; journey?: boolean; tags?: number; title?: string; owner?: string; markdown?: string; dependencies?: boolean; archived?: boolean; deleted?: boolean; writable?: boolean; pending?: boolean; lang?: 'en' | 'ru'; theme?: 'light' | 'dark'; family?: boolean; kind?: CatalogCard['kind']; state?: CatalogCard['state'] }
const noop = () => {};
let outerEscapes = 0;
window.addEventListener('keydown', event => { if (event.key === 'Escape' && !shortcutTargetBlocked(event)) outerEscapes++; }, true);
window.fetch = async (input, init) => {
  const url = String(input);
  if (url.includes('/api/catalog')) { requests.push(JSON.parse(String(init?.body))); return Response.json({}); }
  if (url.includes('/api/notifications')) {
    if (init?.method === 'POST') return Response.json({ message: 'Watch failed' }, { status: 503 });
    return Response.json({ watching: [], watchHash: 'watch-hash' });
  }
  if (url.includes('/api/card-activity')) {
    historyCursors.push(new URL(url, location.origin).searchParams.get('cursor'));
    if (holdHistory) await new Promise<void>(resolve => { finishHistory = resolve; });
    if (historyFails) throw new TypeError('Offline');
    const cursor = new URL(url, location.origin).searchParams.get('cursor');
    return Response.json({ events: [{ id: cursor ?? 'first', at: '2026-11-10T00:00:00Z', summary: cursor ? 'Older event' : 'Saved event', details: [] }], warnings: [], created: null, nextCursor: cursor ? null : 'older' });
  }
  if (url.includes('attachments')) return Response.json({ hash: '', files: [], warnings: [] });
  return Response.json({ cardId: current.id, title: current.title, markdown: current.markdown, sourceHash: current.sourceHash });
};

function Fixture({ options }: { options: Options }) {
  const [card, setCard] = useState<CatalogCard>({ id: 'card:preview', kind: options.kind ?? 'task', title: options.title ?? 'Review the work', markdown: options.markdown ?? 'Card text remains visible.', path: 'cards/preview.md', range: null, version: null,
    state: options.state === undefined ? 'review' : options.state, owner: options.owner ?? 'Maya Chen', sourceHash: options.markdown === undefined ? 'card-hash' : 'content-' + options.markdown, deckId: null, trackIds: [], parentId: null, effort: 2, priority: 'medium',
    tags: Array.from({ length: options.tags ?? 0 }, (_, index) => `Длинный тег проекта ${index + 1}`), archived: options.archived, deleted: options.deleted,
    dependsOn: options.dependencies ? ['card:dependency'] : [],
    ...(options.journey ? { journey: { journeyId: 'pipeline', instanceId: 'instance', stepId: 'step', version: 1 } } : {}) });
  current = card;
  const child = { ...card, id: 'card:child', parentId: card.id, kind: 'task', title: 'Полное название Sub Card '.repeat(20), state: 'started', journey: undefined } as CatalogCard;
  const catalog: CatalogView = { rootIdentity: 'first-batch', documents: [], cards: options.family ? [card, child] : [card], spaces: [], decks: [], tracks: [], warnings: [], formatLanguage: 'en', manifestHash: 'manifest-hash', optionsHash: 'options-hash', configured: true, indexedAt: '',
    members: [{ id: 'maya', label: 'Maya Chen', kind: 'human', aliases: [] }], runs: [], milestones: [] };
  if (options.dependencies) catalog.cards.push({ ...card, id: 'card:dependency', title: 'Завершить подготовку', state: 'not-started', dependsOn: [] });
  if (options.backlinks) {
    const reference = '/r/' + shortReference('c', 'card:preview');
    const link = `[Target](${reference}?source=sandbox)`;
    const source = (id: string, markdown: string, extra: Partial<CatalogCard> = {}) => ({ ...card, id: 'card:' + id, title: id, markdown, ...extra });
    catalog.cards.push(...Array.from({ length: options.backlinks }, (_, index) => source('incoming-' + index,
      index % 2 ? `[Target][ref]\n\n[ref]: ${reference}` : link)));
    catalog.cards.push(source('archived-source', link, { archived: true }), source('deleted-source', link, { deleted: true }),
      source('code-source', '```md\n' + link + '\n```'), source('yaml-source', '---\nlink: ' + reference + '\n---\nText'),
      source('wrong-source', `[Target](${reference}?source=live)`));
  }
  if (options.journey) catalog.journeys = [{ id: 'pipeline', title: 'Pipeline', version: 1, deckId: 'assets', path: 'tasks/journeys/pipeline/index.md', fileHash: 'journey-hash',
    steps: [{ id: 'step', title: 'Step', markdown: '', deckId: 'work', owner: null, dependsOn: [] }] }];
  refreshCard = () => setCard(previous => ({ ...previous, sourceHash: previous.sourceHash + '-refreshed' }));
  async function edit(action: CatalogAction) {
    await fetch('/api/catalog', { method: 'POST', body: JSON.stringify(action) });
    if (holdEdit) await new Promise<void>(resolve => { finishEdit = resolve; });
    if (editFailure === 'network') throw new TypeError('Offline');
    if (editFailure === 'conflict') { refreshCard?.(); return false; }
    if (action.action === 'set-card-state') setCard(previous => ({ ...previous, state: action.state as CatalogCard['state'] }));
    if (action.action === 'update-card-content') setCard(previous => ({ ...previous, title: action.title, markdown: action.markdown, sourceHash: previous.sourceHash + '-saved' }));
    if (action.action === 'bulk-edit-cards' && action.change.kind === 'options') {
      const patch = action.change.patch;
      setCard(previous => ({ ...previous, ...patch }));
    }
    if (action.action === 'bulk-edit-cards' && action.change.kind === 'properties') {
      const owner = action.change.owner;
      if (owner !== undefined) setCard(previous => ({ ...previous, owner }));
    }
    return true;
  }
  const snapshot = { projectName: 'First batch', source: 'sandbox' as const, writable: options.writable ?? true, editMode: 'direct' as const,
    token: 'fixture-token', iteration: { number: 1, goal: '', start: '' } };
  return <div style={{ width: 'min(496px, 100%)', margin: '24px auto' }}>
    <CardPreview card={card} catalog={catalog} snapshot={snapshot}
      writable={options.writable ?? true} pending={options.pending ?? false} onClose={noop} onSelect={next => { selections.push(next.id); setCard(next); }} onDirtyChange={noop} onEdit={edit} />
    {options.family && <CardFamilyPanel hero={card} card={card} children={[child]} openedId={card.id} catalog={catalog} disabled={false} writable={false} onOpen={noop} onCreate={noop} onAttach={noop} />}
  </div>;
}
function render(options: Options = {}) {
  requests.length = 0; selections.length = 0; historyCursors.length = 0; historyFails = false; holdHistory = false; holdEdit = false; outerEscapes = 0; editFailure = null;
  setLang(options.lang ?? 'en');
  document.documentElement.classList.toggle('dark', options.theme === 'dark');
  root.render(<Fixture key={++instance} options={options} />);
}
Object.assign(window, { firstBatch: { render, requests, selections, historyCursors, failEdit: (failure: typeof editFailure) => { editFailure = failure; }, holdEdit: () => { holdEdit = true; }, finishEdit: () => { holdEdit = false; finishEdit?.(); }, outerEscapes: () => outerEscapes, failHistory: (fail: boolean) => { historyFails = fail; }, holdHistory: () => { holdHistory = true; }, finishHistory: () => { holdHistory = false; finishHistory?.(); } } });
render();
