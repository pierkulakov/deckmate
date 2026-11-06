import { CatalogService } from '../../server/catalog-service.ts';
import { NotificationService } from '../../server/notifications.ts';
import { getCatalogHands, selectCatalogHand } from '../../src/catalog-hand.ts';
import type { NotificationCard, NotificationStack } from '../../src/notification-contracts.ts';
import { shortReference } from '../../src/references.ts';
import { commandMember, type CommandContext, type CommandOptions } from './types.ts';

/** 2026-11-05: notifications need this snapshot, never the indexing/housekeeping path of CatalogService.get. */
class NotificationCatalog extends CatalogService {
  private readonly snapshot: CommandContext['catalog'];

  constructor(context: CommandContext) {
    super({ ...context.config, editMode: 'read-only' }, ':memory:');
    this.snapshot = context.catalog;
  }

  override async get() { return this.snapshot; }
}

function sinceTimestamp(since: string | undefined): number | null {
  if (since === undefined) return null;
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/u.exec(since);
  const timestamp = Date.parse(since);
  const day = parts ? new Date(parts[1] + 'T00:00:00Z') : new Date(NaN);
  if (!parts || !Number.isFinite(timestamp) || !Number.isFinite(day.getTime())
    || day.toISOString().slice(0, 10) !== parts[1] || Number(parts[2]) > 23 || Number(parts[3]) > 59 || Number(parts[4]) > 59) {
    throw new RangeError('--since must be a valid ISO timestamp with a time zone.');
  }
  return timestamp;
}

function filteredCard(card: NotificationCard, since: number | null): NotificationCard | null {
  if (since === null || card.latestAt === null) return card;
  const changes = card.changes.filter(change => Date.parse(change.at) > since);
  if (!changes.length) return null;
  return { ...card, changes, latestAt: changes[0].at,
    hiddenChanges: changes.length < card.changes.length ? 0 : card.hiddenChanges };
}

function filteredStack(stack: NotificationStack, since: number | null) {
  const cards = stack.cards.map(card => filteredCard(card, since)).filter(card => card !== null);
  const unknownHidden = since !== null && stack.id !== 'due' && stack.hidden > 0 && cards.length === stack.cards.length;
  let total: number | null = stack.total;
  if (since !== null && stack.id !== 'due') total = unknownHidden ? null : cards.length;
  return { id: stack.id, total, cards, unknownHidden };
}

export async function readAgentInbox(context: CommandContext, requestedMember: string,
  options: { since?: string; limit?: number } = {}) {
  const since = sinceTimestamp(options.since);
  const limit = options.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 0 || limit > 100) throw new RangeError('--limit for inbox must be an integer from 0 to 100.');
  const { member } = selectCatalogHand(getCatalogHands(context.catalog), requestedMember);
  const config = { ...context.config, editMode: 'read-only' as const };
  const service = new NotificationService(config, new NotificationCatalog(context));
  const view = await service.read(context.source, member.id);
  let remaining = limit;
  const stacks = view.stacks.map(stack => {
    const filtered = filteredStack(stack, since);
    const cards = filtered.cards.slice(0, remaining);
    remaining -= cards.length;
    const hidden = filtered.total === null ? null : filtered.total - cards.length;
    return { id: stack.id, total: filtered.total, hidden, truncated: hidden === null || hidden > 0, cards };
  });
  const total = stacks.some(stack => stack.total === null) ? null : stacks.reduce((sum, stack) => sum + stack.total!, 0);
  return { source: context.source, member: member.id, since: options.since ?? null, limit, total, stacks, warnings: view.warnings };
}

function excerpt(text: string, limit: number): string {
  const line = text.replace(/\s+/gu, ' ').trim();
  return line.length > limit ? line.slice(0, limit - 1) + '…' : line;
}

export async function run(context: CommandContext, positionals: string[], options: CommandOptions): Promise<void> {
  const inbox = await readAgentInbox(context, commandMember(context, options.get('member') ?? positionals.join(' '), 'inbox').id, {
    since: options.get('since'), limit: options.has('limit') ? Number(options.get('limit')) : undefined,
  });
  const lines = [`# Inbox · ${inbox.member} · ${inbox.source}`, `Notification window: 30 days / up to 1000 events.`,
    `Since: ${inbox.since ?? 'no filter'}; cards: ${inbox.total ?? 'unknown (a stack is capped)'}.`];
  for (const stack of inbox.stacks) {
    lines.push(`\n## ${stack.id} · ${stack.total ?? '?'} · hidden: ${stack.hidden ?? '?'}`);
    for (const card of stack.cards) {
      const change = card.changes[0];
      lines.push(`- ${shortReference('c', card.cardId)} ${excerpt(card.title, 90)} · ${card.latestAt ?? card.dueDate ?? ''}`);
      if (change) lines.push(`  ${excerpt(change.actor + ': ' + change.lines.join('; '), 140)}`);
      const hidden = card.hiddenChanges + Math.max(0, card.changes.length - 1);
      if (hidden) lines.push(`  More events${inbox.since ? ' before the filter (upper bound)' : ''}: ${hidden}.`);
    }
  }
  for (const warning of inbox.warnings) lines.push(`Warning: ${warning}`);
  process.stdout.write(lines.join('\n') + '\n');
}
