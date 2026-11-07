import { stat } from 'node:fs/promises';
import type { CatalogCard, CatalogView } from '../src/catalog-contracts.ts';
import { getCatalogHands, isActiveCatalogCard, selectCatalogHand } from '../src/catalog-hand.ts';
import { readAgentHistory } from './agent-changes.ts';
import { containedFile } from './config.ts';

export interface QueueOptions { staleHours?: number; now?: number }

export function staleHours(value: number = 24): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError('--stale-hours must be a positive number of hours.');
  return value;
}

const normalizedState = (card: CatalogCard) => (card.state ?? '').trim().toLocaleLowerCase('ru-RU');

/** 2026-11-05: filesystem age supplies the clock; a hash by itself never supplies a historical timestamp. */
export async function readStaleCards(catalog: CatalogView, root: string, options: QueueOptions = {}): Promise<Set<string>> {
  const cutoff = (options.now ?? Date.now()) - staleHours(options.staleHours) * 3600000;
  const candidates = catalog.cards.filter(card => isActiveCatalogCard(card) && card.kind === 'task'
    && normalizedState(card) === 'started' && Date.parse(card.updatedAt ?? '') < cutoff);
  const stale = new Set<string>();
  // 2026-11-05: cap parallel Git/history readers on large projects, retaining the shared history implementation.
  for (let offset = 0; offset < candidates.length; offset += 8) {
    await Promise.all(candidates.slice(offset, offset + 8).map(async card => {
      const filename = await containedFile(root, card.path);
      const before = await stat(filename);
      if (before.mtimeMs >= cutoff) return;
      const history = await readAgentHistory(root, card);
      const journalWarnings = history.warnings.filter(warning => warning !== history.git.warning);
      if (journalWarnings.length) throw new Error(journalWarnings.join(' '));
      const after = await stat(filename);
      // 2026-11-05: neither an old catalog hash nor a concurrent rewrite is evidence of an unchanged file.
      if (history.sourceHash !== card.sourceHash || before.mtimeMs !== after.mtimeMs
        || before.ctimeMs !== after.ctimeMs || before.size !== after.size) return;
      if (history.events.some(event => !Number.isFinite(Date.parse(event.at)) || Date.parse(event.at) >= cutoff)) return;
      stale.add(card.id);
    }));
  }
  return stale;
}

export async function nextAgentCard(catalog: CatalogView, root: string, requestedMember: string, options: QueueOptions = {}) {
  const hand = selectCatalogHand(getCatalogHands(catalog), requestedMember);
  const byId = new Map(catalog.cards.map(card => [card.id, card]));
  const candidates = hand.cards.filter(card => !['review', 'done'].includes(normalizedState(card))
    && (card.dependsOn ?? []).every(id => {
      const dependency = byId.get(id);
      return dependency !== undefined && normalizedState(dependency) === 'done';
    }));
  staleHours(options.staleHours);
  for (const card of candidates) {
    const stale = await readStaleCards({ ...catalog, cards: [card] }, root, options);
    if (!stale.has(card.id)) return { member: hand.member, card };
  }
  return { member: hand.member, card: null };
}
