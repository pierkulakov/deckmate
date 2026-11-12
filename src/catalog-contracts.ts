import type { BulkEditRequest, CardOptions } from './bulk-contracts.ts';
import type { ProjectTag } from './project-tags.ts';
import type { ByteRange } from './contracts.ts';
import type { CardState, FormatLanguage } from './format-vocabulary.ts';
import type { Lang } from './i18n.ts';

export type CardKind = 'task' | 'hero' | 'doc';
export type DeckKind = 'asset' | 'task' | 'knowledge' | 'mixed';
export type SpaceKind = 'gdd' | 'tasks' | 'knowledge' | 'qa' | 'custom';
export type DeckStyle = 'symbol' | 'artwork' | 'minimal';
export type CardPriority = 'high' | 'medium' | 'low';

// Shared Task states for Ordering groups, `state:` search, and Sprint columns.
// Inbox is a navigation category rather than a card state; consumers filter it out as needed.
export const boardColumns = [
  { id: 'inbox' },
  { id: 'discussing' },
  { id: 'in-iteration' },
  { id: 'started' },
  { id: 'review' },
  { id: 'done' },
  { id: 'not-started' },
] as const;

/** Source text for one editor; excludes the managed heading/frontmatter and Hero children. */
export interface CardContent {
  cardId: string;
  title: string;
  markdown: string;
  sourceHash: string;
}

export function defaultDeckKind(space: SpaceKind): DeckKind {
  if (space === 'gdd') return 'asset';
  if (space === 'knowledge') return 'knowledge';
  return space === 'custom' ? 'mixed' : 'task';
}

export function deckAcceptsCard(deck: DeckKind, card: CardKind): boolean {
  return deck === 'mixed' || (deck === 'asset' && card === 'hero')
    || (deck === 'task' && card === 'task') || (deck === 'knowledge' && card === 'doc');
}

/** Only decks that take Tasks can be the Inbox: new cards and Sub Cards are Tasks by default (2026-11-08). */
export function deckCanBeInbox(deck: DeckKind): boolean {
  return deckAcceptsCard(deck, 'task');
}

/**
 * Where a new card lands when the request names no deck (`deckId: null`, 2026-11-08):
 * the project's Inbox when it accepts the card's kind, otherwise no deck at all (Unassigned). Creation never fails
 * for want of a deck; an explicit deckId still has to accept the card's kind. Server and client both use this.
 */
export function newCardDeckId(requested: string | null, inboxDeckId: string | null | undefined,
  decks: readonly Pick<CatalogDeck, 'id' | 'kind'>[], kind: CardKind): string | null {
  if (requested !== null) return requested;
  const inbox = inboxDeckId ? decks.find(deck => deck.id === inboxDeckId) : undefined;
  return inbox && deckAcceptsCard(inbox.kind, kind) ? inbox.id : null;
}

export interface CatalogDocument {
  path: string;
  title: string;
  hash: string;
}

export interface CatalogCard extends CardOptions {
  id: string;
  kind: CardKind;
  path: string;
  version: string | null;
  title: string;
  state: CardState | null;
  owner: string | null;
  ownerNote?: string;
  effort?: number | null;
  priority?: CardPriority | null;
  markdown: string;
  sourceHash: string;
  range: ByteRange | null;
  deckId: string | null;
  trackIds: string[];
  parentId: string | null;
  iteration?: number | null;
  dependsOn?: string[];
  // ISO file-system dates of the card's Markdown file support sorting; null when unavailable.
  createdAt?: string | null;
  updatedAt?: string | null;
  journey?: { journeyId: string; version: number; stepId: string; instanceId: string };
  // 2026-11-12: Markdown is authoritative for questions and decisions on every card kind.
  openQuestions?: CatalogOpenQuestion[] | null;
  openQuestionWarnings?: string[];
  decisions?: CatalogDecision[];
}

export interface CatalogOpenQuestion { text: string; taskRef: string | null; assignee: string | null; target: string | null }

export interface CatalogDecision {
  index: number;
  question: string | null;
  answer: string;
  by: string | null;
  recordedBy?: string;
  assignee?: string;
  date: string | null;
  target: string | null;
  applied: string | null;
}

export function waitingOn(card: CatalogCard): string[] | null {
  if (card.kind !== 'task' || !card.openQuestions?.length) return null;
  return [...new Set(card.openQuestions.flatMap(question => question.assignee === null ? [] : [question.assignee]))];
}

export function isPendingDecision(decision: Pick<CatalogDecision, 'question' | 'applied'>): boolean {
  return decision.question !== null && decision.applied === null;
}

export function pendingDecisions(catalog: Pick<ProjectCatalog, 'cards'>): Array<{ card: CatalogCard; decision: CatalogDecision }> {
  return catalog.cards.flatMap(card => (card.decisions ?? [])
    .filter(isPendingDecision).map(decision => ({ card, decision })));
}

/** 2026-11-12: retries compare the same identity before planning and again under the catalog write lock. */
export function hasMatchingQuestion(questions: readonly CatalogOpenQuestion[],
  decisions: readonly (Pick<CatalogDecision, 'question' | 'target'> & { assignee?: string | null })[],
  expected: Pick<CatalogOpenQuestion, 'text' | 'assignee' | 'target'>, cardRef: string): boolean {
  const matches = (text: string | null, assignee: string | null | undefined, target: string | null) =>
    text === expected.text && (assignee ?? null) === expected.assignee && (target ?? cardRef) === (expected.target ?? cardRef);
  return questions.some(question => matches(question.text, question.assignee, question.target))
    || decisions.some(decision => matches(decision.question, decision.assignee, decision.target));
}

// Attachment files live in the data project. Their list is stored
// alongside them in the managed attachments.md file (server/attachments.ts).
export type AttachmentKind = 'image' | 'pdf';
export interface CardAttachment {
  file: string;
  name: string;
  kind: AttachmentKind;
  mime: string;
  bytes: number;
  addedAt: string;
  addedBy: string | null;
  /** The registry entry exists, but its file is missing from disk. */
  missing?: boolean;
}
export interface CardAttachments { hash: string; files: CardAttachment[]; warnings: string[] }

export interface CatalogJourneyStep {
  id: string;
  title: string;
  markdown: string;
  deckId: string;
  owner: string | null;
  dependsOn: string[];
  // Copied onto the created Sub Card; absent in older files means null or the default zone.
  effort?: number | null;
  priority?: CardPriority | null;
  zoneId?: string;
}

// Journey step metrics: computed by GET /api/journey-metrics from the cards a step
// created and the journal's structured transitions; journal records before 2026-11-04 carry none and are not counted.
export interface JourneyStepReturn { at: string; cardId: string; reason: string; actor: string | null }
export interface JourneyStepMetrics {
  stepId: string;
  /** Cards created by this step (any Journey version), Trash excluded. */
  instances: number;
  accepted: number;
  /** Transitions from review to any state except accepted. */
  returns: number;
  /** Hours from first start to final acceptance; null when no accepted card has both timestamps in the journal. */
  cycleHours: { median: number; average: number; samples: number } | null;
  owners: string[];
  /** Members who changed the states of these cards (labels; ID when the member left the registry). */
  actors: string[];
  /** Up to 3 latest return reasons, newest first. */
  lastReturns: JourneyStepReturn[];
}
export interface JourneyMetrics { journeyId: string; steps: JourneyStepMetrics[]; warnings: string[] }

// A Step Zone groups steps visually in the Journey editor.
// Zones do not change execution order: dependencies do.
export interface CatalogJourneyZone { id: string; title: string }

export interface CatalogJourney {
  id: string;
  title: string;
  version: number;
  deckId: string;
  path: string;
  fileHash: string;
  steps: CatalogJourneyStep[];
  description?: string;
  zones?: CatalogJourneyZone[];
  /** 2026-11-09: pending shows verified source bytes; conflict/invalid shows disk bytes so external edits stay visible. */
  pendingOperation?: { id: string | null; journalHash: string; state: 'pending' | 'conflict' | 'invalid'; file?: string };
}

// Journey templates are independent of a specific deck.
// A template is deck-independent: each step names a role (e.g. "art"); importing maps every role to an existing
// Task/Mixed deck or to a deck created on import. Bundled templates ship with Deckmate; project templates live in
// the data project and come from "Save as Template".
export type JourneyTemplateSource = 'bundled' | 'project';
export interface CatalogJourneyTemplateRole { id: string; title: string }
export interface CatalogJourneyTemplateStep extends Omit<CatalogJourneyStep, 'deckId' | 'owner'> { roleId: string }
/** 2026-11-09: a bundled template's picker title and description in another interface language. `title` and
 *  `description` stay English, the fallback; frontmatter `locales: { ru: { title, description } }`. */
export type TemplateLocales = Partial<Record<Exclude<Lang, 'en'>, { title?: string; description?: string }>>;
export interface CatalogJourneyTemplate {
  id: string;
  source: JourneyTemplateSource;
  title: string;
  description: string;
  category: string;
  tags: string[];
  author: string;
  updated: string;
  roles: CatalogJourneyTemplateRole[];
  zones: CatalogJourneyZone[];
  steps: CatalogJourneyTemplateStep[];
  /** Localized picker text; absent for project-made templates. */
  locales?: TemplateLocales;
  fileHash: string;
}
export type JourneyRoleTarget = { deckId: string } | { createDeck: { title: string; spaceId: string } };

// Starter project templates cover ten game genres.
// One bundled file per genre: assets/project-templates/<id>.md. Applying is additive — existing spaces and decks
// with the same title are reused, nothing is renamed or overwritten. Journeys are bundled Journey templates whose
// roles map to the Production decks that declare them.
export interface ProjectTemplateSpace { id: string; title: string; kind: SpaceKind; icon?: string }
export interface ProjectTemplateDeck {
  id: string; space: string; title: string; kind: DeckKind; icon: string; color: string; description: string;
  /** assets/deck-art/<art>.webp; without it the deck uses its icon and color. */
  art?: string;
  /** Bundled Journey template id (assets/journey-templates/<id>/) attached to this asset deck. */
  journey?: string;
  /** Journey roles this Production deck receives (design, art, animation, audio, code, qa, ui). */
  roles?: string[];
}
export interface ProjectTemplateSample { deck: string; title: string; markdown: string }
/** Which shelf of «Start from template» a starter belongs to (2026-11-05). */
export type ProjectTemplateCategory = 'games' | 'software';
export interface ProjectTemplate {
  id: string; title: string; description: string;
  /** Games or software; a template file without the field is a game template. */
  category: ProjectTemplateCategory;
  /** Genre key of the project profile (skills package genres/), null when none fits. */
  genre: string | null;
  order: number;
  spaces: ProjectTemplateSpace[]; decks: ProjectTemplateDeck[]; tags: ProjectTag[]; samples: ProjectTemplateSample[];
  /** Markdown body: the longer text of the picker. */
  details: string;
  /** Localized picker text. */
  locales?: TemplateLocales;
  fileHash: string;
}
export interface ProjectTemplatePlanItem { kind: 'space' | 'deck' | 'journey' | 'tag' | 'sample'; title: string; status: 'create' | 'resume' | 'reuse' | 'skip'; reason?: string }
/** Dry run of applying a template to the current project: what would be created and what already exists. */
export interface ProjectTemplatePlan { templateId: string; templateHash: string; manifestHash: string; items: ProjectTemplatePlanItem[] }

export interface CatalogSpace {
  id: string;
  title: string;
  kind?: SpaceKind;
  icon?: string;
}

export interface CatalogDeck {
  id: string;
  spaceId: string;
  title: string;
  kind: DeckKind;
  description: string;
  color: string;
  icon: string;
  style?: DeckStyle;
  cover?: string | null;
  coverPosition?: number;
  // watcherIds watch every card in the deck; guardianIds restrict acceptance to those members.
  // Both use manifest member IDs and treat humans and agents equally.
  watcherIds?: string[];
  guardianIds?: string[];
  // The deck's auto-tag is applied on card creation and entry, then removed on exit unless autoTagKeep is set.
  // Disabling auto-tagging does not remove tags already assigned to cards.
  autoTag?: string | null;
  autoTagKeep?: boolean;
  // Template Card supplies default content and properties for new cards in the deck.
  templateMarkdown?: string | null;
  templateOwner?: string | null;
  templateEffort?: number | null;
  templatePriority?: CardPriority | null;
  // Default Order: what viewers without their own choice see first, in the
  // ordering's URL form (order=state&direction=asc…); absent — Priority. Written by set-deck-default-order.
  defaultOrder?: string;
}

export interface CatalogTrack {
  id: string;
  title: string;
  description: string;
}

// Deck Zones replace priority lanes when a deck is ordered manually;
// they are presentation-only for cards and never change execution semantics.
export interface CatalogDeckZone { id: string; title: string }

/** Manual order of one deck: flat card order while no zones exist, per-zone order once they do. */
export interface CatalogDeckManualOrder {
  zones?: CatalogDeckZone[];
  /** Used while `zones` is absent or empty; keys of `zoneOrder` must match zone ids otherwise. */
  flatOrder?: string[];
  zoneOrder?: Record<string, string[]>;
}

export interface CatalogMember {
  id: string;
  label: string;
  kind: 'agent' | 'human';
  aliases: string[];
}

/** A Run is a dated work period stored in the planning registry. */
export interface RunRecord {
  id: string;
  number: number;
  start: string;
  end: string;
  goal: string;
  configurationId?: string;
  description?: string;
  cover?: string;
  finishedAt?: string;
  statistics?: PlanningStatistics;
  history?: PlanningHistoryPoint[];
}

/** Optional recurring schedule; legacy standalone Runs remain valid (2026-11-05). */
export interface RunConfiguration {
  id: string;
  shortName: string;
  color: string;
  projectSpecific?: boolean;
  labelTemplate: string;
  startDate: string;
  durationWeeks: number;
  upcomingCount: number;
  finishTime: string;
  timeZone: string;
  carryOver: RunCarryOver;
  stopDate?: string;
}

export interface RunCarryOver { review: boolean; blocked: boolean; other: boolean }
export interface PlanningHistoryPoint { date: string; tasks: number; done: number; effort: number; doneEffort: number }
export interface PlanningDistribution { key: string; total: number; done: number; unestimated?: number }
export interface PlanningStatistics extends PlanningHistoryPoint {
  capturedAt: string;
  unestimated: number;
  states: PlanningDistribution[];
  priorities: PlanningDistribution[];
  owners: PlanningDistribution[];
  decks: PlanningDistribution[];
  completedEffort: { date: string; effort: number; cardId?: string }[];
}

/** A Milestone is a significant project date with a display color. */
export interface MilestoneRecord {
  id: string;
  title: string;
  date: string;
  color: string;
  projectSpecific?: boolean;
  description?: string;
  cover?: string;
  history?: PlanningHistoryPoint[];
}

export interface ProjectCatalog {
  /** Daily machine observations, separate from user-authored plan registries (2026-11-05). */
  planningHistory?: Record<string, PlanningHistoryPoint[]>;
  rootIdentity: string;
  documents: CatalogDocument[];
  cards: CatalogCard[];
  spaces: CatalogSpace[];
  decks: CatalogDeck[];
  tracks: CatalogTrack[];
  warnings: string[];
  journeys?: CatalogJourney[];
  journeyTemplates?: CatalogJourneyTemplate[];
  members?: CatalogMember[];
  subCardOrder?: Record<string, string[]>;
  // Cards created without an explicit deck go to the Inbox deck; null means no default is assigned.
  inboxDeckId?: string | null;
  /** Milestone shown alongside the Hand; persisted in the manifest. */
  pinnedMilestoneId?: string | null;
  /** Manual order and zones per deck; absent deck = no manual order stored yet. */
  deckOrder?: Record<string, CatalogDeckManualOrder>;
  // Planning registries (Runs, Milestones), attached by server/runs.ts after the catalog is read.
  runs?: RunRecord[];
  runConfigurations?: RunConfiguration[];
  milestones?: MilestoneRecord[];
}

export interface CatalogQuery {
  text?: string;
  deckId?: string;
  trackId?: string;
  kind?: CardKind;
  state?: string;
  owner?: string;
  limit?: number;
}

export interface CatalogIndexSummary {
  rootIdentity: string;
  documents: number;
  cards: number;
  indexedAt: string;
}

export interface CatalogView extends ProjectCatalog {
  formatLanguage: FormatLanguage;
  manifestHash: string;
  runsHash?: string;
  milestonesHash?: string;
  optionsHash?: string;
  tagsHash?: string;
  projectTags?: ProjectTag[];
  bulkOutcome?: import('./bulk-contracts.ts').BulkOutcome;
  /** 2026-11-10: mutation feedback is separate from project-content warnings and absent on ordinary reads. */
  savedWarning?: string;
  configured: boolean;
  indexedAt: string;
}

export interface CatalogCardSelection {
  cardId: string;
  sourceHash: string;
  /** Required by promote-parent to confirm each child's captured family. */
  expectedParentId?: string | null;
}

// Each parsed CSV row becomes a native card. Import follows create-card but uses POST /api/catalog-import
// because its report includes skipped rows and reasons that do not fit CatalogView.
export interface CatalogImportRow {
  /** Reuse `card:<uuid>` from the ID column to prevent duplicates on reimport; null derives the ID from row content. */
  cardId: string | null;
  kind: CardKind;
  title: string;
  markdown: string;
  owner: string | null;
  effort: number | null;
  priority: CardPriority | null;
  /** Only Tasks have a state; hero and doc use null. */
  state: string | null;
  tags: string[];
}

/** Import results distinguish created, already existing, and skipped rows, with a reason for each skip. */
export interface CatalogImportReport {
  created: string[];
  unchanged: string[];
  skipped: Array<{ title: string; reason: string }>;
  warnings: string[];
}

export interface CatalogImportEdit {
  source: import('./workspace-contracts.ts').DataSource;
  manifestHash: string;
  optionsHash: string;
  deckId: string;
  cards: CatalogImportRow[];
}

export type CatalogEdit = { manifestHash: string; sourceHash?: string } & (
  | BulkEditRequest
  | { action: 'save-project-tag'; tagsHash: string; tag: ProjectTag }
  // acceptedBy is the exact guardian label for requests without x-deckmate-actor;
  // identified requests authorize acceptance using the actor (server/catalog.ts).
  // returnReason explains leaving review without acceptance (one line, at most 500 characters).
  // It lives only in the journal transition, never in the card file.
  | { action: 'set-card-state'; cardId: string; sourceHash: string; state: CardState | (string & {}); acceptedBy?: string | null; returnReason?: string | null }
  | { action: 'set-card-properties'; cardId: string; sourceHash: string; owner: string | null; effort: number | null; priority: CardPriority | null }
  | { action: 'set-card-parent'; cardId: string; sourceHash: string; expectedParentId: string | null; parentId: string | null; parentSourceHash: string | null }
  | { action: 'reorder-subcards'; cardId: string; sourceHash: string; cardIds: string[] }
  | { action: 'update-card-content'; cardId: string; sourceHash: string; title: string; markdown: string }
  | { action: 'add-card-report'; cardId: string; sourceHash: string; markdown: string; state?: CardState | (string & {}) }
  | { action: 'create-card'; cardId: string; kind: CardKind; title: string; markdown: string; deckId: string | null; trackIds: string[]; parentId: string | null; owner: string | null; effort: number | null; priority: CardPriority | null; zoneId?: string | null }
  | { action: 'configure-members'; members: CatalogMember[] }
  | { action: 'create-space'; title: string; kind?: SpaceKind; icon?: string }
  | { action: 'update-space'; spaceId: string; title: string; kind: SpaceKind; icon: string }
  | { action: 'delete-space'; spaceId: string; optionsHash?: string }
  /** deckId (2026-11-06): New Deck names the deck itself so a cover chosen before creation can upload right after it. */
  | { action: 'create-deck'; deckId?: string; title: string; spaceId: string; kind: DeckKind; icon: string; color: string; description: string; style?: DeckStyle; coverPosition?: number }
  | { action: 'set-deck-kind'; deckId: string; kind: DeckKind }
  | { action: 'update-deck'; deckId: string; title: string; icon: string; color: string; description: string; style: DeckStyle; cover: string | null; coverPosition: number }
  | { action: 'upload-cover'; deckId: string; dataUrl: string }
  | { action: 'move-deck'; deckId: string; spaceId: string; beforeDeckId: string | null }
  | { action: 'move-space'; spaceId: string; beforeSpaceId: string | null }
  // Deck watching replaces the full watcher list.
  | { action: 'set-deck-watchers'; deckId: string; watcherIds: string[] }
  // Only deck guardians can accept cards in the deck.
  | { action: 'set-deck-guardians'; deckId: string; guardianIds: string[] }
  // Deck automation combines auto-tagging and Template Card; null or empty values disable that part.
  | { action: 'set-deck-automation'; deckId: string; autoTag: string | null; autoTagKeep: boolean; templateMarkdown: string | null; templateOwner: string | null; templateEffort: number | null; templatePriority: CardPriority | null }
  // Deck Default Order is saved from the Ordering panel; null restores Priority.
  | { action: 'set-deck-default-order'; deckId: string; defaultOrder: string | null }
  // Deleting a deck unassigns its cards; attached Journeys prevent deletion.
  | { action: 'delete-deck'; deckId: string }
  | { action: 'create-journey'; deckId: string; title: string; steps: CatalogJourneyStep[] }
  | { action: 'apply-journey'; cardId: string; journeyId: string; journeyHash: string; stepIds: string[]; deckAssignments: Record<string, string> }
  // Whole-template save from the Journey editor: version + 1; removed step files are deleted, kept ones rewritten only if changed.
  | { action: 'update-journey'; journeyId: string; journeyHash: string; title: string; description: string; zones: CatalogJourneyZone[]; steps: CatalogJourneyStep[] }
  | { action: 'abandon-journey-operation'; journeyId: string; journalHash: string }
  // "Add N steps" (mode add, into the deck's journey or a new one) or "Replace with N steps" (mode replace).
  | { action: 'apply-project-template'; templateId: string; templateHash: string; samples: boolean }
  | { action: 'import-journey-template'; deckId: string; templateId: string; templateSource: JourneyTemplateSource; templateHash: string; mode: 'add' | 'replace'; journeyId: string | null; journeyHash: string | null; roleMapping: Record<string, JourneyRoleTarget> }
  | { action: 'save-journey-template'; journeyId: string; journeyHash: string; title: string; description: string; category: string; tags: string[] }
  // Step lesson: `- text — author, YYYY-MM-DD ($c-…)` is appended to the lessons section of the
  // step text. cardId — the Task this step created, where the mistake happened; author — the request actor (x-deckmate-actor).
  | { action: 'add-journey-step-lesson'; journeyId: string; journeyHash: string; stepId: string; cardId: string; text: string }
  // 2026-11-12: compatibility alias for assigning an existing question; never creates a separate Task.
  | { action: 'raise-decision'; cardId: string; sourceHash: string; questionIndex: number; questionText: string; taskCardId: string; deckId: string; memberId: string }
  // 2026-11-12: answers retain the question and target, await application, and complete a legacy linked Task if present.
  | { action: 'record-decision'; cardId: string; sourceHash: string; questionIndex: number; questionText: string; answer: string; memberId: string }
  // 2026-11-12: a question lives on the card it is about and names its addressee in its own line (@member); no separate task.
  // An open question on a Task means the Task waits for the answer. `assignee` is a member ID or null.
  | { action: 'ask-question'; cardId: string; sourceHash: string; text: string; assignee: string | null; target?: string | null }
  | { action: 'assign-question'; cardId: string; sourceHash: string; questionIndex: number; questionText: string; assignee: string | null }
  | { action: 'apply-decision'; cardId: string; sourceHash: string; decisionIndex: number; answer: string; note?: string }
  // Full replacement of dependsOn: repeating the same list writes nothing.
  | { action: 'set-card-dependencies'; cardId: string; sourceHash: string; dependsOn: string[] }
  /** Hand order, 2026-11-04: every open card of the member's hand in the new order; sourceHash guards freshness. */
  | { action: 'reorder-hand'; memberId: string; cards: CatalogCardSelection[] }
  | { action: 'create-track'; title: string; description: string }
  | { action: 'assign-deck'; cardId: string; deckId: string | null }
  | { action: 'set-tracks'; cardId: string; trackIds: string[] }
  | { action: 'set-card-links'; cardId: string; deckId: string | null; trackIds: string[] }
  | { action: 'bulk-assign-deck'; cards: CatalogCardSelection[]; deckId: string | null }
  | { action: 'bulk-add-track'; cards: CatalogCardSelection[]; trackId: string }
  // Manual Order and Zones: the zone list carries the full desired order of zones
  // (add / rename / reorder / delete of empty zones); card moves place selected cards in one zone or the flat order.
  | { action: 'set-deck-zones'; deckId: string; zones: CatalogDeckZone[] }
  | { action: 'move-cards-in-deck'; deckId: string; cards: CatalogCardSelection[]; zoneId: string | null; beforeCardId: string | null }
  // Default Inbox Deck: the deck that receives cards created without an explicit choice; null unassigns it.
  | { action: 'set-inbox-deck'; deckId: string | null }
  // Attachment actions use /api/catalog but run in server/attachments.ts before the catalog editor.
  // attachmentsHash is the card's attachment registry hash ('' before any attachments); conflicts return 409.
  | { action: 'upload-attachment'; cardId: string; attachmentsHash: string; dataUrl: string; fileName: string | null; addedBy: string | null }
  | { action: 'remove-attachment'; cardId: string; attachmentsHash: string; file: string }
);
