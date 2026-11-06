import { readFile } from 'node:fs/promises';
import type { Root } from 'mdast';
import { writeCatalog } from '../../server/cli-write.ts';
import { type CatalogEdit } from '../../src/catalog-contracts.ts';
import { cardStates, cardStateWords, readCardState } from '../../src/format-vocabulary.ts';
import { markdownParser } from '../../src/markdown-model.ts';
import { resolveReference, shortReference } from '../../src/references.ts';
import { commandMember, type CommandContext, type CommandOptions } from './types.ts';

type ReportEdit = Extract<CatalogEdit, { action: 'add-card-report' }>;

async function readReport(filename: string): Promise<string> {
  let bytes: Buffer;
  try { bytes = await readFile(filename); }
  catch (error) {
    throw new Error(`report: cannot read --file ${filename} (${(error as NodeJS.ErrnoException).code ?? 'error'}); save the report first and pass its path.`);
  }
  let markdown: string;
  try { markdown = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error(`report: --file ${filename} is not UTF-8 text; save it as UTF-8.`); }
  if (!markdown.trim()) throw new Error('report: the report file is empty.');
  // 2026-11-06: the report is filed under "#### Report …", and brief reads it only up to the next heading of level 1–4.
  // Such a heading would cut the report off and leave the rest as loose card text (legacy cards reject levels 1–3).
  const heading = (markdownParser.parse(markdown) as Root).children.find(node => node.type === 'heading' && node.depth <= 4);
  if (heading?.type === 'heading') {
    throw new Error(`report: line ${heading.position!.start.line} is a level-${heading.depth} heading; inside the card's #### Report block use ##### or deeper.`);
  }
  return markdown;
}

export async function run(context: CommandContext, positionals: string[], options: CommandOptions): Promise<void> {
  if (positionals.length !== 1) throw new Error('report: pass one card ID or c-ref.');
  const card = resolveReference(context.catalog.cards, 'c', positionals[0]);
  if (!card) throw new Error('Card not found. Pass a card ID or c-ref from show/find.');
  const filename = options.get('file');
  if (!filename?.trim()) throw new Error('report: pass --file <report file>.');
  const actor = commandMember(context, options.get('member'), 'report').id;
  const requestedState = options.get('state');
  const state = requestedState === undefined ? undefined : readCardState(requestedState);
  if (requestedState !== undefined) {
    if (!state) throw new Error(`report --state must be one of: ${cardStates.flatMap(cardStateWords).join(', ')}.`);
    if (card.kind !== 'task') throw new Error('report --state is only available for a Task card.');
  }
  const markdown = await readReport(filename);
  // 2026-11-05: keep the revision selected by the command; refreshing it here would hide a concurrent edit.
  const edit: ReportEdit = { action: 'add-card-report', cardId: card.id, sourceHash: card.sourceHash,
    manifestHash: context.catalog.manifestHash, markdown, ...(state === undefined ? {} : { state }) };
  const result = await writeCatalog(context.config, context.source, edit, actor);
  console.log(JSON.stringify({ id: card.id, ref: shortReference('c', card.id), source: context.source,
    ...(state === undefined ? {} : { requestedState: state }), ...result }, null, 2));
}
