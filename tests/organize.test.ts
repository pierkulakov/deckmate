import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { callAgentTool, openAgentProject, type AgentProject } from '../server/agent-ops.ts';
import { emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { createManagedMarkdown } from '../server/native-cards.ts';
import { initializeDemo } from '../server/demo.ts';
import { projectCli } from '../tools/project.ts';
import { tempProjects } from './helpers/temp-projects.ts';

const temps = tempProjects('deckmate-organize-');
const originalEnvironment = { ...process.env };
let root: string;
let project: AgentProject;

async function addCard(id: string, title: string, kind: 'task' | 'hero' | 'doc', deckId: string,
  parentId: string | null = null, markdown = 'Acceptance is observable.\n'): Promise<void> {
  await createManagedMarkdown(root, `cards/${id}.md`, {
    deckmate: 'card', schema: 1, id, title, kind, deckId, parentId, trackIds: [],
    state: kind === 'task' ? 'not-started' : null, owner: null, effort: null, priority: null,
  }, markdown);
}

async function snapshot(directory: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function visit(relative: string): Promise<void> {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(child);
      else files[child] = (await readFile(path.join(directory, child))).toString('hex');
    }
  }
  await visit('');
  return files;
}

beforeEach(async () => {
  root = await temps.create();
  await mkdir(path.join(root, 'tasks'));
  const manifest = emptyManifest();
  manifest.formatLanguage = 'en';
  manifest.spaces.push({ id: 'game', title: 'Game', kind: 'custom' });
  manifest.decks.push(
    { id: 'units', spaceId: 'game', title: 'Units', kind: 'asset', description: '', icon: 'box', color: '#123456' },
    { id: 'units-copy', spaceId: 'game', title: 'Units', kind: 'asset', description: '', icon: 'box', color: '#123456' },
    { id: 'animation', spaceId: 'game', title: 'Animation', kind: 'task', description: '', icon: 'box', color: '#123456' },
    { id: 'tools', spaceId: 'game', title: 'Tools', kind: 'asset', description: '', icon: 'box', color: '#123456' },
    { id: 'mechanics', spaceId: 'game', title: 'Mechanics', kind: 'knowledge', description: '', icon: 'box', color: '#123456' },
  );
  for (const title of ['Engineering', 'Art', 'Sound & music', 'Production', 'QA', 'Design']) {
    manifest.decks.push({ id: title.toLowerCase().replace(/[^a-z]+/gu, '-'), spaceId: 'game', title, kind: 'task', description: '', icon: 'box', color: '#123456' });
  }
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  await addCard('11111111-1111-4111-8111-111111111111', 'Goblin', 'hero', 'units', null, 'A small enemy.\n\n## Rules\nMoves only at night.\n');
  await addCard('22222222-2222-4222-8222-222222222222', 'Tree', 'hero', 'units');
  await addCard('33333333-3333-4333-8333-333333333333', 'Animate Goblin', 'task', 'units', 'card:11111111-1111-4111-8111-111111111111');
  await addCard('44444444-4444-4444-8444-444444444444', 'Animate Goblin walk', 'task', 'animation', 'card:11111111-1111-4111-8111-111111111111');
  await addCard('55555555-5555-4555-8555-555555555555', 'Fence', 'hero', 'tools');
  await addCard('66666666-6666-4666-8666-666666666666', 'Goblin rules', 'doc', 'mechanics',
    'card:11111111-1111-4111-8111-111111111111', 'Moves only at night.\n');
  project = await openAgentProject({ cwd: root, data: root, readOnly: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.env = { ...originalEnvironment };
  await temps.removeAll();
});

it('audits layout heuristics with source pointers and never changes project bytes', async () => {
  const before = await snapshot(root);
  const manifestHash = (await readProjectCatalog(root)).manifestHash;
  const result = await callAgentTool(project, 'organize', {});
  expect(result.mode).toBe('audit');
  if (result.mode !== 'audit') throw new Error('Expected an audit.');
  const rows = result.table;
  expect(rows.find(row => row.card === 'Deck: Units')?.reason).toMatch(/duplicate/iu);
  expect(rows.find(row => row.card === 'Tree')?.reason).toMatch(/props|entity-area/iu);
  expect(rows.find(row => row.card === 'Fence')?.reason).toMatch(/tool|content/iu);
  expect(rows.find(row => row.card === 'Goblin')?.reason).toMatch(/rule Doc/iu);
  expect(rows.find(row => row.card === 'Animate Goblin')?.reason).toMatch(/discipline/iu);
  expect(rows.find(row => row.card === 'Animate Goblin')?.hero).toContain('Goblin');
  expect(rows.some(row => row.card === 'Animate Goblin walk')).toBe(false);
  for (const row of rows) expect(row.at).toMatch(/^(?:cards|tasks)\/.+\.md:\d+-\d+$/u);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(6000);
  expect(await snapshot(root)).toEqual(before);
  expect((await readProjectCatalog(root)).manifestHash).toBe(manifestHash);
});

it('caps a long audit and discloses omitted findings', async () => {
  for (let index = 0; index < 45; index += 1) {
    const id = `77777777-7777-4777-8777-${String(index).padStart(12, '0')}`;
    await addCard(id, `Goblin ${index}`, 'hero', 'units', null, `## Rules\nRule ${index}.\n`);
  }
  const result = await callAgentTool(project, 'organize', {});
  expect(result.mode).toBe('audit');
  if (result.mode !== 'audit') throw new Error('Expected an audit.');
  expect(result.table.length).toBeLessThan(40);
  expect(result.warnings?.join(' ')).toContain('Response truncated');
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(6000);
});

it('audits entity areas independently of art and finds unparented work outside discipline decks', async () => {
  await addCard('77777777-7777-4777-8777-777777777777', '3D model of a tree', 'hero', 'units');
  await addCard('88888888-8888-4888-8888-888888888888', 'Проверить дерево', 'task', 'units');
  const result = await callAgentTool(project, 'organize', {});
  if (result.mode !== 'audit') throw new Error('Expected an audit.');
  expect(result.table.find(row => row.card === '3D model of a tree')?.reason).toMatch(/props/iu);
  expect(result.table.find(row => row.card === 'Проверить дерево')).toMatchObject({ hero: '—', reason: expect.stringMatching(/discipline/iu) });
});

it.each(['Already works', 'Уже работает'])('allows a Hero progress section (%s) but still flags separate rules', async heading => {
  await addCard('77777777-7777-4777-8777-777777777777', 'Т-34', 'hero', 'units', null,
    `## ${heading}\n### Как работает\nThe mechanic is implemented.\n`);
  await addCard('88888888-8888-4888-8888-888888888888', 'Рекруты', 'hero', 'units', null,
    `## ${heading}\n### Rules\nImplemented.\n## Rules\nFull behavior specification.\n`);
  const result = await callAgentTool(project, 'organize', {});
  if (result.mode !== 'audit') throw new Error('Expected an audit.');
  expect(result.table.some(row => row.card === 'Т-34')).toBe(false);
  expect(result.table.find(row => row.card === 'Рекруты')?.reason).toMatch(/rule Doc/iu);
});

it.each([
  ['Анимировать', 'Animation'], ['Реализовать', 'Engineering'], ['Смоделировать', 'Art'],
  ['Озвучить', 'Sound & music'], ['Подключить', 'Production'], ['Проверить', 'QA'],
  ['Нарисовать', 'Art'], ['Спроектировать', 'Design'], ['Интегрировать', 'Production'],
])('places Russian work verbs in discipline decks: %s', async (verb, deck) => {
  const result = await callAgentTool(project, 'organize', { about: `${verb} Goblin` });
  expect(result).toMatchObject({ mode: 'placement', card: 'subcard', deck, hero: 'Goblin' });
});

it.each([
  'механика стрельбы и два образца оружия',
  'механика стрельбы, два образца оружия',
  '1. механика стрельбы; 2. два образца оружия',
  '1) механика стрельбы\n2) два образца оружия',
  '- механика стрельбы\n- два образца оружия',
])('returns separate placements without a generic Hero match: %s', async about => {
  await addCard('77777777-7777-4777-8777-777777777777', 'Механика передвижения', 'hero', 'mechanics');
  await addCard('88888888-8888-4888-8888-888888888888', 'Два дерева', 'hero', 'units');
  const before = await snapshot(root);
  const result = await callAgentTool(project, 'organize', { about });
  expect(result).toMatchObject({ mode: 'placements', placements: [
    { about: 'механика стрельбы', card: 'hero', deck: 'Mechanics', heroRef: null },
    { about: 'два образца оружия', card: 'hero', deck: 'Weapons', heroRef: null },
  ] });
  expect(await snapshot(root)).toEqual(before);
});

it('matches the topic rather than generic words and handles Russian inflection', async () => {
  await addCard('77777777-7777-4777-8777-777777777777', 'Стрельба', 'hero', 'mechanics');
  await addCard('88888888-8888-4888-8888-888888888888', 'Система передвижения', 'hero', 'mechanics');
  await addCard('99999999-9999-4999-8999-999999999999', '3D model of a tree', 'hero', 'units');
  const result = await callAgentTool(project, 'organize', { about: 'Правила механики стрельбы' });
  expect(result).toMatchObject({ mode: 'placement', card: 'doc', hero: 'Стрельба', heroRef: expect.any(String) });
  const system = await callAgentTool(project, 'organize', { about: 'Система стрельбы' });
  expect(system).toMatchObject({ mode: 'placement', hero: 'Стрельба', heroRef: expect.any(String) });
  const model = await callAgentTool(project, 'organize', { about: '3D model of a gun' });
  expect(model).toMatchObject({ mode: 'placement', heroRef: null });
  const unrelated = await callAgentTool(project, 'organize', { about: 'механика прыжка' });
  expect(unrelated).toMatchObject({ mode: 'placement', heroRef: null });
});

it('recommends an existing entity deck, Hero and discipline deck for new work', async () => {
  const before = await snapshot(root);
  const work = await callAgentTool(project, 'organize', { about: 'Animate Goblin' });
  expect(work).toMatchObject({ mode: 'placement', card: 'subcard', deck: 'Animation', deckId: 'animation',
    hero: 'Goblin', ruleDoc: 'reuse' });
  if (work.mode !== 'placement') throw new Error('Expected a placement.');
  expect(work.heroRef).toMatch(/^c-/u);
  expect(work.readNext.some(pointer => pointer.startsWith('cards/11111111-1111-4111-8111-111111111111.md:'))).toBe(true);

  const entity = await callAgentTool(project, 'organize', { about: 'Stone wall' });
  expect(entity).toMatchObject({ mode: 'placement', card: 'hero', heroRef: null, ruleDoc: 'create' });
  if (entity.mode !== 'placement') throw new Error('Expected an entity placement.');
  expect(entity.deck.length).toBeGreaterThan(0);
  expect(entity.reason).toMatch(/same name/iu);
  const tool = await callAgentTool(project, 'organize', { about: 'Fence placement tool' });
  expect(tool).toMatchObject({ mode: 'placement', card: 'hero', deck: 'Tools', deckId: 'tools' });
  const rule = await callAgentTool(project, 'organize', { about: 'Rules for Goblin' });
  expect(rule).toMatchObject({ mode: 'placement', card: 'doc', deck: 'Mechanics', hero: 'Goblin', ruleDoc: 'reuse' });
  await expect(callAgentTool(project, 'organize', { about: '  ' })).rejects.toThrow(/about/u);
  await expect(callAgentTool(project, 'organize', { unexpected: true })).rejects.toThrow(/Unknown field/u);
  expect(await snapshot(root)).toEqual(before);
});

it('places new work with the existing Hero and discipline deck on the demo project', async () => {
  const demoRoot = path.join(root, 'demo');
  await initializeDemo(demoRoot);
  const demo = await openAgentProject({ cwd: demoRoot, data: demoRoot, readOnly: true });
  const audit = await callAgentTool(demo, 'organize', {});
  if (audit.mode !== 'audit') throw new Error('Expected a demo audit.');
  expect(audit.table).toHaveLength(8);
  expect(audit.table.every(row => row.deck === 'World & props' && row.hero === '—' && /discipline/u.test(row.reason))).toBe(true);
  const result = await callAgentTool(demo, 'organize', { about: 'Animate Moonwake Lantern' });
  expect(result).toMatchObject({ mode: 'placement', card: 'subcard', deck: 'Production', deckId: 'production',
    hero: 'Moonwake Lantern', ruleDoc: 'none' });
  if (result.mode !== 'placement') throw new Error('Expected a demo placement.');
  const deckPointer = result.readNext.find(pointer => pointer.startsWith('tasks/deckmate.md:'))!;
  const deckLine = Number(/:(\d+)-\d+$/u.exec(deckPointer)![1]);
  expect((await readFile(path.join(demoRoot, 'tasks/deckmate.md'), 'utf8')).split(/\r?\n/u)[deckLine - 1]).toContain('id: production');
  const ownRule = await callAgentTool(demo, 'organize', { about: 'Rules for Moonwake Lantern' });
  expect(ownRule).toMatchObject({ mode: 'placement', card: 'doc', deck: 'Field notes', hero: 'Moonwake Lantern', ruleDoc: 'create' });
  console.log(`Demo organize example: ${JSON.stringify(result)}`);
});

it('exposes the same read-only operation as deckmate project organize', async () => {
  const before = await snapshot(root);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await projectCli(['organize', '--about', 'Animate Goblin', '--data', root, '--read-only']);
    expect(log).toHaveBeenCalledTimes(1);
    const output = JSON.parse(log.mock.calls[0][0]) as { mode: string; deck: string };
    expect(output).toMatchObject({ mode: 'placement', deck: 'Animation' });
  } finally { log.mockRestore(); }
  expect(await snapshot(root)).toEqual(before);
});
