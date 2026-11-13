import { answerAgentQuestion } from '../../server/agent-ops.ts';
import type { CommandContext, CommandOptions } from './types.ts';

export async function run(context: CommandContext, positionals: string[], options: CommandOptions): Promise<void> {
  if (positionals.length !== 2) throw new Error('answer: pass a c-ref#N and the answer text in quotes.');
  const human = options.get('as');
  if (!human) throw new Error('answer: pass --as <human-id> for the person who answered in chat.');
  console.log(JSON.stringify(await answerAgentQuestion(context, positionals[0], positionals[1], human,
    { rev: options.get('rev'), member: options.get('member') }), null, 2));
}
