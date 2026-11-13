import { stateAgentCard } from '../../server/agent-ops.ts';
import { shortReference } from '../../src/references.ts';
import { commandMember, type CommandContext, type CommandOptions } from './types.ts';

/** The review transition shares its reason and guardian rules with the agent update operation. */
export async function run(context: CommandContext, positionals: string[], options: CommandOptions): Promise<void> {
  if (positionals.length !== 2) throw new Error('state: pass a card ID or c-ref and the new state, for example state c-1a2b3c4d5e done --member <ID>.');
  const actor = commandMember(context, options.get('member'), 'state').id;
  const { card, state, result } = await stateAgentCard(context, positionals[0], positionals[1], actor, options.get('reason'));
  console.log(JSON.stringify({ id: card.id, ref: shortReference('c', card.id), source: context.source,
    from: card.state, state, ...result }, null, 2));
}
