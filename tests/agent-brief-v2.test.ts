import { afterEach, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildBrief, estimateTokens } from '../server/agent-brief.ts';
import { emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { readCardContent } from '../server/card-content.ts';
import { createManagedMarkdown } from '../server/native-cards.ts';
import { writeCatalog } from '../server/cli-write.ts';
import * as cliWrite from '../server/cli-write.ts';
import type { ServerConfig } from '../server/config.ts';
import { resolveReference, shortReference } from '../src/references.ts';
import { parseOpenQuestions } from '../src/open-questions.ts';
import { run as ask } from '../tools/commands/ask.ts';

const roots: string[] = [];
const port = 4396;
const taskId = 'task:features/example.md#1.1';
const docId = 'doc:features/example.md';
vi.setConfig({ testTimeout: 30000 });

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    const relative = path.relative(await realpath(tmpdir()), await realpath(root));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(root).startsWith('deckmate-k2-')) {
      throw new Error('Unsafe fixture cleanup');
    }
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture(ordered = false) {
  const root = await mkdtemp(path.join(process.env.K2_SANDBOX ?? tmpdir(), 'deckmate-k2-'));
  roots.push(root);
  await mkdir(path.join(root, 'features'));
  await mkdir(path.join(root, 'tasks'));
  await writeFile(path.join(root, 'features/example.md'), '\uFEFF# Example\r\n\r\n## Решено\r\n- Existing rule.\r\n\r\n'
    + '## Открыто\r\n\r\n## 1 — Work\r\nIntro.\r\n### 1.1 First (план)\r\nOriginal body.\r\n\r\n'
    + '### 1.2 Neighbour (приёмка)\r\nKeep these bytes.\r\n');
  const manifest = emptyManifest();
  manifest.spaces = [{ id: 'work', title: 'Work' }];
  manifest.decks = [{ id: 'work', spaceId: 'work', title: 'Work', kind: 'mixed', description: '', color: '#123456', icon: 'box' }];
  manifest.members = [{ id: 'codex', label: 'Codex', kind: 'agent', aliases: [] },
    { id: 'reviewer', label: 'Reviewer', kind: 'human', aliases: [] },
    { id: 'second', label: 'Second', kind: 'human', aliases: [] }];
  manifest.membership = [{ card: taskId, deck: 'work' }];
  if (ordered) manifest.deckOrder = { work: { flatOrder: [taskId] } };
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  const config: ServerConfig = { editMode: 'direct', dataRoot: root, writeRoot: root, projectName: 'K2', port, python: 'python' };
  return { root, config };
}

function offline() {
  return vi.spyOn(globalThis, 'fetch').mockRejectedValue(Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('No listener'), { code: 'ECONNREFUSED' }),
  }));
}

async function askQuestion(config: ServerConfig, cardId: string, text: string, to?: string, target?: string) {
  const catalog = await readProjectCatalog(config.dataRoot);
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const options = new Map([['member', 'codex'], ...(to ? [['to', to] as [string, string]] : []),
      ...(target ? [['target', target] as [string, string]] : [])]);
    await ask({ config, root: config.dataRoot, source: 'sandbox', catalog }, [shortReference('c', cardId), text], options);
    return JSON.parse(output.mock.calls.at(-1)![0] as string);
  } finally { output.mockRestore(); }
}

async function files(root: string): Promise<Record<string, { hash: string; modified: number }>> {
  const result: Record<string, { hash: string; modified: number }> = {};
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const filename = path.join(root, entry.name);
    if (entry.isDirectory()) {
      for (const [relative, value] of Object.entries(await files(filename))) result[entry.name + '/' + relative] = value;
    } else result[entry.name] = { hash: createHash('sha256').update(await readFile(filename)).digest('hex'), modified: (await stat(filename)).mtimeMs };
  }
  return result;
}

async function native(root: string, markdown: string, parentId: string | null = null, kind: 'task' | 'doc' = 'task') {
  const uuid = randomUUID();
  await createManagedMarkdown(root, `cards/${uuid}.md`, { deckmate: 'card', schema: 1, id: uuid, kind,
    title: 'Isolated', state: kind === 'task' ? 'план' : null, owner: null, deckId: 'work', trackIds: [], parentId }, markdown);
  return `card:${uuid}`;
}

async function brief(root: string, cardId: string, budget?: number) {
  const catalog = await readProjectCatalog(root);
  const card = catalog.cards.find(card => card.id === cardId)!;
  if (card.openQuestions === undefined) {
    const questions = parseOpenQuestions(card.markdown).questions;
    if (questions) card.openQuestions = questions.map(question => ({ text: question.text, taskRef: question.taskRef, assignee: null, target: null }));
  }
  return buildBrief(catalog, root, card, { budget });
}

it('asks on the source legacy Task without creating a Decision Task', async () => {
  const { root, config } = await fixture();
  offline();
  const write = vi.spyOn(cliWrite, 'writeCatalog').mockResolvedValue({ warnings: [], via: 'files' });
  const result = await askQuestion(config, taskId, 'Choose colour?');
  const catalog = await readProjectCatalog(root);
  expect(result).toMatchObject({ card: shortReference('c', taskId), assignee: 'reviewer', target: shortReference('c', taskId), existing: false });
  expect(write).toHaveBeenCalledWith(config, 'sandbox', expect.objectContaining({
    action: 'ask-question', cardId: taskId, text: 'Choose colour?', assignee: 'reviewer',
  }), 'codex');
  expect(catalog.cards.filter(card => card.title === 'Решение: Choose colour?')).toHaveLength(0);
});

it('keeps a native child question on that child with an explicit recipient and target', async () => {
  const { root, config } = await fixture(true);
  offline();
  const write = vi.spyOn(cliWrite, 'writeCatalog').mockResolvedValue({ warnings: [], via: 'files' });
  const parentId = await native(root, '## Открыто\n\n', null, 'doc');
  const childId = await native(root, '## Work\n\nOriginal.\n', parentId);
  const target = `${shortReference('c', childId)}#Work`;
  const result = await askQuestion(config, childId, 'Which route?', 'second', target);
  expect(result).toMatchObject({ card: shortReference('c', childId), assignee: 'second', target });
  expect(write).toHaveBeenCalledWith(config, 'sandbox', expect.objectContaining({
    action: 'ask-question', cardId: childId, assignee: 'second', target,
  }), 'codex');
  expect((await readProjectCatalog(root)).cards.filter(card => card.title === 'Решение: Which route?')).toHaveLength(0);
});

it('rejects empty text and an agent recipient before writing', async () => {
  const { root, config } = await fixture();
  offline();
  const write = vi.spyOn(cliWrite, 'writeCatalog').mockResolvedValue({ warnings: [], via: 'files' });
  const snapshot = await files(root);
  await expect(askQuestion(config, taskId, '   ')).rejects.toThrow('1 to 900');
  await expect(askQuestion(config, taskId, 'Question?', 'codex')).rejects.toThrow('human');
  expect(write).not.toHaveBeenCalled();
  expect(await files(root)).toEqual(snapshot);
});

it('extracts only the latest real report, limits it to ten lines, and retains complete source ranges', async () => {
  const { root } = await fixture();
  const cardId = await native(root, 'Original.\r\n```md\r\n#### Report 2026-11-01 · fake\r\n```\r\n\r\n'
    + '#### Report 2026-11-02 · codex\r\nOld report.\r\n\r\n'
    + '#### Report 2026-11-05 · codex\r\n' + Array.from({ length: 30 }, (_, index) => `Result line ${index + 1}`).join('\r\n'));
  const result = await brief(root, cardId);
  expect(result.tokens).toBeLessThanOrEqual(1500);
  expect(result.tokens).toBe(estimateTokens(result.markdown));
  expect(result.truncated).toBe(true);
  expect(result.markdown).toContain('#### Report 2026-11-01 · fake');
  expect(result.markdown).not.toContain('Old report.');
  const report = result.markdown.split('## Report\n')[1].split('\n\n## ')[0];
  expect(report).toContain('Result line 9');
  expect(report).not.toContain('Result line 10');
  expect(report).toContain('…');
  expect(result.readNext.some(reference => reference.path === `cards/${cardId.slice(5)}.md` && reference.title === 'All reports')).toBe(true);
});

it('includes reports on legacy Docs without pulling the complete document into the packet', async () => {
  const { root } = await fixture();
  await appendFile(path.join(root, 'features/example.md'), '\r\n## Notes\r\n#### Report 2026-11-05 · codex\r\nDoc result.\r\n');
  const result = await brief(root, docId);
  expect(result.markdown).toContain('## Report\n');
  expect(result.markdown).toContain('Doc result.');
  expect(result.markdown).toContain('(a document: read the full ranges');
});

it.each(['Open questions', 'Открыто'])('keeps reports outside %s selections and source ranges', async title => {
  const { root, config } = await fixture();
  offline();
  const cardId = await native(root, `Stable colour build.\n\n## ${title}\n\n- Which stable colour build?\n`);
  const catalog = await readProjectCatalog(root);
  const content = await readCardContent(root, cardId);
  await writeCatalog(config, 'sandbox', { action: 'add-card-report', cardId, sourceHash: content.sourceHash,
    manifestHash: catalog.manifestHash, markdown: '- Stable colour build verified.\n', state: 'review' }, 'codex');
  const result = await brief(root, cardId, 5000);
  expect(result.markdown).toContain('Stable colour build verified.');
  expect(result.markdown).not.toMatch(new RegExp(`${title} · [^\\n]*Stable colour build verified`, 'u'));
  const bytes = await readFile(path.join(root, `cards/${cardId.slice(5)}.md`), 'utf8');
  const reportLine = bytes.slice(0, bytes.indexOf('#### Report ')).split(/\r?\n/u).length;
  const references = result.readNext.filter(reference => reference.title === title);
  expect(references).not.toHaveLength(0);
  expect(references.every(reference => reference.to < reportLine)).toBe(true);
  expect(result.markdown.split('## Agent questions\n')[1].split('\n\n## ')[0]).not.toContain('verified.');
});

it('shows open questions and only decisions waiting to be applied on the same card', async () => {
  const { root } = await fixture();
  const cardId = await native(root, 'Stable colour build.\n\n## Open questions\n\n- Which stable colour build?\n\n## Decided\n\n- Existing rule.\n');
  const catalog = await readProjectCatalog(root);
  const card = catalog.cards.find(candidate => candidate.id === cardId)!;
  card.openQuestions = [{ text: 'Which stable colour build?', taskRef: null, assignee: 'reviewer', target: null }];
  card.decisions = [
    { index: 3, question: 'Old question?', answer: 'Already applied.', by: 'reviewer', date: '2026-11-11', target: null, applied: '2026-11-12' },
    { index: 4, question: 'Which stable colour build?', answer: 'Blue.', by: 'reviewer', date: '2026-11-12', target: null, applied: null },
  ];
  const result = await buildBrief(catalog, root, card);
  const ref = shortReference('c', cardId);
  expect(result.markdown).toContain(`Ask ${ref}#1 · @reviewer · target ${ref} · Which stable colour build?`);
  expect(result.markdown).toContain('Apply #4 · Which stable colour build? → Blue. — reviewer');
  expect(result.markdown).not.toContain('Already applied.');
  expect(result.markdown).toContain('## Agent questions\n');
});

it('reads a Journey instruction with its version and detects stale step files', async () => {
  const { root } = await fixture();
  const journeyId = randomUUID();
  const directory = `tasks/journeys/${journeyId}`;
  await createManagedMarkdown(root, `${directory}/steps/check.md`, { id: 'check', title: 'Check', deckId: 'work', owner: null, dependsOn: [] },
    'Read the source.\nVerify the result.\n');
  await createManagedMarkdown(root, `${directory}/index.md`, { deckmate: 'journey', schema: 1, id: journeyId,
    title: 'Journey', version: 2, deckId: 'work', steps: ['steps/check.md'] }, 'Journey.\n');
  const cardId = await native(root, 'Card.\n');
  const catalog = await readProjectCatalog(root);
  const card = catalog.cards.find(candidate => candidate.id === cardId)!;
  card.journey = { journeyId, version: 1, stepId: 'check', instanceId: randomUUID() };
  const result = await buildBrief(catalog, root, card);
  expect(result.markdown).toContain('## Journey step\n');
  expect(result.markdown).toContain('Read the source.\nVerify the result.');
  expect(result.markdown).toContain('Template v2; card from v1.');
  expect(result.readNext.some(reference => reference.path === `${directory}/steps/check.md`)).toBe(true);
  await appendFile(path.join(root, `${directory}/steps/check.md`), 'Changed.\n');
  await expect(buildBrief(catalog, root, card)).rejects.toThrow('Journey step has changed');
});

it.runIf(Boolean(process.env.K2_SANDBOX && process.env.K2_BASELINE))('keeps all three measured briefs under 1500 and the empty-v2 packet byte-identical', async () => {
  const root = process.env.K2_SANDBOX!;
  const baseline = JSON.parse(await readFile(process.env.K2_BASELINE!, 'utf8'));
  const catalog = await readProjectCatalog(root);
  const before = await files(root);
  for (const ref of ['c-tdurz5vi89', 'c-7bycq1r84u', 'c-j5xauk77vb']) {
    const result = await buildBrief(catalog, root, resolveReference(catalog.cards, 'c', ref)!, { budget: 1500 });
    expect(result.tokens).toBeLessThanOrEqual(1500);
    if (ref === 'c-j5xauk77vb') expect(JSON.stringify(result)).toBe(JSON.stringify(baseline[ref]));
  }
  expect(await files(root)).toEqual(before);
});
