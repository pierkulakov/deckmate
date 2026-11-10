import type { CatalogCard, CatalogMember } from '../src/catalog-contracts.ts';

export type CardStateTrigger = 'play' | 'space' | 'done' | 'check' | 'review';
export type CardReviewFocus = 'popover' | 'accept';
export interface CardReviewRequest { sequence: number; focus: CardReviewFocus }
export type CardStateAction =
  | { kind: 'none' | 'reopen-required' | 'member-required' }
  | { kind: 'review'; focus: CardReviewFocus }
  | { kind: 'assign'; owner: string }
  | { kind: 'state'; state: 'not-started' | 'started' | 'review' | 'done' };

export interface CardStateActionContext {
  disabled?: boolean;
  member?: Pick<CatalogMember, 'label' | 'aliases'> | null;
  manualHeroDone?: boolean;
}

/** 2026-11-10: resolve review/terminal states before Space's owner assignment, on every card surface. */
export function resolveCardStateAction(card: CatalogCard | undefined, trigger: CardStateTrigger, context: CardStateActionContext = {}): CardStateAction {
  if (!card || context.disabled || card.archived || card.deleted) return { kind: 'none' };
  const task = card.kind === 'task';
  if (trigger === 'review') {
    if (!task) return { kind: 'none' };
    if (card.state === 'review') return { kind: 'review', focus: 'popover' };
    return { kind: 'state', state: 'review' };
  }
  if (task && card.state === 'review') {
    if (trigger === 'play') return { kind: 'none' };
    if (trigger === 'check') return { kind: 'state', state: 'done' };
    return { kind: 'review', focus: trigger === 'done' ? 'accept' : 'popover' };
  }
  if (trigger === 'check' && task) return { kind: 'state', state: card.state === 'done' ? 'not-started' : 'done' };
  if (task && (card.state === 'done' || card.state === 'wont-do')) {
    if (trigger === 'done') return { kind: 'state', state: 'not-started' };
    return { kind: 'reopen-required' };
  }
  if (trigger === 'done' || trigger === 'check') {
    if (!task && !(card.kind === 'hero' && context.manualHeroDone)) return { kind: 'none' };
    return { kind: 'state', state: card.state === 'done' ? 'not-started' : 'done' };
  }
  if (task && card.state === 'started') return { kind: 'state', state: 'not-started' };
  if (trigger === 'space') {
    const member = context.member;
    if (!member) return { kind: 'member-required' };
    if (card.owner !== member.label && !member.aliases.includes(card.owner ?? '')) return { kind: 'assign', owner: member.label };
  }
  if (!task) return { kind: 'none' };
  return { kind: 'state', state: 'started' };
}
