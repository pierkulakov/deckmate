import { buildBrief } from '../../server/agent-brief.ts';
import { nextAgentCard } from '../../server/agent-queue.ts';
import { shortReference } from '../../src/references.ts';
import { commandMember, type CommandContext, type CommandOptions } from './types.ts';

export async function run(context: CommandContext, positionals: string[], options: CommandOptions): Promise<void> {
  const requested = commandMember(context, options.get('member') ?? positionals.join(' '), 'next').id;
  const { member, card } = await nextAgentCard(context.catalog, context.root, requested,
    { staleHours: options.has('stale-hours') ? Number(options.get('stale-hours')) : undefined });
  if (card && options.has('brief')) {
    const brief = await buildBrief(context.catalog, context.root, card);
    process.stdout.write(brief.markdown);
    return;
  }
  const ref = card ? shortReference('c', card.id) : null;
  console.log(JSON.stringify({ source: context.source, member: member.id,
    card: card ? { ref, title: card.title, state: card.state, path: card.path, sourceHash: card.sourceHash,
      link: `/r/${ref}?source=${context.source}` } : null }));
}
