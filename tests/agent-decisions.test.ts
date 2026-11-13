import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import * as catalogModule from '../server/catalog.ts';
import * as cliWrite from '../server/cli-write.ts';
import * as agentQueue from '../server/agent-queue.ts';
import { createManagedMarkdown } from '../server/native-cards.ts';
import { callAgentTool, openAgentProject, type AgentProject } from '../server/agent-ops.ts';
import { estimateTokens } from '../server/agent-brief.ts';
import { shortReference } from '../src/references.ts';
import type { AgentToolName } from '../src/agent-tools.ts';
import type { CatalogCard, CatalogDecision, CatalogView } from '../src/catalog-contracts.ts';
import { run as nextCommand } from '../tools/commands/next.ts';
import { tempProjects } from './helpers/temp-projects.ts';

const projects = tempProjects('deckmate-agent-decisions-');
const originalEnvironment = { ...process.env };
const cardId = 'card:11111111-1111-4111-8111-111111111111';
const ref = shortReference('c', cardId);
let project: AgentProject;
let root: string;
let base: CatalogView;
let card: CatalogCard;
let readCatalog: ReturnType<typeof vi.spyOn>;
let write: ReturnType<typeof vi.spyOn>;

function catalogWith(changes: Partial<CatalogCard> = {}): CatalogView {
  return { ...base, cards: [{ ...card, ...changes }, ...base.cards.filter(candidate => candidate.id !== cardId)] };
}

function call(name: string, input: unknown): Promise<any> {
  return callAgentTool(project, name as AgentToolName, input, { source: 'cli', defaultMember: 'agent' });
}

beforeEach(async () => {
  root = await projects.create();
  await mkdir(path.join(root, 'tasks'));
  const manifest = emptyManifest();
  manifest.formatLanguage = 'en';
  manifest.spaces.push({ id: 'work', title: 'Work' });
  manifest.decks.push({ id: 'inbox', spaceId: 'work', title: 'Inbox', kind: 'task', description: '', icon: 'box', color: '#123456' });
  manifest.members = [
    { id: 'agent', label: 'Agent', kind: 'agent', aliases: [] },
    { id: 'human', label: 'Human', kind: 'human', aliases: [] },
  ];
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  await createManagedMarkdown(root, `cards/${cardId.slice(5)}.md`, {
    deckmate: 'card', schema: 1, id: cardId.slice(5), kind: 'task', title: 'Choose a colour', state: 'not-started',
    owner: 'Agent', deckId: 'inbox', trackIds: [], parentId: null, handMemberIds: ['agent'],
  }, '## Work\n\nRecord the chosen colour.\n');
  project = await openAgentProject({ cwd: root, data: root });
  base = await readProjectCatalog(root);
  const original = base.cards.find(candidate => candidate.id === cardId)!;
  card = {
    ...original, handMemberIds: ['agent'],
    openQuestions: [{ text: 'Which colour?', taskRef: null, assignee: 'human', target: null }],
    decisions: [],
  };
  readCatalog = vi.spyOn(catalogModule, 'readProjectCatalog');
  write = vi.spyOn(cliWrite, 'writeCatalog').mockResolvedValue({ warnings: [], via: 'files' });
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.env = { ...originalEnvironment };
  await projects.removeAll();
});

it('asks on the same card with an addressee and target, and repeats without a write', async () => {
  readCatalog.mockReturnValue(Promise.resolve(catalogWith({ openQuestions: [] })));
  const asked = await call('ask', { ref, question: 'Which colour?', to: 'human', target: `${ref}#Work`, member: 'agent' });
  expect(asked).toMatchObject({ question: 'Which colour?', card: ref, assignee: 'human', target: `${ref}#Work`, existing: false });
  expect(write).toHaveBeenCalledWith(project.config, 'sandbox', expect.objectContaining({
    action: 'ask-question', cardId, sourceHash: card.sourceHash, text: 'Which colour?', assignee: 'human', target: `${ref}#Work`,
  }), 'agent');

  readCatalog.mockReturnValue(Promise.resolve(catalogWith()));
  const repeated = await call('ask', { ref, question: 'Which colour?', member: 'agent' });
  expect(repeated).toMatchObject({ question: 'Which colour?', card: ref, assignee: 'human', target: ref, existing: true });
  expect(write).toHaveBeenCalledTimes(1);
});

it('returns a compact chat package for a question and its three latest decisions', async () => {
  const decisions = [1, 2, 3, 4].map(index => ({
    index: index - 1, question: `Question ${index}`, answer: `Answer ${index}`, by: 'human', date: '2026-11-12', target: null, applied: null,
  }));
  readCatalog.mockReturnValue(Promise.resolve(catalogWith({ decisions })));
  const result = await call('question', { ref: `${ref}#1` });
  expect(result).toMatchObject({ question: 'Which colour?', card: { ref, title: 'Choose a colour' }, assignee: 'human' });
  expect(result.target).toMatch(/^cards\/.+\.md:\d+-\d+$/u);
  expect(result.decisions.map((decision: CatalogDecision) => decision.answer)).toEqual(['Answer 2', 'Answer 3', 'Answer 4']);
  expect(estimateTokens(JSON.stringify(result))).toBeLessThanOrEqual(200);
  expect(write).not.toHaveBeenCalled();
});

it('records a chat answer as the named human and returns its decision index and target', async () => {
  const recorded: CatalogDecision = { index: 0, question: 'Which colour?', answer: 'Blue.', by: 'Human', recordedBy: 'Agent', date: '2026-11-12', target: null, applied: null };
  readCatalog.mockReturnValueOnce(Promise.resolve(catalogWith()))
    .mockReturnValueOnce(Promise.resolve(catalogWith({ openQuestions: [], decisions: [recorded] })));
  const result = await call('answer', { ref: `${ref}#1`, rev: card.sourceHash.slice(0, 12), answer: 'Blue.', as: 'human' });
  expect(result).toEqual({ card: ref, index: 0, target: ref });
  expect(write).toHaveBeenCalledWith(project.config, 'sandbox', expect.objectContaining({
    action: 'record-decision', cardId, questionIndex: 0, questionText: 'Which colour?', answer: 'Blue.', memberId: 'human',
  }), 'agent');
});

it('returns a pending decision before cards and excludes Tasks waiting on questions', async () => {
  const pending: CatalogDecision = { index: 2, question: 'Which colour?', answer: 'Blue.', by: 'human', date: '2026-11-12', target: null, applied: null };
  readCatalog.mockReturnValue(Promise.resolve(catalogWith({ openQuestions: [], decisions: [pending] })));
  const queue = vi.spyOn(agentQueue, 'nextAgentCard');
  const next = await call('next', { member: 'agent' });
  expect(next).toEqual({ decision: {
    card: ref, index: 2, rev: expect.stringMatching(/^[0-9a-f]{12}$/u), question: 'Which colour?', answer: 'Blue.', by: 'human',
    target: expect.stringMatching(/^cards\/.+\.md:\d+-\d+$/u), next: 'edit the target, then apply_decision',
  } });
  expect(estimateTokens(JSON.stringify(next))).toBeLessThanOrEqual(150);
  expect(queue).not.toHaveBeenCalled();

  readCatalog.mockReturnValue(Promise.resolve(catalogWith()));
  expect(await call('next', { member: 'agent' })).toMatchObject({ card: null });
  expect(write).not.toHaveBeenCalled();
});

it.each(['human', null])('keeps a Task waiting on an answer out of next, assignee=%s', async assignee => {
  readCatalog.mockResolvedValue(catalogWith({ openQuestions: [{ text: 'Which colour?', taskRef: null, assignee, target: null }] }));
  expect(await call('next', { member: 'agent' })).toMatchObject({ card: null });
  expect(write).not.toHaveBeenCalled();
});

it('ellipsizes long question and decision prose to the packet budgets', async () => {
  const prose = 'Очень подробное обоснование с измерениями. '.repeat(30);
  const decisions = [0, 1, 2].map(index => ({ index, question: prose, answer: prose, by: 'human', date: '2026-11-12', target: null, applied: null }));
  readCatalog.mockReturnValue(Promise.resolve(catalogWith({
    title: 'Очень длинное название карточки. '.repeat(20),
    openQuestions: [{ text: prose, taskRef: null, assignee: 'human', target: null }], decisions,
  })));
  const question = await call('question', { ref: `${ref}#1` });
  expect(estimateTokens(JSON.stringify(question))).toBeLessThanOrEqual(200);
  expect(question.decisions).toHaveLength(3);

  readCatalog.mockReturnValue(Promise.resolve(catalogWith({ openQuestions: [], decisions: [decisions[0]] })));
  const next = await call('next', { member: 'agent' });
  expect(estimateTokens(JSON.stringify(next))).toBeLessThanOrEqual(150);
});

it('prints the same pending decision through the next CLI command', async () => {
  const pending: CatalogDecision = { index: 2, question: 'Which colour?', answer: 'Blue.', by: 'human', date: '2026-11-12', target: null, applied: null };
  const catalog = catalogWith({ openQuestions: [], decisions: [pending] });
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  await nextCommand({ config: project.config, source: 'sandbox', root, catalog }, [], new Map([['member', 'agent']]));
  const printed = JSON.parse(output.mock.calls.at(-1)![0] as string);
  expect(printed).toMatchObject({ source: 'sandbox', member: 'agent', decision: {
    card: ref, index: 2, answer: 'Blue.', next: 'edit the target, then apply_decision',
  } });
  expect(printed.decision.target).toMatch(/^cards\/.+\.md:\d+-\d+$/u);
});

it('marks an edited decision applied and passes the note separately from the expected answer', async () => {
  const pending: CatalogDecision = { index: 0, question: 'Which colour?', answer: 'Blue.', by: 'human', date: '2026-11-12', target: null, applied: null };
  readCatalog.mockResolvedValue(catalogWith({ openQuestions: [], decisions: [pending] }));
  const next = await call('next', { member: 'agent' });
  const applied = { ...pending, applied: '2026-11-12' };
  readCatalog.mockReturnValueOnce(Promise.resolve(catalogWith({ openQuestions: [], decisions: [pending] })))
    .mockReturnValueOnce(Promise.resolve(catalogWith({ openQuestions: [], decisions: [applied] })));
  const result = await call('apply_decision', { card: ref, index: 0, rev: next.decision.rev, note: 'Recorded in Work.' });
  expect(result).toEqual({ card: ref, index: 0, applied: '2026-11-12' });
  expect(write).toHaveBeenCalledWith(project.config, 'sandbox', expect.objectContaining({
    action: 'apply-decision', cardId, decisionIndex: 0, answer: 'Blue.', note: 'Recorded in Work.',
  }), null);
});
