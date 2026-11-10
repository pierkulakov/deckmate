import { afterEach, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CatalogCard, CatalogView } from '../src/catalog-contracts.ts';
import type { DeckActivityEvent } from '../src/activity-contracts.ts';
import type { CommandContext } from '../tools/commands/types.ts';
import { localIsoDate } from '../src/catalog-hand.ts';
import { appendActivity } from '../server/activity.ts';
import { nextAgentCard, readStaleCards } from '../server/agent-queue.ts';
import { summarizeCatalog } from '../server/catalog-summary.ts';
import { readAgentInbox } from '../tools/commands/inbox.ts';

const roots: string[] = [];
const hour = 3600000;
const now = Date.UTC(2026, 10, 5, 12);

afterEach(async () => {
  for (const root of roots.splice(0)) {
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(root));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)
      || !path.basename(root).startsWith('deckmate-agent-queue-')) {
      throw new Error('Unexpected queue fixture cleanup target');
    }
    await rm(root, { recursive: true, force: true });
  }
});

function card(id: string, overrides: Partial<CatalogCard> = {}): CatalogCard {
  return { id: `card:${id}`, title: id, kind: 'task', path: `features/${id}.md`, version: null,
    state: 'not-started', owner: null, markdown: 'Instructions.\n', sourceHash: '0'.repeat(64), range: null,
    deckId: null, trackIds: [], parentId: null, ...overrides };
}

async function fixture(cards: CatalogCard[] = []): Promise<CommandContext> {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-agent-queue-'));
  roots.push(root);
  await mkdir(path.join(root, 'features'));
  await mkdir(path.join(root, 'tasks'));
  const catalog: CatalogView = { rootIdentity: root, formatLanguage: 'ru', configured: true, manifestHash: '', indexedAt: '',
    documents: [], spaces: [], decks: [], tracks: [], warnings: [], cards,
    members: [{ id: 'fable', label: 'Claude', kind: 'agent', aliases: ['Fable'] },
      { id: 'pavel', label: 'Павел', kind: 'human', aliases: ['Paul'] }] };
  return { root, source: 'sandbox', catalog,
    config: { dataRoot: root, writeRoot: root, editMode: 'sandbox', projectName: 'Queue test', port: 4391, python: 'python' } };
}

async function materialize(root: string, target: CatalogCard, modifiedAt: number): Promise<void> {
  const bytes = Buffer.from(`\uFEFF# ${target.title}\r\n${target.markdown}`);
  await writeFile(path.join(root, target.path), bytes);
  await utimes(path.join(root, target.path), new Date(modifiedAt), new Date(modifiedAt));
  target.updatedAt = new Date(modifiedAt).toISOString();
  target.sourceHash = createHash('sha256').update(bytes).digest('hex');
}

async function event(root: string, target: CatalogCard, moment: number, actor = 'fable'): Promise<DeckActivityEvent> {
  const record: DeckActivityEvent = { schema: 1, id: randomUUID(), at: new Date(moment).toISOString(),
    actor: 'Deckmate', actorMemberId: actor, action: 'set-card-state', summary: 'State changed',
    cards: [{ id: target.id, title: target.title }], deckIds: [],
    details: [`${target.title}: State: план → в работе`] };
  await appendActivity(root, record, 'en');
  return record;
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function visit(relative: string): Promise<void> {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const filename = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else files[filename] = (await readFile(path.join(root, filename))).toString('hex');
    }
  }
  await visit('');
  return files;
}

it('selects the first explicit hand slot without active unfinished prerequisites, excluding review and inactive cards', async () => {
  const hand = { handMemberIds: ['fable'] };
  const cards = [card('owner-only', { owner: 'Claude' }), card('later', { ...hand, handOrder: { fable: 9 } }),
    card('missing-dependency', { ...hand, dependsOn: ['card:missing'], handOrder: { fable: 0 } }),
    card('unfinished-dependency', { ...hand, dependsOn: ['card:accepted', 'card:review'], handOrder: { fable: 1 } }),
    card('review', { ...hand, state: 'review', handOrder: { fable: 2 } }),
    card('accepted', { ...hand, state: 'done', handOrder: { fable: 3 } }),
    card('archived', { ...hand, archived: true, handOrder: { fable: 4 } }),
    card('deleted', { ...hand, deleted: true, handOrder: { fable: 5 } }),
    card('ready', { ...hand, dependsOn: ['card:accepted'], handOrder: { fable: 6 } })];
  const context = await fixture(cards);
  const before = JSON.stringify(cards);
  expect((await nextAgentCard(context.catalog, context.root, 'fable')).card?.id).toBe('card:missing-dependency');
  expect(JSON.stringify(cards)).toBe(before);
});

it('resolves member aliases, returns an empty hand, and rejects missing or ambiguous members', async () => {
  const context = await fixture([card('owned-but-not-in-hand', { owner: 'Claude' })]);
  const next = await nextAgentCard(context.catalog, context.root, '  fAbLe  ');
  expect(next).toMatchObject({ member: { id: 'fable' }, card: null });
  for (const requested of ['', 'absent']) await expect(nextAgentCard(context.catalog, context.root, requested)).rejects.toThrow();
  context.catalog.members!.push({ id: 'second', label: 'Other', kind: 'agent', aliases: ['Fable'] });
  await expect(nextAgentCard(context.catalog, context.root, 'FABLE')).rejects.toThrow(/Ambiguous|Неоднозначный/u);
});

it('requires an old doing file, unchanged fresh hash and no recent journal activity without writing checkpoints', async () => {
  const stale = card('stale', { state: 'started', handMemberIds: ['fable'], handOrder: { fable: 0 } });
  const recentEvent = card('recent-event', { state: 'started' });
  const changed = card('changed', { state: 'started' });
  const freshFile = card('fresh-file', { state: 'started' });
  const ready = card('ready', { handMemberIds: ['fable'], handOrder: { fable: 1 } });
  const context = await fixture([stale, recentEvent, changed, freshFile, ready]);
  for (const target of [stale, recentEvent, changed, freshFile]) await materialize(context.root, target, now - 48 * hour);
  await event(context.root, stale, now - 25 * hour);
  await event(context.root, recentEvent, now - hour);
  changed.sourceHash = 'f'.repeat(64);
  await utimes(path.join(context.root, freshFile.path), new Date(now), new Date(now));
  const before = await snapshot(context.root);
  expect(await readStaleCards(context.catalog, context.root, { now })).toEqual(new Set([stale.id]));
  expect((await nextAgentCard(context.catalog, context.root, 'fable', { now })).card?.id).toBe(ready.id);
  expect(await snapshot(context.root)).toEqual(before);
});

it('uses a strict age boundary, custom hours, and excludes unavailable timestamps, archived cards and other kinds', async () => {
  const old = card('old', { state: 'started' });
  const boundary = card('boundary', { state: 'started' });
  const journalBoundary = card('journal-boundary', { state: 'started' });
  const exclusions = [card('missing-time', { state: 'started' }), card('invalid-time', { state: 'started', updatedAt: 'invalid' }),
    card('archived', { state: 'started', archived: true }), card('deleted', { state: 'started', deleted: true }),
    card('planned'), card('hero', { kind: 'hero', state: 'started' })];
  const context = await fixture([old, boundary, journalBoundary, ...exclusions]);
  await materialize(context.root, old, now - 25 * hour);
  await materialize(context.root, boundary, now - 24 * hour);
  await materialize(context.root, journalBoundary, now - 30 * hour);
  for (const target of exclusions.slice(2)) target.updatedAt = new Date(now - 50 * hour).toISOString();
  await event(context.root, journalBoundary, now - 24 * hour);
  expect(await readStaleCards(context.catalog, context.root, { now })).toEqual(new Set([old.id]));
  expect(await readStaleCards(context.catalog, context.root, { now, staleHours: 26 })).toEqual(new Set());
  for (const staleHours of [0, -1, NaN, Infinity]) {
    await expect(readStaleCards(context.catalog, context.root, { now, staleHours })).rejects.toThrow('--stale-hours');
  }
});

it('does not call unreadable journal evidence proof of silence', async () => {
  const target = card('unreadable', { state: 'started' });
  const context = await fixture([target]);
  await materialize(context.root, target, now - 48 * hour);
  const record = await event(context.root, target, now - 30 * hour);
  const filename = `${record.at.replace(/[-:.]/gu, '')}-${record.id}.md`;
  await writeFile(path.join(context.root, 'tasks/deckmate-activity', filename), 'Invalid event.\n');
  await expect(readStaleCards(context.catalog, context.root, { now })).rejects.toThrow(/journal/u);
});

it('adds only the stale summary group and applies existing track, limit and active-card filters', async () => {
  const context = await fixture([card('old', { state: 'started', trackIds: ['audio'] }),
    card('old-second', { state: 'started', trackIds: ['audio'] }), card('outside', { state: 'started' }),
    card('archived', { state: 'started', trackIds: ['audio'], archived: true })]);
  context.catalog.tracks = [{ id: 'audio', title: 'Audio', description: '' }];
  const ordinary = summarizeCatalog(context.catalog, 'audio', 1);
  const enriched = summarizeCatalog(context.catalog, 'audio', 1, new Set(context.catalog.cards.map(target => target.id)));
  expect(enriched.groups.stale).toMatchObject({ total: 2, truncated: true, cards: [{ id: 'card:old' }] });
  const { stale: ignoredOrdinary, ...ordinaryGroups } = ordinary.groups;
  const { stale: ignoredEnriched, ...enrichedGroups } = enriched.groups;
  expect(ignoredOrdinary).toEqual({ total: 0, truncated: false, cards: [] });
  expect(ignoredEnriched.total).toBe(2);
  expect({ ...enriched, groups: enrichedGroups }).toEqual({ ...ordinary, groups: ordinaryGroups });
});

async function notificationFixture() {
  const owned = card('owned', { owner: 'Paul' });
  const watched = card('watched');
  const mention = card('mention', { markdown: 'Please review @Paul.' });
  const deckWatch = card('deck-watch', { deckId: 'audio' });
  const due = card('due', { owner: 'Павел', dueDate: localIsoDate() });
  const self = card('self', { owner: 'Павел' });
  const context = await fixture([owned, watched, mention, deckWatch, due, self]);
  context.catalog.decks = [{ id: 'audio', title: 'Audio', kind: 'task', spaceId: 'work', color: '', icon: '', description: '', watcherIds: ['pavel'] }];
  await writeFile(path.join(context.root, 'tasks/deckmate-notifications.md'),
    `---\nschema: 1\nmembers:\n  pavel:\n    watching: ["${watched.id}"]\n---\n# Notifications\n`);
  const moment = Math.floor(Date.now() / 1000) * 1000 - 10000;
  for (const target of [owned, watched, mention, deckWatch]) await event(context.root, target, moment);
  await event(context.root, self, moment, 'pavel');
  return { context, owned, watched, mention, deckWatch, due, moment };
}

it('reads owner, explicit watch, deck watch, mentions and due stacks without changing notification state', async () => {
  const { context, owned, watched, mention, deckWatch, due } = await notificationFixture();
  const before = await snapshot(context.root);
  const inbox = await readAgentInbox(context, 'Paul');
  expect(inbox.member).toBe('pavel');
  expect(inbox.total).toBe(5);
  expect(inbox.stacks[0].cards.map(target => target.cardId)).toEqual([owned.id]);
  expect(inbox.stacks[1].cards.map(target => target.cardId).sort()).toEqual([watched.id, mention.id, deckWatch.id].sort());
  expect(inbox.stacks[2].cards.map(target => target.cardId)).toEqual([due.id]);
  expect(inbox.warnings).toEqual([]);
  expect(await snapshot(context.root)).toEqual(before);
});

it('filters strictly after a timezone-qualified instant while retaining due cards', async () => {
  const { context, owned, due, moment } = await notificationFixture();
  const newer = await event(context.root, owned, moment + 1000);
  const offsetSince = new Date(moment + 3 * hour).toISOString().replace('Z', '+03:00');
  const inbox = await readAgentInbox(context, 'pavel', { since: offsetSince });
  expect(inbox.total).toBe(2);
  expect(inbox.stacks[0].cards[0].changes.map(change => change.eventId)).toEqual([newer.id]);
  expect(inbox.stacks[0].cards[0].latestAt).toBe(newer.at);
  expect(inbox.stacks[1].cards).toEqual([]);
  expect(inbox.stacks[2].cards[0].cardId).toBe(due.id);
});

it('limits cards globally across stacks including a zero-card count-only query', async () => {
  const { context } = await notificationFixture();
  for (const limit of [0, 1, 3, 10]) {
    const inbox = await readAgentInbox(context, 'pavel', { limit });
    expect(inbox.total).toBe(5);
    expect(inbox.stacks.reduce((total, stack) => total + stack.cards.length, 0)).toBe(Math.min(limit, 5));
    for (const stack of inbox.stacks) {
      expect(stack.hidden).toBe(stack.total! - stack.cards.length);
      expect(stack.truncated).toBe(stack.hidden! > 0);
    }
  }
});

it('keeps unknown counts honest when since filtering reaches service caps', async () => {
  const cards = Array.from({ length: 21 }, (_, index) => card(`notification-${index}`, { owner: 'Павел' }));
  const context = await fixture(cards);
  const moment = Math.floor(Date.now() / 1000) * 1000 - 60000;
  for (const [index, target] of cards.entries()) await event(context.root, target, moment + index * 1000);
  const since = new Date(moment - 1000).toISOString();
  const inbox = await readAgentInbox(context, 'pavel', { since, limit: 10 });
  expect(inbox.total).toBeNull();
  expect(inbox.stacks[0]).toMatchObject({ total: null, hidden: null, truncated: true });
  expect(inbox.stacks[0].cards).toHaveLength(10);
  const pastCap = await readAgentInbox(context, 'pavel', { since: new Date(moment + 19000).toISOString() });
  expect(pastCap.total).toBe(1);
  expect(pastCap.stacks[0]).toMatchObject({ total: 1, hidden: 0, truncated: false });
});

it('keeps hidden event counts conservative and clears them when the cutoff crosses the visible history', async () => {
  const target = card('many-changes', { owner: 'Павел' });
  const context = await fixture([target]);
  const moment = Math.floor(Date.now() / 1000) * 1000 - 60000;
  for (let index = 0; index < 6; index += 1) await event(context.root, target, moment + index * 1000);
  const all = await readAgentInbox(context, 'pavel', { since: new Date(moment - 1000).toISOString() });
  expect(all.stacks[0].cards[0].changes).toHaveLength(5);
  expect(all.stacks[0].cards[0].hiddenChanges).toBe(1);
  const recent = await readAgentInbox(context, 'pavel', { since: new Date(moment + 3000).toISOString() });
  expect(recent.stacks[0].cards[0].changes).toHaveLength(2);
  expect(recent.stacks[0].cards[0].hiddenChanges).toBe(0);
});

it('rejects invalid inbox dates, limits and unknown members without falling back to the first human', async () => {
  const context = await fixture();
  for (const since of ['2026-11-05', '2026-11-05T00:00:00', '2026-02-29T00:00:00Z', '2026-11-05T24:00:00Z',
    '2026-11-05T00:00:00+25:00', 'not-a-date']) {
    await expect(readAgentInbox(context, 'pavel', { since })).rejects.toThrow('--since');
  }
  for (const limit of [-1, 1.5, NaN, Infinity, 101]) await expect(readAgentInbox(context, 'pavel', { limit })).rejects.toThrow('--limit');
  await expect(readAgentInbox(context, 'missing')).rejects.toThrow(/not on the team|не найден/u);
});
