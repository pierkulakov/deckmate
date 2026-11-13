import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdir, readdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AgentToolError } from '../src/agent-tools.ts';
import { callAgentTool, openAgentProject, type AgentProject } from '../server/agent-ops.ts';
import { emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { createManagedMarkdown } from '../server/native-cards.ts';
import { prepareCardOptionsPatch, readCardOptions } from '../server/card-options.ts';
import { CatalogService } from '../server/catalog-service.ts';
import * as catalogModule from '../server/catalog.ts';
import { tempProjects } from './helpers/temp-projects.ts';

const temps = tempProjects('deckmate-agent-ops-');
const originalEnvironment = { ...process.env };
let project: AgentProject;
let root: string;
const existingId = 'card:11111111-1111-4111-8111-111111111111';

beforeEach(async () => {
  root = await temps.create();
  await mkdir(path.join(root, 'tasks'));
  const manifest = emptyManifest();
  manifest.formatLanguage = 'en';
  manifest.inboxDeckId = 'inbox';
  manifest.spaces.push({ id: 'work', title: 'Work' });
  manifest.decks.push(
    { id: 'inbox', spaceId: 'work', title: 'Inbox', kind: 'task', description: '', icon: 'box', color: '#123456' },
    { id: 'done', spaceId: 'work', title: 'Done', kind: 'mixed', description: '', icon: 'box', color: '#654321' },
  );
  manifest.members = [
    { id: 'agent', label: 'Agent', kind: 'agent', aliases: ['test-client'] },
    { id: 'other', label: 'Other', kind: 'agent', aliases: [] },
    { id: 'human', label: 'Human', kind: 'human', aliases: [] },
  ];
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  await createManagedMarkdown(root, `cards/${existingId.slice(5)}.md`, {
    deckmate: 'card', schema: 1, id: existingId.slice(5), kind: 'task', title: 'Searchable existing', state: 'not-started',
    owner: 'Agent', deckId: 'inbox', trackIds: [], parentId: null,
  }, 'Existing body.\n');
  const options = await readCardOptions(root);
  await (await prepareCardOptionsPatch(root, options.hash, { [existingId]: { handMemberIds: ['agent'] } })).publish();
  project = await openAgentProject({ cwd: root, data: root });
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(Object.assign(new TypeError('offline'), {
    cause: Object.assign(new Error('No listener'), { code: 'ECONNREFUSED' }),
  }));
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.env = { ...originalEnvironment };
  await temps.removeAll();
});

it('finds the manifest above cwd and returns next with a brief for the MCP client member', async () => {
  const nested = path.join(root, 'tasks', 'nested');
  await mkdir(nested);
  delete process.env.DECKMATE_DATA;
  delete process.env.FREETION_DATA;
  const opened = await openAgentProject({ cwd: nested, data: undefined });
  expect(await realpath(opened.root)).toBe(await realpath(root));
  const result = await callAgentTool(opened, 'next', {}, { clientName: 'test-client' });
  expect(result.card).toMatchObject({ title: 'Searchable existing', deck: 'Inbox', owner: 'Agent' });
  expect(result.brief).toContain('Existing body.');
  expect(result.readNext).toEqual([]);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(6000);
});

it('creates ten deterministic Inbox cards and repeats the whole batch without new files', async () => {
  const cards = Array.from({ length: 10 }, (_, index) => ({
    title: `Searchable ${index}`, body: `Body ${index}.\n`, key: `stable-${index}`,
  }));
  const first = await callAgentTool(project, 'create_cards', { cards, member: 'agent' });
  expect(first.created).toHaveLength(10);
  expect(first.failed).toEqual([]);
  expect(first.created.every(card => card.deck === 'Inbox')).toBe(true);
  const before = await readdir(path.join(root, 'cards'));
  const second = await callAgentTool(project, 'create_cards', { cards, member: 'agent' });
  expect(second.created).toEqual([]);
  expect(second.existing).toHaveLength(10);
  expect(second.failed).toEqual([]);
  expect(await readdir(path.join(root, 'cards'))).toEqual(before);
  expect(JSON.stringify(second).length).toBeLessThanOrEqual(6000);
});

it('caps a maximum-batch response and discloses omitted card heads', async () => {
  const result = await callAgentTool(project, 'create_cards', { member: 'agent', cards: Array.from({ length: 50 }, (_, index) => ({
    title: `A sufficiently descriptive card title ${index}`, key: `capped-${index}`,
  })) });
  expect(result.failed).toEqual([]);
  expect(result.created.length + result.existing.length).toBeLessThan(50);
  expect(result.warnings?.join(' ')).toContain('Response truncated');
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(6000);
}, 30000);

it('updates deck and owner, then rejects a stale rev with a recovery step', async () => {
  const current = await readProjectCatalog(root);
  const rev = current.cards.find(card => card.id === existingId)!.sourceHash.slice(0, 12);
  const updated = await callAgentTool(project, 'update_card', {
    ref: existingId, rev, deck: 'done', owner: 'Other', member: 'agent',
  });
  expect(updated.changed).toEqual(['owner', 'deck']);
  expect(updated.card).toMatchObject({ deck: 'Done', owner: 'Other' });
  const failure = await callAgentTool(project, 'update_card', {
    ref: existingId, rev, state: 'started', member: 'agent',
  }).catch(error => error);
  expect(failure).toBeInstanceOf(AgentToolError);
  expect(failure.message).toBe('card changed since rev');
  expect(failure.next).toContain(`call brief with since=${rev}`);
});

it('does not let a combined owner reset and done accept the agents own unreported work', async () => {
  await expect(callAgentTool(project, 'update_card', { ref: existingId, owner: null, state: 'done', member: 'agent' }))
    .rejects.toThrow(/own work|собственн/u);
  expect((await readProjectCatalog(root)).cards.find(card => card.id === existingId)?.state).not.toBe('done');
});

it.each([
  'Длинный заголовок '.repeat(60).slice(0, 1000).trim(),
  `Escaped ${'\u0001'.repeat(992)}`,
])('bounds scalar titles with an ellipsis without changing stored titles or card references (%#)', async title => {
  const created = await callAgentTool(project, 'create_cards', { member: 'agent', cards: [{ title, owner: 'Agent',
    body: 'Observable work context. '.repeat(300) }] });
  expect(created.failed).toEqual([]);
  const card = created.created[0];
  expect(card).toBeDefined();
  expect(card.title.length).toBeLessThanOrEqual(200);
  expect(card.title).toMatch(/…$/u);
  const updated = await callAgentTool(project, 'update_card', { ref: card.ref, member: 'agent', priority: 'high' });
  expect(updated.card.ref).toBe(card.ref);
  expect(updated.card.title).toBe(card.title);
  const reported = await callAgentTool(project, 'report', { ref: card.ref, text: 'Checked.', member: 'agent' });
  const searched = await callAgentTool(project, 'search', { query: title.split(' ')[0], limit: 1 });
  expect(searched.hits[0]?.title).toBe(card.title);
  const stored = (await readProjectCatalog(root)).cards.find(candidate => candidate.title === title)!;
  const options = await readCardOptions(root);
  await (await prepareCardOptionsPatch(root, options.hash, {
    [existingId]: { handMemberIds: [] }, [stored.id]: { handMemberIds: ['agent'] },
  })).publish();
  const next = await callAgentTool(project, 'next', { member: 'agent', budget: 4000 });
  expect(next.card?.ref).toBe(card.ref);
  expect(next.card?.title).toBe(card.title);
  for (const result of [created, updated, reported, searched, next]) expect(JSON.stringify(result).length).toBeLessThanOrEqual(6000);
  expect((await readProjectCatalog(root)).cards.find(candidate => candidate.title === title)).toBeDefined();
});

it('files a UTF-8 report supplied as text and changes state in the same write', async () => {
  const result = await callAgentTool(project, 'report', {
    ref: existingId, text: 'Проверено: 3/3.\n', state: 'review', member: 'agent',
  });
  expect(result.card.state).toBe('review');
  expect(await readFile(path.join(root, `cards/${existingId.slice(5)}.md`), 'utf8')).toContain('Проверено: 3/3.');
});

it('searches with a bounded hit list, snippets and an exact remainder', async () => {
  await callAgentTool(project, 'create_cards', { member: 'agent', cards: [1, 2, 3].map(index => ({
    title: `Searchable extra ${index}`, key: `search-${index}`,
  })) });
  const result = await callAgentTool(project, 'search', { query: 'Searchable', limit: 2 });
  expect(result.hits).toHaveLength(2);
  expect(result.more).toBe(2);
  for (const hit of result.hits) {
    expect(hit.at).toMatch(/^cards\/.+\.md:\d+-\d+$/u);
    expect(hit.snippet?.length ?? 0).toBeLessThanOrEqual(200);
  }
});

it('accepts MCP report files relative to the project and at the byte limit', async () => {
  await writeFile(path.join(root, 'report.txt'), 'я'.repeat(100_000));
  const result = await callAgentTool(project, 'report', { ref: existingId, file: 'report.txt', member: 'agent' }, { source: 'mcp' });
  expect(result.card.ref).toBeTruthy();
  expect(await readFile(path.join(root, `cards/${existingId.slice(5)}.md`), 'utf8')).toContain('я'.repeat(100_000));
});

it('rejects outside, oversized, non-file and Windows special MCP report paths without saving', async () => {
  const outside = await temps.create();
  await writeFile(path.join(outside, 'secret.txt'), 'Outside private text');
  await writeFile(path.join(root, 'large.txt'), 'я'.repeat(100_001));
  await symlink(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  const filename = path.join(root, `cards/${existingId.slice(5)}.md`);
  const before = await readFile(filename);
  for (const file of [path.join(outside, 'secret.txt'), path.relative(root, path.join(outside, 'secret.txt')),
    'escape/secret.txt', 'large.txt', 'tasks', 'missing.txt', '\\\\host\\share\\secret.txt', '//host/share/secret.txt',
    '\\\\?\\C:\\secret.txt', '\\\\.\\NUL', 'report.txt:secret', 'C:secret.txt', 'NUL', 'aux.txt']) {
    const error = await callAgentTool(project, 'report', { ref: existingId, file, member: 'agent' }, { source: 'mcp' }).catch(error => error);
    expect(error, file).toBeInstanceOf(AgentToolError);
    expect(error.toFailure(), file).toEqual({ error: expect.any(String), next: 'pass the report as text, or save it inside the project' });
  }
  expect(await readFile(filename)).toEqual(before);
});

it('keeps CLI report file access outside the project unrestricted', async () => {
  const outside = await temps.create();
  const file = path.join(outside, 'report.txt');
  await writeFile(file, 'Shell report.');
  await callAgentTool(project, 'report', { ref: existingId, file, member: 'agent' }, { source: 'cli' });
  expect(await readFile(path.join(root, `cards/${existingId.slice(5)}.md`), 'utf8')).toContain('Shell report.');
});

it('marks creation as saved when the post-write catalog read fails', async () => {
  const original = CatalogService.prototype.edit;
  vi.spyOn(CatalogService.prototype, 'edit').mockImplementationOnce(async function (this: CatalogService, ...args) {
    const view = await original.apply(this, args);
    expect(view.cards.some(card => card.title === 'Saved before read failure')).toBe(true);
    vi.spyOn(catalogModule, 'readProjectCatalog').mockRejectedValueOnce(new Error('Post-write catalog unavailable'));
    return view;
  });
  await expect(callAgentTool(project, 'create_cards', { cards: [{ title: 'Saved before read failure' }], member: 'agent' }))
    .rejects.toMatchObject({ saved: true, next: expect.stringContaining('before retrying') });
  vi.restoreAllMocks();
  expect((await readProjectCatalog(root)).cards.some(card => card.title === 'Saved before read failure')).toBe(true);
});
