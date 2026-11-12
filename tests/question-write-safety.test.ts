import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { callAgentTool, openAgentProject, type AgentCaller } from '../server/agent-ops.ts';
import { editProjectCatalog, emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { createManagedMarkdown, readNativeCard, patchManagedMarkdown, replaceProjectMarkdown } from '../server/native-cards.ts';
import { createMcpSession } from '../server/mcp.ts';
import { agentInstructions, agentToolDefinitions, type AgentToolName } from '../src/agent-tools.ts';
import { applyDecision, assignQuestion, parseOpenQuestions, recordDecision, resolvedDecisionsOf } from '../src/open-questions.ts';
import { markdownParser } from '../src/markdown-model.ts';
import { shortReference } from '../src/references.ts';
import { pendingDecisions } from '../src/catalog-contracts.ts';
import { readCardActivity } from '../server/activity.ts';
import { projectCli } from '../tools/project.ts';

const roots: string[] = [];
const environment = { ...process.env };
afterEach(async () => {
  vi.restoreAllMocks();
  process.env = { ...environment };
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(body = '## Open questions\n- Colour? @pier\n- Timber? @pier\n') {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-question-safety-'));
  roots.push(root);
  await mkdir(path.join(root, 'tasks'));
  const manifest = emptyManifest();
  manifest.formatLanguage = 'en';
  manifest.members = [
    { id: 'pier', label: 'Pier', kind: 'human', aliases: [] },
    { id: 'maya', label: 'Maya', kind: 'human', aliases: [] },
    { id: 'agent', label: 'Builder', kind: 'agent', aliases: ['claude'] },
  ];
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  const cardId = `card:${randomUUID()}`;
  const filename = `cards/${cardId.slice(5)}.md`;
  await createManagedMarkdown(root, filename, { deckmate: 'card', schema: 1, id: cardId.slice(5), kind: 'task',
    title: 'Subject', state: 'started', owner: 'Builder', parentId: null, deckId: null, trackIds: [] }, body);
  const project = await openAgentProject({ cwd: root, data: root });
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(Object.assign(new TypeError('offline'), {
    cause: Object.assign(new Error('No listener'), { code: 'ECONNREFUSED' }),
  }));
  const ref = shortReference('c', cardId);
  const caller: AgentCaller = { source: 'mcp', defaultMember: 'agent' };
  const call = <Name extends AgentToolName>(name: Name, input: unknown) => callAgentTool(project, name, input, caller);
  const current = async () => {
    const catalog = await readProjectCatalog(root);
    return { catalog, card: catalog.cards.find(card => card.id === cardId)! };
  };
  const bytes = () => readFile(path.join(root, filename));
  const replaceBody = async (markdown: string) => {
    const file = (await readNativeCard(root, cardId))!;
    await replaceProjectMarkdown(root, filename, file.fileHash, patchManagedMarkdown(file, {}, markdown));
  };
  return { root, cardId, filename, project, ref, call, current, bytes, replaceBody };
}

it.each(['\n', '\r\n', '\r'])('moves code before the question paragraph and retains reference links, EOL=%j', eol => {
  const markdown = '\uFEFF' + ['## Open questions', '- ```text', '  Keep 👣.  ', '  ```', '',
    '  Which [rule][r]? @pier → [Rules][target]', '  - Keep option.  ', '- Other?', '',
    '## Notes', 'Unchanged.  ', '', '[r]: https://example.com/rule', '[target]: /r/c-0123456789#camera'].join(eol);
  expect(parseOpenQuestions(markdown).questions?.[0]).toMatchObject({ text: 'Which rule?', assignee: 'pier', target: 'c-0123456789#camera' });
  const assigned = assignQuestion(markdown, 0, 'Which rule?', 'maya');
  expect(assigned).toBe(markdown.replace('@pier', '@maya'));
  const saved = recordDecision(markdown, 0, 'Which rule?', 'Stable', 'Pier', '2026-11-12', 'en', 'en');
  expect(saved).toContain(['- ```text', '  Keep 👣.  ', '  ```'].join(eol));
  expect(saved).toContain('[rule][r]');
  expect(saved).toContain('[Rules][target]');
  expect(saved.slice(saved.indexOf('## Notes'))).toBe(markdown.slice(markdown.indexOf('## Notes')));
  expect(resolvedDecisionsOf(markdownParser.parse(saved))[0]).toMatchObject({ question: 'Which rule?', answer: 'Stable',
    target: 'c-0123456789#camera', author: 'Pier', applied: null });
});

it.each(['→', '—'])('does not consume a %s card link in the middle of a sentence', separator => {
  const markdown = `## Open questions\n- Does A ${separator} [B](/r/c-0123456789) work? @pier\n`;
  const text = `Does A ${separator} B work?`;
  expect(parseOpenQuestions(markdown).questions?.[0]).toMatchObject({ text, assignee: 'pier', taskRef: null, target: null });
  expect(assignQuestion(markdown, 0, text, 'maya')).toBe(markdown.replace('@pier', '@maya'));
  const saved = recordDecision(markdown, 0, text, 'Yes', 'Pier', '2026-11-12');
  expect(saved).toContain('[B](/r/c-0123456789)');
  expect(resolvedDecisionsOf(markdownParser.parse(saved))[0]).toMatchObject({ question: text, target: null, taskRef: null });
});

it.each(['\n', '\r\n', '\r'])('adds an application note only to its item, EOL=%j', eol => {
  const first = '  Colour? <!-- deckmate:decision --> → Blue — Pier, 2026-11-12 <!-- deckmate:pending -->';
  const second = '- Timber? <!-- deckmate:decision --> → Oak — Pier, 2026-11-12 <!-- deckmate:pending -->';
  const markdown = '\uFEFF' + ['## Decided', '', '-', first, '  - Option.  ', second, '', '## Notes', 'Keep.  '].join(eol);
  const saved = applyDecision(markdown, 0, 'Blue', '2026-11-12', 'en', undefined, 'Updated Work.');
  expect(saved).toBe(markdown.replace('<!-- deckmate:pending -->', '<!-- deckmate:applied 2026-11-12 -->')
    .replace('  - Option.  ', `  - Option.  ${eol}${eol}  Applied: Updated Work.`));
  expect(resolvedDecisionsOf(markdownParser.parse(saved)).map(decision => decision.answer)).toEqual(['Blue', 'Oak']);
  expect(applyDecision(saved, 0, 'Blue', '2026-11-13', 'en', undefined, 'Another note')).toBe(saved);
});

it('rejects stale and unversioned MCP answers instead of answering the next question', async () => {
  const f = await fixture();
  const packet = await f.call('question', { ref: `${f.ref}#1` });
  const input = { ref: `${f.ref}#1`, rev: packet.rev, answer: 'Blue', as: 'pier' };
  await f.call('answer', input);
  const saved = await f.bytes();
  await expect(f.call('answer', input)).rejects.toThrow();
  await expect(f.call('answer', { ref: `${f.ref}#1`, answer: 'Blue', as: 'pier' })).rejects.toThrow();
  expect(await f.bytes()).toEqual(saved);
  expect((await f.current()).card.openQuestions?.map(question => question.text)).toEqual(['Timber?']);
});

it.each(['assignee', 'order'])('rejects an answer captured before the question %s changed', async change => {
  const f = await fixture();
  const packet = await f.call('question', { ref: `${f.ref}#1` });
  const file = (await readNativeCard(f.root, f.cardId))!;
  const changed = change === 'assignee' ? file.markdown.replace('Colour? @pier', 'Colour? @maya')
    : file.markdown.replace('- Colour? @pier\n- Timber? @pier', '- Timber? @pier\n- Colour? @pier');
  await f.replaceBody(changed);
  const before = await f.bytes();
  await expect(f.call('answer', { ref: `${f.ref}#1`, rev: packet.rev, answer: 'Blue', as: 'pier' })).rejects.toThrow();
  expect(await f.bytes()).toEqual(before);
});

it('returns the saved index for a Markdown answer and keeps the recorder separate from the human', async () => {
  const f = await fixture();
  const packet = await f.call('question', { ref: `${f.ref}#1` });
  const result = await f.call('answer', { ref: `${f.ref}#1`, rev: packet.rev, answer: '**Blue**', as: 'pier' });
  expect(result).toMatchObject({ card: f.ref, index: 0 });
  expect((await f.current()).card.decisions?.[0]).toMatchObject({ question: 'Colour?', answer: 'Blue', by: 'Pier', recordedBy: 'Builder' });
  expect((await f.bytes()).toString('utf8')).toMatch(/— Pier, via Builder, \d{4}-\d{2}-\d{2}/u);
  expect((await readCardActivity(f.root, f.cardId)).events).toEqual([expect.objectContaining({ action: 'record-decision', actorMemberId: 'agent' })]);
});

it('keeps decision selection bound across reordering, but permits editing the target on the same card', async () => {
  const f = await fixture('## Work\nKeep.\n\n## Open questions\n- Colour? @pier\n- Timber? @pier\n');
  for (const answer of ['Blue', 'Blue']) {
    const packet = await f.call('question', { ref: `${f.ref}#1` });
    await f.call('answer', { ref: `${f.ref}#1`, rev: packet.rev, answer, as: 'pier' });
  }
  const next = await f.call('next', { member: 'agent' });
  const selection = next.decision!;
  const file = (await readNativeCard(f.root, f.cardId))!;
  const lines = file.markdown.split('\n');
  const positions = lines.flatMap((line, index) => line.includes('deckmate:decision') ? [index] : []);
  [lines[positions[0]], lines[positions[1]]] = [lines[positions[1]], lines[positions[0]]];
  await f.replaceBody(lines.join('\n'));
  const before = await f.bytes();
  await expect(f.call('apply_decision', { card: f.ref, index: selection.index, rev: selection.rev })).rejects.toThrow();
  expect(await f.bytes()).toEqual(before);
  await f.replaceBody(file.markdown.replace('Keep.', 'Keep. Mark the exit in blue.'));
  const edited = await f.bytes();
  await expect(f.call('apply_decision', { card: f.ref, index: selection.index })).rejects.toThrow();
  await expect(f.call('apply_decision', { card: f.ref, index: selection.index, rev: selection.rev, note: 'x'.repeat(2001) })).rejects.toThrow();
  expect(await f.bytes()).toEqual(edited);
  const applied = await f.call('apply_decision', { card: f.ref, index: selection.index, rev: selection.rev, note: 'Updated Work.' });
  expect(applied.applied).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  const saved = await f.bytes();
  expect(saved.toString('utf8')).toContain('Updated Work.');
  expect(await f.call('apply_decision', { card: f.ref, index: selection.index, rev: selection.rev })).toEqual(applied);
  expect(await f.bytes()).toEqual(saved);
});

it('refuses indistinguishable decision selections instead of marking another item with different options', async () => {
  const entry = '- Colour? @pier <!-- deckmate:decision --> → Blue — Pier, 2026-11-12 <!-- deckmate:pending -->';
  const f = await fixture(`## Decided\n${entry}\n  - First context\n${entry}\n  - Second context\n`);
  const next = await f.call('next', { member: 'agent' });
  const file = (await readNativeCard(f.root, f.cardId))!;
  await f.replaceBody(file.markdown.replace('First context', 'Swap context').replace('Second context', 'First context').replace('Swap context', 'Second context'));
  const before = await f.bytes();
  await expect(f.call('apply_decision', { card: f.ref, index: next.decision!.index, rev: next.decision!.rev })).rejects.toThrow(/identical|ambiguous/u);
  expect(await f.bytes()).toEqual(before);
});

it('deduplicates the complete validated ask identity, including resolved questions', async () => {
  const f = await fixture('## Work\nKeep.\n');
  const input = { ref: f.ref, question: 'Which **colour**?', to: 'pier', target: `${f.ref}#work` };
  await f.call('ask', input);
  const saved = await f.bytes();
  expect(await f.call('ask', input)).toMatchObject({ existing: true });
  expect(await f.bytes()).toEqual(saved);
  await expect(f.call('ask', { ...input, to: 'missing' })).rejects.toThrow();
  await expect(f.call('ask', { ...input, target: `${f.ref}#missing` })).rejects.toThrow();
  expect(await f.bytes()).toEqual(saved);
  await f.call('ask', { ...input, to: 'maya' });
  await f.call('ask', { ...input, target: f.ref });
  expect((await f.current()).card.openQuestions).toHaveLength(3);
  const packet = await f.call('question', { ref: `${f.ref}#1` });
  await f.call('answer', { ref: `${f.ref}#1`, rev: packet.rev, answer: 'Blue', as: 'pier' });
  const recorded = await f.bytes();
  expect(await f.call('ask', input)).toMatchObject({ existing: true });
  expect(await f.bytes()).toEqual(recorded);
  const current = await f.current();
  expect(await editProjectCatalog(f.root, { action: 'ask-question', cardId: f.cardId, sourceHash: current.card.sourceHash,
    manifestHash: current.catalog.manifestHash, text: input.question, assignee: 'pier', target: input.target })).toEqual([]);
  const next = await f.call('next', { member: 'agent' });
  await f.call('apply_decision', { card: f.ref, index: next.decision!.index, rev: next.decision!.rev });
  const applied = await f.bytes();
  expect(await f.call('ask', input)).toMatchObject({ existing: true });
  expect(await f.bytes()).toEqual(applied);
});

it('excludes legacy pending-looking entries from the pool', async () => {
  const f = await fixture('## Decided\n- Legacy — Pier, 2026-11-01 <!-- deckmate:pending -->\n');
  const { catalog } = await f.current();
  expect(pendingDecisions(catalog)).toEqual([]);
  expect(await f.call('next', { member: 'agent' })).not.toHaveProperty('decision');
});

it('publishes the whole question item with reference definitions and retries without rewriting bytes', async () => {
  const body = '## Open questions\r\n\r\n- ```text\r\n  Keep code.  \r\n  ```\r\n\r\n'
    + '  Which [rule][r]? @pier\r\n  - Option.  \r\n\r\n## Notes\nKeep final bytes.  \n\n[r]: https://example.com/rule';
  const f = await fixture(body);
  const { card, catalog } = await f.current();
  const edit = { action: 'record-decision' as const, cardId: f.cardId, sourceHash: card.sourceHash,
    manifestHash: catalog.manifestHash, questionIndex: 0, questionText: 'Which rule?', answer: 'Use [rule][r]', memberId: 'pier' };
  const before = await f.bytes();
  await editProjectCatalog(f.root, edit, 'agent');
  const saved = await f.bytes();
  expect(saved.subarray(0, before.length - Buffer.byteLength(body))).toEqual(before.subarray(0, before.length - Buffer.byteLength(body)));
  expect(saved.toString('utf8')).toContain('- ```text\r\n  Keep code.  \r\n  ```');
  expect(saved.toString('utf8')).toContain('Use [rule][r]');
  expect(saved.toString('utf8').slice(saved.toString('utf8').indexOf('## Notes'))).toBe(body.slice(body.indexOf('## Notes')));
  expect((await f.current()).card.decisions?.[0]).toMatchObject({ question: 'Which rule?', answer: 'Use rule', recordedBy: 'Builder' });
  expect(await editProjectCatalog(f.root, edit, 'agent')).toEqual([]);
  expect(await f.bytes()).toEqual(saved);
});

it('passes captured revisions and the recording member through the real CLI commands', async () => {
  const f = await fixture();
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  await projectCli(['question', `${f.ref}#1`, '--data', f.root]);
  const packet = JSON.parse(output.mock.calls.at(-1)![0] as string);
  await projectCli(['answer', `${f.ref}#1`, 'Blue', '--as', 'pier', '--member', 'agent', '--rev', packet.rev, '--data', f.root]);
  const saved = await f.bytes();
  await expect(projectCli(['answer', `${f.ref}#1`, 'Blue', '--as', 'pier', '--member', 'agent', '--rev', packet.rev, '--data', f.root])).rejects.toThrow();
  expect(await f.bytes()).toEqual(saved);
  const next = await f.call('next', { member: 'agent' });
  await projectCli(['apply', f.ref, String(next.decision!.index), '--rev', next.decision!.rev, '--note', 'Updated rule.', '--data', f.root]);
  expect((await f.bytes()).toString('utf8')).toContain('Updated rule.');
});

it('refuses an unidentified MCP recorder even when as names a human', async () => {
  const f = await fixture();
  const packet = await f.call('question', { ref: `${f.ref}#1` });
  const before = await f.bytes();
  await expect(callAgentTool(f.project, 'answer', { ref: `${f.ref}#1`, rev: packet.rev, answer: 'Blue', as: 'pier' },
    { source: 'mcp', clientName: 'unknown' })).rejects.toThrow(/member/u);
  expect(await f.bytes()).toEqual(before);
});

it('does not let MCP answer as a human accept a legacy Task owned by the recording agent', async () => {
  const f = await fixture();
  const id = randomUUID();
  const taskId = `card:${id}`;
  await createManagedMarkdown(f.root, `cards/${id}.md`, { deckmate: 'card', schema: 1, id, kind: 'task', title: 'Decision work',
    state: 'review', owner: 'Builder', parentId: f.cardId, deckId: null, trackIds: [] }, '#### Report 2026-11-11 · agent\nBuilt it.\n');
  await f.replaceBody(`## Open questions\n- Colour? @pier — [Decision](/r/${shortReference('c', taskId)})\n`);
  const lines: string[] = [];
  const session = createMcpSession({ tools: agentToolDefinitions, instructions: agentInstructions, version: 'test', defaultMember: 'agent',
    call: (name, input, caller) => callAgentTool(f.project, name, input, { ...caller, source: 'mcp' }), write: line => lines.push(line) });
  const request = async (name: AgentToolName, input: unknown) => {
    await session.handle(JSON.stringify({ jsonrpc: '2.0', id: lines.length, method: 'tools/call', params: { name, arguments: input } }));
    return JSON.parse(lines.at(-1)!).result;
  };
  const packet = JSON.parse((await request('question', { ref: `${f.ref}#1` })).content[0].text);
  const before = await f.bytes();
  const taskBefore = await readFile(path.join(f.root, `cards/${id}.md`));
  const result = await request('answer', { ref: `${f.ref}#1`, rev: packet.rev, answer: 'Blue', as: 'pier' });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toMatch(/own work|собственную/u);
  expect(await f.bytes()).toEqual(before);
  expect(await readFile(path.join(f.root, `cards/${id}.md`))).toEqual(taskBefore);
});
