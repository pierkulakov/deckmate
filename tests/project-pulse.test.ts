import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appendActivity } from '../server/activity.ts';
import { emptyManifest, localToday, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { createManagedMarkdown } from '../server/native-cards.ts';
import { readProjectPulse } from '../server/project-pulse.ts';
import type { ActivityStateTransition } from '../src/activity-contracts.ts';
import type { CardState } from '../src/format-vocabulary.ts';
import type { CatalogCard, CatalogView } from '../src/catalog-contracts.ts';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

/** Noon of a project-local day `daysAgo` before today, as the journal stores it (UTC ISO). */
function localNoon(daysAgo: number, minute = 0): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, 12, minute).toISOString();
}

// 2026-11-06: the pulse counts an acceptance once, on the day of the card's last move into done, and only while it
// stands; review age is the last entry into review, even when it lies before the 14-day window.
it('counts acceptances per local day through back-and-forth moves and finds the oldest review entry', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-pulse-'));
  roots.push(root);
  await mkdir(path.join(root, 'tasks'));
  const manifest = emptyManifest();
  manifest.spaces.push({ id: 'work', title: 'Work' });
  for (const id of ['build', 'qa']) manifest.decks.push({ id, title: id, kind: 'task', spaceId: 'work', description: '', icon: 'box', color: '#234567' });
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  const card = async (state: CardState, deckId: string) => {
    const id = randomUUID();
    await createManagedMarkdown(root, `cards/${id}.md`, { deckmate: 'card', schema: 1, id, kind: 'task', title: `Task ${id.slice(0, 4)}`,
      state, owner: null, deckId, trackIds: [], parentId: null }, 'Body.');
    return `card:${id}`;
  };
  const reaccepted = await card('done', 'build');
  const accepted = await card('done', 'build');
  const reopened = await card('started', 'build');
  const acceptedLongAgo = await card('done', 'build');
  const longReview = await card('review', 'qa');
  const freshReview = await card('review', 'build');
  await card('review', 'build');
  const move = async (at: string, cardId: string, from: CardState, to: CardState) => {
    const transitions: ActivityStateTransition[] = [{ cardId, from, to }];
    await appendActivity(root, { schema: 1, id: randomUUID(), at, action: 'set-card-state', actor: 'Deckmate', summary: 'State changed',
      cards: [{ id: cardId, title: cardId }], deckIds: ['build'], details: [], transitions }, 'en');
  };
  await move(localNoon(25), longReview, 'started', 'review');
  await move(localNoon(22), longReview, 'review', 'started');
  await move(localNoon(20), acceptedLongAgo, 'review', 'done');
  await move(localNoon(18), longReview, 'started', 'review');
  await move(localNoon(5), accepted, 'review', 'done');
  await move(localNoon(3), reaccepted, 'review', 'done');
  await move(localNoon(2), reaccepted, 'done', 'started');
  await move(localNoon(1), reopened, 'review', 'done');
  await move(localNoon(1, 30), reopened, 'done', 'started');
  await move(localNoon(1, 45), freshReview, 'started', 'review');
  await move(localNoon(0), reaccepted, 'review', 'done');

  const pulse = await readProjectPulse(root, await readProjectCatalog(root));
  const expectedDays = Array.from({ length: 14 }, () => 0);
  expectedDays[13] = 1;
  expectedDays[13 - 5] = 1;
  expect(pulse.accepted).toEqual({ days: expectedDays, total: 2 });
  expect(pulse.review).toEqual({ count: 3, oldestSince: localNoon(18), deckId: 'qa' });
  expect(pulse.inProgress).toEqual({ count: 1, ownerIds: [] });
});

it('counts active work, ranks owner aliases and uses only the first schedule while retaining archived acceptances', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-pulse-'));
  roots.push(root);
  const id = randomUUID();
  await createManagedMarkdown(root, `cards/${id}.md`, { deckmate: 'card', schema: 1, id, kind: 'task', title: 'Work',
    state: 'started', owner: null, deckId: null, trackIds: [], parentId: null }, 'Body.');
  const initial = await readProjectCatalog(root);
  const base = initial.cards.find(card => card.kind === 'task')!;
  const task = (id: string, patch: Partial<CatalogCard> = {}): CatalogCard => ({ ...base, id, ...patch });
  const today = localToday();
  const catalog: CatalogView = { ...initial,
    members: Array.from({ length: 8 }, (_, index) => ({ id: `member-${index}`, label: `Member ${index}`, kind: 'human', aliases: [`@m${index}`] })),
    cards: [
      ...Array.from({ length: 8 }, (_, index) => task(`owner-${index}`, { owner: `@m${index}`, run: 'current' })),
      task('frequent', { owner: 'Member 7', run: 'current' }), task('unknown', { owner: 'Outside' }),
      task('accepted', { state: 'done', run: 'current' }), task('archived', { state: 'done', archived: true, run: 'current' }),
      task('deleted', { state: 'done', deleted: true, run: 'current' }), task('hidden-work', { archived: true }),
      task('review', { state: 'review' }), task('document', { kind: 'doc', state: null }),
    ],
    runs: [
      { id: 'other', number: 1, goal: 'Other schedule', start: today, end: today, configurationId: 'second' },
      { id: 'finished', number: 1, goal: 'Finished', start: today, end: today, configurationId: 'first', finishedAt: localNoon(0) },
      { id: 'current', number: 2, goal: 'Current', start: today, end: today, configurationId: 'first' },
    ],
    runConfigurations: ['first', 'second'].map(id => ({ id, shortName: id, color: '#123456', labelTemplate: 'Run {n}', startDate: today,
      durationWeeks: 1, upcomingCount: 1, finishTime: '17:00', timeZone: 'UTC', carryOver: { review: false, blocked: false, other: false } })),
  };
  for (const cardId of ['archived', 'deleted']) await appendActivity(root, { schema: 1, id: randomUUID(), at: localNoon(0), action: 'set-card-state',
    actor: 'Deckmate', summary: 'Accepted', cards: [{ id: cardId, title: cardId }], deckIds: [], details: [], transitions: [{ cardId, from: 'review', to: 'done' }] }, 'en');
  const pulse = await readProjectPulse(root, catalog);
  expect(pulse.inProgress).toEqual({ count: 10, ownerIds: ['member-7', 'member-0', 'member-1', 'member-2', 'member-3', 'member-4'] });
  expect(pulse.review).toEqual({ count: 1, oldestSince: null, deckId: null });
  expect(pulse.accepted.total).toBe(1);
  expect(pulse.accepted.days.at(-1)).toBe(1);
  expect(pulse.run).toEqual({ id: 'current', title: 'Current', done: 1, total: 10, end: today });
  expect(pulse.withoutDeck).toBe(13);
  const empty = await readProjectPulse(root, { ...catalog, cards: [], runConfigurations: [] });
  expect(empty).toEqual({ inProgress: { count: 0, ownerIds: [] }, review: { count: 0, oldestSince: null, deckId: null },
    accepted: { days: Array(14).fill(0), total: 0 }, run: null, withoutDeck: 0 });
});
