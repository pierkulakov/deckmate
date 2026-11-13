import { callAgentTool } from '../../server/agent-ops.ts';
import { environmentValue } from '../../server/environment.ts';
import { commandMember, printToolFailure, type CommandContext, type CommandOptions } from './types.ts';

export async function run(context: CommandContext, positionals: string[], options: CommandOptions): Promise<void> {
  if (positionals.length !== 1) throw new Error('update: pass one card ID or c-ref.');
  const member = options.get('member');
  if (member !== undefined) commandMember(context, member, 'update');
  const input = {
    ref: positionals[0], member,
    ...(options.has('rev') ? { rev: options.get('rev') } : {}),
    ...(options.has('state') ? { state: options.get('state') } : {}),
    ...(options.has('reason') ? { reason: options.get('reason') } : {}),
    ...(options.has('owner') ? { owner: options.get('owner') || null } : {}),
    ...(options.has('priority') ? { priority: options.get('priority') } : {}),
    ...(options.has('effort') ? { effort: Number(options.get('effort')) } : {}),
    ...(options.has('deck') ? { deck: options.get('deck') } : {}),
    ...(options.has('tracks') ? { tracks: options.get('tracks')?.split(',') ?? [] } : {}),
    ...(options.has('parent') ? { parent: options.get('parent') } : {}),
  };
  try {
    console.log(JSON.stringify(await callAgentTool(context, 'update_card', input, { defaultMember: environmentValue('MEMBER'), source: 'cli' })));
  } catch (error) {
    printToolFailure(error);
  }
}
