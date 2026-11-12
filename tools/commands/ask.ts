import { askAgentQuestion } from '../../server/agent-ops.ts';
import { commandMember, type CommandContext, type CommandOptions } from './types.ts';

export async function run(context: CommandContext, positionals: string[], options: CommandOptions): Promise<void> {
  if (positionals.length !== 2) throw new Error('ask: pass a c-ref and the question text in quotes.');
  const actor = commandMember(context, options.get('member'), 'ask').id;
  const result = await askAgentQuestion(context, positionals[0], actor,
    { question: positionals[1], to: options.get('to'), target: options.get('target') });
  console.log(JSON.stringify(result, null, 2));
}
