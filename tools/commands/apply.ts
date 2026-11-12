import { applyAgentDecision } from '../../server/agent-ops.ts';
import type { CommandContext, CommandOptions } from './types.ts';

export async function run(context: CommandContext, positionals: string[], options: CommandOptions): Promise<void> {
  if (positionals.length !== 2 || !/^[0-9]+$/u.test(positionals[1])) throw new Error('apply: pass a c-ref and a nonnegative decision index.');
  const index = Number(positionals[1]);
  if (!Number.isSafeInteger(index)) throw new Error('apply: the decision index must be a safe nonnegative integer.');
  const result = await applyAgentDecision(context, positionals[0], index, options.get('note'), options.get('rev'));
  console.log(JSON.stringify(result, null, 2));
}
