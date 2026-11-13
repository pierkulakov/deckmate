import { reportAgentCard } from '../../server/agent-ops.ts';
import { shortReference } from '../../src/references.ts';
import { commandMember, type CommandContext, type CommandOptions } from './types.ts';

export async function run(context: CommandContext, positionals: string[], options: CommandOptions): Promise<void> {
  if (positionals.length !== 1) throw new Error('report: pass one card ID or c-ref.');
  const filename = options.get('file');
  if (!filename?.trim()) throw new Error('report: pass --file <report file>.');
  const actor = commandMember(context, options.get('member'), 'report').id;
  const { card, requestedState, result } = await reportAgentCard(context, positionals[0], actor,
    { file: filename, state: options.get('state') });
  console.log(JSON.stringify({ id: card.id, ref: shortReference('c', card.id), source: context.source,
    ...(requestedState === undefined ? {} : { requestedState }), ...result }, null, 2));
}
