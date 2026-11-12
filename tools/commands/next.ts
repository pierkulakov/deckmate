import { readAgentNext } from '../../server/agent-ops.ts';
import { cardLink, shortReference } from '../../src/references.ts';
import { commandMember, type CommandContext, type CommandOptions } from './types.ts';

export async function run(context: CommandContext, positionals: string[], options: CommandOptions): Promise<void> {
  const requested = commandMember(context, options.get('member') ?? positionals.join(' '), 'next').id;
  const { member, card, decision, brief } = await readAgentNext(context, requested, {
    staleHours: options.has('stale-hours') ? Number(options.get('stale-hours')) : undefined,
    withBrief: options.has('brief'),
  });
  if (decision) {
    console.log(JSON.stringify({ source: context.source, member: member.id, decision }, null, 2));
    return;
  }
  if (card && brief) {
    process.stdout.write(brief.markdown);
    return;
  }
  const ref = card ? shortReference('c', card.id) : null;
  console.log(JSON.stringify({ source: context.source, member: member.id,
    card: card && ref ? { ref, title: card.title, state: card.state, path: card.path, sourceHash: card.sourceHash,
      link: cardLink(ref, context.source) } : null }));
}
