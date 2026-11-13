// 2026-11-11: one operations core for agents. The MCP server and `deckmate project` commands call these functions;
// writes go through writeCatalog (server/cli-write.ts), so the hash guards, the write queue of a running server and
// the activity log stay the same as for the UI. Contract: src/agent-tools.ts.
import { open, readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Root } from 'mdast';
import { containedFile, loadConfig, type ServerConfig } from './config.ts';
import { resolveDataPath } from './data-paths.ts';
import { adoptLegacyEnvironment, environmentValue } from './environment.ts';
import { readProjectCatalog } from './catalog.ts';
import { CatalogError, CatalogService } from './catalog-service.ts';
import { writeCatalog, withCatalogWriter, type CliBatchOutcome, type CliCatalogWriter, type CliWriteResult } from './cli-write.ts';
import { nextAgentCard } from './agent-queue.ts';
import { organizeAgentCards } from './agent-organize.ts';
import { buildBrief, estimateTokens, sourceLineRange } from './agent-brief.ts';
import { readAgentChanges } from './agent-changes.ts';
import { readAgentsConfig } from './agents-config.ts';
import { readProjectMarkdown } from './native-cards.ts';
import { deterministicCardId } from './card-id.ts';
import { commandMember } from '../tools/commands/types.ts';
import { getCatalogHands, selectCatalogHand } from '../src/catalog-hand.ts';
import type { DataSource } from '../src/workspace-contracts.ts';
import {
  AgentToolError, agentToolLimits, agentToolNames,
  type AgentAnswerInput, type AgentApplyDecisionInput, type AgentAskInput, type AgentAskOutput, type AgentBriefInput,
  type AgentCardHead, type AgentCreateCardsInput, type AgentNewCard, type AgentNextDecision, type AgentNextInput,
  type AgentOrganizeInput, type AgentQuestionOutput, type AgentReportInput, type AgentSearchInput, type AgentToolInputs,
  type AgentToolName, type AgentToolOutputs, type AgentUpdateCardInput,
} from '../src/agent-tools.ts';
import type { CatalogCard, CatalogDecision, CatalogEdit, CatalogMember, CatalogOpenQuestion, CatalogQuery, CatalogView } from '../src/catalog-contracts.ts';
import { hasMatchingQuestion, pendingDecisions } from '../src/catalog-contracts.ts';
import { resolveReference, shortReference } from '../src/references.ts';
import { cardStates, cardStateWords, readCardState } from '../src/format-vocabulary.ts';
import { markdownParser } from '../src/markdown-model.ts';
import { decisionAnswerText, parseDecisionTarget } from '../src/open-questions.ts';
import { decisionTargetRange } from './decision-target.ts';

export interface AgentProject {
  config: ServerConfig;
  source: DataSource;
  /** Writable project folder that holds tasks/deckmate.md. */
  root: string;
}

export interface AgentProjectOptions {
  /** Folder the agent started in; the project is found by walking up to the manifest. */
  cwd: string;
  /** Explicit project folder (--data); wins over DECKMATE_DATA and the walk. */
  data?: string;
  readOnly?: boolean;
}

/** Who calls: the member wins over the default member, which wins over the MCP client name. */
export interface AgentCaller {
  /** 2026-11-12: MCP file reads need confinement; shell callers already have filesystem access. */
  source?: 'cli' | 'mcp';
  /** --member of `deckmate mcp` or DECKMATE_MEMBER. */
  defaultMember?: string;
  /** clientInfo.name from MCP initialize, matched against member IDs, aliases and agent launcher names. */
  clientName?: string;
}

/** The command context and the agent project have the same files and write policy. */
export interface AgentOperationContext extends AgentProject { catalog: CatalogView }

const projectNext = 'run in the project folder or pass --data <folder>';

async function containsManifest(root: string): Promise<boolean> {
  try {
    const relative = await resolveDataPath(root, 'tasks/deckmate.md');
    return (await stat(path.join(root, relative))).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function findProjectFolder(cwd: string): Promise<string | null> {
  let current = await realpath(path.resolve(cwd));
  while (true) {
    if (await containsManifest(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function openAgentProject(options: AgentProjectOptions): Promise<AgentProject> {
  try {
    adoptLegacyEnvironment(options.data);
    const configured = environmentValue('DATA');
    const selected = options.data !== undefined ? path.resolve(options.data)
      : configured ? path.resolve(configured) : await findProjectFolder(options.cwd);
    if (!selected || !await containsManifest(selected)) throw new AgentToolError('Project manifest not found.', projectNext);
    process.env.DECKMATE_DATA = selected;
    const config = await loadConfig({ readOnly: options.readOnly });
    const root = config.writeRoot ?? config.dataRoot;
    return { config, source: 'sandbox', root };
  } catch (error) {
    if (error instanceof AgentToolError) throw error;
    throw new AgentToolError(error instanceof Error ? error.message : String(error), projectNext);
  }
}

function cardHead(catalog: CatalogView, card: CatalogCard): AgentCardHead {
  const deck = catalog.decks.find(candidate => candidate.id === card.deckId)?.title;
  return {
    ref: shortReference('c', card.id), title: card.title,
    ...(card.kind === 'task' ? {} : { kind: card.kind }),
    ...(card.state ? { state: card.state } : {}),
    ...(deck ? { deck } : {}),
    ...(card.owner ? { owner: card.owner } : {}),
    rev: card.sourceHash.slice(0, agentToolLimits.revLength),
  };
}

function resolveCard(catalog: CatalogView, reference: string): CatalogCard {
  const card = resolveReference(catalog.cards, 'c', reference);
  if (!card) throw new Error('Card not found. Pass a card ID or c-ref from show/find.');
  return card;
}

function briefPointers(brief: Awaited<ReturnType<typeof buildBrief>>): string[] {
  return brief.readNext.map(reference => `${reference.path}:${reference.from}-${reference.to}`)
    .filter(pointer => !brief.markdown.includes(pointer));
}

export interface AgentNextResult {
  member: CatalogMember;
  card: CatalogCard | null;
  decision?: AgentNextDecision;
  brief?: Awaited<ReturnType<typeof buildBrief>>;
}

/** Shared by the agent tool and the legacy next output. */
export async function readAgentNext(context: AgentOperationContext, requestedMember: string,
  options: { staleHours?: number; budget?: number; withBrief?: boolean } = {}): Promise<AgentNextResult> {
  const pending = pendingDecisions(context.catalog)[0];
  if (pending) {
    const member = selectCatalogHand(getCatalogHands(context.catalog), requestedMember).member;
    return { member, card: null, decision: await nextDecision(context.root, context.catalog, pending) };
  }
  const { member, card } = await nextAgentCard(context.catalog, context.root, requestedMember,
    { staleHours: options.staleHours });
  const brief = card && options.withBrief
    ? await buildBrief(context.catalog, context.root, card, { budget: options.budget ?? agentToolLimits.briefBudget })
    : undefined;
  return { member, card, ...(brief ? { brief } : {}) };
}

function assertRevision(card: CatalogCard, rev: string | undefined, next?: string): void {
  if (rev !== undefined && !card.sourceHash.toLowerCase().startsWith(rev.toLowerCase())) {
    throw new AgentToolError('card changed since rev', next ?? `call brief with since=${rev}, then retry with the new rev`);
  }
}

const reportFileByteLimit = 200_000;

async function reportMarkdown(options: { text?: string; file?: string; source?: 'cli' | 'mcp' }, root: string): Promise<string> {
  let markdown: string;
  if (options.file !== undefined) {
    let bytes: Buffer;
    try {
      if (options.source === 'mcp') {
        const filename = options.file;
        const localName = filename.replace(/^[a-z]:[\\/]/iu, '');
        if (/^[\\/]{2}/u.test(filename) || /[:\x00]/u.test(localName) || /^[a-z]:[^\\/]/iu.test(filename)
          || localName.split(/[\\/]/u).some(part => /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) {
          throw new Error('Invalid report path');
        }
        const resolved = await containedFile(root, filename);
        if (/^[\\/]{2}/u.test(resolved)) throw new Error('Invalid report path');
        const before = await stat(resolved);
        if (!before.isFile() || before.size > reportFileByteLimit) throw new Error('Not a regular report file within the size limit');
        const file = await open(resolved, 'r');
        try {
          const info = await file.stat();
          if (!info.isFile() || info.size > reportFileByteLimit || info.dev !== before.dev || info.ino !== before.ino
            || await containedFile(root, resolved) !== resolved) throw new Error('Report file changed or exceeds the limit');
          // 2026-11-12: a bounded read also caps files that grow after the size check.
          const buffer = Buffer.alloc(reportFileByteLimit + 1);
          let length = 0;
          while (length < buffer.length) {
            const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
            if (!bytesRead) break;
            length += bytesRead;
          }
          if (length > reportFileByteLimit) throw new Error('Report file exceeds the limit');
          bytes = buffer.subarray(0, length);
        } finally { await file.close(); }
      } else bytes = await readFile(options.file);
    }
    catch (error) {
      if (options.source === 'mcp') throw new AgentToolError('report.file must be a regular file inside the project, at most 200000 bytes.',
        'pass the report as text, or save it inside the project');
      throw new Error(`report: cannot read --file ${options.file} (${(error as NodeJS.ErrnoException).code ?? 'error'}); save the report first and pass its path.`);
    }
    try { markdown = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new Error(`report: --file ${options.file} is not UTF-8 text; save it as UTF-8.`); }
    if (!markdown.trim()) throw new Error('report: the report file is empty.');
  } else {
    markdown = options.text ?? '';
    if (!markdown.trim()) throw new Error('report: the report text is empty.');
  }
  // 2026-11-06: brief reads a report only up to the next heading of level 1–4.
  const heading = (markdownParser.parse(markdown) as Root).children.find(node => node.type === 'heading' && node.depth <= 4);
  if (heading?.type === 'heading') {
    throw new Error(`report: line ${heading.position!.start.line} is a level-${heading.depth} heading; inside the card's #### Report block use ##### or deeper.`);
  }
  return markdown;
}

export interface AgentReportResult {
  card: CatalogCard;
  current: CatalogCard;
  requestedState?: string;
  result: CliWriteResult;
}

/** Shared by report and by update's final state transition. */
async function writeAgentState(context: AgentOperationContext, card: CatalogCard, state: string,
  actor: string, reason?: string): Promise<CliWriteResult> {
  if (card.kind === 'doc') throw new Error('state: a Doc card has no state; a Hero takes only done or not-started.');
  const parsed = readCardState(state);
  if (!parsed) throw new Error(`state: the state must be one of: ${cardStates.flatMap(cardStateWords).join(', ')}.`);
  const trimmed = reason?.trim();
  if (trimmed && (trimmed.length > 500 || /[\r\n]/u.test(trimmed))) {
    throw new Error('state: --reason must be one line of up to 500 characters.');
  }
  if (card.state === 'review' && parsed !== 'review' && parsed !== 'done' && !trimmed) {
    throw new Error('state: leaving review without acceptance needs --reason "<tolerance: required, actual; fix>" (one line, up to 500 characters).');
  }
  return writeCatalog(context.config, context.source, {
    action: 'set-card-state', cardId: card.id, sourceHash: card.sourceHash, manifestHash: context.catalog.manifestHash,
    state: parsed, ...(trimmed ? { returnReason: trimmed } : {}),
  }, actor);
}

export async function reportAgentCard(context: AgentOperationContext, reference: string, actor: string,
  options: { text?: string; file?: string; state?: string; rev?: string; source?: 'cli' | 'mcp' } = {}): Promise<AgentReportResult> {
  const card = resolveCard(context.catalog, reference);
  assertRevision(card, options.rev);
  const requestedState = options.state === undefined ? undefined : readCardState(options.state);
  if (options.state !== undefined) {
    if (!requestedState) throw new Error(`report --state must be one of: ${cardStates.flatMap(cardStateWords).join(', ')}.`);
    if (card.kind !== 'task') throw new Error('report --state is only available for a Task card.');
  }
  const markdown = await reportMarkdown(options, context.root);
  const result = await writeCatalog(context.config, context.source, {
    action: 'add-card-report', cardId: card.id, sourceHash: card.sourceHash,
    manifestHash: context.catalog.manifestHash, markdown, ...(requestedState === undefined ? {} : { state: requestedState }),
  }, actor);
  const fresh = await readProjectCatalog(context.root);
  const current = fresh.cards.find(candidate => candidate.id === card.id);
  if (!current) throw new CatalogError(409, 'The report was saved, but the card is no longer in the catalog.', true);
  return { card, current, ...(requestedState === undefined ? {} : { requestedState }), result };
}

export interface AgentStateResult { card: CatalogCard; state: string; result: CliWriteResult }

export async function stateAgentCard(context: AgentOperationContext, reference: string, requestedState: string,
  actor: string, reason?: string): Promise<AgentStateResult> {
  const card = resolveCard(context.catalog, reference);
  const state = readCardState(requestedState);
  if (!state) throw new Error(`state: the state must be one of: ${cardStates.flatMap(cardStateWords).join(', ')}.`);
  const result = await writeAgentState(context, card, state, actor, reason);
  return { card, state, result };
}

interface PendingDecision { card: CatalogCard; decision: CatalogDecision }

function decisionReference(card: CatalogCard, target: string | null | undefined): string {
  return target ?? shortReference('c', card.id);
}

function decisionRevision(card: CatalogCard, decision: CatalogDecision): string {
  // 2026-11-12: a selection survives target edits and its applied mark, but not a different answer at the same index.
  return createHash('sha256').update(JSON.stringify([card.id, decision.question, decision.answer,
    decision.by, decision.recordedBy ?? null, decision.assignee ?? null, decision.date, decision.target])).digest('hex').slice(0, agentToolLimits.revLength);
}

function requireSelectionRevision(rev: string | undefined, next: string): asserts rev is string {
  if (rev === undefined || !new RegExp(`^[0-9a-f]{${agentToolLimits.revLength}}$`, 'iu').test(rev)) {
    throw new AgentToolError('Pass the rev returned with this selection.', next);
  }
}

interface BoundedField { get: () => string; set: (value: string) => void }
function fitEstimatedBudget(output: unknown, budget: number, fields: BoundedField[]): void {
  for (let attempt = 0; attempt < 10000 && estimateTokens(JSON.stringify(output)) > budget; attempt += 1) {
    const field = fields.filter(candidate => candidate.get().length > 24)
      .sort((left, right) => right.get().length - left.get().length)[0];
    if (!field) break;
    const value = field.get();
    field.set(value.slice(0, Math.max(23, value.length - 16)).replace(/[\uD800-\uDBFF]$/u, '').replace(/…$/u, '') + '…');
  }
}

function questionReference(catalog: CatalogView, reference: string): { card: CatalogCard; question: CatalogOpenQuestion; index: number } {
  const match = /^(c-[0-9a-z]{10})#([1-9]\d*)$/u.exec(reference);
  if (!match) throw new AgentToolError('question ref must be c-xxxxxxxxxx#N.', 'pass a ref returned by ask or brief');
  const card = resolveCard(catalog, match[1]);
  const index = Number(match[2]) - 1;
  const question = card.openQuestions?.[index];
  if (!question) throw new AgentToolError(`Open question not found: ${reference}.`, 'call brief and pass a current open-question ref');
  return { card, question, index };
}

function normalizedAnswer(answer: string): string {
  const text = answer.trim();
  if (!text) throw new AgentToolError('answer must not be empty.', 'pass the answer approved in chat');
  return text;
}

function freshDecisionCard(catalog: CatalogView, cardId: string): CatalogCard {
  const card = catalog.cards.find(candidate => candidate.id === cardId);
  if (!card) throw new CatalogError(409, 'The decision was saved, but its card is no longer in the catalog.', true);
  return card;
}

export async function askAgentQuestion(context: AgentOperationContext, reference: string, actor: string,
  input: { question: string; to?: string; target?: string }): Promise<AgentAskOutput> {
  const card = resolveCard(context.catalog, reference);
  const text = input.question.replace(/\s+/gu, ' ').trim();
  if (!text || text.length > 900) throw new Error('ask: the question must be 1 to 900 characters long.');
  const cardRef = shortReference('c', card.id);
  const assignee = input.to === undefined
    ? context.catalog.members?.find(member => member.kind === 'human')?.id ?? null
    : commandMember(context, input.to, 'ask').id;
  if (assignee !== null && context.catalog.members?.find(member => member.id === assignee)?.kind !== 'human') {
    throw new Error('ask --to: the recipient must be a member with kind: human; add a person to the registry.');
  }
  const destination = parseDecisionTarget(input.target === undefined ? cardRef : input.target.trim());
  if (!destination) throw new Error('ask: target must be a c-ref with an optional heading fragment.');
  const target = destination.ref + (destination.fragment ? `#${destination.fragment}` : '');
  await decisionTargetRange(context.root, context.catalog, target);
  const normalized = decisionAnswerText(text, card.markdown);
  const existing = hasMatchingQuestion(card.openQuestions ?? [], card.decisions ?? [], { text: normalized, assignee, target }, cardRef);
  if (existing) return { question: normalized, card: cardRef, assignee, target, existing: true };
  const result = await writeCatalog(context.config, context.source, {
    action: 'ask-question', cardId: card.id, sourceHash: card.sourceHash, manifestHash: context.catalog.manifestHash,
    text, assignee, ...(input.target === undefined ? {} : { target }),
  }, actor);
  return { question: normalized, card: cardRef, assignee, target, existing: false,
    ...(result.warnings.length ? { warnings: result.warnings } : {}) };
}

export async function readAgentQuestion(context: AgentOperationContext, reference: string): Promise<AgentQuestionOutput> {
  const { card, question } = questionReference(context.catalog, reference);
  const target = await decisionTargetRange(context.root, context.catalog, decisionReference(card, question.target));
  const decisions = (card.decisions ?? []).slice(-3).map(decision => ({
    index: decision.index, question: decision.question, answer: decision.answer, by: decision.by, date: decision.date,
  }));
  const output: AgentQuestionOutput = { rev: card.sourceHash.slice(0, agentToolLimits.revLength), question: question.text, card: { ref: shortReference('c', card.id), title: card.title },
    assignee: question.assignee, target, decisions };
  const fields: BoundedField[] = [
    { get: () => output.question, set: value => { output.question = value; } },
    { get: () => output.card.title, set: value => { output.card.title = value; } },
  ];
  if (output.assignee !== null) fields.push({ get: () => output.assignee!, set: value => { output.assignee = value; } });
  for (const decision of output.decisions) {
    fields.push({ get: () => decision.answer, set: value => { decision.answer = value; } });
    if (decision.by !== null) fields.push({ get: () => decision.by!, set: value => { decision.by = value; } });
    if (decision.question !== null) fields.push({ get: () => decision.question!, set: value => { decision.question = value; } });
  }
  fitEstimatedBudget(output, 200, fields);
  return output;
}

export async function answerAgentQuestion(context: AgentOperationContext, reference: string, answerText: string,
  humanId: string, options: { rev?: string; member?: string } = {}): Promise<AgentToolOutputs['answer']> {
  requireSelectionRevision(options.rev, 'call question and pass its rev with the answer');
  const { card, question, index } = questionReference(context.catalog, reference);
  assertRevision(card, options.rev, 'call question again and confirm the current question before answering');
  const human = commandMember(context, humanId, 'answer');
  if (human.kind !== 'human') throw new AgentToolError('answer.as must name a human member.', 'pass the id of the person who answered in chat');
  const answer = normalizedAnswer(answerText);
  const actor = commandMember(context, options.member ?? environmentValue('MEMBER'), 'answer');
  await writeCatalog(context.config, context.source, {
    action: 'record-decision', cardId: card.id, sourceHash: card.sourceHash, manifestHash: context.catalog.manifestHash,
    questionIndex: index, questionText: question.text, answer, memberId: human.id,
  }, actor.id);
  const fresh = freshDecisionCard(await readProjectCatalog(context.root), card.id);
  const normalized = decisionAnswerText(answer, card.markdown);
  const decision = fresh.decisions?.filter(candidate => candidate.question === question.text
    && candidate.answer === normalized && candidate.by === human.label
    && (candidate.recordedBy ?? null) === (actor.kind === 'agent' ? actor.label : null)
    && candidate.target === question.target).at(-1);
  if (!decision) throw new CatalogError(409, 'The answer was saved, but its decision was not found. Inspect the card before retrying.', true);
  return { card: shortReference('c', card.id), index: decision.index, target: decisionReference(card, decision.target ?? question.target) };
}

async function nextDecision(root: string, catalog: CatalogView, pending: PendingDecision): Promise<AgentNextDecision> {
  const { card, decision } = pending;
  const output: AgentNextDecision = {
    card: shortReference('c', card.id), index: decision.index, rev: decisionRevision(card, decision), question: decision.question, answer: decision.answer,
    by: decision.by, target: await decisionTargetRange(root, catalog, decisionReference(card, decision.target)),
    next: 'edit the target, then apply_decision',
  };
  const fields: BoundedField[] = [
    { get: () => output.answer, set: value => { output.answer = value; } },
    ...(output.by === null ? [] : [{ get: () => output.by!, set: (value: string) => { output.by = value; } }]),
  ];
  if (output.question !== null) fields.push({ get: () => output.question!, set: value => { output.question = value; } });
  fitEstimatedBudget({ decision: output }, 150, fields);
  return output;
}

export async function applyAgentDecision(context: AgentOperationContext, reference: string, index: number,
  note?: string, rev?: string): Promise<AgentToolOutputs['apply_decision']> {
  requireSelectionRevision(rev, 'call next and pass its decision rev');
  const card = resolveCard(context.catalog, reference);
  const decision = card.decisions?.find(candidate => candidate.index === index);
  if (!decision) throw new AgentToolError(`Decision not found: ${shortReference('c', card.id)}#${index}.`, 'call next and pass its decision index');
  if (decisionRevision(card, decision) !== rev.toLowerCase()) throw new AgentToolError('The selected decision changed.', 'call next and use its decision selection');
  if (note !== undefined && (note.length > 2000 || /[\u0000]/u.test(note))) throw new Error('apply_decision: note must be at most 2000 characters without NUL.');
  const cardRef = shortReference('c', card.id);
  if (decision.applied !== null) return { card: cardRef, index, applied: decision.applied };
  if (card.decisions?.some(candidate => candidate.index !== index && decisionRevision(card, candidate) === rev.toLowerCase())) {
    throw new AgentToolError('The card has identical decision selections.', 'distinguish their questions or targets in Markdown, then call next');
  }
  await writeCatalog(context.config, context.source, {
    action: 'apply-decision', cardId: card.id, sourceHash: card.sourceHash, manifestHash: context.catalog.manifestHash,
    decisionIndex: index, answer: decision.answer, ...(note === undefined ? {} : { note }),
  }, null);
  const fresh = freshDecisionCard(await readProjectCatalog(context.root), card.id);
  const applied = fresh.decisions?.find(candidate => candidate.index === index)?.applied;
  if (applied === null || applied === undefined) {
    throw new CatalogError(409, 'The decision was written, but its applied mark was not found. Inspect the card before retrying.', true);
  }
  return { card: cardRef, index, applied };
}

function invalidInput(field: string, expectation: string): never {
  throw new AgentToolError(`${field} must be ${expectation}.`, `pass ${field} as ${expectation}`);
}

function objectInput(input: unknown, fields: readonly string[], required: readonly string[] = [], prefix = 'input'): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalidInput(prefix, 'an object');
  const value = input as Record<string, unknown>;
  for (const field of required) if (!Object.hasOwn(value, field)) invalidInput(`${prefix}.${field}`, 'provided');
  for (const field of Object.keys(value)) {
    if (!fields.includes(field)) throw new AgentToolError(`Unknown field ${prefix}.${field}.`,
      `remove ${prefix}.${field}; allowed fields: ${fields.join(', ')}`);
  }
  return value;
}

function stringValue(value: Record<string, unknown>, field: string, required = false, nullable = false, prefix = 'input'): string | null | undefined {
  const item = value[field];
  if (item === undefined && !required) return undefined;
  if (nullable && item === null) return null;
  if (typeof item !== 'string') invalidInput(`${prefix}.${field}`, nullable ? 'a string or null' : 'a string');
  return item;
}

function numberValue(value: Record<string, unknown>, field: string, options: { integer?: boolean; min: number; max?: number; nullable?: boolean },
  prefix = 'input'): number | null | undefined {
  const item = value[field];
  if (item === undefined) return undefined;
  if (options.nullable && item === null) return null;
  if (typeof item !== 'number' || !Number.isFinite(item) || (options.integer && !Number.isInteger(item))
    || item < options.min || (options.max !== undefined && item > options.max)) {
    const range = `${options.min}${options.max === undefined ? ' or greater' : ` to ${options.max}`}`;
    invalidInput(`${prefix}.${field}`, `${options.integer ? 'an integer' : 'a finite number'} from ${range}${options.nullable ? ' or null' : ''}`);
  }
  return item;
}

function enumValue<T extends string>(value: Record<string, unknown>, field: string, choices: readonly T[], nullable = false,
  prefix = 'input'): T | null | undefined {
  const item = value[field];
  if (item === undefined) return undefined;
  if (nullable && item === null) return null;
  if (typeof item !== 'string' || !choices.includes(item as T)) invalidInput(`${prefix}.${field}`, `${choices.join(', ')}${nullable ? ' or null' : ''}`);
  return item as T;
}

function stringArray(value: Record<string, unknown>, field: string, prefix = 'input'): string[] | undefined {
  const item = value[field];
  if (item === undefined) return undefined;
  if (!Array.isArray(item) || item.some(entry => typeof entry !== 'string')) invalidInput(`${prefix}.${field}`, 'an array of strings');
  return item as string[];
}

function revValue(value: Record<string, unknown>): string | undefined {
  const rev = stringValue(value, 'rev') as string | undefined;
  if (rev !== undefined && !/^[0-9a-f]{1,64}$/iu.test(rev)) invalidInput('input.rev', '1 to 64 hexadecimal characters');
  return rev;
}

const kinds = ['task', 'hero', 'doc'] as const;
const priorities = ['high', 'medium', 'low'] as const;
const newCardFields = ['title', 'body', 'kind', 'deck', 'owner', 'priority', 'effort', 'parent', 'tracks', 'key'] as const;

function validateNewCard(input: unknown, index: number): AgentNewCard {
  const prefix = `input.cards[${index}]`;
  const value = objectInput(input, newCardFields, ['title'], prefix);
  return {
    title: stringValue(value, 'title', true, false, prefix) as string,
    ...(value.body === undefined ? {} : { body: stringValue(value, 'body', false, false, prefix) as string }),
    ...(value.kind === undefined ? {} : { kind: enumValue(value, 'kind', kinds, false, prefix)! }),
    ...(value.deck === undefined ? {} : { deck: stringValue(value, 'deck', false, false, prefix) as string }),
    ...(value.owner === undefined ? {} : { owner: stringValue(value, 'owner', false, false, prefix) as string }),
    ...(value.priority === undefined ? {} : { priority: enumValue(value, 'priority', priorities, false, prefix)! }),
    ...(value.effort === undefined ? {} : { effort: numberValue(value, 'effort', { min: 0 }, prefix) as number }),
    ...(value.parent === undefined ? {} : { parent: stringValue(value, 'parent', false, false, prefix) as string }),
    ...(value.tracks === undefined ? {} : { tracks: stringArray(value, 'tracks', prefix)! }),
    ...(value.key === undefined ? {} : { key: stringValue(value, 'key', false, false, prefix) as string }),
  };
}

function validateInput<Name extends AgentToolName>(name: Name, input: unknown): AgentToolInputs[Name] {
  if (name === 'next') {
    const value = objectInput(input, ['member', 'budget']);
    return { member: stringValue(value, 'member'), budget: numberValue(value, 'budget',
      { integer: true, min: 200, max: agentToolLimits.briefBudgetMax }) } as AgentToolInputs[Name];
  }
  if (name === 'brief') {
    const value = objectInput(input, ['ref', 'budget', 'since'], ['ref']);
    return { ref: stringValue(value, 'ref', true), budget: numberValue(value, 'budget',
      { integer: true, min: 200, max: agentToolLimits.briefBudgetMax }), since: stringValue(value, 'since') } as AgentToolInputs[Name];
  }
  if (name === 'create_cards') {
    const value = objectInput(input, ['cards', 'member'], ['cards']);
    if (!Array.isArray(value.cards) || value.cards.length < 1 || value.cards.length > agentToolLimits.createBatch) {
      invalidInput('input.cards', `an array of 1 to ${agentToolLimits.createBatch} cards`);
    }
    return { cards: value.cards.map(validateNewCard), member: stringValue(value, 'member') } as AgentToolInputs[Name];
  }
  if (name === 'update_card') {
    const fields = ['ref', 'rev', 'state', 'reason', 'owner', 'priority', 'effort', 'deck', 'tracks', 'parent', 'member'] as const;
    const value = objectInput(input, fields, ['ref']);
    return {
      ref: stringValue(value, 'ref', true), rev: revValue(value), state: stringValue(value, 'state'),
      reason: stringValue(value, 'reason'), owner: stringValue(value, 'owner', false, true),
      priority: enumValue(value, 'priority', priorities, true), effort: numberValue(value, 'effort', { min: 0, nullable: true }),
      deck: stringValue(value, 'deck', false, true), tracks: stringArray(value, 'tracks'),
      parent: stringValue(value, 'parent', false, true), member: stringValue(value, 'member'),
    } as AgentToolInputs[Name];
  }
  if (name === 'report') {
    const value = objectInput(input, ['ref', 'text', 'file', 'state', 'rev', 'member'], ['ref']);
    if ((value.text === undefined) === (value.file === undefined)) {
      throw new AgentToolError('report needs exactly one of text or file.', 'pass exactly one of text or file');
    }
    return { ref: stringValue(value, 'ref', true), text: stringValue(value, 'text'), file: stringValue(value, 'file'),
      state: stringValue(value, 'state'), rev: revValue(value), member: stringValue(value, 'member') } as AgentToolInputs[Name];
  }
  if (name === 'ask') {
    const value = objectInput(input, ['ref', 'question', 'to', 'target', 'member'], ['ref', 'question']);
    return { ref: stringValue(value, 'ref', true), question: stringValue(value, 'question', true),
      to: stringValue(value, 'to'), target: stringValue(value, 'target'), member: stringValue(value, 'member') } as AgentToolInputs[Name];
  }
  if (name === 'question') {
    const value = objectInput(input, ['ref'], ['ref']);
    return { ref: stringValue(value, 'ref', true) } as AgentToolInputs[Name];
  }
  if (name === 'answer') {
    const value = objectInput(input, ['ref', 'rev', 'answer', 'as'], ['ref', 'rev', 'answer', 'as']);
    return { ref: stringValue(value, 'ref', true), answer: stringValue(value, 'answer', true),
      rev: stringValue(value, 'rev', true), as: stringValue(value, 'as', true) } as AgentToolInputs[Name];
  }
  if (name === 'apply_decision') {
    const value = objectInput(input, ['card', 'index', 'note', 'rev'], ['card', 'index', 'rev']);
    return { card: stringValue(value, 'card', true), index: numberValue(value, 'index', { integer: true, min: 0 }),
      rev: stringValue(value, 'rev', true), note: stringValue(value, 'note') } as AgentToolInputs[Name];
  }
  if (name === 'search') {
    const value = objectInput(input, ['query', 'deck', 'state', 'owner', 'kind', 'limit']);
    return { query: stringValue(value, 'query'), deck: stringValue(value, 'deck'), state: stringValue(value, 'state'),
      owner: stringValue(value, 'owner'), kind: enumValue(value, 'kind', kinds),
      limit: numberValue(value, 'limit', { integer: true, min: 1, max: agentToolLimits.searchMax }) } as AgentToolInputs[Name];
  }
  if (name === 'organize') {
    const value = objectInput(input, ['about']);
    const about = stringValue(value, 'about')?.trim();
    if (about !== undefined && (!about || about.length > 300)) invalidInput('input.about', 'a non-empty string of up to 300 characters');
    return { ...(about === undefined ? {} : { about }) } as AgentToolInputs[Name];
  }
  throw new AgentToolError(`Unknown agent tool ${String(name)}.`, `use one of: ${agentToolNames.join(', ')}`);
}

async function agentMember(context: AgentOperationContext, requested: string | undefined, caller: AgentCaller): Promise<CatalogMember> {
  const direct = requested ?? caller.defaultMember;
  if (direct !== undefined) {
    try { return commandMember(context, direct, 'agent'); }
    catch { /* The protocol error below always names the registry and the next step. */ }
  } else if (caller.clientName) {
    try { return commandMember(context, caller.clientName, 'agent'); }
    catch { /* A launcher name can be the member's ID or alias instead of the MCP client name. */ }
    try {
      const agents = await readAgentsConfig(context.root);
      const launcher = Object.keys(agents.launchers).find(name => name.toLocaleLowerCase('en') === caller.clientName!.toLocaleLowerCase('en'));
      if (launcher) return commandMember(context, launcher, 'agent');
    } catch { /* The same actionable member error covers an unknown client and an unknown launcher. */ }
  }
  const ids = (context.catalog.members ?? []).map(member => member.id).join(', ') || 'none';
  throw new AgentToolError('member is not known', `pass member (Members: ${ids}) or set DECKMATE_MEMBER`);
}

function resolveDeck(catalog: CatalogView, requested: string): string {
  const normalized = requested.trim().toLocaleLowerCase('ru-RU');
  const deck = catalog.decks.find(candidate => candidate.id === requested)
    ?? catalog.decks.find(candidate => candidate.title.trim().toLocaleLowerCase('ru-RU') === normalized);
  if (!deck) {
    throw new AgentToolError(`Deck not found: ${requested}.`, `pass one of: ${catalog.decks.map(candidate => candidate.title).join(', ')}`
      + (catalog.inboxDeckId ? '' : '; this project has no Inbox, so a card without deck stays Unassigned'));
  }
  return deck.id;
}

interface CreatePlan { index: number; cardId: string; edit?: Omit<Extract<CatalogEdit, { action: 'create-card' }>, 'manifestHash'>; failure?: AgentToolError }
type WritableCreatePlan = CreatePlan & { edit: NonNullable<CreatePlan['edit']>; position: number };

async function createAgentCards(writer: CliCatalogWriter, input: AgentCreateCardsInput,
  actor: string): Promise<AgentToolOutputs['create_cards']> {
  const initial = writer.catalog;
  const output: AgentToolOutputs['create_cards'] = { created: [], existing: [], failed: [] };
  const plans: CreatePlan[] = [];
  const writable: WritableCreatePlan[] = [];
  const planned = new Map<string, WritableCreatePlan>();
  const initialById = new Map(initial.cards.map(card => [card.id, card]));
  for (const [index, card] of input.cards.entries()) {
    try {
      const kind = card.kind ?? 'task';
      const deckId = card.deck === undefined ? null : resolveDeck(initial, card.deck);
      const parentId = card.parent === undefined ? null : resolveCard(initial, card.parent).id;
      const cardId = deterministicCardId(card.key !== undefined ? JSON.stringify(card.key)
        : JSON.stringify([kind, deckId, card.title, card.body ?? '']));
      const duplicate = planned.get(cardId);
      if (duplicate) {
        plans.push({ index, cardId, failure: new AgentToolError('The same card key appears earlier in this batch.',
          `the earlier card has index ${duplicate.index}; inspect it before retrying`) });
        continue;
      }
      const existing = initialById.get(cardId);
      if (existing) {
        output.existing.push(cardHead(initial, existing));
        continue;
      }
      const plan: WritableCreatePlan = { index, cardId, position: writable.length, edit: {
        action: 'create-card', cardId, kind, title: card.title, markdown: card.body ?? '', deckId, parentId,
        trackIds: card.tracks ?? [], owner: card.owner ?? null, effort: card.effort ?? null, priority: card.priority ?? null,
      } };
      plans.push(plan);
      writable.push(plan);
      planned.set(cardId, plan);
    } catch (error) {
      const failure = agentFailure(error, 'check this card and retry with a new key if its ID is occupied');
      output.failed.push({ index, error: failure.message, next: failure.next, ...(failure.saved ? { saved: true } : {}) });
    }
  }
  let outcomes: CliBatchOutcome[];
  try {
    outcomes = writable.length ? await writer.writeBatch(
      writable.map(plan => (manifestHash: string) => ({ ...plan.edit, manifestHash })), actor) : [];
  } catch (error) { throw agentFailure(error, 'call brief again before retrying'); }
  const fresh = writer.catalog;
  const freshById = new Map(fresh.cards.map(card => [card.id, card]));
  const warnings: string[] = [];
  for (const [position, outcome] of outcomes.entries()) {
    const plan = writable[position];
    const card = freshById.get(plan.cardId);
    if (outcome.ok) {
      warnings.push(...outcome.warnings);
      if (card) output.created.push(cardHead(fresh, card));
      else output.failed.push({ index: plan.index, error: 'The write succeeded, but the card is missing from the catalog.',
        next: 'call brief again before retrying', saved: true });
    } else {
      const failure = agentFailure(outcome.error, 'call brief again and retry; pass a new key if the card ID is occupied');
      output.failed.push({ index: plan.index, error: failure.message, next: failure.next, ...(failure.saved ? { saved: true } : {}) });
    }
  }
  for (const plan of plans.filter(candidate => candidate.failure && planned.get(candidate.cardId) !== undefined)) {
    const original = planned.get(plan.cardId)!;
    const outcome = outcomes[original.position];
    const card = freshById.get(plan.cardId);
    if (outcome?.ok && card) output.existing.push(cardHead(fresh, card));
    else output.failed.push({ index: plan.index, error: plan.failure!.message, next: plan.failure!.next });
  }
  output.failed.sort((left, right) => left.index - right.index);
  // 2026-11-12: an agent told to use Inbox must learn that the project has none instead of reporting Inbox anyway.
  if (!initial.inboxDeckId && input.cards.some(card => card.deck === undefined)) {
    warnings.push('This project has no Inbox deck; cards without deck are Unassigned.');
  }
  if (warnings.length) output.warnings = warnings;
  return output;
}

function partialWriteFailure(error: unknown, changed: string[]): AgentToolError {
  const failure = agentFailure(error, 'call brief again and retry');
  if (!changed.length) return failure;
  return new AgentToolError(failure.message, `Already applied: ${changed.join(', ')}. Call brief again before retrying the remaining fields.`,
    true);
}

async function updateAgentCard(project: AgentProject, initial: CatalogView, input: AgentUpdateCardInput,
  actor: string): Promise<AgentToolOutputs['update_card']> {
  let catalog = initial;
  let card = resolveCard(catalog, input.ref);
  assertRevision(card, input.rev);
  const changed: string[] = [];
  const warnings: string[] = [];
  const apply = async (fields: string[], edit: (manifestHash: string) => CatalogEdit): Promise<void> => {
    try {
      const result = await writeCatalog(project.config, project.source, edit(catalog.manifestHash), actor);
      changed.push(...fields);
      warnings.push(...result.warnings);
      catalog = await readProjectCatalog(project.root);
      const fresh = catalog.cards.find(candidate => candidate.id === card.id);
      if (!fresh) throw new AgentToolError('The card disappeared after a write.', 'Inspect the project before retrying.', true);
      card = fresh;
    } catch (error) { throw partialWriteFailure(error, changed); }
  };
  if (input.owner !== undefined || input.effort !== undefined || input.priority !== undefined) {
    const fields = (['owner', 'effort', 'priority'] as const).filter(field => input[field] !== undefined);
    await apply(fields, manifestHash => ({
      action: 'set-card-properties', cardId: card.id, sourceHash: card.sourceHash, manifestHash,
      owner: input.owner === undefined ? card.owner : input.owner,
      effort: input.effort === undefined ? card.effort ?? null : input.effort,
      priority: input.priority === undefined ? card.priority ?? null : input.priority,
    }));
  }
  if (input.deck !== undefined) {
    let deckId: string | null;
    try { deckId = input.deck === null ? null : resolveDeck(catalog, input.deck); }
    catch (error) { throw partialWriteFailure(error, changed); }
    await apply(['deck'], manifestHash => ({ action: 'assign-deck', cardId: card.id, sourceHash: card.sourceHash, manifestHash, deckId }));
  }
  if (input.tracks !== undefined) {
    await apply(['tracks'], manifestHash => ({ action: 'set-tracks', cardId: card.id, sourceHash: card.sourceHash,
      manifestHash, trackIds: input.tracks! }));
  }
  if (input.parent !== undefined) {
    let parent: CatalogCard | null;
    try { parent = input.parent === null ? null : resolveCard(catalog, input.parent); }
    catch (error) { throw partialWriteFailure(error, changed); }
    await apply(['parent'], manifestHash => ({
      action: 'set-card-parent', cardId: card.id, sourceHash: card.sourceHash, manifestHash,
      expectedParentId: card.parentId, parentId: parent?.id ?? null, parentSourceHash: parent?.sourceHash ?? null,
    }));
  }
  if (input.state !== undefined) {
    try {
      const result = await writeAgentState({ ...project, catalog }, card, input.state, actor, input.reason);
      warnings.push(...result.warnings);
      changed.push('state');
      catalog = await readProjectCatalog(project.root);
      card = catalog.cards.find(candidate => candidate.id === card.id) ?? card;
    } catch (error) { throw partialWriteFailure(error, changed); }
  }
  return { card: cardHead(catalog, card), changed, ...(warnings.length ? { warnings } : {}) };
}

async function searchAgentCards(project: AgentProject, input: AgentSearchInput): Promise<AgentToolOutputs['search']> {
  const service = new CatalogService({ ...project.config, editMode: 'read-only' }, ':memory:');
  try {
    const state = input.state === undefined ? undefined : readCardState(input.state);
    if (input.state !== undefined && !state) throw new Error(`state must be one of: ${cardStates.flatMap(cardStateWords).join(', ')}.`);
    const initial = await readProjectCatalog(project.root);
    const query: CatalogQuery = {
      text: input.query, deckId: input.deck === undefined ? undefined : resolveDeck(initial, input.deck),
      state, owner: input.owner, kind: input.kind,
    };
    const limit = input.limit ?? agentToolLimits.searchDefault;
    const all = await service.search(project.source, { ...query, limit: 1000 });
    const found = await service.search(project.source, { ...query, limit }, { hits: true });
    const hits = await Promise.all(found.map(async card => {
      const first = card.hits[0];
      let at = `${card.path}:${first?.line ?? 1}-${first?.line ?? 1}`;
      if (!first) {
        const bytes = await readProjectMarkdown(project.root, card.path);
        const range = sourceLineRange(bytes, card.range ?? { start: 0, end: bytes.length });
        at = `${card.path}:${range.from}-${range.to}`;
      }
      const deck = initial.decks.find(candidate => candidate.id === card.deckId)?.title;
      return {
        ref: shortReference('c', card.id), title: card.title, ...(card.state ? { state: card.state } : {}),
        ...(deck ? { deck } : {}), at,
        ...(first ? { snippet: first.text.slice(0, agentToolLimits.snippetChars) } : {}),
      };
    }));
    return { hits, more: Math.max(0, all.length - found.length) };
  } finally { await service.close(); }
}

function agentFailure(error: unknown, next: string): AgentToolError {
  if (error instanceof AgentToolError) return error;
  if (error instanceof CatalogError) {
    const retry = error.status === 409 ? (/card.*id|already.*exist/iu.test(error.message) ? 'pass a new key' : 'call brief again and retry')
      : error.status === 403 ? 'reopen the project without read-only mode'
        : error.status === 422 ? 'correct the field named in the error and retry' : next;
    return new AgentToolError(error.message, retry, error.saved);
  }
  return new AgentToolError(error instanceof Error ? error.message : String(error), next,
    Boolean(error && typeof error === 'object' && 'saved' in error && error.saved === true));
}

const responseTextLimits: Record<string, number> = {
  title: 200, deck: 200, hero: 200, card: 200, owner: 200, reason: 500, error: 500, next: 500, question: 500,
};

function trimResponseText(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  let trimmed = false;
  for (const [key, item] of Object.entries(value)) {
    const limit = responseTextLimits[key];
    if (typeof item === 'string' && limit && item.length > limit) {
      const reference = key === 'hero' ? /\s+\(c-[a-z0-9]+\)$/u.exec(item)?.[0] ?? '' : '';
      const prefix = item.slice(0, limit - reference.length - 1).replace(/[\uD800-\uDBFF]$/u, '');
      (value as Record<string, unknown>)[key] = `${prefix}…${reference}`;
      trimmed = true;
    } else if (trimResponseText(item)) trimmed = true;
  }
  return trimmed;
}

/** 2026-11-12: singleton responses also need bounded display text; trimming lists alone cannot enforce the ceiling. */
function limitToolResponse<Name extends AgentToolName>(name: Name, output: AgentToolOutputs[Name]): AgentToolOutputs[Name] {
  if (name === 'brief') return output;
  const textTrimmed = trimResponseText(output);
  if (!textTrimmed && JSON.stringify(output).length <= agentToolLimits.responseChars) return output;
  const value = output as unknown as Record<string, unknown>;
  const withWarnings = value as { warnings?: string[] };
  const originalWarnings = withWarnings.warnings;
  withWarnings.warnings = [...(originalWarnings ?? []),
    'Response truncated: shortened text or omitted list entries; read source pointers, use smaller batches or narrower filters.'];
  const omitted: string[] = [];
  const trim = (field: string): boolean => {
    const list = value[field];
    if (!Array.isArray(list) || !list.length || (field === 'warnings' && list.length === 1)) return false;
    if (field === 'warnings') list.shift();
    else list.pop();
    omitted.push(field);
    return true;
  };
  const orders: Partial<Record<AgentToolName, string[]>> = {
    next: ['readNext', 'warnings'], create_cards: ['existing', 'created', 'failed', 'warnings'],
    update_card: ['warnings'], report: ['warnings'], search: ['hits', 'warnings'], ask: ['warnings'],
    organize: ['table', 'placements', 'readNext', 'warnings'],
  };
  const order = orders[name] ?? [];
  while (JSON.stringify(output).length > agentToolLimits.responseChars && order.some(trim)) {
    if (name === 'search' && omitted.at(-1) === 'hits') (output as AgentToolOutputs['search']).more += 1;
  }
  if (name === 'next') {
    const next = output as AgentToolOutputs['next'];
    while (next.brief && JSON.stringify(output).length > agentToolLimits.responseChars) {
      const excess = JSON.stringify(output).length - agentToolLimits.responseChars + 30;
      next.brief = next.brief.slice(0, Math.max(0, next.brief.length - excess));
      next.truncated = true;
      omitted.push('brief');
      if (!next.brief) break;
    }
  }
  if (!textTrimmed && !omitted.length) {
    if (originalWarnings === undefined) delete withWarnings.warnings;
    else withWarnings.warnings = originalWarnings;
  }
  return output;
}

/**
 * Validates `input` against the tool's contract and runs it on a fresh read of the project files.
 * Throws AgentToolError (src/agent-tools.ts) for every failure an agent can act on.
 */
export async function callAgentTool<Name extends AgentToolName>(project: AgentProject, name: Name, input: unknown,
  caller: AgentCaller = {}): Promise<AgentToolOutputs[Name]> {
  try {
    const valid = validateInput(name, input);
    if (name === 'create_cards') {
      const request = valid as AgentCreateCardsInput;
      return await withCatalogWriter(project.config, project.source, async writer => {
        const member = await agentMember({ ...project, catalog: writer.catalog }, request.member, caller);
        return limitToolResponse(name, await createAgentCards(writer, request, member.id) as AgentToolOutputs[Name]);
      });
    }
    const catalog = await readProjectCatalog(project.root);
    const context: AgentOperationContext = { ...project, catalog };
    let output: AgentToolOutputs[Name];
    if (name === 'next') {
      const request = valid as AgentNextInput;
      const member = await agentMember(context, request.member, caller);
      const result = await readAgentNext(context, member.id, { budget: request.budget, withBrief: true });
      output = (result.decision ? { decision: result.decision } : {
        card: result.card ? cardHead(catalog, result.card) : null,
        ...(result.brief ? { brief: result.brief.markdown, truncated: result.brief.truncated, readNext: briefPointers(result.brief) }
          : { next: 'No allowed card. Ask the project owner for work, or create_cards in Inbox.' }),
      }) as AgentToolOutputs[Name];
    } else if (name === 'brief') {
      const request = valid as AgentBriefInput;
      const card = resolveCard(catalog, request.ref);
      const brief = await buildBrief(catalog, project.root, card, { budget: request.budget ?? agentToolLimits.briefBudget });
      let changes: AgentToolOutputs['brief']['changes'];
      if (request.since !== undefined) {
        // 2026-11-11: a rev is a prefix of the hash the agent read; after another member's edit it matches no current
        // hash, which is itself the answer. A hash carries no time, so the card's events are listed either way.
        const shortRev = new RegExp(`^[0-9a-f]{${agentToolLimits.revLength}}$`, 'iu').test(request.since);
        const history = await readAgentChanges(project.root, card, shortRev ? card.sourceHash : request.since);
        const changed = shortRev ? !card.sourceHash.toLowerCase().startsWith(request.since.toLowerCase()) : history.changed;
        changes = { changed, events: history.events.map(event => ({
          at: event.at, by: event.actorMemberId ?? null, what: event.summary.replace(/\s+/gu, ' ').trim().slice(0, 200),
        })) };
      }
      output = { card: cardHead(catalog, card), brief: brief.markdown, truncated: brief.truncated,
        readNext: briefPointers(brief), ...(changes ? { changes } : {}) } as AgentToolOutputs[Name];
    } else if (name === 'update_card') {
      const request = valid as AgentUpdateCardInput;
      const member = await agentMember(context, request.member, caller);
      output = await updateAgentCard(project, catalog, request, member.id) as AgentToolOutputs[Name];
    } else if (name === 'report') {
      const request = valid as AgentReportInput;
      const member = await agentMember(context, request.member, caller);
      const result = await reportAgentCard(context, request.ref, member.id, { ...request, source: caller.source });
      output = { card: cardHead(await readProjectCatalog(project.root), result.current),
        ...(result.result.warnings.length ? { warnings: result.result.warnings } : {}) } as AgentToolOutputs[Name];
    } else if (name === 'ask') {
      const request = valid as AgentAskInput;
      const member = await agentMember(context, request.member, caller);
      output = await askAgentQuestion(context, request.ref, member.id, request) as AgentToolOutputs[Name];
    } else if (name === 'question') {
      output = await readAgentQuestion(context, (valid as AgentToolInputs['question']).ref) as AgentToolOutputs[Name];
    } else if (name === 'answer') {
      const request = valid as AgentAnswerInput;
      const member = await agentMember(context, undefined, caller);
      output = await answerAgentQuestion(context, request.ref, request.answer, request.as, { rev: request.rev, member: member.id }) as AgentToolOutputs[Name];
    } else if (name === 'apply_decision') {
      const request = valid as AgentApplyDecisionInput;
      output = await applyAgentDecision(context, request.card, request.index, request.note, request.rev) as AgentToolOutputs[Name];
    } else if (name === 'search') {
      output = await searchAgentCards(project, valid as AgentSearchInput) as AgentToolOutputs[Name];
    } else {
      output = await organizeAgentCards(project, catalog, valid as AgentOrganizeInput) as AgentToolOutputs[Name];
    }
    return limitToolResponse(name, output);
  } catch (error) {
    throw agentFailure(error, 'check the named field or call brief again, then retry');
  }
}
