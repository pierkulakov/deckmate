import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EmptyState } from '../../client/components/EmptyState.tsx';
import { LoadingState } from '../../client/components/LoadingState.tsx';
import { ErrorState } from '../../client/components/ErrorState.tsx';
import { TimelineView } from '../../client/components/TimelineView.tsx';
import { PlanningScope } from '../../client/components/PlanningScope.tsx';
import { PlanningProbe } from './planning-probe.tsx';
import { GlobalSearch } from '../../client/components/GlobalSearch.tsx';
import { Notifications } from '../../client/components/Notifications.tsx';
import { ServerStatus } from '../../client/components/ServerStatus.tsx';
import { AttachmentsPanel } from '../../client/components/AttachmentsPanel.tsx';
import { DeckTagsPanel, emptyTagPick } from '../../client/components/DeckTagsPanel.tsx';
import { QuickSettingsList } from '../../client/components/QuickSettingsList.tsx';
import { TagPicker, TagSelectionList } from '../../client/components/TagPicker.tsx';
import { EditorCommandMenu } from '../../client/components/EditorCommandMenu.tsx';
import { LevelBadge } from '../../client/components/LevelBadge.tsx';
import { CardFamilyComposer } from '../../client/components/CardFamilyComposer.tsx';
import { MembersEditor } from '../../client/components/MembersEditor.tsx';
import { DeckActivity } from '../../client/components/DeckActivity.tsx';
import { setLang } from '../../client/i18n.ts';
import { publishWorkspaceFileChange } from '../../client/workspace-file-events.ts';
import { readOnlyAccess, readOnlyDescription } from '../../client/source-access.ts';
import type { CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import '../../client/styles.css';

const card: CatalogCard = { id: 'card:ca1d0000-0000-4000-8000-000000000001', title: 'Recovered card', kind: 'task',
  path: 'cards/test.md', markdown: '', state: 'not-started', owner: 'Builder', sourceHash: 'card-hash', version: null,
  range: null, deckId: 'tasks', trackIds: [], parentId: null };
const parent: CatalogCard = { ...card, id: 'card:ca1d0000-0000-4000-8000-000000000002', kind: 'hero', title: 'Hero' };
const catalog: CatalogView = { rootIdentity: 'interface-states', documents: [], cards: [card, parent], spaces: [],
  decks: [{ id: 'tasks', title: 'Tasks', kind: 'task', spaceId: 'work', description: '', icon: 'box', color: '#687e9c' }], tracks: [],
  warnings: [], formatLanguage: 'en', manifestHash: 'manifest', configured: true, indexedAt: '',
  members: [{ id: 'builder', label: 'Builder', kind: 'human', aliases: [] }], runs: [], milestones: [] };
const snapshot = { source: 'sandbox', token: 'test-token', writable: true, projectName: 'Interface states' } as unknown as WorkspaceSnapshot;
const file = { file: 'tasks/deckmate-assets/cards/test/file.pdf', name: 'Recovered.pdf', kind: 'pdf', mime: 'application/pdf',
  bytes: 128, addedAt: '2026-11-10T00:00:00Z', addedBy: null };
const state = { fail: [] as string[], hold: [] as string[], reads: {} as Record<string, number>, releases: {} as Record<string, () => void>,
  files: [file], retries: 0, resets: 0, created: 0, opened: 0, retryFail: false, releaseRetry: () => {}, fastRetry: false, active: true, notificationsEmpty: false, membersEmpty: false,
  longMessage: null as string | null, notificationAccess: null as WorkspaceSnapshot | null };
window.fetch = async input => {
  const path = new URL(String(input), location.origin).pathname;
  state.reads[path] = (state.reads[path] ?? 0) + 1;
  if (state.hold.includes(path)) await new Promise<void>(resolve => { state.releases[path] = resolve; });
  if (state.fail.includes(path)) throw new TypeError('Network unavailable');
  if (path === '/api/attachments') return Response.json({ hash: 'attachments', files: state.files, warnings: [] });
  if (path === '/api/onboarding-facts') return Response.json({ agentSkill: false });
  if (path === '/api/activity') return Response.json({ events: [{ schema: 1, id: 'event', at: '2026-11-10T00:00:00Z', action: 'create-card', actor: 'Deckmate', summary: 'Created card', cards: [], deckIds: ['tasks'], details: [] }], nextCursor: 'next', warnings: [] });
  if (path === '/api/notifications') return Response.json({ source: 'sandbox', writable: !state.notificationAccess, member: catalog.members![0],
    members: catalog.members, warnings: [], stacks: state.notificationsEmpty ? [] : [{ id: 'due', title: 'Due cards', total: 1, hidden: 0, dismissible: false,
      cards: [{ cardId: card.id, title: card.title, state: card.state, changes: [], hiddenChanges: 0 }] },
      ...(state.notificationAccess ? [{ id: 'owned', title: 'Owned cards', total: 1, hidden: 0, dismissible: true, latestAt: '2026-11-10T00:00:00Z',
        cards: [{ cardId: card.id, title: card.title, state: card.state, changes: [], hiddenChanges: 0 }] }] : [])] });
  return Response.json(state.membersEmpty ? { ...catalog, members: [] } : catalog);
};

function Components() {
  const [message, setMessage] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState('Preserved draft');
  const retry = async () => {
    state.retries++;
    await new Promise<void>(resolve => { state.releaseRetry = resolve; if (state.fastRetry) resolve(); });
    if (!state.retryFail) setMessage(null);
  };
  return <>
    <EmptyState variant="first-run" title="Milestone" action={{ hint: '+' }} />
    <EmptyState variant="filtered" onReset={() => state.resets++} />
    <EmptyState />
    <LoadingState />
    <LoadingState variant="skeleton" />
    <LoadingState variant="keep-data" active={state.active}><p id="retained">Confirmed data</p></LoadingState>
    <ErrorState message={state.longMessage ?? message} onRetry={retry} />
    <ErrorState variant="inline" onRetry={retry} />
    <input aria-label="Draft" value={draft} onChange={event => setDraft(event.target.value)} />
    <ErrorState variant="saved-input" onRetry={retry} />
  </>;
}
function TagProbe() {
  const [query, setQuery] = useState('');
  return <TagSelectionList tags={[]} selected={[]} query={query} onQueryChange={setQuery} onToggle={() => {}} />;
}
function EditorProbe() {
  const [value, setValue] = useState('@');
  return <EditorCommandMenu value={value} onChange={setValue} catalog={{ ...catalog, members: [] }} disabled={false} />;
}
function ComposerProbe() {
  const [current, setCurrent] = useState(catalog);
  return <CardFamilyComposer parent={parent} catalog={current} initialDeckId="tasks" pending={false}
    onCreate={async () => { state.created++; setCurrent({ ...catalog, manifestHash: 'after-create' }); return true; }}
    onCancel={() => {}} onCreated={() => state.opened++} />;
}
const root = createRoot(document.getElementById('root')!);
let instance = 0;
function render(screen: string) {
  state.membersEmpty = screen === 'members-readonly-empty';
  let content;
  if (screen === 'timeline') content = <TimelineView snapshot={snapshot} refreshKey={0} onOpenCard={() => {}} />;
  else if (screen === 'planning-probe') content = <PlanningProbe />;
  else if (screen === 'timeline-readonly') content = <TimelineView snapshot={{ ...snapshot, writable: false }} refreshKey={0} onOpenCard={() => {}} />;
  else if (screen === 'planning-scope') {
    const run = { id: 'run-1', number: 1, start: '2026-11-01', end: '2026-11-30', goal: 'Plan' };
    const otherCard = { ...card, owner: 'Other' };
    const planCatalog = { ...catalog, cards: [otherCard], runs: [run] };
    content = <PlanningScope title="Plan" subtitle="" target={{ kind: 'run', id: run.id }} cards={[otherCard]} catalog={planCatalog} snapshot={snapshot} pending={false}
      onEdit={async () => true} onOpenCard={() => {}} onLockChange={() => {}} onDirtyChange={() => {}} />;
  }
  else if (screen === 'search') content = <GlobalSearch snapshot={snapshot} refreshKey={0} onOpenCard={() => {}} onOpenDeck={() => {}} />;
  else if (screen === 'notifications') content = <Notifications snapshot={state.notificationAccess ?? snapshot} refreshKey={0} onOpenCard={() => {}} />;
  else if (screen === 'status-offline') content = <ServerStatus connection="offline" snapshot={snapshot} updatedAt={0} />;
  else if (screen === 'attachments') content = <AttachmentsPanel card={card} catalog={catalog} writable onEdit={async () => true} />;
  else if (screen === 'tags') content = <DeckTagsPanel cards={[card]} pick={emptyTagPick} active onPick={() => {}} />;
  else if (screen === 'tags-empty') content = <DeckTagsPanel cards={[]} pick={emptyTagPick} active onPick={() => {}} />;
  else if (screen === 'activity') content = <DeckActivity deckId="tasks" source="sandbox" refreshKey={0} disabled={false} onOpen={() => {}} />;
  else if (screen === 'quick') content = <QuickSettingsList title="Deck" choices={[]} current="" disabled={false} onChoose={() => {}} />;
  else if (screen === 'tag-picker') content = <TagProbe />;
  else if (screen === 'tag-editor') content = <TagPicker card={card} catalog={catalog} disabled={false} onEdit={async () => true} />;
  else if (screen === 'editor') content = <EditorProbe />;
  else if (screen === 'quests') content = <LevelBadge snapshot={snapshot} refreshKey={0} onNavigate={() => {}} />;
  else if (screen === 'members') content = <MembersEditor snapshot={snapshot} refreshKey={0} open onOpenChange={() => {}} />;
  else if (screen === 'members-readonly-empty') content = <MembersEditor snapshot={{ ...snapshot, writable: false }} refreshKey={0} open onOpenChange={() => {}} />;
  else if (screen === 'composer') content = <ComposerProbe />;
  else content = <Components />;
  root.render(<main key={++instance} style={{ padding: 16, maxWidth: 800, marginInline: 'auto' }}>{content}</main>);
}
function input(selector: string, value: string) {
  const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}
Object.assign(window, { statesTest: { state, render, setLang, input, changeAttachments: () => publishWorkspaceFileChange({ source: 'sandbox' }),
  sourceAccess: { readOnlyAccess, readOnlyDescription } } });
render('components');
