import { defineText, serverLang, serverText } from './i18n.ts';
import { createHash } from 'node:crypto';
import type { CatalogCard } from '../src/catalog-contracts.ts';
import { isMechanicPath, parseDocument } from '../src/markdown.ts';
import { readIteration } from './document.ts';
import { readProjectMarkdown, replaceProjectMarkdown } from './native-cards.ts';
import { cardStateMarkWords, writeCardState, type CardState, type FormatLanguage } from '../src/format-vocabulary.ts';

const messages = defineText({
  legacyStateTaskRequired: "State belongs to a Task in a mechanic file.",
  sliceNotFound: "Slice not found.",
  stateChangesStructure: "The state edit changed the slice structure.",
}, {
  legacyStateTaskRequired: "Состояние принадлежит Task в файле механики.",
  sliceNotFound: "Срез не найден.",
  stateChangesStructure: "Правка состояния изменила структуру срезов.",
});


const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** 2026-11-03: Batch candidates use one baseline, so sibling slices never stale each other's hashes. */
export function patchLegacyCardStates(bytes: Buffer, cards: CatalogCard[], state: CardState, iteration = 0, formatLanguage: FormatLanguage = 'ru'): Buffer {
  if (!cards.length) return bytes;
  const relative = cards[0].path;
  if (cards.some(card => card.kind !== 'task' || card.path !== relative || !isMechanicPath(card.path) || card.version === null)) throw new Error(serverText(messages).legacyStateTaskRequired);
  const document = parseDocument(relative, bytes, serverLang());
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date());
  const marks: Record<CardState, string> = {
    'not-started': '',
    discussing: `(${writeCardState('discussing', formatLanguage)})`,
    'in-iteration': `(${writeCardState('in-iteration', formatLanguage)} ${iteration})`,
    started: `(${writeCardState('started', formatLanguage)})`,
    review: `(${writeCardState('review', formatLanguage)})`,
    done: `(${writeCardState('done', formatLanguage)} ${date})`,
    'wont-do': `(${writeCardState('wont-do', formatLanguage)})`,
  };
  const stateMark = new RegExp(`\\((?:${cardStateMarkWords().join('|')})(?![\\p{L}\\p{N}_])[^)]*\\)`, 'gu');
  const patches = cards.flatMap(card => {
    const slice = document.slices.find(candidate => candidate.ver === card.version);
    if (!slice) throw new Error(serverText(messages).sliceNotFound);
    const hasStateMark = Array.from(slice.heading.matchAll(stateMark)).length > 0;
    if (slice.state === state && (state !== 'not-started' || !hasStateMark)) return [];
    let end = slice.range.start;
    while (end < bytes.length && bytes[end] !== 10 && bytes[end] !== 13) end += 1;
    const title = bytes.subarray(slice.range.start, end).toString('utf8').replace(/^###\s+(?:✅\s+)?/u, '')
      .replace(stateMark, '').trimEnd();
    return [{ start: slice.range.start, end, heading: `### ${state === 'done' ? '✅ ' : ''}${title}${marks[state] ? ' ' + marks[state] : ''}` }];
  });
  let candidate = bytes;
  for (const patch of patches.sort((first, second) => second.start - first.start)) candidate = Buffer.concat([candidate.subarray(0, patch.start), Buffer.from(patch.heading), candidate.subarray(patch.end)]);
  const next = parseDocument(relative, candidate, serverLang());
  if (JSON.stringify(next.slices.map(item => item.ver)) !== JSON.stringify(document.slices.map(item => item.ver))
    || cards.some(card => next.slices.find(item => item.ver === card.version)?.state !== state)) throw new Error(serverText(messages).stateChangesStructure);
  return candidate;
}

/** Same heading grammar as Repository.moveSlice; no body or neighbouring slice edits. */
export async function updateLegacyCardState(root: string, card: CatalogCard, state: CardState, beforePublish: () => Promise<void>,
  formatLanguage: FormatLanguage = 'ru'): Promise<boolean> {
  if (card.kind !== 'task' || !isMechanicPath(card.path) || card.version === null) throw new Error(serverText(messages).legacyStateTaskRequired);
  const bytes = await readProjectMarkdown(root, card.path);
  if (digest(bytes) !== card.sourceHash) throw new Error('CARD_CONFLICT');
  const document = parseDocument(card.path, bytes, serverLang());
  const slice = document.slices.find(candidate => candidate.ver === card.version);
  if (!slice) throw new Error(serverText(messages).sliceNotFound);
  let iterationBytes: Buffer | undefined;
  let iteration = 0;
  if (state === 'in-iteration') {
    iterationBytes = await readProjectMarkdown(root, 'tasks/iterations.md');
    iteration = readIteration(iterationBytes.toString('utf8')).number;
  }
  const candidate = patchLegacyCardStates(bytes, [card], state, iteration, formatLanguage);
  if (candidate.equals(bytes)) return false;
  await replaceProjectMarkdown(root, card.path, card.sourceHash, candidate, async () => {
    await beforePublish();
    if (iterationBytes && digest(await readProjectMarkdown(root, 'tasks/iterations.md')) !== digest(iterationBytes)) throw new Error('CARD_CONFLICT');
  });
  return true;
}
