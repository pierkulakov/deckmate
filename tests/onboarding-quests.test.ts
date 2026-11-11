import { afterAll, describe, expect, it, vi } from 'vitest';
import type { CatalogAction } from '../client/catalog-store.ts';
import type { OnboardingSignal } from '../client/onboarding/signals.ts';
import type { CatalogCard, CatalogMember, CatalogView } from '../src/catalog-contracts.ts';

// quests.ts imports client/i18n.ts, which touches document and localStorage while the module loads.
vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });

const { chapters } = await import('../client/onboarding/quests.ts');
const { chapterStatuses, levelOf, questsCompletedBy, totalXp } = await import('../client/onboarding/model.ts');

const team: CatalogMember[] = [
  { id: 'm-pavel', label: 'Павел', kind: 'human', aliases: [] },
  { id: 'm-anna', label: 'Anna', kind: 'human', aliases: [] },
  { id: 'm-glm', label: 'GLM', kind: 'agent', aliases: [] },
];

function view(cards: CatalogCard[], members: CatalogMember[] = team): CatalogView {
  return { cards, members } as unknown as CatalogView;
}

function cardOf(id: string, fields: Partial<CatalogCard> = {}): CatalogCard {
  return { id, kind: 'task', path: `cards/${id}.md`, version: null, title: id, state: null, owner: null,
    markdown: '', sourceHash: `${id}-a`, range: null, deckId: null, trackIds: [], parentId: null, ...fields };
}

/** Quest rules read only the action name, so rows that test an action carry just the name. */
function actionEdit(action: string, before: CatalogView, after: CatalogView): OnboardingSignal {
  return { type: 'catalog-edit', action: { action } as CatalogAction, before, after };
}

/** One card rewritten: fields in `next` replace `before`, and the file hash changes as in a real save. */
function edited(id: string, before: Partial<CatalogCard>, next: Partial<CatalogCard>): OnboardingSignal {
  return actionEdit('set-card-state',
    view([cardOf(id, { ...before, sourceHash: `${id}-a` })]),
    view([cardOf(id, { ...before, ...next, sourceHash: `${id}-b` })]));
}

const agentCardMovedToReview = {
  before: view([cardOf('c-1', { owner: 'GLM', state: 'started', sourceHash: 'c-1-a' })]),
  after: view([cardOf('c-1', { owner: 'GLM', state: 'review', sourceHash: 'c-1-b' })]),
};

interface QuestCase { id: string; yes: OnboardingSignal; no: OnboardingSignal }

// Every quest: its own action counts, the neighbor's does not — another state, the same owner kept,
// a new card instead of an edit, an edit instead of an observation.
const cases: QuestCase[] = [
  { id: 'open-deck', yes: { type: 'deck-opened', deckId: 'd-design' }, no: { type: 'view', view: 'deck' } },
  { id: 'hand-add',
    yes: edited('c-1', { handMemberIds: [] }, { handMemberIds: ['m-pavel'] }),
    no: actionEdit('create-card', view([]), view([cardOf('c-new', { handMemberIds: ['m-pavel'] })])) },
  { id: 'visit-hand', yes: { type: 'view', view: 'hand' }, no: { type: 'view', view: 'deck' } },
  { id: 'start-card',
    yes: edited('c-1', { state: 'not-started' }, { state: 'started' }),
    no: edited('c-1', { state: 'started' }, { state: 'review' }) },
  { id: 'finish-card',
    yes: edited('c-1', { state: 'started' }, { state: 'done' }),
    no: edited('c-1', { state: 'started' }, { state: 'review' }) },
  { id: 'assign-owner',
    yes: edited('c-1', { owner: null }, { owner: 'Anna' }),
    no: edited('c-1', { owner: 'Anna' }, { owner: null }) },
  { id: 'set-priority',
    yes: edited('c-1', { priority: null }, { priority: 'high' }),
    no: edited('c-1', { priority: 'high' }, { priority: null }) },
  { id: 'set-effort',
    yes: edited('c-1', { effort: null }, { effort: 3 }),
    no: edited('c-1', { effort: 3 }, { effort: null }) },
  { id: 'block-card',
    yes: edited('c-1', { dependsOn: [] }, { dependsOn: ['c-2'] }),
    no: edited('c-1', { dependsOn: ['c-2'] }, { dependsOn: [] }) },
  { id: 'unblock-card',
    yes: edited('c-1', { dependsOn: ['c-2'] }, { dependsOn: [] }),
    // A finished card nobody waits on unblocks nothing, even though it reached the done state.
    no: actionEdit('set-card-state',
      view([cardOf('c-1', { state: 'not-started', sourceHash: 'c-1-a' })]),
      view([cardOf('c-1', { state: 'done', sourceHash: 'c-1-b' })])) },
  { id: 'request-review',
    yes: edited('c-1', { state: 'started' }, { state: 'review' }),
    no: edited('c-1', { state: 'review' }, { state: 'done' }) },
  { id: 'resolve-review',
    yes: edited('c-1', { state: 'review' }, { state: 'done' }),
    no: edited('c-1', { state: 'started' }, { state: 'review' }) },
  { id: 'pick-preference',
    yes: { type: 'preference', name: 'theme' },
    no: { type: 'panel-opened', panel: 'members' } },
  { id: 'activity-feed',
    yes: { type: 'panel-opened', panel: 'activity' },
    no: { type: 'panel-opened', panel: 'members' } },
  { id: 'meet-team',
    yes: { type: 'panel-opened', panel: 'members' },
    no: { type: 'panel-opened', panel: 'activity' } },
  { id: 'attach-file',
    yes: actionEdit('upload-attachment', view([]), view([])),
    no: actionEdit('update-card-content', view([]), view([])) },
  { id: 'start-template',
    yes: actionEdit('apply-project-template', view([]), view([])),
    no: actionEdit('apply-journey', view([]), view([])) },
  { id: 'run-journey',
    yes: actionEdit('apply-journey', view([]), view([])),
    no: actionEdit('apply-project-template', view([]), view([])) },
  { id: 'vision-card', yes: { type: 'vision-card-added', cardId: 'c-1' }, no: { type: 'view', view: 'vision' } },
  { id: 'filter-search',
    yes: { type: 'search', query: '#art' },
    no: { type: 'search', query: 'cover art' } },
  { id: 'shortcuts',
    yes: { type: 'panel-opened', panel: 'shortcuts' },
    no: { type: 'panel-opened', panel: 'members' } },
  { id: 'add-agent',
    yes: actionEdit('configure-members', view([], team), view([], [...team, { id: 'm-bot', label: 'Scout', kind: 'agent', aliases: [] }])),
    no: actionEdit('configure-members', view([], team), view([], [...team, { id: 'm-ira', label: 'Ira', kind: 'human', aliases: [] }])),
  },
  { id: 'install-skill',
    yes: { type: 'facts', facts: { agentSkill: true } },
    no: { type: 'facts', facts: { agentSkill: false } } },
  { id: 'agent-owner',
    yes: edited('c-1', { owner: 'Павел' }, { owner: 'GLM' }),
    no: edited('c-1', { owner: 'Павел' }, { owner: 'Anna' }) },
  { id: 'agent-report',
    yes: { type: 'catalog-observed', ...agentCardMovedToReview },
    no: { ...actionEdit('set-card-state', agentCardMovedToReview.before, agentCardMovedToReview.after) } },
  { id: 'agent-review',
    yes: edited('c-1', { owner: 'GLM', state: 'review' }, { owner: 'GLM', state: 'done' }),
    no: edited('c-1', { owner: 'Anna', state: 'review' }, { owner: 'Anna', state: 'done' }) },
  { id: 'answer-question',
    yes: actionEdit('record-decision', view([]), view([])),
    no: actionEdit('raise-decision', view([]), view([])) },
];

const questById = new Map(chapters.flatMap(chapter => chapter.quests.map(quest => [quest.id, quest])));

afterAll(() => vi.unstubAllGlobals());

describe('onboarding quests', () => {
  it('covers every quest of every chapter exactly once', () => {
    const ids = chapters.flatMap(chapter => chapter.quests.map(quest => quest.id));
    expect(ids).toHaveLength(27);
    expect(new Set(ids).size).toBe(ids.length);
    expect(cases.map(row => row.id)).toEqual(ids);
  });

  it.each(cases.map(row => [row.id, row] as const))('%s counts on its own action and not on the neighbor', (id, row) => {
    const quest = questById.get(id);
    expect(quest, id).toBeDefined();
    expect(quest!.done(row.yes), `${id}: its own action`).toBe(true);
    expect(quest!.done(row.no), `${id}: the neighbor action`).toBe(false);
  });

  // 2026-11-05: an agent or a teammate changing the files must not finish the person's own lessons.
  it('pays the person’s card quests only for a save from this browser, never for a change seen in the files', () => {
    for (const row of cases) {
      if (row.yes.type !== 'catalog-edit') continue;
      const seen: OnboardingSignal = { type: 'catalog-observed', before: row.yes.before, after: row.yes.after };
      expect(questById.get(row.id)!.done(seen), row.id).toBe(false);
    }
  });

  it('opens the first three unfinished chapters; a finished one opens the next', () => {
    expect(chapterStatuses(chapters, new Set())).toEqual(['open', 'open', 'open', 'locked', 'locked']);
    const firstDone = new Set(chapters[0].quests.map(quest => quest.id));
    expect(chapterStatuses(chapters, firstDone)).toEqual(['done', 'open', 'open', 'open', 'locked']);
  });

  it('records real actions even when their chapter is still locked', () => {
    const signal = actionEdit('apply-project-template', view([]), view([]));
    expect(questsCompletedBy(signal, chapters, new Set()).map(quest => quest.id)).toContain('start-template');
    expect(questsCompletedBy(signal, chapters, new Set(['start-template'])).map(quest => quest.id)).not.toContain('start-template');
  });

  it('does not award a locked fact-only quest just because an existing skill is present', () => {
    const signal: OnboardingSignal = { type: 'facts', facts: { agentSkill: true } };
    expect(questsCompletedBy(signal, chapters, new Set()).map(quest => quest.id)).not.toContain('install-skill');
    const firstTwoDone = new Set(chapters.slice(0, 2).flatMap(chapter => chapter.quests.map(quest => quest.id)));
    expect(questsCompletedBy(signal, chapters, firstTwoDone).map(quest => quest.id)).toContain('install-skill');
  });

  it('ends leveling at the full quest total', () => {
    const total = totalXp(chapters);
    expect(levelOf(total, total).next).toBeNull();
  });

  // 2026-11-05: «Show me» needs somewhere to point; only the terminal-command quest has no interface element.
  it('gives every quest but install-skill a Show me destination', () => {
    for (const quest of chapters.flatMap(chapter => chapter.quests)) {
      expect(Boolean(quest.view || quest.target), quest.id).toBe(quest.id !== 'install-skill');
      for (const selector of [quest.target, quest.targetWithoutDecks]) {
        if (!selector) continue;
        for (const part of selector.split(',')) {
          expect(part.trim(), quest.id).not.toBe('');
          expect(part.trim(), quest.id).toMatch(/^[.[#]/u);
        }
      }
    }
  });

  // 2026-11-11: a project with no decks has no cover to click, so the first quest must offer wording and a target
  // that exist there: the gallery «+» action and the template start button.
  it('redirects the open-deck quest to deck-creating actions when the project has no decks', () => {
    const quest = questById.get('open-deck')!;
    expect(quest.bodyWithoutDecks).toBeDefined();
    expect(quest.targetWithoutDecks!.split(',').map(part => part.trim())).toEqual(['.deck-gallery-add', '.project-template-start > .ui-button']);
    for (const other of chapters.flatMap(chapter => chapter.quests)) {
      if (other.id === 'open-deck') continue;
      expect(other.bodyWithoutDecks, other.id).toBeUndefined();
    }
  });
});
