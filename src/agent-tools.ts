// 2026-11-11: the agent tool contract, shared by the MCP server (server/mcp.ts), the operations core
// (server/agent-ops.ts) and `deckmate project` commands. Tool text is protocol text for models: it is not translated,
// like card text and identifiers. Every listed byte is paid by each agent session, so descriptions stay one line.
import type { CardKind, CardPriority } from './catalog-contracts.ts';
import { layoutToolHint } from './layout-rules.ts';

export const agentToolNames = ['next', 'brief', 'create_cards', 'update_card', 'report', 'ask', 'question', 'answer', 'apply_decision', 'search', 'organize'] as const;
export type AgentToolName = typeof agentToolNames[number];

export const agentToolLimits = {
  /** Default and maximum brief budget in estimated tokens (server/agent-brief.ts estimateTokens). */
  briefBudget: 1500,
  briefBudgetMax: 4000,
  /** Cards per create_cards call. */
  createBatch: 50,
  /** Search hits per call: default and maximum; a snippet is cut to snippetChars. */
  searchDefault: 5,
  searchMax: 20,
  snippetChars: 200,
  /** Ceiling for any tool response other than a brief, in characters of compact JSON. */
  responseChars: 6000,
  /** Leading hex characters of a card's sourceHash that form its rev. */
  revLength: 12,
} as const;

/**
 * Short card head returned by every tool that names a card. Fields at their default are left out to save tokens:
 * no `kind` is a task, no `state` has none, no `deck` is Unassigned (otherwise the deck title), no `owner` is unowned.
 */
export interface AgentCardHead {
  ref: string;
  title: string;
  kind?: Exclude<CardKind, 'task'>;
  state?: string;
  deck?: string;
  owner?: string;
  /** First revLength hex characters of the card's sourceHash; pass it back to reject writes over newer edits. */
  rev: string;
}

/** A pointer for further reading with the agent's own file reader: "path:from-to", 1-based inclusive lines. */
export type AgentReadPointer = string;

export interface AgentNextInput { member?: string; budget?: number }
export interface AgentNextDecision {
  card: string;
  index: number;
  /** Decision identity returned by next; unchanged by editing its target or applying it. */
  rev: string;
  question: string | null;
  answer: string;
  by: string | null;
  target: AgentReadPointer;
  next: 'edit the target, then apply_decision';
}
export interface AgentNextOutput {
  /** Present for ordinary card work; a pending decision is returned alone instead. */
  card?: AgentCardHead | null;
  decision?: AgentNextDecision;
  /** Markdown brief of the card (the same text as `deckmate project brief`); absent when card is null. */
  brief?: string;
  truncated?: boolean;
  /** Only pointers the brief text does not already show. */
  readNext?: AgentReadPointer[];
  /** What to do when there is no card. */
  next?: string;
}

export interface AgentBriefInput { ref: string; budget?: number; since?: string }
export interface AgentBriefOutput {
  card: AgentCardHead;
  brief: string;
  truncated: boolean;
  readNext?: AgentReadPointer[];
  /** Present when `since` (a rev, a full sourceHash or an ISO time) was passed. */
  changes?: { changed: boolean | null; events: Array<{ at: string; by: string | null; what: string }> };
}

export interface AgentNewCard {
  title: string;
  body?: string;
  /** Default: task. */
  kind?: CardKind;
  /** Deck ID or title; default: the project's Inbox (Unassigned when Inbox does not accept the kind). */
  deck?: string;
  owner?: string;
  priority?: CardPriority;
  effort?: number;
  /** c-ref or card ID of the parent Hero or Doc. */
  parent?: string;
  /** Track IDs. */
  tracks?: string[];
  /** Caller's stable key: the same key never creates a second card. Default key: kind, deck, title and body. */
  key?: string;
}
export interface AgentCreateCardsInput { cards: AgentNewCard[]; member?: string }
export interface AgentCreateCardsOutput {
  created: AgentCardHead[];
  /** Cards that already existed for the same key; nothing was written for them. */
  existing: AgentCardHead[];
  failed: Array<{ index: number; error: string; next: string; saved?: boolean }>;
  warnings?: string[];
}

export interface AgentUpdateCardInput {
  ref: string;
  rev?: string;
  state?: string;
  /** Required when leaving review without acceptance: one line, up to 500 characters. */
  reason?: string;
  owner?: string | null;
  priority?: CardPriority | null;
  effort?: number | null;
  /** Deck ID or title; null moves the card to Unassigned. */
  deck?: string | null;
  tracks?: string[];
  parent?: string | null;
  member?: string;
}
export interface AgentUpdateCardOutput { card: AgentCardHead; changed: string[]; warnings?: string[] }

export interface AgentReportInput { ref: string; text?: string; file?: string; state?: string; rev?: string; member?: string }
export interface AgentReportOutput { card: AgentCardHead; warnings?: string[] }

/** 2026-11-12: the question is written on the card it is about, addressed to the member in `to`; an open question on a Task keeps it out of next until answered. */
export interface AgentAskInput { ref: string; question: string; to?: string; target?: string; member?: string }
export interface AgentAskOutput { question: string; card: string; assignee: string | null; target: string; existing: boolean; warnings?: string[] }

export interface AgentQuestionInput { ref: string }
export interface AgentQuestionOutput {
  /** Source revision captured before the discussion; answer must return it. */
  rev: string;
  question: string;
  card: { ref: string; title: string };
  assignee: string | null;
  target: AgentReadPointer;
  decisions: Array<{ index: number; question: string | null; answer: string; by: string | null; date: string | null }>;
}
export interface AgentAnswerInput { ref: string; rev: string; answer: string; as: string }
export interface AgentAnswerOutput { card: string; index: number; target: string }
export interface AgentApplyDecisionInput { card: string; index: number; rev: string; note?: string }
export interface AgentApplyDecisionOutput { card: string; index: number; applied: string }

export interface AgentSearchInput { query?: string; deck?: string; state?: string; owner?: string; kind?: CardKind; limit?: number }
export interface AgentSearchOutput {
  /** Fields at their default are left out, as in AgentCardHead. */
  hits: Array<{ ref: string; title: string; state?: string; deck?: string; at: AgentReadPointer; snippet?: string }>;
  /** Matches beyond the returned hits. */
  more: number;
}

export interface AgentOrganizeInput { about?: string }
export interface AgentOrganizeIssue {
  card: string;
  deck: string;
  hero: string;
  reason: string;
  at: AgentReadPointer;
}
export interface AgentOrganizeAuditOutput { mode: 'audit'; table: AgentOrganizeIssue[]; warnings?: string[] }
export interface AgentOrganizePlacementOutput {
  mode: 'placement';
  about: string;
  card: 'hero' | 'subcard' | 'doc';
  deck: string;
  /** Null means a new deck is recommended, after checking for the same name. */
  deckId: string | null;
  hero: string;
  heroRef: string | null;
  ruleDoc: 'create' | 'reuse' | 'none';
  reason: string;
  readNext: AgentReadPointer[];
  warnings?: string[];
}
export interface AgentOrganizePlacementsOutput {
  mode: 'placements';
  about: string;
  placements: AgentOrganizePlacementOutput[];
  warnings?: string[];
}
export type AgentOrganizeOutput = AgentOrganizeAuditOutput | AgentOrganizePlacementOutput | AgentOrganizePlacementsOutput;

export interface AgentToolInputs {
  next: AgentNextInput; brief: AgentBriefInput; create_cards: AgentCreateCardsInput; update_card: AgentUpdateCardInput;
  report: AgentReportInput; ask: AgentAskInput; question: AgentQuestionInput; answer: AgentAnswerInput;
  apply_decision: AgentApplyDecisionInput; search: AgentSearchInput; organize: AgentOrganizeInput;
}
export interface AgentToolOutputs {
  next: AgentNextOutput; brief: AgentBriefOutput; create_cards: AgentCreateCardsOutput; update_card: AgentUpdateCardOutput;
  report: AgentReportOutput; ask: AgentAskOutput; question: AgentQuestionOutput; answer: AgentAnswerOutput;
  apply_decision: AgentApplyDecisionOutput; search: AgentSearchOutput; organize: AgentOrganizeOutput;
}

/** Error shape of every tool: `next` names the step that resolves it; `saved` marks a partial write. */
export interface AgentToolFailure { error: string; next: string; saved?: boolean }

/** Thrown by the operations core; transports print it as AgentToolFailure. */
export class AgentToolError extends Error {
  readonly next: string;
  readonly saved: boolean;
  constructor(message: string, next: string, saved = false) {
    super(message);
    this.name = 'AgentToolError';
    this.next = next;
    this.saved = saved;
  }
  toFailure(): AgentToolFailure {
    return { error: this.message, next: this.next, ...(this.saved ? { saved: true } : {}) };
  }
}

/** Sent once in the MCP initialize result; replaces reading the skill for the everyday route. */
export const agentInstructions = 'next: decisions; answer: chat. '
  + `Layout: ${layoutToolHint}; organize checks placement.`;

// 2026-11-11: schemas carry types only; ranges, defaults and unknown fields are checked by the operations core,
// whose errors name the fix. Field names explain themselves; a description is kept where a name cannot.
type JsonSchema = Record<string, unknown>;
const text = { type: 'string' };
const nullableText = { type: ['string', 'null'] };
const integer = { type: 'integer' };
const kind = { enum: ['task', 'hero', 'doc'] };
const priority = { enum: ['high', 'medium', 'low'] };
const object = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema =>
  ({ type: 'object', properties, ...(required.length ? { required } : {}) });

export interface AgentToolDefinition { name: AgentToolName; description: string; inputSchema: JsonSchema }

export const agentToolDefinitions: readonly AgentToolDefinition[] = [
  { name: 'next', description: 'Next.',
    inputSchema: object({ member: text, budget: integer }) },
  { name: 'brief', description: 'Brief.',
    inputSchema: object({ ref: text, budget: integer, since: text }, ['ref']) },
  { name: 'create_cards', description: `${layoutToolHint}.`,
    inputSchema: object({ member: text, cards: { type: 'array', items: object({
      title: text, body: text, kind, deck: text, owner: text, priority, effort: { type: 'number' },
      parent: text, tracks: { type: 'array', items: text }, key: text,
    }, ['title']) } }, ['cards']) },
  { name: 'update_card', description: 'Edit.',
    inputSchema: object({ ref: text, rev: text, member: text, state: text, reason: text, owner: nullableText,
      priority: { enum: ['high', 'medium', 'low', null] }, effort: { type: ['number', 'null'] },
      deck: nullableText, tracks: { type: 'array', items: text }, parent: nullableText }, ['ref']) },
  { name: 'report', description: 'Report.',
    inputSchema: object({ ref: text, rev: text, member: text, text, file: text, state: text }, ['ref']) },
  { name: 'ask', description: 'Ask.',
    inputSchema: object({ ref: text, member: text, question: text, to: text, target: text }, ['ref', 'question']) },
  { name: 'question', description: 'Question.',
    inputSchema: object({ ref: text }, ['ref']) },
  { name: 'answer', description: 'Answer.',
    inputSchema: object({ ref: text, rev: text, answer: text, as: text }, ['ref', 'rev', 'answer', 'as']) },
  { name: 'apply_decision', description: 'Apply.',
    inputSchema: object({ card: text, index: integer, rev: text, note: text }, ['card', 'index', 'rev']) },
  { name: 'search', description: 'Search.',
    inputSchema: object({ query: text, deck: text, state: text, owner: text, kind, limit: integer }) },
  { name: 'organize', description: 'Placement.',
    inputSchema: object({ about: text }) },
];
