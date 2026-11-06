import type { CatalogMember } from './catalog-contracts.ts';
import type { DataSource } from './workspace-contracts.ts';

/**
 * Notification stacks group changes by their relationship to the member.
 * "owned" — changes to cards the member owns, derived from the activity journal; dismissed by opening the card
 * or by holding the stack's dismiss button. "watching" — major steps only (created, workflow state, archive,
 * delete, restore, deck move) of the cards the member watches: all cards in a watched deck,
 * an explicit per-member watch list or a live @-mention in the card text. "due" — cards due today; never dismissed by hand,
 * it empties itself when the card is accepted, archived, or its due date or owner changes. Conversations and
 * Time Tracking stacks are out of scope (2026-11-04).
 */
export type NotificationStackId = 'owned' | 'watching' | 'due';

export interface NotificationMember extends Pick<CatalogMember, 'id' | 'label' | 'kind'> {}

/** One journal record as it concerns one card: who acted, when, and the changed fields as journal lines. */
export interface NotificationChange {
  eventId: string;
  at: string;
  actor: string;
  lines: string[];
}

export interface NotificationCard {
  cardId: string;
  title: string;
  deckTitle: string | null;
  /** Newest change in the card group; null for due cards, which are not journal-driven. */
  latestAt: string | null;
  dueDate?: string;
  state?: string | null;
  changes: NotificationChange[];
  /** Older changes of this card that are not listed. */
  hiddenChanges: number;
}

export interface NotificationStack {
  id: NotificationStackId;
  title: string;
  dismissible: boolean;
  /** Cards in the stack; only the newest are listed, the rest counted in hidden. */
  total: number;
  hidden: number;
  latestAt: string | null;
  cards: NotificationCard[];
}

export interface NotificationsView {
  source: DataSource;
  /** "Me": the requested member, else the first human of the registry, else the first member. */
  member: NotificationMember | null;
  members: NotificationMember[];
  today: string;
  /** Dismissing and watching write the project file; only the sandbox copy is writable. */
  writable: boolean;
  /** Explicit subscriptions only; deck eyes and mentions are independent sources. */
  watching: string[];
  /** Hash of this member's explicit list; null means the state could not be read safely. */
  watchHash: string | null;
  total: number;
  stacks: NotificationStack[];
  warnings: string[];
}

/** Dismiss everything of one card (it was opened) or of one stack (hold-dismiss) up to the moment the client saw. */
export interface NotificationDismissRequest {
  source: DataSource;
  memberId: string;
  cardId?: string;
  stack?: Exclude<NotificationStackId, 'due'>;
  at: string;
}

export interface NotificationWatchRequest {
  source: DataSource;
  memberId: string;
  cardId: string;
  watching: boolean;
  watchHash: string;
}
