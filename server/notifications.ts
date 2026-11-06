import { defineText, serverText } from './i18n.ts';
import { createHash } from 'node:crypto';
import { isAlias, isMap, isScalar, isSeq, parseDocument, visit, type Document } from 'yaml';
import type { DeckActivityEvent } from '../src/activity-contracts.ts';
import type { CatalogCard, CatalogMember, CatalogView } from '../src/catalog-contracts.ts';
import { memberIdForOwner, memberIdPattern } from '../src/members.ts';
import type { NotificationCard, NotificationChange, NotificationDismissRequest, NotificationMember, NotificationsView, NotificationStack, NotificationWatchRequest } from '../src/notification-contracts.ts';
import type { DataSource } from '../src/workspace-contracts.ts';
import type { FormatLanguage } from '../src/format-vocabulary.ts';
import { journalEntries, listJournal } from './activity.ts';
import { localToday } from './catalog.ts';
import { CatalogError, type CatalogService } from './catalog-service.ts';
import { assertWritable, type ServerConfig } from './config.ts';
import { projectLanguage } from './project-language.ts';
import { createManagedMarkdown, readProjectMarkdown, replaceProjectMarkdown } from './native-cards.ts';

const messages = defineText({
  frontMatter: "The notifications file has no YAML front matter.",
  invalidYaml: "Invalid notifications YAML.",
  aliases: "The notifications file does not support YAML aliases.",
  schema: "The notifications file needs schema: 1 and a members map.",
  explicitMap: "Notification state must be an explicit map.",
  invalidValue: "Invalid notification format.",
  missingField: "No notification field specified.",
  archived: "Archived",
  unarchived: "Unarchived",
  deleted: "Deleted",
  restored: "Restored",
  unreadable: "Some journal entries could not be read; their notifications are not shown.",
  readFailed: "could not read",
  memberMissing: "Member not found in the team.",
  cardMissing: "Card not found.",
  watchChanged: "The watch list changed. Reopen the menu and try again.",
  verifyWatch: "Could not verify the watch list.",
  fileChanged: "The notifications file changed while saving. Try again.",
  invalidState: (memberId: string) => `Notification state for “${memberId}” skipped: invalid format.`,
  invalidWatch: (memberId: string) => `The watch list for “${memberId}” must contain card IDs.`,
  allShown: (file: string, error: string) => `${file}: ${error}. All notifications are shown.`,
}, {
  frontMatter: "В файле уведомлений нет YAML-шапки.",
  invalidYaml: "Некорректный YAML файла уведомлений.",
  aliases: "Файл уведомлений не поддерживает YAML aliases.",
  schema: "Файлу уведомлений нужны schema: 1 и members map.",
  explicitMap: "Состояние уведомлений должно быть явным map.",
  invalidValue: "Неверный формат уведомления.",
  missingField: "Не задано поле уведомлений.",
  archived: "Перенесена в архив",
  unarchived: "Возвращена из архива",
  deleted: "Удалена",
  restored: "Восстановлена",
  unreadable: "Некоторые записи журнала не удалось прочитать; уведомления по ним не показаны.",
  readFailed: "не удалось прочитать",
  memberMissing: "Участник не найден в составе команды.",
  cardMissing: "Карточка не найдена.",
  watchChanged: "Список наблюдения изменился. Откройте меню заново и повторите действие.",
  verifyWatch: "Не удалось проверить список наблюдения.",
  fileChanged: "Файл уведомлений изменился во время записи. Повторите действие.",
  invalidState: (memberId: string) => `Состояние уведомлений «${memberId}» пропущено: неверный формат.`,
  invalidWatch: (memberId: string) => `Список наблюдения «${memberId}» должен содержать ID карт.`,
  allShown: (file: string, error: string) => `${file}: ${error}. Показаны все уведомления.`,
});


/**
 * 2026-11-04: derive owned and watched card notifications from the activity journal, and due cards from dueDate.
 * Per-member dismissal state lives in the project file below; explicit watch lists share it (2026-11-05).
 * Also include deck watchers and live mentions of the member when reading notifications.
 */
export const notificationStatePath = 'tasks/deckmate-notifications.md';

const journalWindowDays = 30;
const journalFileLimit = 1000;
const stackCardLimit = 20;
const cardChangeLimit = 5;
const isoMoment = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const frontMatter = /^(?:﻿)?---(\r?\n)([\s\S]*?)^---[ \t]*(?:\r?\n|$)/mu;
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
// 2026-11-06: a new registry gets its header in the project's format language; state keys are identifiers and never
// translate. parseState takes only the YAML, so the header text never affects parsing.
const registryBriefs = {
  en: '# Notifications\n\nPer-member dismiss state of the notification stacks (a seen notification is gone).\n'
    + 'watching: explicit card IDs watched by the member. seenCards: card ID → the newest change seen by opening it.\n'
    + 'dismissedStacks.owned / watching: each stack dismissed up to that moment. Changes live in tasks/deckmate-activity;\n'
    + 'due cards are derived from dueDate and never stored here. Written by Deckmate; agents may read it.\n',
  ru: '# Уведомления\n\nКакие стеки уведомлений убрал каждый участник (просмотренное уведомление исчезает).\n'
    + 'watching: ID карточек, за которыми участник наблюдает явно. seenCards: ID карточки → последнее изменение, увиденное при её открытии.\n'
    + 'dismissedStacks.owned / watching: момент, до которого убран каждый стек. Сами изменения лежат в tasks/deckmate-activity;\n'
    + 'карточки со сроком выводятся из dueDate и здесь не хранятся. Файл пишет Deckmate; агенты могут его читать.\n',
} as const satisfies Record<FormatLanguage, string>;

// Owners receive creation, owner and workflow changes, archive/delete/restore, deck moves, title and content,
// priority, effort, run, milestone and the due date. Tags, Hand, bookmarks, tracks and Hero links are not on that list.
const ownerFields = /^(Создана карточка|Card created|Название|Title|Обновлено описание|Description updated|Статус|State|Колода|Deck|Исполнитель|Owner|Effort|Priority|Тип|Type|Run|Milestone|Срок|Due date|Архив|Archive|Удаление|Deletion)(?::|$)/u;
const ownerChange = /^(?:Исполнитель|Owner): (.*?) → (.*)$/u;
// Watchers receive creation, workflow changes, archive/delete/restore, and deck moves only.
// Content, priority, and effort changes deliberately do not notify watchers.
const watchFields = /^(Создана карточка|Card created|Статус|State|Архив|Archive|Удаление|Deletion|Колода|Deck)(?::|$)/u;
const deckChange = /^(?:Колода|Deck): (.*?) → (.*)$/u;
// System events notify owners when the last blocker is accepted, even after their own actions.
// Run carry-over also moves cards without a member acting.
const systemActions = new Set(['card-unlocked', 'carry-over-runs']);

interface MemberDismissals { seenCards: Map<string, string>; owned: string | null; watching: string | null; watchedCards: Set<string> }
interface StateFile { text: string; yamlStart: number; yamlEnd: number; yaml: string; members: Map<string, MemberDismissals>; warnings: string[] }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** An omitted map is empty; anything other than a map is a format error (null). */
function optionalMap(value: unknown): Record<string, unknown> | null {
  if (value == null) return {};
  return record(value) ? value : null;
}

function emptyDismissals(): MemberDismissals {
  return { seenCards: new Map(), owned: null, watching: null, watchedCards: new Set() };
}

function watchHash(cards: Set<string>): string {
  return digest(Buffer.from(JSON.stringify([...cards].sort())));
}

function parseState(bytes: Buffer): StateFile {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const match = frontMatter.exec(text);
  if (!match || match.index !== 0) throw new Error(serverText(messages).frontMatter);
  const document = parseDocument(match[2]);
  if (document.errors.length || !isMap(document.contents)) throw new Error(serverText(messages).invalidYaml);
  visit(document, (_key, node) => { if (isAlias(node)) throw new Error(serverText(messages).aliases); });
  const metadata: unknown = document.toJS({ maxAliasCount: 0 });
  const registry = record(metadata) ? optionalMap(metadata.members) : null;
  if (!record(metadata) || metadata.schema !== 1 || !registry) throw new Error(serverText(messages).schema);
  const members = new Map<string, MemberDismissals>();
  const warnings: string[] = [];
  for (const [memberId, value] of Object.entries(registry)) {
    const seen = record(value) ? optionalMap(value.seenCards) : null;
    const stacks = record(value) ? optionalMap(value.dismissedStacks) : null;
    if (!memberIdPattern.test(memberId) || !record(value) || !seen || !stacks) { warnings.push(serverText(messages).invalidState(memberId)); continue; }
    const seenCards = new Map(Object.entries(seen).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && isoMoment.test(entry[1])));
    const owned = typeof stacks.owned === 'string' && isoMoment.test(stacks.owned) ? stacks.owned : null;
    const watching = typeof stacks.watching === 'string' && isoMoment.test(stacks.watching) ? stacks.watching : null;
    const list: unknown = value.watching ?? [];
    if (!Array.isArray(list) || list.some(cardId => typeof cardId !== 'string' || !cardId || cardId.length > 1000)) {
      throw new Error(serverText(messages).invalidWatch(memberId));
    }
    members.set(memberId, { seenCards, owned, watching, watchedCards: new Set(list) });
  }
  const yamlStart = text.indexOf('\n') + 1;
  return { text, yamlStart, yamlEnd: yamlStart + match[2].length, yaml: match[2], members, warnings };
}

/** 2026-11-05: patch only the selected YAML value; other members, comments, BOM and body keep their bytes. */
function patchStateValue(state: StateFile, path: string[], value: unknown): Buffer {
  const document = parseDocument(state.yaml);
  const newline = state.text.includes('\r\n') ? '\r\n' : '\n';
  let target: unknown = document.contents;
  let yaml = state.yaml;
  for (const [index, key] of path.entries()) {
    if (!isMap(target) || !target.range) throw new Error(serverText(messages).explicitMap);
    const node = target.get(key, true);
    if (index < path.length - 1 && node !== undefined) { target = node; continue; }
    let replacement = value;
    for (const nested of path.slice(index + 1).reverse()) replacement = { [nested]: replacement };
    if (node === undefined) {
      const position = target.range[0] + (target.flow ? 1 : 0);
      const column = position - (yaml.lastIndexOf('\n', position - 1) + 1);
      const entry = JSON.stringify(key) + ': ' + JSON.stringify(replacement);
      const inserted = target.flow ? entry + (target.items.length ? ', ' : '') : entry + newline + ' '.repeat(column);
      yaml = yaml.slice(0, position) + inserted + yaml.slice(position);
    } else {
      if ((!isScalar(node) && !isSeq(node)) || !node.range) throw new Error(serverText(messages).invalidValue);
      const [start, end] = node.range;
      const ending = yaml.slice(start, end).match(/\r?\n$/u)?.[0] ?? '';
      const prefix = start === end && yaml[start - 1] === ':' ? ' ' : '';
      yaml = yaml.slice(0, start) + prefix + JSON.stringify(replacement) + ending + yaml.slice(end);
    }
    return Buffer.from(state.text.slice(0, state.yamlStart) + yaml + state.text.slice(state.yamlEnd));
  }
  throw new Error(serverText(messages).missingField);
}

async function readStateBytes(root: string): Promise<Buffer | null> {
  try { return await readProjectMarkdown(root, notificationStatePath); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

/**
 * Removes seen marks the journal window no longer reaches. The owned cursor must not prune them anymore (2026-11-05):
 * with a second journal stack («watching») the same mark still suppresses that stack's events, so only the window
 * expires a mark.
 */
function pruneSeen(document: Document, memberId: string, oldestKept: string): void {
  const seen = document.getIn(['members', memberId, 'seenCards'], true);
  if (!isMap(seen)) return;
  for (const item of [...seen.items]) {
    const value = isScalar(item.value) ? item.value.value : null;
    if (typeof value === 'string' && value < oldestKept) seen.delete(item.key);
  }
}

/** Journal lines read «<card title>: <change>»; the longest title wins when one title starts another. */
function changesByCard(event: DeckActivityEvent): Map<string, string[]> {
  const cards = [...event.cards].sort((left, right) => right.title.length - left.title.length);
  const changes = new Map<string, string[]>();
  for (const detail of event.details) {
    const card = cards.find(candidate => detail.startsWith(candidate.title + ': '));
    if (!card) continue;
    changes.set(card.id, [...changes.get(card.id) ?? [], detail.slice(card.title.length + 2)]);
  }
  return changes;
}

function readableChange(change: string): string {
  const flag = /^(Архив|Archive|Удаление|Deletion): .+ → (.+)$/u.exec(change);
  if (flag) {
    const enabled = flag[2] === 'true';
    if (['Архив', 'Archive'].includes(flag[1])) return enabled ? serverText(messages).archived : serverText(messages).unarchived;
    return enabled ? serverText(messages).deleted : serverText(messages).restored;
  }
  // Card Options values are journaled as JSON; a quote or null means nothing to a reader.
  if (/^(Run|Milestone|Срок|Due date): /u.test(change)) return change.replace(/"/gu, '').replace(/\bnull\b/gu, '—');
  return change;
}

function actorLabel(event: DeckActivityEvent, members: CatalogMember[]): string {
  if (systemActions.has(event.action)) return 'Deckmate';
  if (typeof event.actorMemberId !== 'string') return 'API';
  return members.find(member => member.id === event.actorMemberId)?.label ?? event.actorMemberId;
}

function journalStamp(moment: number): string { return new Date(moment).toISOString().replace(/[-:.]/gu, ''); }

function summaryMember(member: CatalogMember): NotificationMember { return { id: member.id, label: member.label, kind: member.kind }; }

/**
 * «Cards you own»: walks the journal from the newest record back, tracking who owned each card at that moment
 * (an owner change hands older records to the previous owner). An owner change reaches both the old and the new owner.
 * One's own changes do not notify, except system records; records without actorMemberId predate 2026-11-04.
 */
function ownedStack(events: DeckActivityEvent[], catalog: CatalogView, member: CatalogMember, dismissals: MemberDismissals): NotificationStack {
  const members = catalog.members ?? [];
  const cardsById = new Map(catalog.cards.map(card => [card.id, card]));
  const ownerAfter = new Map<string, string | null>();
  const groups = new Map<string, NotificationChange[]>();
  for (const event of events) {
    const system = systemActions.has(event.action);
    const notifies = system || ('actorMemberId' in event && event.actorMemberId !== member.id);
    for (const [cardId, changes] of changesByCard(event)) {
      const card = cardsById.get(cardId);
      if (!ownerAfter.has(cardId)) ownerAfter.set(cardId, card?.owner ?? null);
      const recipients = new Set([memberIdForOwner(ownerAfter.get(cardId), members)]);
      const handover = changes.map(change => ownerChange.exec(change)).find(match => match !== null);
      if (handover) {
        recipients.add(memberIdForOwner(handover[1], members));
        recipients.add(memberIdForOwner(handover[2], members));
        ownerAfter.set(cardId, handover[1] === '—' ? null : handover[1]);
      }
      if (!notifies || !card || !recipients.has(member.id)) continue;
      if ((dismissals.owned && event.at <= dismissals.owned) || event.at <= (dismissals.seenCards.get(cardId) ?? '')) continue;
      const lines = system ? changes : changes.filter(change => ownerFields.test(change)).map(readableChange);
      if (!lines.length) continue;
      groups.set(cardId, [...groups.get(cardId) ?? [], { eventId: event.id, at: event.at, actor: actorLabel(event, members), lines }]);
    }
  }
  const decks = new Map(catalog.decks.map(deck => [deck.id, deck.title]));
  const cards: NotificationCard[] = [...groups].map(([cardId, changes]) => {
    const card = cardsById.get(cardId)!;
    return { cardId, title: card.title, deckTitle: decks.get(card.deckId ?? '') ?? null, latestAt: changes[0].at,
      changes: changes.slice(0, cardChangeLimit), hiddenChanges: Math.max(0, changes.length - cardChangeLimit) };
  }).sort((left, right) => (right.latestAt ?? '').localeCompare(left.latestAt ?? ''));
  return { id: 'owned', title: 'Cards you own', dismissible: true, total: cards.length, hidden: Math.max(0, cards.length - stackCardLimit),
    latestAt: cards[0]?.latestAt ?? null, cards: cards.slice(0, stackCardLimit) };
}

/** Mentionable spellings of one member — the same set the editor offers as @-completions (client/editor-mentions.ts). */
function mentionNames(member: CatalogMember): string[] {
  return [...new Set([member.label, member.id, ...member.aliases].map(name => name.trim().toLocaleLowerCase()))].filter(Boolean);
}

/** Live mentions in indexed card content automatically add the mentioned member as a watcher. */
function mentionsMember(markdown: string, names: string[]): boolean {
  const lower = markdown.toLocaleLowerCase();
  for (let cursor = markdown.indexOf('@'); cursor >= 0; cursor = markdown.indexOf('@', cursor + 1)) {
    if (cursor > 0 && /[\p{L}\p{N}_@./\\-]/u.test(markdown[cursor - 1])) continue;
    if (names.some(name => lower.startsWith(name, cursor + 1) && !/[\p{L}\p{N}_-]/u.test(markdown[cursor + name.length + 1] ?? ''))) return true;
  }
  return false;
}

/**
 * 2026-11-05: watching a deck means watching every card in it, so moves notify watchers of both decks
 * and creation notifies watchers of the destination. Explicit lists and live mentions also add watchers.
 * Watchers receive only watchFields changes, excluding their own actions; system events address owners.
 * Opening a card dismisses its watched notifications, as with owned notifications.
 */
function watchingStack(events: DeckActivityEvent[], catalog: CatalogView, member: CatalogMember, dismissals: MemberDismissals): NotificationStack {
  const members = catalog.members ?? [];
  const cardsById = new Map(catalog.cards.map(card => [card.id, card]));
  const decksByTitle = new Map(catalog.decks.map(deck => [deck.title, deck.id]));
  const watchedDeckIds = new Set(catalog.decks.filter(deck => deck.watcherIds?.includes(member.id)).map(deck => deck.id));
  const names = mentionNames(member);
  // Rewind the current deckId through deck-change journal lines to find the deck at each event.
  const deckAfter = new Map<string, string | null>();
  const groups = new Map<string, NotificationChange[]>();
  for (const event of events) {
    const notifies = 'actorMemberId' in event && event.actorMemberId !== member.id;
    for (const [cardId, changes] of changesByCard(event)) {
      const card = cardsById.get(cardId);
      if (!card) continue;
      if (!deckAfter.has(cardId)) deckAfter.set(cardId, card.deckId);
      const move = changes.map(change => deckChange.exec(change)).find(match => match !== null);
      const heardDecks = new Set<string | null>([deckAfter.get(cardId) ?? null]);
      if (move) {
        const origin = ['Без колоды', 'No Deck'].includes(move[1]) ? null : decksByTitle.get(move[1]) ?? null;
        heardDecks.add(origin);
        deckAfter.set(cardId, origin);
      }
      const byDeckEye = [...heardDecks].some(deckId => deckId !== null && watchedDeckIds.has(deckId));
      if (!notifies || (!dismissals.watchedCards.has(cardId) && !byDeckEye && !mentionsMember(card.markdown, names))) continue;
      if ((dismissals.watching && event.at <= dismissals.watching) || event.at <= (dismissals.seenCards.get(cardId) ?? '')) continue;
      const lines = changes.filter(change => watchFields.test(change)).map(readableChange);
      if (!lines.length) continue;
      groups.set(cardId, [...groups.get(cardId) ?? [], { eventId: event.id, at: event.at, actor: actorLabel(event, members), lines }]);
    }
  }
  const decks = new Map(catalog.decks.map(deck => [deck.id, deck.title]));
  const cards: NotificationCard[] = [...groups].map(([cardId, changes]) => {
    const card = cardsById.get(cardId)!;
    return { cardId, title: card.title, deckTitle: decks.get(card.deckId ?? '') ?? null, latestAt: changes[0].at,
      changes: changes.slice(0, cardChangeLimit), hiddenChanges: Math.max(0, changes.length - cardChangeLimit) };
  }).sort((left, right) => (right.latestAt ?? '').localeCompare(left.latestAt ?? ''));
  return { id: 'watching', title: 'Cards you watch', dismissible: true, total: cards.length, hidden: Math.max(0, cards.length - stackCardLimit),
    latestAt: cards[0]?.latestAt ?? null, cards: cards.slice(0, stackCardLimit) };
}

/** «Due Cards»: due today and owned by the member; leaves by itself on acceptance, archive, new date or new owner. */
function dueStack(catalog: CatalogView, member: CatalogMember, today: string): NotificationStack {
  const members = catalog.members ?? [];
  const decks = new Map(catalog.decks.map(deck => [deck.id, deck.title]));
  const due = catalog.cards.filter((card: CatalogCard) => card.dueDate === today && card.state !== 'done'
    && !card.archived && !card.deleted && memberIdForOwner(card.owner, members) === member.id)
    .sort((left, right) => left.title.localeCompare(right.title, 'ru'));
  const cards: NotificationCard[] = due.map(card => ({ cardId: card.id, title: card.title, deckTitle: decks.get(card.deckId ?? '') ?? null,
    latestAt: null, dueDate: card.dueDate ?? undefined, state: card.state, changes: [], hiddenChanges: 0 }));
  return { id: 'due', title: 'Due Cards', dismissible: false, total: cards.length, hidden: Math.max(0, cards.length - stackCardLimit),
    latestAt: null, cards: cards.slice(0, stackCardLimit) };
}

export class NotificationService {
  private config: ServerConfig;
  private catalog: CatalogService;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(config: ServerConfig, catalog: CatalogService) {
    this.config = config;
    this.catalog = catalog;
  }

  /** 2026-11-06: the shared journal scan; entries are parsed once per path and bytes, so edits are never stale. */
  private async recentEvents(root: string, warnings: string[]): Promise<DeckActivityEvent[]> {
    const oldest = journalStamp(Date.now() - journalWindowDays * 86400000);
    const listing = await listJournal(root);
    const recent = listing.files.filter(filename => filename.split('/').at(-1)! >= oldest).slice(0, journalFileLimit);
    const events: DeckActivityEvent[] = [];
    for await (const event of journalEntries(listing, recent)) {
      if (event) events.push(event);
      else if (!warnings.includes(serverText(messages).unreadable)) warnings.push(serverText(messages).unreadable);
    }
    return events;
  }

  async read(source: DataSource, requestedMemberId?: string): Promise<NotificationsView> {
    const catalog = await this.catalog.get(source);
    const root = this.catalog.root(source);
    const members = catalog.members ?? [];
    const member = members.find(candidate => candidate.id === requestedMemberId) ?? members.find(candidate => candidate.kind === 'human') ?? members[0] ?? null;
    const today = localToday();
    const writable = source === 'sandbox' && this.config.editMode !== 'read-only' && Boolean(this.config.writeRoot);
    const view: NotificationsView = { source, member: member && summaryMember(member), members: members.map(summaryMember), today, writable,
      watching: [], watchHash: null, total: 0, stacks: [], warnings: [] };
    if (!member) return view;
    let dismissals = emptyDismissals();
    try {
      const bytes = await readStateBytes(root);
      if (bytes) {
        const state = parseState(bytes);
        view.warnings.push(...state.warnings);
        dismissals = state.members.get(member.id) ?? dismissals;
      }
      view.watching = [...dismissals.watchedCards];
      view.watchHash = view.warnings.length ? null : watchHash(dismissals.watchedCards);
    } catch (error) {
      view.warnings.push(serverText(messages).allShown(notificationStatePath, error instanceof Error ? error.message : serverText(messages).readFailed));
    }
    const events = await this.recentEvents(root, view.warnings);
    view.stacks = [ownedStack(events, catalog, member, dismissals), watchingStack(events, catalog, member, dismissals), dueStack(catalog, member, today)];
    view.total = view.stacks.reduce((total, stack) => total + stack.total, 0);
    return view;
  }

  /** Seen → gone: one card or a whole journal stack, up to the moment the client saw. */
  dismiss(request: NotificationDismissRequest): Promise<NotificationsView> {
    const operation = this.writes.then(async () => {
      const root = await assertWritable(this.config, request.source);
      const catalog = await this.catalog.get('sandbox');
      if (!(catalog.members ?? []).some(member => member.id === request.memberId)) throw new CatalogError(422, serverText(messages).memberMissing);
      if (request.cardId && !catalog.cards.some(card => card.id === request.cardId)) throw new CatalogError(422, serverText(messages).cardMissing);
      const path = request.cardId ? ['members', request.memberId, 'seenCards', request.cardId] : ['members', request.memberId, 'dismissedStacks', request.stack!];
      await this.writeMoment(root, request.memberId, path, request.at);
      return this.read('sandbox', request.memberId);
    });
    this.writes = operation.catch(() => {});
    return operation;
  }

  watch(request: NotificationWatchRequest): Promise<NotificationsView> {
    const operation = this.writes.then(async () => {
      const root = await assertWritable(this.config, request.source);
      const catalog = await this.catalog.get('sandbox');
      if (!(catalog.members ?? []).some(member => member.id === request.memberId)) throw new CatalogError(422, serverText(messages).memberMissing);
      if (!catalog.cards.some(card => card.id === request.cardId)) throw new CatalogError(422, serverText(messages).cardMissing);
      await this.writeWatch(root, request);
      return this.read('sandbox', request.memberId);
    });
    this.writes = operation.catch(() => {});
    return operation;
  }

  private async writeWatch(root: string, request: NotificationWatchRequest): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const bytes = await readStateBytes(root);
      const state = bytes ? parseState(bytes) : null;
      if (state?.warnings.length) throw new CatalogError(422, state.warnings.join(' '));
      const cards = state?.members.get(request.memberId)?.watchedCards ?? new Set<string>();
      if (watchHash(cards) !== request.watchHash) throw new CatalogError(409, serverText(messages).watchChanged);
      if (cards.has(request.cardId) === request.watching) return;
      if (request.watching) cards.add(request.cardId);
      else cards.delete(request.cardId);
      if (!state || !bytes) {
        if (await createManagedMarkdown(root, notificationStatePath, { schema: 1, members: { [request.memberId]: { watching: [...cards] } } }, registryBriefs[await projectLanguage(root)])) return;
        continue;
      }
      const next = patchStateValue(state, ['members', request.memberId, 'watching'], [...cards]);
      if (watchHash(parseState(next).members.get(request.memberId)!.watchedCards) !== watchHash(cards)) throw new Error(serverText(messages).verifyWatch);
      // Seen marks may change concurrently; retry from fresh bytes, but never overwrite another watch-list revision.
      try { await replaceProjectMarkdown(root, notificationStatePath, digest(bytes), next); return; }
      catch (error) { if (!(error instanceof Error && error.message === 'CARD_CONFLICT')) throw error; }
    }
    throw new CatalogError(409, serverText(messages).fileChanged);
  }

  /** Marks only move forward, so a retry after a concurrent edit re-applies the same mark to fresh bytes. */
  private async writeMoment(root: string, memberId: string, path: string[], at: string): Promise<void> {
    const oldestKept = new Date(Date.now() - journalWindowDays * 86400000).toISOString();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const bytes = await readStateBytes(root);
      if (!bytes) {
        const metadata: Record<string, unknown> = { schema: 1, members: {} };
        let target = metadata;
        for (const key of path.slice(0, -1)) target = (target[key] ??= {}) as Record<string, unknown>;
        target[path[path.length - 1]] = at;
        if (await createManagedMarkdown(root, notificationStatePath, metadata, registryBriefs[await projectLanguage(root)])) return;
        continue;
      }
      const state = parseState(bytes);
      const document = parseDocument(state.yaml);
      const current = document.getIn(path);
      if (typeof current === 'string' && current >= at) return;
      document.setIn(path, at);
      pruneSeen(document, memberId, oldestKept);
      const next = Buffer.from(state.text.slice(0, state.yamlStart) + document.toString({ lineWidth: 0 }) + state.text.slice(state.yamlEnd));
      try { await replaceProjectMarkdown(root, notificationStatePath, digest(bytes), next); return; }
      catch (error) { if (!(error instanceof Error && error.message === 'CARD_CONFLICT')) throw error; }
    }
    throw new CatalogError(409, serverText(messages).fileChanged);
  }
}
