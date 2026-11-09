import { afterEach, expect, it, vi } from 'vitest';
import { freePort } from './free-port.ts';
import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildBrief, estimateTokens } from '../server/agent-brief.ts';
import { emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { readCardContent } from '../server/card-content.ts';
import { createManagedMarkdown } from '../server/native-cards.ts';
import { createApp } from '../server/app.ts';
import { writeCatalog } from '../server/cli-write.ts';
import type { ServerConfig } from '../server/config.ts';
import { getCatalogHands } from '../src/catalog-hand.ts';
import { parseOpenQuestions } from '../src/open-questions.ts';
import { resolveReference, shortReference } from '../src/references.ts';
import { run as ask } from '../tools/commands/ask.ts';

const roots: string[] = [];
const apps: Array<{ app: FastifyInstance; closed: Promise<void>; port: number }> = [];
const port = 4396;
const headers = { host: `127.0.0.1:${port}` };
const taskId = 'task:features/example.md#1.1';
const docId = 'doc:features/example.md';
vi.setConfig({ testTimeout: 30000 });

afterEach(async () => {
  vi.restoreAllMocks();
  for (const { app, closed, port: appPort } of apps.splice(0)) {
    // The server answers only requests addressed to its own host and port.
    const appHeaders = { host: `127.0.0.1:${appPort}` };
    const snapshot = (await app.inject({ url: '/api/snapshot', headers: appHeaders })).json();
    expect((await app.inject({ method: 'POST', url: '/api/shutdown',
      headers: { ...appHeaders, 'x-deckmate-token': snapshot.token } })).statusCode).toBe(200);
    await closed;
  }
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

async function askQuestion(config: ServerConfig, cardId: string, text: string, to?: string) {
  const catalog = await readProjectCatalog(config.dataRoot);
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await ask({ config, root: config.dataRoot, source: 'sandbox', catalog }, [shortReference('c', cardId), text],
      new Map([['member', 'codex'], ...(to ? [['to', to] as [string, string]] : [])]));
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
  return buildBrief(catalog, root, catalog.cards.find(card => card.id === cardId)!, { budget });
}

it('asks a legacy rule, adds exactly one decision to the first human hand, and repeats with zero writes', async () => {
  const { root, config } = await fixture();
  const fetch = offline();
  const filename = path.join(root, 'features/example.md');
  const before = await readFile(filename, 'utf8');
  const result = await askQuestion(config, taskId, 'Choose colour?');
  const catalog = await readProjectCatalog(root);
  const decisions = catalog.cards.filter(card => card.title === 'Решение: Choose colour?');
  expect(decisions).toHaveLength(1);
  expect(decisions[0]).toMatchObject({ kind: 'task', parentId: docId, owner: 'Reviewer' });
  expect(getCatalogHands(catalog).find(hand => hand.member.id === 'reviewer')?.cards.map(card => card.id)).toContain(decisions[0].id);
  const after = await readFile(filename, 'utf8');
  const withoutBom = after.slice(1);
  const questions = parseOpenQuestions(withoutBom).questions!;
  expect(questions).toHaveLength(1);
  expect(questions[0].taskRef).toBe(shortReference('c', decisions[0].id));
  expect(result.link).toContain(questions[0].taskRef);
  expect('\uFEFF' + withoutBom.replace(withoutBom.slice(questions[0].start, questions[0].end) + '\r\n', '')
    .replace('## Открыто\r\n\r\n\r\n', '## Открыто\r\n\r\n')).toBe(before);
  const snapshot = await files(root);
  fetch.mockClear();
  expect(await askQuestion(config, taskId, 'Choose colour?')).toMatchObject({ existing: true, writes: 0, link: result.link });
  expect(fetch).not.toHaveBeenCalled();
  expect(await files(root)).toEqual(snapshot);
});

it('uses a native Doc parent and explicit human recipient, finishing manual-order stages', async () => {
  const { root, config } = await fixture(true);
  offline();
  const parentId = await native(root, '## Открыто\n\n', null, 'doc');
  const childId = await native(root, 'Original.\n', parentId);
  const result = await askQuestion(config, childId, 'Which route?', 'second');
  const catalog = await readProjectCatalog(root);
  const decision = catalog.cards.find(card => card.title === 'Решение: Which route?')!;
  expect(decision).toMatchObject({ parentId, owner: 'Second' });
  expect(getCatalogHands(catalog).find(hand => hand.member.id === 'second')?.cards.map(card => card.id)).toContain(decision.id);
  expect(result.link).toContain(shortReference('c', decision.id));
  expect(catalog.deckOrder?.work.flatOrder).toContain(decision.id);
  const snapshot = await files(root);
  await askQuestion(config, childId, 'Which route?', 'second');
  expect(await files(root)).toEqual(snapshot);
});

it('keeps a native question without a rule on that card and preserves literal Markdown punctuation', async () => {
  const { root, config } = await fixture();
  offline();
  const cardId = await native(root, 'Body.\r\n');
  for (const text of ['- [ ] status', 'Use &lt;tag&gt;?', '1) *bold* [link](/r/c-1234567890)']) {
    // 2026-11-06: nobody receives a Decision task here, so the command says so instead of implying one.
    expect((await askQuestion(config, cardId, text)).warnings.join(' ')).toContain('no Decision task was created');
    const snapshot = await files(root);
    expect(await askQuestion(config, cardId, text)).toMatchObject({ writes: 0 });
    expect(await files(root)).toEqual(snapshot);
  }
  const content = await readCardContent(root, cardId);
  expect(parseOpenQuestions(content.markdown).questions?.map(question => question.text)).toEqual([
    '- [ ] status', 'Use &lt;tag&gt;?', '1) *bold* [link](/r/c-1234567890)',
  ]);
  expect((await readProjectCatalog(root)).cards.filter(card => card.title.startsWith('Решение:'))).toHaveLength(0);
});

it('writes English open-question and decision markers without renaming an existing English section', async () => {
  const { root, config } = await fixture();
  offline();
  const manifestPath = path.join(root, 'tasks/deckmate.md');
  await writeFile(manifestPath, (await readFile(manifestPath, 'utf8')).replace('schema: 1\n', 'schema: 1\nformatLanguage: en\n'));
  const cardId = await native(root, 'Body.\n');
  await askQuestion(config, cardId, 'Plain question?');
  const content = await readCardContent(root, cardId);
  expect(content.markdown).toContain('## Open questions\n');
  expect(content.markdown).not.toContain('## Открыто');

  const docId = await native(root, '## Open questions\n\n', null, 'doc');
  await askQuestion(config, docId, 'Choose a route?');
  const catalog = await readProjectCatalog(root);
  expect(catalog.cards.some(card => card.title === 'Decision: Choose a route?')).toBe(true);
  const task = catalog.cards.find(card => card.title === 'Decision: Choose a route?')!;
  const body = (await readCardContent(root, task.id)).markdown;
  expect(body).toContain('A question from the rule [Isolated](/r/');
  expect(body).toContain('section “Open questions”:');
  expect(body).toContain('The human\'s answer is recorded by the record-decision command in the rule\'s “Decided” section.');
  const saved = await readFile(path.join(root, `cards/${docId.slice(5)}.md`), 'utf8');
  expect(saved.match(/^## Open questions$/gmu)).toHaveLength(1);
});

it('uses CRLF for an empty native body and rejects unsafe body rewrites before writing', async () => {
  const { root, config } = await fixture();
  offline();
  const cardId = await native(root, '');
  const filename = path.join(root, `cards/${cardId.slice(5)}.md`);
  await writeFile(filename, (await readFile(filename, 'utf8')).replace(/\r?\n/gu, '\r\n'));
  await askQuestion(config, cardId, 'Empty body?');
  expect((await readCardContent(root, cardId)).markdown).toContain('\r\n- Empty body\\?\r\n');
  await appendFile(filename, 'Mixed\n');
  const snapshot = await files(root);
  await expect(askQuestion(config, cardId, 'Another?')).rejects.toThrow('bytes outside the question');
  expect(await files(root)).toEqual(snapshot);
});

it('rejects invalid text, an agent recipient, and stale source hashes without writes', async () => {
  const { root, config } = await fixture();
  offline();
  const snapshot = await files(root);
  await expect(askQuestion(config, taskId, 'Trailing -')).rejects.toThrow('trailing dash');
  await expect(askQuestion(config, taskId, 'Question?', 'codex')).rejects.toThrow('human');
  expect(await files(root)).toEqual(snapshot);
  const catalog = await readProjectCatalog(root);
  await appendFile(path.join(root, 'features/example.md'), '\r\nExternal.\r\n');
  const changed = await files(root);
  await expect(ask({ config, root, source: 'sandbox', catalog }, [taskId, 'Question?'], new Map([['member', 'codex']]))).rejects.toMatchObject({ status: 409 });
  expect(await files(root)).toEqual(changed);
});

it('uses the live transport and stops its server through /api/shutdown', async () => {
  const { root, config: fixed } = await fixture();
  const config = { ...fixed, port: await freePort() };
  const app = await createApp(config);
  const closed = new Promise<void>(resolve => app.addHook('onClose', async () => { resolve(); }));
  apps.push({ app, closed, port: config.port });
  await app.listen({ host: '127.0.0.1', port: config.port });
  const fetch = vi.spyOn(globalThis, 'fetch');
  const result = await askQuestion(config, taskId, 'Server question?');
  expect(result.link).toMatch(/\/r\/c-/u);
  const posts = fetch.mock.calls.filter(([, options]) => options?.method === 'POST');
  expect(posts).toHaveLength(2);
  expect(posts.every(([, options]) => new Headers(options?.headers).get('x-deckmate-actor') === 'codex')).toBe(true);
  expect((await readProjectCatalog(root)).cards.filter(card => card.title === 'Решение: Server question?')).toHaveLength(1);
}, 30000);

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

it('shows open questions and recorded answers after resolution without inventing a pairing', async () => {
  const { root, config } = await fixture();
  offline();
  await askQuestion(config, taskId, 'Which colour?');
  expect((await brief(root, taskId)).markdown).toContain('## Agent questions\n');
  const catalog = await readProjectCatalog(root);
  const content = await readCardContent(root, docId);
  await writeCatalog(config, 'sandbox', { action: 'record-decision', cardId: docId, sourceHash: content.sourceHash,
    manifestHash: catalog.manifestHash, questionIndex: 0, questionText: 'Which colour?', answer: 'Blue.', memberId: 'reviewer' }, 'reviewer');
  const result = await brief(root, taskId);
  expect(result.markdown).toContain('Решение: Which colour?');
  expect(result.markdown).toContain('Blue. — Reviewer');
  expect(result.markdown).toContain('answers are not linked to individual questions');
  expect(parseOpenQuestions((await readCardContent(root, docId)).markdown).questions).toHaveLength(0);
});

it('shows answers recorded under an English “Decided” heading', async () => {
  // 2026-11-09: the brief matched only «Решено», so every answer in an English project vanished from it.
  const { root, config } = await fixture();
  offline();
  const manifestPath = path.join(root, 'tasks/deckmate.md');
  await writeFile(manifestPath, (await readFile(manifestPath, 'utf8')).replace('schema: 1\n', 'schema: 1\nformatLanguage: en\n'));
  const rulePath = path.join(root, 'features/example.md');
  await writeFile(rulePath, (await readFile(rulePath, 'utf8')).replace('## Решено', '## Decided').replace('## Открыто', '## Open questions'));
  await askQuestion(config, taskId, 'Which colour?');
  const catalog = await readProjectCatalog(root);
  const content = await readCardContent(root, docId);
  await writeCatalog(config, 'sandbox', { action: 'record-decision', cardId: docId, sourceHash: content.sourceHash,
    manifestHash: catalog.manifestHash, questionIndex: 0, questionText: 'Which colour?', answer: 'Blue.', memberId: 'reviewer' }, 'reviewer');
  const result = await brief(root, taskId);
  expect(result.markdown).toContain('Blue. — Reviewer');
  expect(result.markdown).toContain('answers are not linked to individual questions');
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
    const result = await buildBrief(catalog, root, resolveReference(catalog.cards, 'c', ref)!);
    expect(result.tokens).toBeLessThanOrEqual(1500);
    if (ref === 'c-j5xauk77vb') expect(JSON.stringify(result)).toBe(JSON.stringify(baseline[ref]));
  }
  expect(await files(root)).toEqual(before);
});
