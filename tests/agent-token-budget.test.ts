// 2026-11-12: a measurement, not a feature test. Six agent scenarios on the demo project (server/demo.ts), each
// priced two ways: through the MCP session (the argument JSON plus the content[0].text of every call) and through
// the smallest honest set of direct file reads and writes. estimateTokens (server/agent-brief.ts) is a reproducible
// estimate, not a model tokenizer; both sides are priced with it, so the comparison stays like for like.
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  agentInstructions, agentToolDefinitions,
  type AgentCreateCardsOutput, type AgentNextOutput, type AgentReportOutput, type AgentToolName,
} from '../src/agent-tools.ts';
import { callAgentTool, openAgentProject, type AgentCaller, type AgentProject } from '../server/agent-ops.ts';
import { createMcpSession, type McpSession } from '../server/mcp.ts';
import { initializeDemo } from '../server/demo.ts';
import { readProjectCatalog } from '../server/catalog.ts';
import { resolveReference, shortReference } from '../src/references.ts';
import { estimateTokens } from '../server/agent-brief.ts';
import { tempProjects } from './helpers/temp-projects.ts';

// Budgets come from the first full run of this file on the demo project (2026-11-12): every scenario budget is the
// measured MCP cost ×1.25 rounded up to the next 50, so platform variance (git availability swaps one warning line
// inside a brief) stays inside the budget. The entry ceiling is fixed by the measurement task itself.
const entryBudget = 800; // measured 794: initialize instructions 39 + tools/list 755.
const scenarioBudgets = {
  take: 650, // measured 503: next {member:'build-agent'}.
  create: 750, // measured 594: create_cards with ten titled cards.
  report: 100, // measured 79: report with a two-line report and state review.
  return: 850, // measured 637: brief with since=<rev of the first reading>.
  discuss: 200, // measured 122: question, then answer as the human.
  apply: 150, // measured 108: next returns the decision, then apply_decision marks it.
} as const;

const originalEnvironment = { ...process.env };
const temps = tempProjects('deckmate-agent-budget-');
const lines: string[] = [];
let nextId = 0;
let root: string;
let project: AgentProject;
let session: McpSession;

interface ToolCall { text: string; tokens: number }

async function callTool(name: AgentToolName, args: unknown): Promise<ToolCall> {
  await session.handle(JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } }));
  const response = JSON.parse(lines[lines.length - 1]) as { result: { content: Array<{ text: string }>; isError?: boolean } };
  expect(response.result.isError, response.result.content[0].text).not.toBe(true);
  return { text: response.result.content[0].text, tokens: estimateTokens(JSON.stringify(args)) + estimateTokens(response.result.content[0].text) };
}

/** The one-time session fee: the initialize instructions plus the tools/list payload the client keeps in context. */
async function measureEntry(): Promise<number> {
  await session.handle(JSON.stringify({ jsonrpc: '2.0', id: 'init', method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'agent-token-budget-test', version: '1' } } }));
  const initialized = JSON.parse(lines[lines.length - 1]) as { result: { instructions: string } };
  await session.handle(JSON.stringify({ jsonrpc: '2.0', id: 'list', method: 'tools/list' }));
  const listed = JSON.parse(lines[lines.length - 1]) as { result: unknown };
  return estimateTokens(initialized.result.instructions) + estimateTokens(JSON.stringify(listed.result));
}

async function fileTokens(relativePath: string): Promise<number> {
  return estimateTokens(await readFile(path.join(root, relativePath), 'utf8'));
}

/** Every added and removed line of an edit, by longest common subsequence; files here stay under ~250 lines. */
function lineDiff(before: string, after: string): string[] {
  const left = before.split('\n');
  const right = after.split('\n');
  const table = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] = left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const changed: string[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { i += 1; j += 1; }
    else if (table[i + 1][j] >= table[i][j + 1]) changed.push(left[i++]);
    else changed.push(right[j++]);
  }
  while (i < left.length) changed.push(left[i++]);
  while (j < right.length) changed.push(right[j++]);
  return changed;
}

beforeAll(async () => {
  root = await temps.create();
  await initializeDemo(root);
  project = await openAgentProject({ cwd: root, data: root });
  // Writes must never drift to a running local server: the temp project owns its files (as in tests/agent-ops.test.ts).
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(Object.assign(new TypeError('offline'), {
    cause: Object.assign(new Error('No listener'), { code: 'ECONNREFUSED' }),
  }));
  session = createMcpSession({
    call: (name, input, caller: AgentCaller) => callAgentTool(project, name as AgentToolName, input, caller),
    tools: agentToolDefinitions,
    instructions: agentInstructions,
    version: 'token-budget-test',
    defaultMember: 'build-agent',
    write: line => lines.push(line),
  });
});

afterAll(async () => {
  vi.restoreAllMocks();
  process.env = { ...originalEnvironment };
  await temps.removeAll();
});

it('keeps six agent scenarios inside their MCP budgets and measures direct file reads', async () => {
  const entry = await measureEntry();
  expect(entry).toBeLessThanOrEqual(entryBudget);

  // 1 "take a task": files pay for the manifest (members, decks), card options (the Hand), the chosen card and its
  // parent; MCP pays for one next call.
  const take = await callTool('next', { member: 'build-agent' });
  const next = JSON.parse(take.text) as AgentNextOutput;
  expect(next.card).not.toBeNull();
  const catalog = await readProjectCatalog(root);
  const card = resolveReference(catalog.cards, 'c', next.card!.ref)!;
  const parent = catalog.cards.find(candidate => candidate.id === card.parentId);
  const takeFiles = (await fileTokens('tasks/deckmate.md')) + (await fileTokens('tasks/deckmate-card-options.md'))
    + (await fileTokens(card.path)) + (parent ? await fileTokens(parent.path) : 0);

  // 2 "file ten Inbox cards": files pay for reading the manifest, writing ten full card files and the deck-order
  // edit in the manifest. The demo Inbox deck stores an empty flatOrder, which the catalog drops
  // (server/catalog.ts normalizeDeckOrder), so create_cards leaves the manifest untouched and the edit below is 0.
  const manifestBefore = await readFile(path.join(root, 'tasks/deckmate.md'), 'utf8');
  const newCards = Array.from({ length: 10 }, (_, index) => ({
    title: `Support the harbor playtest ${index}`, body: `Prepare item ${index} for the playtest build.\n`,
  }));
  const create = await callTool('create_cards', { cards: newCards, member: 'build-agent' });
  const created = JSON.parse(create.text) as AgentCreateCardsOutput;
  expect(created.failed).toEqual([]);
  expect(created.created).toHaveLength(10);
  const manifestAfter = await readFile(path.join(root, 'tasks/deckmate.md'), 'utf8');
  const fresh = await readProjectCatalog(root);
  let createdFiles = 0;
  for (const head of created.created) createdFiles += await fileTokens(resolveReference(fresh.cards, 'c', head.ref)!.path);
  const createFiles = estimateTokens(manifestBefore) + createdFiles
    + estimateTokens(lineDiff(manifestBefore, manifestAfter).join('\n'));

  // 3 "hand in": files pay for reading the card file and writing the report block plus the state line.
  const cardBefore = await readFile(path.join(root, card.path), 'utf8');
  const reportText = 'Built the harbor market stalls around the square; collision checked.\n';
  const report = await callTool('report', { ref: next.card!.ref, text: reportText, state: 'review', member: 'build-agent' });
  expect((JSON.parse(report.text) as AgentReportOutput).card.state).toBe('review');
  const cardAfter = await readFile(path.join(root, card.path), 'utf8');
  const reportFiles = estimateTokens(cardBefore) + estimateTokens(lineDiff(cardBefore, cardAfter).join('\n'));

  // 2026-11-12: reassignment traffic is excluded from the returning agent's budget; its first revision drives the diff.
  await callAgentTool(project, 'update_card', { ref: next.card!.ref, owner: 'Maya Chen', member: 'maya' });
  const returning = await callTool('brief', { ref: next.card!.ref, since: next.card!.rev });
  expect((JSON.parse(returning.text) as { changes?: { changed: boolean | null } }).changes?.changed).toBe(true);
  const returnFiles = (await fileTokens(card.path)) + (await fileTokens('tasks/deckmate.md'))
    + (await fileTokens('tasks/deckmate-card-options.md'));

  // 2026-11-12: question and answer costs include the real writer's persisted Markdown diff, not a simulated response.
  const questionText = 'Which colour marks the harbour exit?';
  await appendFile(path.join(root, card.path), `\n## Open questions\n\n- ${questionText}\n`);
  const discussionBase = await readProjectCatalog(root);
  const human = discussionBase.members!.find(member => member.kind === 'human')!;
  const questionCall = await callTool('question', { ref: `${shortReference('c', card.id)}#1` });
  expect(estimateTokens(questionCall.text)).toBeLessThanOrEqual(200);

  const beforeDiscussion = await readFile(path.join(root, card.path), 'utf8');
  const answerCall = await callTool('answer', { ref: `${shortReference('c', card.id)}#1`, rev: JSON.parse(questionCall.text).rev, answer: 'Use blue.', as: human.id });
  const afterDiscussion = await readFile(path.join(root, card.path), 'utf8');
  expect(afterDiscussion).not.toBe(beforeDiscussion);
  const discuss = { tokens: questionCall.tokens + answerCall.tokens };
  const discussionFiles = (await fileTokens('tasks/deckmate.md')) + estimateTokens(beforeDiscussion)
    + estimateTokens(lineDiff(beforeDiscussion, afterDiscussion).join('\n'));

  // 6 "apply a decision": next supplies the target and apply_decision writes the mark. The direct-file side pays for
  // the decided source and a one-line applied-note diff; both sides use the same estimateTokens measurement.
  const decisionCall = await callTool('next', { member: 'build-agent' });
  expect(estimateTokens(decisionCall.text)).toBeLessThanOrEqual(150);
  const selection = JSON.parse(decisionCall.text).decision;
  const applyCall = await callTool('apply_decision', { card: selection.card, index: selection.index, rev: selection.rev, note: 'Recorded blue in the card.' });
  const apply = { tokens: decisionCall.tokens + applyCall.tokens };
  const afterApplied = await readFile(path.join(root, card.path), 'utf8');
  expect(afterApplied).toContain('Applied: Recorded blue in the card.');
  const applyFiles = (await fileTokens('tasks/deckmate.md')) + estimateTokens(afterDiscussion)
    + estimateTokens(lineDiff(afterDiscussion, afterApplied).join('\n'));

  expect(take.tokens).toBeLessThanOrEqual(scenarioBudgets.take);
  expect(create.tokens).toBeLessThanOrEqual(scenarioBudgets.create);
  expect(report.tokens).toBeLessThanOrEqual(scenarioBudgets.report);
  expect(returning.tokens).toBeLessThanOrEqual(scenarioBudgets['return']);
  expect(discuss.tokens).toBeLessThanOrEqual(scenarioBudgets.discuss);
  expect(apply.tokens).toBeLessThanOrEqual(scenarioBudgets.apply);
  // The fee-included comparison is asserted where the route replaces several reads (1, 2, 4, 5); for a single cheap
  // write the one-time session fee dominates, so the table keeps the honest pair of numbers without an assert.
  expect(take.tokens + entry).toBeLessThan(takeFiles);
  expect(create.tokens + entry).toBeLessThan(createFiles);
  expect(returning.tokens + entry).toBeLessThan(returnFiles);
  expect(discuss.tokens + entry).toBeLessThan(discussionFiles);

  const row = (scenario: string, mcp: string, withEntry: string, files: string, budget: string): string =>
    [scenario.padEnd(30), mcp.padStart(4), withEntry.padStart(6), files.padStart(5), budget.padStart(6)].join(' | ');
  // One summary at the end, so the numbers can be copied into a report.
  console.log(['Agent token budget on the demo project; estimateTokens is a reproducible estimate, not a model tokenizer.',
    row('scenario', 'MCP', '+entry', 'files', 'budget'),
    row('entry (initialize, tools/list)', String(entry), '-', '-', String(entryBudget)),
    row('1 take a task', String(take.tokens), String(take.tokens + entry), String(takeFiles), String(scenarioBudgets.take)),
    row('2 file ten Inbox cards', String(create.tokens), String(create.tokens + entry), String(createFiles), String(scenarioBudgets.create)),
    row('3 hand in a report', String(report.tokens), String(report.tokens + entry), String(reportFiles), String(scenarioBudgets.report)),
    row('4 return after edits', String(returning.tokens), String(returning.tokens + entry), String(returnFiles), String(scenarioBudgets['return'])),
    row('5 discuss and answer', String(discuss.tokens), String(discuss.tokens + entry), String(discussionFiles), String(scenarioBudgets.discuss)),
    row('6 apply a decision', String(apply.tokens), String(apply.tokens + entry), String(applyFiles), String(scenarioBudgets.apply)),
  ].join('\n'));
}, 120_000);
