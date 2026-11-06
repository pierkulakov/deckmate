import type { CatalogCard, CatalogMember, CatalogView, RunRecord } from '../src/catalog-contracts.ts';
import type { ProjectPulse } from '../src/pulse-contracts.ts';
import { isActiveCatalogCard, localIsoDate } from '../src/catalog-hand.ts';
import { memberIdForOwner } from '../src/members.ts';
import { journalEntries, listJournal } from './activity.ts';
import { localToday } from './catalog.ts';

// Decks home pulse (2026-11-06): counted only from what Deckmate already keeps — the catalog's cards, the Run registry
// attached to the view and the structured transitions of the activity journal. Reading it never writes the project.

const acceptedWindowDays = 14;
const ownerLimit = 6;

/** Project-local calendar days ending today, oldest first, in the server's local time like localToday. */
function recentDays(today: string, count: number): string[] {
  const [year, month, day] = today.split('-').map(Number);
  return Array.from({ length: count }, (_, index) => localIsoDate(new Date(year, month - 1, day - (count - 1 - index))));
}

interface JournalFacts {
  /** Local day of the acceptance that still stands, for cards accepted inside the window. */
  acceptedOn: Map<string, string>;
  /** When each card now in review last entered review (ISO). */
  reviewSince: Map<string, string>;
}

/**
 * Walks the journal newest first, so a card's first transition met is its last one. A card counts as accepted on that
 * day only when that last move went to done and the card is still accepted: work that was reopened does not count, and
 * back-and-forth moves count once, on the final acceptance. Below the window the walk goes on only while a card now in
 * review has not yet found when it entered review.
 */
async function readJournalFacts(root: string, accepted: ReadonlySet<string>, inReview: ReadonlySet<string>, windowStart: string): Promise<JournalFacts> {
  const acceptedOn = new Map<string, string>();
  const reviewSince = new Map<string, string>();
  const settled = new Set<string>();
  const listing = await listJournal(root);
  for await (const event of journalEntries(listing, listing.files)) {
    if (!event) continue;
    const day = localIsoDate(new Date(event.at));
    if (day < windowStart && reviewSince.size === inReview.size) break;
    for (const transition of [...event.transitions ?? []].reverse()) {
      if (!settled.has(transition.cardId)) {
        settled.add(transition.cardId);
        if (transition.to === 'done' && accepted.has(transition.cardId) && day >= windowStart) acceptedOn.set(transition.cardId, day);
      }
      if (transition.to === 'review' && inReview.has(transition.cardId) && !reviewSince.has(transition.cardId)) reviewSince.set(transition.cardId, event.at);
    }
  }
  return { acceptedOn, reviewSince };
}

/** Member IDs of the cards' owners, most frequent first; ties keep catalog order. */
function frequentOwners(cards: readonly CatalogCard[], members: CatalogMember[]): string[] {
  const counts = new Map<string, number>();
  for (const card of cards) {
    const memberId = memberIdForOwner(card.owner, members);
    if (memberId) counts.set(memberId, (counts.get(memberId) ?? 0) + 1);
  }
  return [...counts].sort((first, second) => second[1] - first[1]).slice(0, ownerLimit).map(([memberId]) => memberId);
}

/** The first schedule's unfinished Run whose dates contain today. */
function currentScheduledRun(catalog: CatalogView, today: string): RunRecord | null {
  const schedule = catalog.runConfigurations?.[0];
  if (!schedule) return null;
  return catalog.runs?.find(run => run.configurationId === schedule.id && !run.finishedAt && run.start <= today && today <= run.end) ?? null;
}

export async function readProjectPulse(root: string, catalog: CatalogView): Promise<ProjectPulse> {
  const today = localToday();
  const days = recentDays(today, acceptedWindowDays);
  const tasks = catalog.cards.filter(card => card.kind === 'task' && isActiveCatalogCard(card));
  const started = tasks.filter(card => card.state === 'started');
  const reviewing = tasks.filter(card => card.state === 'review');
  // An archived acceptance still happened; only Trash takes a card out of the count.
  const accepted = new Set(catalog.cards.filter(card => card.kind === 'task' && card.state === 'done' && !card.deleted).map(card => card.id));
  const facts = await readJournalFacts(root, accepted, new Set(reviewing.map(card => card.id)), days[0]);
  const perDay = new Map<string, number>();
  for (const day of facts.acceptedOn.values()) perDay.set(day, (perDay.get(day) ?? 0) + 1);
  const acceptedDays = days.map(day => perDay.get(day) ?? 0);
  let oldestReview: CatalogCard | null = null;
  let oldestSince: string | null = null;
  for (const card of reviewing) {
    const since = facts.reviewSince.get(card.id);
    if (since && (oldestSince === null || Date.parse(since) < Date.parse(oldestSince))) {
      oldestReview = card;
      oldestSince = since;
    }
  }
  const run = currentScheduledRun(catalog, today);
  const runTasks = run ? tasks.filter(card => card.run === run.id) : [];
  return {
    inProgress: { count: started.length, ownerIds: frequentOwners(started, catalog.members ?? []) },
    review: { count: reviewing.length, oldestSince, deckId: oldestReview?.deckId ?? null },
    accepted: { days: acceptedDays, total: acceptedDays.reduce((sum, count) => sum + count, 0) },
    run: run ? { id: run.id, title: run.goal, done: runTasks.filter(card => card.state === 'done').length, total: runTasks.length, end: run.end } : null,
    withoutDeck: catalog.cards.filter(card => isActiveCatalogCard(card) && card.deckId === null).length,
  };
}
