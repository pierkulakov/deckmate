import { afterEach, expect, it, vi } from 'vitest';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initializeDemo } from '../server/demo.ts';
import { readProjectCatalog } from '../server/catalog.ts';
import { readJourneys } from '../server/journeys.ts';
import { attachPlanningRegistries } from '../server/runs.ts';
import { Boards } from '../server/boards.ts';
import { getCatalogHands } from '../src/catalog-hand.ts';
import { readProjectPulse } from '../server/project-pulse.ts';

const roots: string[] = [];
async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-demo-test-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) {
    const relative = path.relative(tmpdir(), root);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(root).startsWith('deckmate-demo-test-')) throw new Error('Unexpected demo test cleanup target.');
    await rm(root, { recursive: true, force: true });
  }
});

it('creates a complete indie studio with illustrated decks, two Journey families and current planning data', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2031, 4, 9, 12));
  const base = await fixture();
  const root = path.join(base, 'new', 'demo');
  await initializeDemo(root);
  const catalog = await readProjectCatalog(root);
  await attachPlanningRegistries(catalog, root);
  expect(catalog.warnings).toEqual([]);
  const pulse = await readProjectPulse(root, catalog);
  expect(pulse.run).toMatchObject({ id: 'first-playable', done: 3, total: 24 });
  expect(pulse.accepted.total).toBe(3);
  expect(pulse.accepted.days.at(-1)).toBe(3);
  expect(pulse.review).toMatchObject({ count: 6, oldestSince: new Date().toISOString() });
  expect(catalog.decks.map(deck => deck.kind)).toEqual(['mixed', 'task', 'task', 'task', 'knowledge']);
  expect(catalog.members?.map(member => member.kind)).toEqual(['human', 'human', 'agent', 'agent']);
  expect(catalog.cards).toHaveLength(30);
  expect(catalog.cards.filter(card => card.kind === 'doc')).toHaveLength(4);
  expect(catalog.cards.filter(card => card.deckId === 'world')).toHaveLength(10);
  for (const deck of catalog.decks) {
    expect(deck.style).toBe('artwork');
    const bytes = await readFile(path.join(root, deck.cover!));
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(bytes.toString('ascii', 8, 12)).toBe('WEBP');
  }
  const heroes = catalog.cards.filter(card => card.kind === 'hero');
  expect(heroes).toHaveLength(2);
  for (const hero of heroes) {
    const children = catalog.cards.filter(card => card.parentId === hero.id);
    expect(children).toHaveLength(5);
    expect(children.every(card => card.deckId === 'production' && card.journey)).toBe(true);
    const byStep = new Map(children.map(card => [card.journey!.stepId, card]));
    expect(byStep.get('design')?.state).toBe('done');
    expect(byStep.get('build')?.state).toBe('started');
    expect(byStep.get('review')?.state).toBe('review');
    expect(byStep.get('polish')).toMatchObject({ state: 'not-started', dependsOn: [] });
    expect(byStep.get('integrate')).toMatchObject({ state: 'not-started', dependsOn: [byStep.get('build')!.id] });
    expect(byStep.get('build')?.dependsOn).toEqual([byStep.get('design')!.id]);
    expect(byStep.get('review')?.dependsOn).toEqual([byStep.get('design')!.id]);
  }
  const journeys = await readJourneys(root);
  expect(journeys.warnings).toEqual([]);
  expect(journeys.journeys).toHaveLength(1);
  expect(journeys.journeys[0].steps).toHaveLength(5);
  expect(catalog.runConfigurations).toEqual([expect.objectContaining({ id: 'studio-run', durationWeeks: 2, startDate: '2031-05-07' })]);
  expect(catalog.runs).toEqual([{ id: 'first-playable', number: 1, configurationId: 'studio-run', start: '2031-05-07', end: '2031-05-20',
    goal: 'First playable', description: 'Make one evening in Moonwake playable from shore to lighthouse.' }]);
  expect(catalog.milestones).toEqual([{ id: 'harbor-playtest', title: 'Harbor playtest', date: '2031-05-21', color: '#e2b66c' }]);
  expect(catalog.pinnedMilestoneId).toBe('harbor-playtest');
  const tasks = catalog.cards.filter(card => card.kind === 'task');
  expect(tasks).toHaveLength(24);
  expect(tasks.every(card => card.owner && card.effort && card.priority && card.tags?.length && card.run && card.milestone
    && card.dueDate! >= '2031-05-10' && card.dueDate! <= '2031-05-18')).toBe(true);
  const hand = getCatalogHands(catalog).find(entry => entry.member.id === 'maya')!;
  expect(hand.cards).toHaveLength(7);
  expect(hand.doneCards).toHaveLength(2);
  expect(hand.doneCards.every(card => card.doneAt === '2031-05-09')).toBe(true);
  const boards = new Boards({ editMode: 'read-only', dataRoot: root, writeRoot: null, port: 4317, projectName: 'Demo', python: 'python' });
  const boardList = await boards.list('live');
  expect(boardList).toHaveLength(1);
  expect(new Set(boardList[0].linkedCardIds)).toEqual(new Set(heroes.map(card => card.id)));
  const board = await boards.read('live', boardList[0].id);
  expect(board.scene.elements.filter(element => element.type === 'embeddable')).toHaveLength(3);
  expect(board.scene.elements.filter(element => element.type === 'text').length).toBeGreaterThanOrEqual(8);
  expect(await readdir(root)).not.toContain('.git');
  const manifest = await readFile(path.join(root, 'tasks/deckmate.md'));
  expect(manifest.toString('utf8')).toContain('formatLanguage: en');
  for (const card of tasks) expect(await readFile(path.join(root, card.path), 'utf8')).toMatch(new RegExp(`^state: ["']?${card.state}["']?$`, 'mu'));
  await expect(initializeDemo(root)).rejects.toThrow('not empty');
  expect(await readFile(path.join(root, 'tasks/deckmate.md'))).toEqual(manifest);
});

it('accepts an empty directory and preserves unrelated files when refusing a nonempty one', async () => {
  const root = await fixture();
  const empty = path.join(root, 'empty');
  await mkdir(empty);
  await initializeDemo(empty);
  const occupied = path.join(root, 'occupied');
  await mkdir(occupied);
  await writeFile(path.join(occupied, '.keep'), 'Keep these bytes.');
  await expect(initializeDemo(occupied)).rejects.toThrow('not empty');
  expect(await readdir(occupied)).toEqual(['.keep']);
  expect(await readFile(path.join(occupied, '.keep'), 'utf8')).toBe('Keep these bytes.');
});

it('rejects symlink destinations and symlink ancestors without writing through them', async () => {
  const root = await fixture();
  const outside = path.join(root, 'outside');
  const link = path.join(root, 'link');
  await mkdir(outside);
  await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  expect((await lstat(link)).isSymbolicLink()).toBe(true);
  await expect(initializeDemo(link)).rejects.toThrow('symbolic links');
  await expect(initializeDemo(path.join(link, 'nested'))).rejects.toThrow('symbolic links');
  expect(await readdir(outside)).toEqual([]);
});
