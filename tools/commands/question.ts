import { readAgentQuestion } from '../../server/agent-ops.ts';
import type { CommandContext, CommandOptions } from './types.ts';

export async function run(context: CommandContext, positionals: string[], _options: CommandOptions): Promise<void> {
  if (positionals.length !== 1) throw new Error('question: pass one c-ref#N.');
  console.log(JSON.stringify(await readAgentQuestion(context, positionals[0]), null, 2));
}
