import { writeCatalog } from '../../server/cli-write.ts';
import type { CatalogEdit } from '../../src/catalog-contracts.ts';
import { cardStates, cardStateWords, readCardState } from '../../src/format-vocabulary.ts';
import { resolveReference, shortReference } from '../../src/references.ts';
import { commandMember, type CommandContext, type CommandOptions } from './types.ts';

type StateEdit = Extract<CatalogEdit, { action: 'set-card-state' }>;

/**
 * 2026-11-06: the review step of the agent route — a reviewer returns a card with a reason, a guardian or the project
 * owner accepts it. Deck guardians and the return-reason rules stay with the catalog write, as for the UI.
 */
export async function run(context: CommandContext, positionals: string[], options: CommandOptions): Promise<void> {
  if (positionals.length !== 2) throw new Error('state: pass a card ID or c-ref and the new state, for example state c-1a2b3c4d5e done --member <ID>.');
  const card = resolveReference(context.catalog.cards, 'c', positionals[0]);
  if (!card) throw new Error('Card not found. Pass a card ID or c-ref from show/find.');
  if (card.kind !== 'task') throw new Error('state: only a Task card has a state.');
  const state = readCardState(positionals[1]);
  if (!state) throw new Error(`state: the state must be one of: ${cardStates.flatMap(cardStateWords).join(', ')}.`);
  const actor = commandMember(context, options.get('member'), 'state').id;
  const reason = options.get('reason')?.trim();
  // A return without a reason leaves the assignee to guess what to fix; the review workflow always names it.
  if (card.state === 'review' && state !== 'review' && state !== 'done' && !reason) {
    throw new Error('state: leaving review without acceptance needs --reason "<tolerance: required, actual; fix>" (one line, up to 500 characters).');
  }
  const edit: StateEdit = { action: 'set-card-state', cardId: card.id, sourceHash: card.sourceHash,
    manifestHash: context.catalog.manifestHash, state, ...(reason ? { returnReason: reason } : {}) };
  const result = await writeCatalog(context.config, context.source, edit, actor);
  console.log(JSON.stringify({ id: card.id, ref: shortReference('c', card.id), source: context.source,
    from: card.state, state, ...result }, null, 2));
}
