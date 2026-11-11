import { createHash } from 'node:crypto';
import type { Root } from 'mdast';
import { readCardContent } from '../../server/card-content.ts';
import { readProjectMarkdown } from '../../server/native-cards.ts';
import { ruleCardFor } from '../../server/agent-brief.ts';
import { readProjectCatalog } from '../../server/catalog.ts';
import { writeCatalog } from '../../server/cli-write.ts';
import { CatalogError } from '../../server/catalog-service.ts';
import { deckAcceptsCard } from '../../src/catalog-contracts.ts';
import { markdownParser } from '../../src/markdown-model.ts';
import { appendSectionLine, parseOpenQuestions } from '../../src/open-questions.ts';
import { resolveReference, shortReference } from '../../src/references.ts';
import { commandMember, type CommandContext, type CommandOptions } from './types.ts';
import { markerWords, writeMarker, type FormatLanguage } from '../../src/format-vocabulary.ts';
import { defineText, serverText } from '../../server/i18n.ts';

const messages = defineText({
  questionDoesNotBlock: 'The saved question does not block the source Task or remove it from next. Coordinate with the person to take the Task out of execution, and pause dependent work until an answer is saved.',
  noRule: (toIgnored: boolean) => 'The card has no rule Doc: the question is in its own Open questions, and no Decision task was created'
    + (toIgnored ? ', so --to was not used' : '') + '. Tell the person directly, or put the Task under its rule Doc.',
  decisionLinkMissing: 'The link to the decision task is not saved yet; repeat ask with the same text.',
  linkedTaskMissing: 'The linked task is not in the catalog.',
}, {
  questionDoesNotBlock: 'Сохранённый вопрос сам не блокирует исходную Task и не убирает её из next. Согласуйте с человеком вывод Task из исполнения и приостановите зависимую работу до сохранения ответа.',
  noRule: (toIgnored: boolean) => 'У карточки нет Doc с правилами: вопрос сохранён в её собственном разделе Open questions, Decision Task не создана'
    + (toIgnored ? ', поэтому --to не использован' : '') + '. Сообщите человеку напрямую или поместите Task под Doc с правилами.',
  decisionLinkMissing: 'Ссылка на Decision Task ещё не сохранена; повторите ask с тем же текстом.',
  linkedTaskMissing: 'Связанной Task нет в каталоге.',
});

function appendQuestion(markdown: string, text: string, eol: string, formatLanguage: FormatLanguage): string {
  // 2026-11-05: the question is plain text, so punctuation cannot create headings, links or nested items.
  const escaped = text.replace(/[!-/:-@\[-`{-~]/gu, '\\$&');
  const line = `- ${escaped}${eol}`;
  const marker = writeMarker('openQuestions', formatLanguage);
  if (parseOpenQuestions(`## ${marker}${eol}${line}`).questions?.[0]?.text !== text) {
    throw new Error('ask: the text cannot be stored as an item of the Open questions section unchanged; remove the trailing dash.');
  }
  return appendSectionLine(markdown, markdownParser.parse(markdown) as Root, markerWords('openQuestions'), line)
    ?? markdown + (markdown.endsWith(eol + eol) ? '' : eol + eol) + `## ${marker}${eol}${eol}${line}`;
}

function decisionId(ruleId: string, text: string): string {
  // 2026-11-05: a retry after a partially saved raise-decision must finish the same Task.
  const hash = createHash('sha256').update(JSON.stringify([ruleId, text])).digest('hex');
  return `card:${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export async function run(context: CommandContext, positionals: string[], options: CommandOptions): Promise<void> {
  if (positionals.length !== 2) throw new Error('ask: pass a c-ref and the question text in quotes.');
  const card = resolveReference(context.catalog.cards, 'c', positionals[0]);
  if (!card) throw new Error('Card not found. Pass a card ID or c-ref from show/find.');
  const actor = commandMember(context, options.get('member'), 'ask').id;
  const text = positionals[1].replace(/\s+/gu, ' ').trim();
  if (!text || text.length > 900) throw new Error('ask: the question must be 1 to 900 characters long.');
  const rule = ruleCardFor(context.catalog, card);
  if (!rule && !card.id.startsWith('card:')) throw new Error('ask: the card has no Doc with its rules.');
  const target = rule ?? card;
  let content = await readCardContent(context.root, target.id);
  if (content.sourceHash !== target.sourceHash) throw new CatalogError(409, 'The file has changed. Repeat ask.');
  let questions = parseOpenQuestions(content.markdown).questions ?? [];
  let questionIndex = questions.findIndex(question => question.text === text);
  const existing = questions[questionIndex];
  const link = (taskRef: string | null) => `/r/${taskRef ?? shortReference('c', target.id)}?source=${context.source}`;
  const warnings = [serverText(messages).questionDoesNotBlock];
  if (!rule) warnings.push(serverText(messages).noRule(options.has('to')));
  if (existing && (!rule || existing.taskRef)) {
    console.log(JSON.stringify({ question: text, link: link(existing.taskRef), existing: true, writes: 0, warnings }, null, 2));
    return;
  }
  const memberId = options.get('to') ?? context.catalog.members?.find(member => member.kind === 'human')?.id;
  const member = context.catalog.members?.find(candidate => candidate.id === memberId);
  const preferredDecks = [card.deckId, rule?.deckId, context.catalog.inboxDeckId];
  const deck = preferredDecks.map(id => context.catalog.decks.find(candidate => candidate.id === id && deckAcceptsCard(candidate.kind, 'task')))
    .find(Boolean) ?? context.catalog.decks.find(candidate => deckAcceptsCard(candidate.kind, 'task'));
  if (rule && member?.kind !== 'human') throw new Error('ask --to: the recipient must be a member with kind: human; add a person to the registry.');
  if (rule && !deck) throw new Error('ask: a decision needs a Task or Mixed deck.');
  const bytes = await readProjectMarkdown(context.root, target.path);
  const native = target.id.startsWith('card:');
  const newlineSource = native && !content.markdown.includes('\r\n') ? bytes.subarray(0, bytes.indexOf(10) + 1) : bytes;
  const newline = newlineSource.includes(Buffer.from('\r\n')) ? '\r\n' : '\n';
  if (content.title !== content.title.trim() || content.markdown.replace(/\r\n|\r|\n/gu, newline) !== content.markdown
    || (!native && !(markdownParser.parse(bytes.toString('utf8')) as Root).children.some(node => node.type === 'heading' && node.depth === 1))) {
    throw new Error('ask: the write would change bytes outside the question (line endings or the title). Fix the source file separately.');
  }
  if (questionIndex < 0) {
    const expectedMarkdown = appendQuestion(content.markdown, text, newline, context.catalog.formatLanguage);
    if (!parseOpenQuestions(expectedMarkdown).questions?.some(question => question.text === text)) {
      throw new Error('ask: the Open questions section was not recognized; check for unclosed Markdown blocks.');
    }
    const result = await writeCatalog(context.config, context.source, {
      action: 'update-card-content', ...content, markdown: expectedMarkdown,
      manifestHash: context.catalog.manifestHash,
    }, actor);
    warnings.push(...result.warnings);
    content = await readCardContent(context.root, target.id);
    if (content.markdown !== expectedMarkdown) throw new CatalogError(409, 'The question was saved, but the file has changed since. Check it before repeating ask.', true);
    questions = parseOpenQuestions(content.markdown).questions ?? [];
    questionIndex = questions.findIndex(question => question.text === text);
    if (questionIndex < 0) throw new CatalogError(422, 'The saved question was not recognized. Check the Open questions section.', true);
  }
  let taskRef: string | null = null;
  if (rule) {
    const taskCardId = decisionId(rule.id, text);
    const edit = {
      action: 'raise-decision' as const, cardId: rule.id, sourceHash: content.sourceHash,
      manifestHash: context.catalog.manifestHash, questionIndex, questionText: text,
      taskCardId, deckId: deck!.id, memberId: member!.id,
    };
    const result = await writeCatalog(context.config, context.source, edit, actor);
    warnings.push(...result.warnings);
    if (result.warnings.length) {
      const catalog = await readProjectCatalog(context.root);
      const task = catalog.cards.find(candidate => candidate.id === taskCardId);
      // 2026-11-05: creation in a manually ordered Deck changes the manifest before the remaining stages.
      if (catalog.manifestHash !== edit.manifestHash && task?.parentId === rule.id
        && markerWords('decision').some(marker => task.title === `${marker} ${text}`)) {
        const retry = await writeCatalog(context.config, context.source, { ...edit, manifestHash: catalog.manifestHash }, actor);
        warnings.push(...retry.warnings);
      }
    }
    // A saved-stage warning is not proof that the final link exists; report only the persisted result.
    const fresh = await readCardContent(context.root, target.id);
    taskRef = parseOpenQuestions(fresh.markdown).questions?.find(question => question.text === text)?.taskRef ?? null;
    if (!taskRef) warnings.push(serverText(messages).decisionLinkMissing);
    const catalog = await readProjectCatalog(context.root);
    if (taskRef && !resolveReference(catalog.cards, 'c', taskRef)) warnings.push(serverText(messages).linkedTaskMissing);
  }
  console.log(JSON.stringify({ question: text, link: link(taskRef), existing: false, warnings }, null, 2));
}
