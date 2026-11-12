import { callAgentTool } from '../../server/agent-ops.ts';
import type { CommandContext, CommandOptions } from './types.ts';

export async function run(context: CommandContext, positionals: string[], options: CommandOptions): Promise<void> {
  if (positionals.length) throw new Error('organize: use --about "<new thing>" instead of positional arguments.');
  const about = options.get('about');
  console.log(JSON.stringify(await callAgentTool(context, 'organize', about === undefined ? {} : { about })));
}
