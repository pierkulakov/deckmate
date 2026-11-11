import { useState } from 'react';
import type { CatalogCard, CatalogView, MilestoneRecord, RunRecord } from '../../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import { PlanningScope } from '../../client/components/PlanningScope.tsx';
import { PlanningCalendar, type CalendarDraft } from '../../client/components/PlanningCalendar.tsx';
import { MilestoneForm } from '../../client/components/PlanningPopover.tsx';
import { PlanningStats } from '../../client/components/PlanningStats.tsx';
import { planningColors } from '../../client/components/PlanningColors.tsx';
import type { SavePlanning } from '../../client/components/TimelineView.tsx';
import '../../client/surface.css';

const milestone: MilestoneRecord = { id: 'same', title: 'Original', date: '2026-11-23', color: '#7b7b7b', description: 'Original description' };
const run: RunRecord = { id: 'same', number: 1, goal: 'Plan A', start: '2026-11-02', end: '2026-11-29', history: [
  { date: '2026-11-02', tasks: 4, done: 0, effort: 3, doneEffort: 0 },
  { date: '2026-11-05', tasks: 4, done: 1, effort: 3, doneEffort: .5 },
  { date: '2026-11-09', tasks: 4, done: 4, effort: 3, doneEffort: 3 },
] };
const cards: CatalogCard[] = ['One', 'Two', 'Three', 'Four', 'Hero', 'Doc'].map((title, index) => ({
  id: `card:${index}`, title, kind: index < 4 ? 'task' : index === 4 ? 'hero' : 'doc', path: `cards/${index}.md`, markdown: '',
  state: index === 1 ? 'done' : 'not-started', effort: [0, .5, null, 2.5, 50, 100][index], owner: null,
  sourceHash: `hash:${index}`, version: null, range: null, deckId: null, trackIds: [], parentId: null,
}));
const initialCatalog: CatalogView = { rootIdentity: 'planning-probe', documents: [], cards, spaces: [], decks: [], tracks: [], members: [],
  warnings: [], formatLanguage: 'en', manifestHash: 'manifest', configured: true, indexedAt: '', milestonesHash: 'original',
  runs: [run, { ...run, id: 'other', goal: 'Plan B' }], milestones: [milestone, ...[2, 3, 4].map(index => ({ ...milestone, id: `same-${index}`, title: `Milestone ${index}` }))] };

export function PlanningProbe() {
  const [mode, setMode] = useState('scope');
  const [target, setTarget] = useState({ kind: 'run' as 'run' | 'milestone', id: 'same' });
  const [catalog, setCatalog] = useState(initialCatalog);
  const [source, setSource] = useState<'sandbox' | 'live'>('sandbox');
  const [draft, setDraft] = useState<CalendarDraft | null>(null);
  const [state] = useState(() => ({ opened: [] as string[], saves: [] as unknown[], fail: false, conflict: false, saved: milestone }));
  const onSave: SavePlanning = async action => {
    state.saves.push(action);
    if (state.fail) return { ok: false, message: 'Offline; retry your draft.' };
    if (state.conflict) {
      const fresh = { ...catalog, milestonesHash: 'external', milestones: [{ ...milestone, title: 'External', description: 'External description' }] };
      state.conflict = false;
      return { ok: false, message: 'File changed', revisions: fresh };
    }
    if (action.action === 'update-milestone') state.saved = action.milestone;
    return { ok: true };
  };
  Object.assign(window, { planningTest: { state, setMode, setTarget, setSource, setCatalog, catalog, run, initialCatalog, planningColors } });
  const snapshot = { source, writable: source === 'sandbox' } as WorkspaceSnapshot;
  if (mode === 'form') return <MilestoneForm date={milestone.date} milestone={milestone} catalog={catalog} pending={false} onSave={onSave} onDirtyChange={() => {}} onDone={() => {}} />;
  if (mode === 'calendar') return <PlanningCalendar open draft={draft} onDraftChange={setDraft} onClose={() => setMode('scope')} onDirtyChange={() => {}}
    catalog={catalog} cards={cards} today="2026-11-23" writable pending={false} error={null} onSave={onSave} onChoose={chosen => state.opened.push(chosen.id)} />;
  if (mode === 'stats') return <PlanningStats cards={cards} catalog={catalog} run={catalog.runs![0]} history={catalog.runs![0].history} />;
  return <PlanningScope title="Plan" subtitle="November" target={target} cards={cards} catalog={catalog} snapshot={snapshot} pending={false}
    onEdit={async () => true} onOpenCard={id => state.opened.push(id)} onLockChange={() => {}} onDirtyChange={() => {}} onPlanningEdit={onSave} />;
}
