import { defineText, serverText } from '../../server/i18n.ts';
import { writeCatalog } from '../../server/cli-write.ts';
import { readCardAttachments } from '../../server/attachments.ts';
import { resolveReference, shortReference } from '../../src/references.ts';
import { commandMember, type CommandContext, type CommandOptions } from './types.ts';

const text = defineText({
  usage: (command: string) => `${command}: pass one card ID or c-ref and --file <project-relative path>.`,
  cardMissing: 'Card not found.',
}, {
  usage: (command: string) => `${command}: укажите один ID карточки или c-ref и --file <путь от корня проекта>.`,
  cardMissing: 'Карточка не найдена.',
});

export async function editLink(context: CommandContext, positionals: string[], options: CommandOptions, command: 'attach' | 'detach'): Promise<void> {
  const file = options.get('file');
  if (positionals.length !== 1 || !file) throw new Error(serverText(text).usage(command));
  const card = resolveReference(context.catalog.cards, 'c', positionals[0]);
  if (!card) throw new Error(serverText(text).cardMissing);
  const actor = options.has('member') ? commandMember(context, options.get('member'), command).id : null;
  const attachments = await readCardAttachments(context.root, card.id);
  const result = await writeCatalog(context.config, context.source, {
    action: command === 'attach' ? 'attach-project-file' : 'detach-project-file',
    manifestHash: context.catalog.manifestHash, cardId: card.id, attachmentsHash: attachments.hash, file,
  }, actor);
  console.log(JSON.stringify({ id: card.id, ref: shortReference('c', card.id), file, action: command, ...result }));
}

export async function run(context: CommandContext, positionals: string[], options: CommandOptions): Promise<void> {
  await editLink(context, positionals, options, 'attach');
}
