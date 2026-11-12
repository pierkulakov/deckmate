import { pendingDecisions as catalogPendingDecisions, waitingOn as catalogWaitingOn, type CatalogCard, type CatalogDecision, type CatalogOpenQuestion, type CatalogView } from '../src/catalog-contracts.ts';
import { resolvedDecisionsOf } from '../src/open-questions.ts';
import { resolveReference, shortReference } from '../src/references.ts';
import { parseEditorMarkdown } from './editor-checklists.ts';
import { defineText, type Lang } from './i18n.ts';
import type { RootContent } from 'mdast';

export type Question = CatalogOpenQuestion;
export type Decision = CatalogDecision & { nodes?: RootContent[] };

const text = defineText({ applyTo: (target: string) => `Apply to: ${target}`, waiting: (names: string) => `Waiting on ${names}`, waitingAnswer: 'Waiting on an answer' },
  { applyTo: (target: string) => `Внести в: ${target}`, waiting: (names: string) => `Ждёт ответа: ${names}`, waitingAnswer: 'Ждёт ответа' });
const legacyDecisions = new WeakMap<CatalogCard, Decision[]>();

export function questionsOf(card: CatalogCard): Question[] { return card.openQuestions ?? []; }

export function decisionsOf(card: CatalogCard): Decision[] {
  const projected = card.decisions;
  if (projected != null) return projected;
  const cached = legacyDecisions.get(card);
  if (cached) return cached;
  const entries = resolvedDecisionsOf(parseEditorMarkdown(card.markdown)).map((entry, index) => ({
    index, question: entry.question, answer: entry.answer, by: entry.author, date: entry.date, target: null, applied: null, nodes: entry.nodes,
  }));
  legacyDecisions.set(card, entries);
  return entries;
}

export function pendingDecisionsOf(card: CatalogCard): Decision[] {
  const decisions = decisionsOf(card);
  if (!decisions.length) return [];
  const originalDecisions = new Map<CatalogDecision, Decision>();
  // The interface also shows legacy answers without a question or an application date.
  const adaptedDecisions = decisions.map(decision => {
    if (decision.question !== null && decision.applied !== '') return decision;
    const adapted = { ...decision, question: decision.question ?? '', applied: decision.applied || null };
    originalDecisions.set(adapted, decision);
    return adapted;
  });
  return catalogPendingDecisions({ cards: [{ ...card, decisions: adaptedDecisions }] })
    .map(({ decision }) => originalDecisions.get(decision) ?? decision);
}

export function pendingDecisions(catalog: Pick<CatalogView, 'cards'>) {
  return catalog.cards.filter(card => !card.archived && !card.deleted)
    .flatMap(card => pendingDecisionsOf(card).map(decision => ({ card, decision })));
}

export function waitingOn(card: CatalogCard, members: CatalogView['members'], lang: Lang): string {
  const names = catalogWaitingOn(card)?.filter(Boolean);
  if (!names) return '';
  return names.length ? text[lang].waiting(names.map(id => '@' + (members?.find(member => member.id === id)?.label ?? id)).join(', ')) : text[lang].waitingAnswer;
}

export function targetDetails(target: string | null | undefined, card: CatalogCard, catalog: Pick<CatalogView, 'cards'>, lang: Lang) {
  const [rawReference, ...sections] = (target ?? '').split('#');
  const reference = rawReference.replace(/^.*\/r\//u, '').split('?')[0];
  let selected: CatalogCard | null = card;
  if (reference) {
    try { selected = resolveReference(catalog.cards, 'c', reference); }
    catch { selected = null; }
  }
  const section = sections.join('#');
  let readableSection = section;
  try { readableSection = decodeURIComponent(section); } catch { /* Keep an invalid escape visible. */ }
  const title = selected?.title ?? reference;
  const ref = selected ? shortReference('c', selected.id) : /^c-[0-9a-z]{10}$/u.test(reference) ? reference : '';
  const label = title + (readableSection ? ` § ${readableSection}` : '');
  return { card: selected, label, caption: text[lang].applyTo(label), isCurrent: selected?.id === card.id, reference: ref, section };
}
