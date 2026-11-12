import { createHash } from 'node:crypto';
import type { Nodes } from 'mdast';
import type { ProjectCatalog } from '../src/catalog-contracts.ts';
import { markdownParser } from '../src/markdown-model.ts';
import { parseDecisionTarget } from '../src/open-questions.ts';
import { resolveReference } from '../src/references.ts';
import { sourceLineRange } from './agent-brief.ts';
import { cardSourceRange } from './card-content.ts';
import { defineText, serverLang, serverText } from './i18n.ts';
import { readProjectMarkdown } from './native-cards.ts';

const messages = defineText({
  invalid: 'The answer target must be a card reference with an optional heading fragment.',
  missing: 'The answer target card was not found.',
  section: 'The answer target section was not found.',
}, {
  invalid: 'Цель ответа — ссылка на карточку и, при необходимости, раздел.',
  missing: 'Карточка-цель ответа не найдена.',
  section: 'Раздел-цель ответа не найден.',
});

function headingText(node: Nodes): string {
  if ('value' in node) return node.value;
  if (node.type === 'image') return node.alt ?? '';
  return 'children' in node ? node.children.map(headingText).join('') : '';
}

export async function decisionTargetRange(root: string, catalog: Pick<ProjectCatalog, 'cards'>, target: string): Promise<string> {
  const destination = parseDecisionTarget(target);
  if (!destination) throw new Error(serverText(messages).invalid);
  const card = resolveReference(catalog.cards, 'c', destination.ref, serverLang());
  if (!card) throw new Error(serverText(messages).missing);
  const bytes = await readProjectMarkdown(root, card.path);
  if (createHash('sha256').update(bytes).digest('hex') !== card.sourceHash) throw new Error('CARD_CONFLICT');
  let range = cardSourceRange(card.id, bytes);
  if (destination.fragment !== null) {
    const markdown = bytes.subarray(range.start, range.end).toString('utf8');
    const headings = markdownParser.parse(markdown).children.filter(node => node.type === 'heading');
    const requested = decodeURIComponent(destination.fragment).toLocaleLowerCase('ru');
    const occurrences = new Map<string, number>();
    const heading = headings.find(node => {
      const title = headingText(node);
      const slug = title.trim().toLocaleLowerCase('ru').replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/gu, '-');
      const count = occurrences.get(slug) ?? 0;
      occurrences.set(slug, count + 1);
      const unique = count ? `${slug}-${count}` : slug;
      const number = /^\s*(\d+(?:\.\d+)*[a-z]?)(?:\s|[.—:-]|$)/iu.exec(title)?.[1].toLocaleLowerCase('ru');
      return unique === requested || number === requested || number?.replaceAll('.', '-') === requested;
    });
    if (!heading) throw new Error(serverText(messages).section);
    const following = headings.find(node => node.position!.start.offset! > heading.position!.start.offset! && node.depth <= heading.depth);
    const bom = markdown.startsWith('\uFEFF') ? 3 : 0;
    const offset = (at: number) => range.start + bom + Buffer.byteLength(markdown.replace(/^\uFEFF/u, '').slice(0, at));
    range = { start: offset(heading.position!.start.offset!), end: following ? offset(following.position!.start.offset!) : range.end };
  }
  const lines = sourceLineRange(bytes, range);
  return `${card.path}:${lines.from}-${lines.to}`;
}
