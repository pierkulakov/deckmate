import { createHash } from 'node:crypto';
import type { Root } from 'mdast';
import type { CatalogCard, CatalogView } from '../src/catalog-contracts.ts';
import type { ByteRange } from '../src/contracts.ts';
import { shortReference } from '../src/references.ts';
import { parseDocument } from '../src/markdown.ts';
import { markdownParser } from '../src/markdown-model.ts';
import { cardReportAuthor, isCardSectionBoundary } from '../src/open-questions.ts';
import { readHeroSections } from './card-content.ts';
import { readManagedMarkdown, readNativeCard, readProjectMarkdown } from './native-cards.ts';
import { readAgentHistory, type AgentHistory } from './agent-changes.ts';
import { activityEventPath } from './activity.ts';
import { defineText, serverText } from './i18n.ts';
import { cardStateMarkWords, markerWords } from '../src/format-vocabulary.ts';

const messages = defineText({
  returnFeedback: 'Latest recorded review return',
  actor: (memberId: string) => `Actor: ${memberId}`,
  unknownActor: 'unknown',
  reason: (reason: string) => `Reason: ${reason}`,
  feedbackTruncated: '… [return feedback truncated; read the full journal range]',
}, {
  returnFeedback: 'Последний записанный возврат с приёмки',
  actor: (memberId: string) => `Автор: ${memberId}`,
  unknownActor: 'неизвестен',
  reason: (reason: string) => `Причина: ${reason}`,
  feedbackTruncated: '… [обратная связь сокращена; прочитайте полный диапазон журнала]',
});

export interface ReadNext { path: string; from: number; to: number; title: string; tokens: number }
export interface AgentBrief { markdown: string; tokens: number; truncated: boolean; readNext: ReadNext[] }
export interface SourceLine { line: number; text: string; start: number; end: number }
export interface ContextSection { title: string; from: number; to: number; lines: SourceLine[] }
export interface SelectedLine extends SourceLine { score: number }

/** 2026-11-05: the research's reproducible estimate, not a model-specific tokenizer. */
export function estimateTokens(text: string): number {
  const characters = Array.from(text);
  const cyrillic = text.match(/\p{Script=Cyrillic}/gu)?.length ?? 0;
  return Math.ceil(cyrillic / 2.7 + (characters.length - cyrillic) / 3.8);
}

export function sourceLines(bytes: Buffer): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  for (let offset = 0; offset < bytes.length; offset += 1) {
    if (bytes[offset] !== 10 && bytes[offset] !== 13) continue;
    const contentEnd = offset;
    if (bytes[offset] === 13 && bytes[offset + 1] === 10) offset += 1;
    lines.push({ line: lines.length + 1, text: bytes.subarray(start, contentEnd).toString('utf8'), start, end: offset + 1 });
    start = offset + 1;
  }
  if (start < bytes.length || !lines.length) {
    lines.push({ line: lines.length + 1, text: bytes.subarray(start).toString('utf8'), start, end: bytes.length });
  }
  return lines;
}

export function sourceLineRange(bytes: Buffer, range: ByteRange): { from: number; to: number } {
  if (range.start < 0 || range.end < range.start || range.end > bytes.length) throw new RangeError('The byte range is outside the file.');
  const lines = sourceLines(bytes);
  const from = lines.find(line => line.end > range.start)?.line ?? lines.length;
  const to = lines.find(line => line.end >= range.end)?.line ?? lines.length;
  return { from, to: Math.max(from, to) };
}

export async function readFileLines(root: string, relativePath: string, from: number, to: number) {
  const bytes = await readProjectMarkdown(root, relativePath);
  const lines = sourceLines(bytes);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1 || to < from || to > lines.length) {
    throw new RangeError(`Lines must satisfy 1 <= from <= to <= ${lines.length}.`);
  }
  const markdown = bytes.subarray(lines[from - 1].start, lines[to - 1].end).toString('utf8');
  return { path: relativePath, from, to, totalLines: lines.length, markdown,
    sourceHash: createHash('sha256').update(bytes).digest('hex'), tokens: estimateTokens(markdown) };
}

// 2026-11-05: discard workflow boilerplate before comparing words, so generic acceptance lines do not rank rules.
const stopWords = new Set(('этот этого этой этих есть если когда который которая которые чтобы после перед ' +
  'будет будут было были быть только можно нужно надо пока один одна одно свои своим свое своё всех весь ' +
  'каждый каждого также либо между через потому работа готово видно тест тесты кадр глаза ' +
  'claude codex круг время потом ниже выше сначала вместо более очень').split(' '));
for (const word of cardStateMarkWords()) stopWords.add(word);

const openQuestionTitles = markerWords('openQuestions');
const sameTitle = (left: string, right: string) => left.trim().toLocaleLowerCase('ru-RU') === right.toLocaleLowerCase('ru-RU');
const isOpenQuestionTitle = (title: string) => openQuestionTitles.some(candidate => sameTitle(title, candidate));
// 2026-11-09: record-decision writes the project's own spelling (`## Decided` in English projects); matching only
// the Russian marker alone dropped every English answer from the brief before 0.6.0.
const decidedTitles = markerWords('decided');
const isDecidedTitle = (title: string) => decidedTitles.some(candidate => sameTitle(title, candidate));
const isQuestionSectionTitle = (title: string) => isOpenQuestionTitle(title) || isDecidedTitle(title);
const isSignificantSection = (title: string) => isQuestionSectionTitle(title) || /^(Что есть|Как сделано)/iu.test(title);

function wordKey(word: string): string {
  const normalized = word.toLowerCase().replaceAll('ё', 'е');
  // Conservative suffix folding connects inflections without adding semantic synonyms or a language package.
  if (/^[а-я]+$/u.test(normalized)) {
    const stem = normalized.replace(/(?:иями|ями|ами|ого|ему|ому|ыми|ими|ией|иям|иях|ов|ев|ам|ям|ах|ях|ом|ем|ой|ый|ий|ая|яя|ое|ее|ую|юю|ые|ие|а|я|ы|и|у|ю|е|о)$/u, '');
    if (stem.length >= 3) return stem;
  }
  return normalized;
}

function contextWords(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[\p{L}][\p{L}\p{N}_]*/gu) ?? [])
    .filter(word => word.length > 3 && !stopWords.has(word)).map(wordKey));
}

function overlap(text: string, words: Set<string>): number {
  return [...contextWords(text)].filter(word => words.has(word)).length;
}

/** Pure selection; callers retain line numbers and the complete section as a read-next reference. */
export function selectContextLines(lines: SourceLine[], topic: string, options: { code?: boolean; limit?: number } = {}): SelectedLine[] {
  const words = contextWords(topic);
  const identifiers = [...topic.matchAll(/`([^`\r\n]+)`/gu)].map(match => match[1].toLowerCase());
  return lines.filter(line => line.text.trim() && !/^\s*#/u.test(line.text) && !/\*\*(?:отменено|заменено)(?=\s)/iu.test(line.text)).map(line => {
    const shared = overlap(line.text, words);
    const codeMatch = options.code && identifiers.some(identifier => line.text.toLowerCase().includes(identifier));
    const density = Math.sqrt(Math.max(1, contextWords(line.text).size / 20));
    return { ...line, score: (shared + (codeMatch ? 3 : 0)) / density, eligible: shared >= 2 || codeMatch };
  }).filter(line => line.eligible).sort((first, second) => second.score - first.score || first.line - second.line)
    .slice(0, Math.min(5, options.limit ?? 5)).map(({ eligible, ...line }) => line);
}

function sectionsOf(lines: SourceLine[]): ContextSection[] {
  const root = markdownParser.parse(lines.map(line => line.text).join('\n'));
  const headings = root.children.filter(isCardSectionBoundary).map(node => {
    const line = lines[node.position!.start.line - 1];
    return { ...line, text: line.text.replace(/^\uFEFF/u, '').replace(/^#{1,4}\s+/u, '')
      .replace(/[\s#*_]+$/u, '').replace(/^[*_]+/u, '') };
  });
  const sections: ContextSection[] = [];
  if (!headings.length || headings[0].line > 1) {
    sections.push({ title: 'Introduction', from: 1, to: (headings[0]?.line ?? lines.length + 1) - 1, lines: [] });
  }
  for (const [index, heading] of headings.entries()) {
    sections.push({ title: heading.text, from: heading.line,
      to: (headings[index + 1]?.line ?? lines.length + 1) - 1, lines: [] });
  }
  return sections.map(section => ({ ...section, lines: lines.slice(section.from - 1, section.to) }));
}

function excerpt(text: string, maximum = 220): string {
  const line = text.trim().replace(/\s+/gu, ' ');
  if (line.length <= maximum) return line;
  const prefix = line.slice(0, maximum - 2);
  const boundary = prefix.lastIndexOf(' ');
  return prefix.slice(0, boundary > maximum / 2 ? boundary : prefix.length) + ' …';
}

async function cardRange(root: string, card: CatalogCard, bytes: Buffer): Promise<ByteRange> {
  if (createHash('sha256').update(bytes).digest('hex') !== card.sourceHash) {
    throw new RangeError('The card file changed after the catalog was read. Repeat brief.');
  }
  if (card.range) return card.range;
  if (card.id.startsWith('card:')) {
    const native = await readNativeCard(root, card.id);
    if (!native || native.fileHash !== card.sourceHash) throw new RangeError('The card file has changed. Repeat brief.');
    return native.bodyRange;
  }
  if (card.id.startsWith('hero:')) {
    const hero = readHeroSections(parseDocument(card.path, bytes)).find(section => section.id === card.id);
    if (!hero) throw new RangeError('The Hero is missing from the current file.');
    return hero.introRange;
  }
  return { start: 0, end: bytes.length };
}

function cardLabel(card: CatalogCard): string {
  return `${shortReference('c', card.id)} ${card.version ? card.version + ' ' : ''}${card.title} (${card.state ?? card.kind})`;
}

function relatedCards(catalog: CatalogView, card: CatalogCard, parent: CatalogCard | undefined): CatalogCard[] {
  const literalWords = (card.title.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => word.length > 3 && !stopWords.has(word));
  const titleWords = contextWords(card.title + ' ' + (parent?.title ?? ''));
  const bodyWords = contextWords(card.markdown);
  const candidates = catalog.cards.filter(candidate => candidate.path !== card.path && !candidate.archived && !candidate.deleted);
  const literalMatches = candidates.filter(candidate => {
    const words = new Set((candidate.title + ' ' + candidate.markdown).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
    return literalWords.length > 0 && literalWords.every(word => words.has(word));
  });
  return (literalMatches.length ? literalMatches : candidates)
    .map(candidate => {
      const candidateWords = contextWords(candidate.title + ' ' + candidate.markdown);
      const titleScore = [...titleWords].filter(word => candidateWords.has(word)).length;
      const bodyScore = [...bodyWords].filter(word => candidateWords.has(word)).length;
      // A long document repeats many unrelated terms; a focused slice is the useful cross-file reference.
      const specificity = Math.sqrt(Math.max(1, candidateWords.size / 35));
      return { card: candidate, score: (titleScore * 3 + Math.min(bodyScore, 12)) / specificity,
        matches: titleScore + bodyScore };
    }).filter(candidate => candidate.matches > 0)
    .sort((first, second) => second.score - first.score || first.card.id.localeCompare(second.card.id))
    .slice(0, 3).map(candidate => candidate.card);
}

function nextReference(relativePath: string, bytes: Buffer, from: number, to: number, title: string): ReadNext {
  const lines = sourceLines(bytes);
  return { path: relativePath, from, to, title,
    tokens: estimateTokens(bytes.subarray(lines[from - 1].start, lines[to - 1].end).toString('utf8')) };
}

function omittedSource(relativePath: string, bytes: Buffer, sections: ContextSection[], included: { from: number; to: number } | null): ReadNext[] {
  const result: ReadNext[] = [];
  const significant = isSignificantSection;
  for (const section of sections) {
    const spans = [{ from: section.from, to: section.to }];
    if (included && included.from <= section.to && included.to >= section.from) {
      spans.splice(0, 1, { from: section.from, to: included.from - 1 }, { from: included.to + 1, to: section.to });
    }
    for (const span of spans.filter(span => span.from <= span.to && span.from >= section.from && span.to <= section.to)) {
      const previous = result.at(-1);
      if (previous && previous.to + 1 === span.from && !significant(section.title) && !significant(previous.title)) {
        const title = previous.title.includes(' / ') ? previous.title : previous.title + ' / …';
        result[result.length - 1] = nextReference(relativePath, bytes, previous.from, span.to, title);
      } else result.push(nextReference(relativePath, bytes, span.from, span.to, section.title));
    }
  }
  return result;
}

function readNextMarkdown(references: ReadNext[]): string {
  return '\n\n## Read next (full ranges, ≈ tokens)\n' + references.map(reference =>
    `- ${reference.path}:${reference.from}-${reference.to} ${reference.title} ≈${reference.tokens}`).join('\n');
}

interface BriefSupplement { title: string; source: string; lines: string[]; shown: number; clipped: boolean; truncationMarker?: string }
interface ReportBlock { start: number; end: number; markdown: string }

function reportBlocks(markdown: string): ReportBlock[] {
  const bomLength = markdown.startsWith('\uFEFF') ? 1 : 0;
  const nodes = (markdownParser.parse(markdown.slice(bomLength)) as Root).children;
  return nodes.flatMap((node, index) => {
    if (cardReportAuthor(node) === null) return [];
    const start = bomLength + node.position!.start.offset!;
    const next = nodes.slice(index + 1).find(candidate => candidate.type === 'heading' && candidate.depth <= 4);
    const end = next ? bomLength + next.position!.start.offset! : markdown.length;
    return [{ start, end, markdown: markdown.slice(start, end) }];
  });
}

function withoutReports(body: string, reports: ReportBlock[]): string {
  let result = body;
  for (const report of [...reports].reverse()) result = result.slice(0, report.start) + result.slice(report.end);
  return result;
}

function sourceReference(references: ReadNext[], relativePath: string, bytes: Buffer, from: number, to: number, title: string): string {
  if (!references.some(reference => reference.path === relativePath && reference.from <= from && reference.to >= to)) {
    references.push(nextReference(relativePath, bytes, from, to, title));
  }
  return `${relativePath}:${from}-${to}`;
}

async function briefSupplements(catalog: CatalogView, root: string, card: CatalogCard, bytes: Buffer,
  range: ByteRange, body: string, reports: ReportBlock[], readNext: ReadNext[]): Promise<BriefSupplement[]> {
  const supplements: BriefSupplement[] = [];
  const latest = reports.at(-1);
  if (latest) {
    const first = reports[0];
    const location = sourceLineRange(bytes, { start: range.start + Buffer.byteLength(body.slice(0, first.start)),
      end: range.start + Buffer.byteLength(body.slice(0, latest.end)) });
    const source = sourceReference(readNext, card.path, bytes, location.from, location.to, 'All reports');
    const lines = latest.markdown.trimEnd().split(/\r?\n/u);
    supplements.push({ title: 'Report', source, lines: lines.slice(0, 10), shown: 0, clipped: lines.length > 10 || reports.length > 1 });
  }
  const questions = card.openQuestions ?? [];
  const pending = (card.decisions ?? []).filter(decision => decision.applied === null);
  if (questions.length || pending.length) {
    const ref = shortReference('c', card.id);
    const lines = [
      ...questions.map((question, index) => `Ask ${ref}#${index + 1} · @${question.assignee ?? 'unassigned'} · target ${question.target ?? ref} · ${question.text}`),
      ...pending.map(decision => `Apply #${decision.index} · ${decision.question ? decision.question + ' → ' : ''}${decision.answer} — ${decision.by} · target ${decision.target ?? ref}`),
    ];
    const sources: string[] = [];
    for (const section of sectionsOf(sourceLines(bytes)).filter(section => isQuestionSectionTitle(section.title))) {
      sources.push(sourceReference(readNext, card.path, bytes, section.from, section.to, section.title));
    }
    supplements.push({ title: 'Agent questions', source: sources.join(' · ') || card.path, lines, shown: 0, clipped: false });
  }
  if (card.journey) {
    const journey = catalog.journeys?.find(candidate => candidate.id === card.journey!.journeyId);
    const step = journey?.steps.find(candidate => candidate.id === card.journey!.stepId);
    if (journey && step) {
      const stepPath = `${journey.path.slice(0, journey.path.lastIndexOf('/'))}/steps/${step.id}.md`;
      const file = await readManagedMarkdown(root, stepPath);
      const document = catalog.documents.find(candidate => candidate.path === stepPath);
      if (!file || (document && file.fileHash !== document.hash)) throw new RangeError('The Journey step has changed. Repeat brief.');
      const stepBytes = await readProjectMarkdown(root, stepPath);
      if (createHash('sha256').update(stepBytes).digest('hex') !== file.fileHash) throw new RangeError('The Journey step has changed. Repeat brief.');
      const location = sourceLineRange(stepBytes, file.bodyRange);
      const source = sourceReference(readNext, stepPath, stepBytes, location.from, location.to, 'Whole Journey step');
      const version = `Template v${journey.version}; card from v${card.journey.version}.`;
      supplements.push({ title: 'Journey step', source: `${source} · ${version}`,
        lines: file.markdown.trimEnd().split(/\r?\n/u), shown: 0, clipped: false });
    } else {
      supplements.push({ title: 'Journey step', source: `${card.journey.journeyId} / ${card.journey.stepId}`,
        lines: ['The step instruction is missing from the current Journey.'], shown: 0, clipped: true });
    }
  }
  return supplements;
}

async function returnFeedbackSupplement(root: string, feedback: NonNullable<AgentHistory['latestReturn']>, readNext: ReadNext[]): Promise<BriefSupplement> {
  const { event, transition } = feedback;
  const text = serverText(messages);
  const relativePath = activityEventPath(event);
  const bytes = await readProjectMarkdown(root, relativePath);
  const source = sourceReference(readNext, relativePath, bytes, 1, sourceLines(bytes).length, text.returnFeedback);
  const actor = typeof event.actorMemberId === 'string' && event.actorMemberId ? event.actorMemberId : text.unknownActor;
  return { title: text.returnFeedback,
    source: `${event.at} · ${text.actor(actor)} · ${transition.from} → ${transition.to ?? '—'}\n${source}`,
    lines: [text.reason(transition.reason)], shown: 0, clipped: false, truncationMarker: text.feedbackTruncated };
}

function supplementMarkdown(supplements: BriefSupplement[]): string {
  return supplements.map(supplement => `\n\n## ${supplement.title}\n${supplement.source}\n`
    + supplement.lines.slice(0, supplement.shown).join('\n')
    + (supplement.clipped || supplement.shown < supplement.lines.length ? '\n' + (supplement.truncationMarker ?? '…') : '')).join('');
}

/** A pure read of primary files; no catalog housekeeping or agent checkpoint is allowed here. */
export async function buildBrief(catalog: CatalogView, root: string, card: CatalogCard, options: { budget?: number } = {}): Promise<AgentBrief> {
  const budget = options.budget ?? 1500;
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > 100000) throw new RangeError('--budget must be an integer from 1 to 100000.');
  const bytes = await readProjectMarkdown(root, card.path);
  const range = await cardRange(root, card, bytes);
  const historyPromise = readAgentHistory(root, card);
  const location = sourceLineRange(bytes, range);
  const lines = sourceLines(bytes);
  const sections = sectionsOf(lines);
  const parent = catalog.cards.find(candidate => candidate.id === card.parentId);
  const deck = catalog.decks.find(candidate => candidate.id === card.deckId);
  const children = catalog.cards.filter(candidate => candidate.parentId === card.id && !candidate.deleted);
  const family = catalog.cards.filter(candidate => candidate.parentId === card.parentId && candidate.path === card.path && candidate.kind === 'task');
  const position = family.findIndex(candidate => candidate.id === card.id);
  const neighbors = position < 0 ? [] : [family[position - 1], family[position + 1]].filter((candidate): candidate is CatalogCard => Boolean(candidate));
  const related = relatedCards(catalog, card, parent);
  const topic = card.title + '\n' + card.markdown;
  const nativeOrSlice = card.id.startsWith('card:') || card.id.startsWith('task:') || card.id.startsWith('hero:');
  const fullBody = bytes.subarray(range.start, range.end).toString('utf8');
  const reports = reportBlocks(fullBody);
  const body = nativeOrSlice ? withoutReports(fullBody, reports) : '';
  const readNext = omittedSource(card.path, bytes, sections, nativeOrSlice && fullBody ? location : null);
  const supplements = await briefSupplements(catalog, root, card, bytes, range, fullBody, reports, readNext);
  const history = await historyPromise;
  if (history.sourceHash !== card.sourceHash) throw new RangeError('The card file changed during brief. Repeat the request.');
  if (history.latestReturn) supplements.unshift(await returnFeedbackSupplement(root, history.latestReturn, readNext));
  const metadata = [
    `# ${shortReference('c', card.id)} · ${card.version ? card.version + ' ' : ''}${card.title}`,
    `File ${card.path}:${location.from}-${location.to} · sourceHash ${card.sourceHash}`,
    `State ${card.state ?? '—'} · owner ${card.owner ?? '—'} · due ${card.dueDate ?? '—'} · iteration ${card.iteration ?? '—'}`,
    `Deck ${deck ? deck.title + ' (' + deck.id + ')' : '—'} · Hero ${parent ? cardLabel(parent) : '—'}`,
  ];
  if (neighbors.length) metadata.push('Neighbors: ' + neighbors.map(cardLabel).join(' · '));
  metadata.push('Dependencies: ' + ((card.dependsOn?.length ?? 0) ? card.dependsOn!.map(id => {
    const dependency = catalog.cards.find(candidate => candidate.id === id);
    return dependency ? cardLabel(dependency) : id + ' (not found)';
  }).join(' · ') : 'none recorded' + (card.id.startsWith('task:') ? ' (legacy; see the text below)' : '')));
  if (card.tags?.length) metadata.push('Tags: ' + card.tags.join(', '));
  const emptyBody = nativeOrSlice ? '(empty body)\n' : '(a document: read the full ranges under Read next)\n';
  let content = metadata.join('\n') + '\n\n## Card (verbatim)\n' + (body || emptyBody);
  if (children.length) content += '\n## Subcards\n' + children.map(cardLabel).join('\n');
  const additions: string[] = [];
  for (const candidate of related) {
    const relatedBytes = await readProjectMarkdown(root, candidate.path);
    const candidateRange = await cardRange(root, candidate, relatedBytes);
    const relatedLocation = sourceLineRange(relatedBytes, candidateRange);
    const candidateLines = sourceLines(relatedBytes).filter(line => line.end > candidateRange.start && line.start < candidateRange.end);
    const hit = selectContextLines(candidateLines, topic, { limit: 1 })[0]
      ?? candidateLines.find(line => overlap(line.text, contextWords(card.title)) > 0);
    additions.push(`\nRelated: ${candidate.path}:${relatedLocation.from}-${relatedLocation.to} ${cardLabel(candidate)}${hit ? ' — ' + excerpt(hit.text, 150) : ''}`);
    readNext.push(nextReference(candidate.path, relatedBytes, relatedLocation.from, relatedLocation.to, candidate.title));
  }
  for (const neighbor of neighbors.filter(candidate => candidate.state === 'done' && candidate.range)) {
    const resultLine = lines.filter(line => line.start >= neighbor.range!.start && line.end <= neighbor.range!.end)
      .find(line => /^-\s+\*\*(?:Сделано|Принято)/iu.test(line.text) && /`[^`]+`/u.test(line.text));
    if (resultLine) additions.push(`\nCode from neighbor ${neighbor.version} (${neighbor.state}) · ${card.path}:${resultLine.line}: ${excerpt(resultLine.text)}`);
  }
  const selected = sections.filter(section => isSignificantSection(section.title)).map(section => ({
    section, lines: selectContextLines(section.lines, topic, { code: /^(Что есть|Как сделано)/iu.test(section.title) }),
  }));
  // 2026-11-05: round-robin keeps an open question from being crowded out by a long list of decisions.
  for (let rank = 0; rank < 5; rank += 1) {
    for (const selection of selected) {
      const line = selection.lines[rank];
      if (!line) continue;
      additions.push(`\n${selection.section.title} · ${card.path}:${line.line}: ${excerpt(line.text)}`);
    }
  }
  const events = history.events.map(event => `${event.at} ${excerpt(event.summary, 150)}`).join(' · ');
  const commits = history.git.commits.map(commit => commit.hash.slice(0, 8)).join(', ');
  const eventSection = `\n\n## Events\nJournal: ${history.totalEvents}; shown ${history.events.length}.${events ? ' ' + events : ''}\n` +
    `git log -3 -- ${card.path}: ${commits || history.git.status}.${history.warnings.length ? '\n' + history.warnings.join('\n') : ''}`;
  const tail = readNextMarkdown(readNext);
  const includedLines = new Map<string, number>();
  const selectionSummary = () => selected.map(selection => {
    const count = includedLines.get(selection.section.title) ?? 0;
    const omitted = selection.section.lines.filter(line => line.text.trim() && !/^#/u.test(line.text)).length - count;
    return `\n${selection.section.title}: selected ${count}, skipped ${omitted}; whole section ${card.path}:${selection.section.from}-${selection.section.to}.`;
  }).join('');
  const render = () => content + selectionSummary() + supplementMarkdown(supplements) + eventSection + tail;
  const minimum = estimateTokens(render());
  if (minimum > budget) throw new RangeError(`Budget ${budget} is too small for the verbatim card and its references; at least ${minimum} tokens are required.`);
  // 2026-11-05: reserve part of the available budget for new evidence, keeping the original rule selection first.
  const supplementBudget = minimum + Math.floor((budget - minimum) * 0.6);
  const maximumLines = Math.max(0, ...supplements.map(supplement => supplement.lines.length));
  for (let rank = 0; rank < maximumLines; rank += 1) {
    for (const supplement of supplements) {
      if (supplement.shown !== rank || rank >= supplement.lines.length) continue;
      supplement.shown += 1;
      if (estimateTokens(render()) > supplementBudget) supplement.shown -= 1;
    }
  }
  let skipped = 0;
  for (const addition of additions) {
    if (estimateTokens(content + addition + selectionSummary() + supplementMarkdown(supplements) + eventSection + tail) <= budget - 2) {
      content += addition;
      for (const selection of selected) {
        if (addition.startsWith('\n' + selection.section.title + ' · ')) includedLines.set(selection.section.title, (includedLines.get(selection.section.title) ?? 0) + 1);
      }
    } else skipped += 1;
  }
  const markdown = render();
  return { markdown, tokens: estimateTokens(markdown), truncated: readNext.length > 0 || skipped > 0
    || supplements.some(supplement => supplement.clipped || supplement.shown < supplement.lines.length)
    || history.totalEvents > history.events.length, readNext };
}
