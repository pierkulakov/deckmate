import { defineText, serverText } from './i18n.ts';
import type { CatalogCard, CatalogView, JourneyMetrics, JourneyStepMetrics, JourneyStepReturn } from '../src/catalog-contracts.ts';
import type { ActivityStateTransition } from '../src/activity-contracts.ts';
import { readWholeActivity } from './activity.ts';

const messages = defineText({
  unreadableEntries: (count: number) => `Unread journal entries: ${count}; metrics may be incomplete.`,
}, {
  unreadableEntries: (count: number) => `Не прочитано записей журнала: ${count}; метрики могут быть неполными.`,
});


// 2026-11-04: locate stalled Journey steps by reading their cards and structured journal transitions.
// Cards are linked through card.journey.stepId. Entries before 2026-11-04 lack transitions
// and are excluded; do not infer transitions from human-readable details.

const millisecondsPerHour = 3_600_000;

interface TimedTransition extends ActivityStateTransition { at: string; actor: string | null }

function median(values: number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Hours from the first in-progress transition to final acceptance; null if either event is missing. */
function cycleHours(card: CatalogCard, history: TimedTransition[]): number | null {
  if (card.state !== 'done') return null;
  const start = history.find(transition => transition.to === 'started');
  const end = history.findLast(transition => transition.to === 'done');
  if (!start || !end || end.at <= start.at) return null;
  return (Date.parse(end.at) - Date.parse(start.at)) / millisecondsPerHour;
}

function stepMetrics(stepId: string, cards: CatalogCard[], histories: Map<string, TimedTransition[]>): JourneyStepMetrics {
  const owners = new Set<string>();
  const actors = new Set<string>();
  const cycles: number[] = [];
  const reasons: JourneyStepReturn[] = [];
  let returns = 0;
  for (const card of cards) {
    if (card.owner) owners.add(card.owner);
    const history = histories.get(card.id) ?? [];
    for (const transition of history) {
      if (transition.actor) actors.add(transition.actor);
      if (transition.from !== 'review' || transition.to === 'done') continue;
      returns += 1;
      if (transition.reason) reasons.push({ at: transition.at, cardId: card.id, reason: transition.reason, actor: transition.actor });
    }
    const hours = cycleHours(card, history);
    if (hours !== null) cycles.push(hours);
  }
  return {
    stepId, instances: cards.length, accepted: cards.filter(card => card.state === 'done').length, returns,
    cycleHours: cycles.length ? { median: median(cycles), average: cycles.reduce((sum, hours) => sum + hours, 0) / cycles.length, samples: cycles.length } : null,
    owners: [...owners], actors: [...actors],
    lastReturns: reasons.sort((first, second) => (first.at < second.at ? 1 : first.at > second.at ? -1 : 0)).slice(0, 3),
  };
}

/** Include steps with cards in Journey order, followed by steps removed from the Journey. */
export async function readJourneyMetrics(root: string, catalog: CatalogView, journeyId: string): Promise<JourneyMetrics | null> {
  const journey = catalog.journeys?.find(candidate => candidate.id === journeyId);
  if (!journey) return null;
  const cards = catalog.cards.filter(card => card.journey?.journeyId === journeyId && !card.deleted);
  const byStep = new Map<string, CatalogCard[]>();
  for (const card of cards) {
    const stepCards = byStep.get(card.journey!.stepId);
    if (stepCards) stepCards.push(card); else byStep.set(card.journey!.stepId, [card]);
  }
  const warnings: string[] = [];
  const histories = new Map<string, TimedTransition[]>();
  if (cards.length) {
    const cardIds = new Set(cards.map(card => card.id));
    const labels = new Map((catalog.members ?? []).map(member => [member.id, member.label]));
    const { events, unreadable } = await readWholeActivity(root);
    if (unreadable) warnings.push(serverText(messages).unreadableEntries(unreadable));
    for (const event of events) {
      const actor = event.actorMemberId ? labels.get(event.actorMemberId) ?? event.actorMemberId : null;
      for (const transition of event.transitions ?? []) {
        if (!cardIds.has(transition.cardId)) continue;
        const timed = { ...transition, at: event.at, actor };
        const history = histories.get(transition.cardId);
        if (history) history.push(timed); else histories.set(transition.cardId, [timed]);
      }
    }
  }
  const order = [...journey.steps.map(step => step.id), ...[...byStep.keys()].filter(stepId => !journey.steps.some(step => step.id === stepId))];
  const steps = order.filter(stepId => byStep.has(stepId)).map(stepId => stepMetrics(stepId, byStep.get(stepId)!, histories));
  return { journeyId, steps, warnings };
}
