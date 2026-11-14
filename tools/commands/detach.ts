import { editLink } from './attach.ts';
import type { CommandContext, CommandOptions } from './types.ts';

export async function run(context: CommandContext, positionals: string[], options: CommandOptions): Promise<void> {
  await editLink(context, positionals, options, 'detach');
}
