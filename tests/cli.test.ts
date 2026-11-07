import { afterEach, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stringify } from 'yaml';
import { shortReference } from '../src/references.ts';
import { appendActivity } from '../server/activity.ts';

const execute = promisify(execFile);
const workspace = fileURLToPath(new URL('../', import.meta.url));
const cliFile = path.join(workspace, 'tools/project.ts');
const fixtures: string[] = [];
const taskId = 'task:features/audio.md#1.0';
const journeyId = '17f3d4ae-f317-4a25-9e4f-e09f191cc767';
const boardId = '5958279e-6e05-41cc-9557-9977fe475148';
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

interface Probe { opened: string[]; closed: number; ftsRows: number }
interface Fixture { base: string; root: string; preload: string }
const preload = `
import sqlite from 'node:sqlite';
import { registerHooks } from 'node:module';
import { writeFileSync } from 'node:fs';
const stats = { opened: [], closed: 0, ftsRows: 0 };
const Original = sqlite.DatabaseSync;
const ObservedDatabase = class extends Original {
  constructor(filename, options) {
    stats.opened.push(String(filename));
    if (filename !== ':memory:') throw new Error('CLI tried to open persistent SQLite');
    super(filename, options);
  }
  prepare(sql) {
    const statement = super.prepare(sql);
    if (/INSERT INTO cards_fts\\b/iu.test(sql)) {
      const run = statement.run.bind(statement);
      Object.defineProperty(statement, 'run', { value: (...parameters) => {
        stats.ftsRows += 1;
        return run(...parameters);
      } });
    }
    return statement;
  }
  close() { stats.closed += 1; return super.close(); }
};
// node:sqlite named exports are not updated by syncBuiltinESMExports in Node 26.
// Redirect future imports to an observable subclass that still executes real SQLite.
const probeKey = Symbol.for('deckmate.cli.sqlite-probe');
globalThis[probeKey] = { ...sqlite, DatabaseSync: ObservedDatabase };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'node:sqlite') return { url: 'deckmate:sqlite-probe', shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url !== 'deckmate:sqlite-probe') return nextLoad(url, context);
    return { format: 'module', shortCircuit: true,
      source: "const sqlite = globalThis[Symbol.for('deckmate.cli.sqlite-probe')]; export default sqlite; " +
        Object.keys(sqlite).map(key => 'export const ' + key + ' = sqlite.' + key + ';').join(' '),
    };
  },
});
process.on('exit', () => writeFileSync(process.env.DECKMATE_CLI_PROBE, JSON.stringify(stats)));
`;

async function fixture(): Promise<Fixture> {
  const base = await mkdtemp(path.join(tmpdir(), 'deckmate-cli-'));
  fixtures.push(base);
  const root = path.join(base, 'project');
  await mkdir(root);
  for (const directory of ['features', 'docs', 'tasks', 'boards']) await mkdir(path.join(root, directory));
  await writeFile(path.join(root, 'features/audio.md'), '# Звук\n\n## 1 — Персонаж\n### 1.0 Шаги (в работе)\n**Кто:** GLM\nЛесные шаги и события.\n### 1.1 Окружение (план)\nВетер.\n');
  await writeFile(path.join(root, 'docs/guide.md'), '# Правила\nПрочитать перед работой.\n');
  const manifest = {
    schema: 1, members: [{ id: 'glm', label: 'GLM', kind: 'agent', aliases: [] }],
    spaces: [{ id: 'production', title: 'Production' }],
    decks: [
      { id: 'audio', spaceId: 'production', title: 'Audio', kind: 'task', icon: 'audio', color: '#123456', description: '' },
      { id: 'assets', spaceId: 'production', title: 'Assets', kind: 'asset', icon: 'box', color: '#654321', description: '' },
    ],
    tracks: [{ id: 'sound', title: 'Звук', description: '' }],
    membership: [{ card: taskId, deck: 'audio', tracks: ['sound'] }, { card: 'hero:features/audio.md#1', deck: 'assets' }],
  };
  await writeFile(path.join(root, 'tasks/deckmate.md'), '---\n' + stringify(manifest) + '---\nKeep this text.\n');
  const journeyDirectory = path.join(root, 'tasks/journeys', journeyId);
  await mkdir(path.join(journeyDirectory, 'steps'), { recursive: true });
  await writeFile(path.join(journeyDirectory, 'index.md'), '---\n' + stringify({
    deckmate: 'journey', schema: 1, id: journeyId, title: 'Audio pipeline', version: 1, deckId: 'assets', steps: ['steps/step-01.md'],
  }) + '---\nOverview.\n');
  await writeFile(path.join(journeyDirectory, 'steps/step-01.md'), '---\n' + stringify({
    id: 'step-01', title: 'Footstep %PARENT_TITLE%', deckId: 'audio', owner: 'GLM', dependsOn: [],
  }) + '---\n## Input\nRead contracts.\n## Check\nListen to the result.\n');
  await writeFile(path.join(root, 'boards', boardId + '.excalidraw'), JSON.stringify({
    type: 'excalidraw', version: 2, name: 'Sound diagram',
    elements: [{ id: 'linked', type: 'rectangle', customData: { deckmateCardId: taskId } }],
    appState: {}, files: {}, externalFiles: {},
  }));
  const filename = path.join(base, 'observe-sqlite.mjs');
  await writeFile(filename, preload);
  return { base, root, preload: filename };
}

async function run(fixture: Fixture, args: string[]): Promise<{ value: any; probe: Probe }> {
  const probeFile = path.join(fixture.base, 'probe-' + randomUUID() + '.json');
  const result = await execute(process.execPath, ['--import', pathToFileURL(fixture.preload).href, cliFile, ...args], {
    cwd: workspace, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, DECKMATE_DATA: fixture.root, DECKMATE_WRITE: '', DECKMATE_PROJECT_NAME: 'CLI fixture',
      DECKMATE_CLI_PROBE: probeFile, NODE_OPTIONS: '' },
  });
  return { value: JSON.parse(result.stdout), probe: JSON.parse(await readFile(probeFile, 'utf8')) as Probe };
}

async function files(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else result[path.relative(root, filename)] = sha256(await readFile(filename));
    }
  }
  await visit(root);
  return result;
}

afterEach(async () => {
  for (const base of fixtures.splice(0)) {
    if (path.dirname(base) !== path.resolve(tmpdir()) || !path.basename(base).startsWith('deckmate-cli-')) throw new Error('Unsafe CLI fixture cleanup');
    await rm(base, { recursive: true, force: true });
  }
});

it('reads map/show/summary/pipeline commands without opening SQLite or tokenizing FTS', async () => {
  const fixtureValue = await fixture();
  const before = await files(fixtureValue.root);
  const requests = [
    ['map'], ['show', shortReference('c', taskId)], ['summary', '--track', 'sound'],
    ['pipelines'], ['pipeline', shortReference('p', journeyId)], ['step', shortReference('p', journeyId), 'step-01'],
  ];
  const results = [];
  for (const argumentsList of requests) {
    const result = await run(fixtureValue, argumentsList);
    expect(result.probe).toEqual({ opened: [], closed: 0, ftsRows: 0 });
    results.push(result.value);
  }
  const [map, shown, summary, pipelines, pipeline, step] = results;
  expect(map).toMatchObject({ documents: 4, tasks: 2, indexedAt: '', warnings: [] });
  expect(map.boards).toHaveLength(1);
  expect(shown).toMatchObject({ id: taskId, state: 'started', owner: 'GLM', deckId: 'audio', trackIds: ['sound'],
    context: { document: { path: 'features/audio.md' }, parent: { id: 'hero:features/audio.md#1' },
      deck: { id: 'audio' }, space: { id: 'production' }, tracks: [{ id: 'sound' }] } });
  const bytes = await readFile(path.join(fixtureValue.root, shown.path));
  expect(shown.sourceHash).toBe(sha256(bytes));
  expect(bytes.subarray(shown.range.start, shown.range.end).toString('utf8')).toBe(shown.markdown);
  expect(summary).toMatchObject({ indexedAt: '', counts: { total: 1, kind: { task: 1 } }, groups: { doing: { total: 1 } } });
  expect(pipelines[0].steps[0].path).toBe('tasks/journeys/' + journeyId + '/steps/step-01.md');
  expect(pipeline.steps[0]).not.toHaveProperty('markdown');
  expect(step).toMatchObject({ id: 'step-01', version: 1, owner: 'GLM', deckId: 'audio', dependsOn: [] });
  expect(step.markdown).toContain('Listen to the result.');
  expect(await files(fixtureValue.root)).toEqual(before);
}, 20000);

it('reads boards independently of a malformed card catalog and without SQLite', async () => {
  const fixtureValue = await fixture();
  await writeFile(path.join(fixtureValue.root, 'tasks/deckmate.md'), '---\nschema: [\n---\n');
  const before = await files(fixtureValue.root);
  const listed = await run(fixtureValue, ['boards']);
  const shown = await run(fixtureValue, ['board', shortReference('v', boardId)]);
  expect(listed.probe).toEqual({ opened: [], closed: 0, ftsRows: 0 });
  expect(shown.probe).toEqual({ opened: [], closed: 0, ftsRows: 0 });
  expect(listed.value).toEqual([expect.objectContaining({ id: boardId, linkedCardIds: [taskId] })]);
  expect(shown.value).toMatchObject({ id: boardId, scene: { files: {} }, linkedCardIds: [taskId] });
  expect(await files(fixtureValue.root)).toEqual(before);
}, 10000);

it('retains actual FTS search, track filtering and explicit rebuild in memory only', async () => {
  const fixtureValue = await fixture();
  const before = await files(fixtureValue.root);
  for (const argumentsList of [
    ['find', '--text', 'шаги', '--kind', 'task', '--owner', 'glm'],
    ['track', 'sound'], ['rebuild'],
  ]) {
    const result = await run(fixtureValue, argumentsList);
    expect(result.probe).toEqual({ opened: [':memory:'], closed: 1, ftsRows: 5 });
    if (argumentsList[0] === 'rebuild') {
      expect(result.value).toMatchObject({ rebuilt: true, storage: 'memory', cards: 5 });
      expect(result.value.indexedAt).toMatch(/^\d{4}-\d\d-\d\dT/u);
    } else expect(result.value.map((card: { id: string }) => card.id)).toEqual([taskId]);
  }
  expect(await files(fixtureValue.root)).toEqual(before);
}, 15000);

it('reads fresh file hashes and ranges on the next non-indexed invocation', async () => {
  const fixtureValue = await fixture();
  const first = await run(fixtureValue, ['show', taskId, '--source', 'live']);
  const filename = path.join(fixtureValue.root, 'features/audio.md');
  const changed = (await readFile(filename, 'utf8')).replace('Лесные шаги', 'Свежие шаги 👣');
  await writeFile(filename, changed);
  const second = await run(fixtureValue, ['show', taskId, '--source', 'live']);
  expect(first.probe.opened).toEqual([]);
  expect(second.probe.opened).toEqual([]);
  expect(second.value.sourceHash).not.toBe(first.value.sourceHash);
  const bytes = Buffer.from(changed);
  expect(second.value.sourceHash).toBe(sha256(bytes));
  expect(second.value.markdown).toContain('Свежие шаги 👣');
  expect(bytes.subarray(second.value.range.start, second.value.range.end).toString('utf8')).toBe(second.value.markdown);
  expect(second.value.link).toContain('?source=live');
}, 10000);

it('builds agent briefs as Markdown or JSON without an index or primary writes', async () => {
  const fixtureValue = await fixture();
  const before = await files(fixtureValue.root);
  const brief = await run(fixtureValue, ['brief', shortReference('c', taskId), '--json']);
  expect(brief.probe).toEqual({ opened: [], closed: 0, ftsRows: 0 });
  expect(brief.value.tokens).toBeGreaterThan(0);
  expect(brief.value.tokens).toBeLessThanOrEqual(1500);
  expect(typeof brief.value.truncated).toBe('boolean');
  expect(brief.value.markdown).toContain('Лесные шаги и события.');
  expect(brief.value.readNext).toEqual(expect.any(Array));
  const markdown = await execute(process.execPath, [cliFile, 'brief', shortReference('c', taskId)], {
    cwd: workspace, windowsHide: true, env: { ...process.env, DECKMATE_DATA: fixtureValue.root, DECKMATE_WRITE: '', NODE_OPTIONS: '' },
  });
  expect(markdown.stdout).toBe(brief.value.markdown);
  const hero = await run(fixtureValue, ['brief', shortReference('c', 'hero:features/audio.md#1'), '--json']);
  expect(hero.value.markdown).toContain('Окружение');
  await expect(run(fixtureValue, ['brief', taskId, '--budget', '0', '--json'])).rejects.toThrow();
  expect(await files(fixtureValue.root)).toEqual(before);
}, 20000);

it('adds bounded find hits and token counts only with the explicit brief fields option', async () => {
  const fixtureValue = await fixture();
  const before = await files(fixtureValue.root);
  const legacy = await run(fixtureValue, ['find', 'шаги']);
  const enriched = await run(fixtureValue, ['find', 'шаги', '--fields', 'brief']);
  expect(enriched.value.tokens).toBeGreaterThan(0);
  expect(enriched.value.cards.map(({ hits, ...card }: { hits: unknown }) => card)).toEqual(legacy.value);
  for (const card of enriched.value.cards) {
    expect(card).not.toHaveProperty('markdown');
    expect(card.hits.length).toBeGreaterThan(0);
    expect(card.hits.length).toBeLessThanOrEqual(3);
    for (const hit of card.hits) {
      expect(hit.line).toBeGreaterThan(0);
      expect(hit.text.length).toBeLessThanOrEqual(200);
    }
  }
  expect(enriched.value.cards.find((card: { id: string }) => card.id === taskId).hits)
    .toEqual(expect.arrayContaining([expect.objectContaining({ line: 4 })]));
  const shown = await run(fixtureValue, ['show', taskId, '--fields', 'brief']);
  const summary = await run(fixtureValue, ['summary', '--fields', 'brief']);
  expect(shown.value.tokens).toBeGreaterThan(0);
  expect(summary.value.tokens).toBeGreaterThan(0);
  expect(await files(fixtureValue.root)).toEqual(before);
}, 20000);

it('reads inclusive file lines with CRLF and BOM intact and rejects invalid ranges', async () => {
  const fixtureValue = await fixture();
  const filename = path.join(fixtureValue.root, 'features/audio.md');
  const original = await readFile(filename, 'utf8');
  const text = '\uFEFF' + original.replace(/\n/gu, '\r\n');
  await writeFile(filename, text);
  const before = await files(fixtureValue.root);
  const selected = await run(fixtureValue, ['show', taskId, '--lines', '2-7']);
  expect(selected.value).toMatchObject({ path: 'features/audio.md', from: 2, to: 7, sourceHash: sha256(Buffer.from(text)) });
  expect(selected.value.markdown).toBe(text.split('\r\n').slice(1, 7).join('\r\n') + '\r\n');
  expect(selected.value.markdown.match(/\r\n/gu)).toHaveLength(6);
  expect(selected.value.tokens).toBeGreaterThan(0);
  const first = await run(fixtureValue, ['show', taskId, '--lines', '1-1']);
  expect(first.value.markdown).toBe('\uFEFF# Звук\r\n');
  for (const range of ['0-1', '7-2', '1-999']) await expect(run(fixtureValue, ['show', taskId, '--lines', range])).rejects.toThrow();
  expect(await files(fixtureValue.root)).toEqual(before);
}, 20000);

it('reads changes since an ISO timestamp or source hash without recording an agent marker', async () => {
  const fixtureValue = await fixture();
  for (const at of ['2026-10-31T23:59:59.000Z', '2026-11-02T12:00:00.000Z']) {
    await appendActivity(fixtureValue.root, { schema: 1, id: randomUUID(), at, action: 'test', actor: 'Deckmate',
      summary: 'A recorded card change', cards: [{ id: taskId, title: 'Шаги' }], deckIds: ['audio'], details: [] }, 'en');
  }
  const before = await files(fixtureValue.root);
  const currentHash = sha256(await readFile(path.join(fixtureValue.root, 'features/audio.md')));
  const changed = await run(fixtureValue, ['changes', shortReference('c', taskId), '--since', '2026-11-01T00:00:00Z']);
  expect(changed.value).toMatchObject({ cardId: taskId, sourceHash: currentHash, eventScope: 'after-timestamp' });
  expect(changed.value.events.map((event: { at: string }) => event.at)).toEqual(['2026-11-02T12:00:00.000Z']);
  const same = await run(fixtureValue, ['changes', taskId, '--since', currentHash]);
  expect(same.value).toMatchObject({ previousSourceHash: currentHash, changed: false, eventScope: 'all-card-events' });
  expect(same.value.events).toHaveLength(2);
  const different = await run(fixtureValue, ['changes', taskId, '--since', '0'.repeat(64)]);
  expect(different.value.changed).toBe(true);
  await expect(run(fixtureValue, ['changes', taskId, '--since', '2026-02-30T00:00:00Z'])).rejects.toThrow();
  expect(await files(fixtureValue.root)).toEqual(before);
}, 20000);
