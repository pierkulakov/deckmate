import { readFile } from 'node:fs/promises';
import { callAgentTool } from '../../server/agent-ops.ts';
import { environmentValue } from '../../server/environment.ts';
import { commandMember, printToolFailure, type CommandContext, type CommandOptions } from './types.ts';

export async function run(context: CommandContext, positionals: string[], options: CommandOptions): Promise<void> {
  const member = options.get('member');
  if (member !== undefined) commandMember(context, member, 'create');
  const filename = options.get('file');
  let cards: unknown;
  if (filename !== undefined) {
    if (positionals.length || ['deck', 'kind', 'owner', 'priority', 'effort', 'parent', 'key', 'body-file'].some(name => options.has(name))) {
      throw new Error('create: --file accepts only --member and the shared project options.');
    }
    cards = JSON.parse(await readFile(filename, 'utf8'));
  } else {
    if (positionals.length !== 1) throw new Error('create: pass one title in quotes, or --file <cards.json>.');
    const bodyFile = options.get('body-file');
    cards = [{
      title: positionals[0],
      ...(options.has('deck') ? { deck: options.get('deck') } : {}),
      ...(options.has('kind') ? { kind: options.get('kind') } : {}),
      ...(options.has('owner') ? { owner: options.get('owner') } : {}),
      ...(options.has('priority') ? { priority: options.get('priority') } : {}),
      ...(options.has('effort') ? { effort: Number(options.get('effort')) } : {}),
      ...(options.has('parent') ? { parent: options.get('parent') } : {}),
      ...(options.has('key') ? { key: options.get('key') } : {}),
      ...(bodyFile !== undefined ? { body: await readFile(bodyFile, 'utf8') } : {}),
    }];
  }
  try {
    const result = await callAgentTool(context, 'create_cards', { cards, member }, { defaultMember: environmentValue('MEMBER'), source: 'cli' });
    console.log(JSON.stringify(result));
  } catch (error) {
    printToolFailure(error);
  }
}
