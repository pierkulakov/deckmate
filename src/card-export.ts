import type { CatalogCard, CatalogView } from './catalog-contracts.ts';
import type { DataSource } from './workspace-contracts.ts';
import { shortReference } from './references.ts';
import { defaultLang, defineText, type Lang } from './i18n.ts';

const text = defineText({
  noColumns: 'Choose at least one CSV column.',
  unknownColumn: (id: string) => `Unknown CSV column: ${id}`,
  missingContent: (id: string) => `Full Markdown is not loaded: ${id}`,
}, {
  noColumns: 'Выберите хотя бы один столбец CSV.',
  unknownColumn: (id: string) => `Неизвестный столбец CSV: ${id}`,
  missingContent: (id: string) => `Полный Markdown не загружен: ${id}`,
});

export const cardExportColumns = [
  { id: 'reference', label: 'Reference' }, { id: 'id', label: 'ID' }, { id: 'title', label: 'Title' },
  { id: 'kind', label: 'Type' }, { id: 'state', label: 'State' }, { id: 'deck', label: 'Deck' },
  { id: 'owner', label: 'Owner' }, { id: 'effort', label: 'Effort' }, { id: 'priority', label: 'Priority' },
  { id: 'tags', label: 'Tags' }, { id: 'run', label: 'Run' }, { id: 'milestone', label: 'Milestone' },
  { id: 'dueDate', label: 'Due date' }, { id: 'parent', label: 'Hero' }, { id: 'tracks', label: 'Tracks' },
  { id: 'hand', label: 'Hand' }, { id: 'bookmarked', label: 'Bookmarked' },
  { id: 'archived', label: 'Archived' }, { id: 'deleted', label: 'Deleted' },
  { id: 'path', label: 'Source path' }, { id: 'content', label: 'Markdown' },
] as const;
export type CardExportColumnId = typeof cardExportColumns[number]['id'];
export const defaultCardExportColumns: CardExportColumnId[] = ['reference', 'title', 'kind', 'state', 'deck', 'owner', 'effort', 'priority', 'tags', 'run', 'milestone', 'dueDate'];

interface CardExportOptions {
  catalog?: Pick<CatalogView, 'cards' | 'decks' | 'tracks' | 'members'>;
  contentById?: ReadonlyMap<string, string>;
  origin?: string;
  source?: DataSource;
}

/** 2026-11-03: spreadsheets may execute text after stripping whitespace/control prefixes. */
function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (/^[\s\u0000-\u001f\ufeff]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text)) text = "'" + text;
  return '"' + text.replace(/\r\n|\r|\n/gu, '\r\n').replace(/"/gu, '""') + '"';
}

/** Full Markdown is supplied separately; catalog excerpts must never masquerade as a complete export. */
export function exportCardsCsv(cards: readonly CatalogCard[], columns: readonly CardExportColumnId[], options: CardExportOptions = {}, lang: Lang = defaultLang): string {
  const selectedColumns = [...new Set(columns)];
  if (selectedColumns.length === 0) throw new Error(text[lang].noColumns);
  const definitions = selectedColumns.map(id => {
    const column = cardExportColumns.find(candidate => candidate.id === id);
    if (!column) throw new Error(text[lang].unknownColumn(id));
    return column;
  });
  const deckTitles = new Map(options.catalog?.decks.map(deck => [deck.id, deck.title]));
  const cardTitles = new Map(options.catalog?.cards.map(card => [card.id, card.title]));
  const trackTitles = new Map(options.catalog?.tracks.map(track => [track.id, track.title]));
  const memberLabels = new Map(options.catalog?.members?.map(member => [member.id, member.label]));
  function valueFor(card: CatalogCard, column: CardExportColumnId): unknown {
    switch (column) {
      case 'reference': {
        const reference = shortReference('c', card.id);
        return options.origin ? `${options.origin.replace(/\/$/u, '')}/r/${reference}?source=${options.source ?? 'sandbox'}` : reference;
      }
      case 'deck': return card.deckId ? deckTitles.get(card.deckId) ?? card.deckId : '';
      case 'parent': return card.parentId ? cardTitles.get(card.parentId) ?? card.parentId : '';
      case 'tracks': return card.trackIds.map(id => trackTitles.get(id) ?? id).join(', ');
      case 'hand': return (card.handMemberIds ?? []).map(id => memberLabels.get(id) ?? id).join(', ');
      case 'tags': return (card.tags ?? []).join(', ');
      case 'bookmarked': case 'archived': case 'deleted': return Boolean(card[column]);
      case 'content': {
        if (!options.contentById?.has(card.id)) throw new Error(text[lang].missingContent(card.id));
        return options.contentById.get(card.id);
      }
      default: return card[column];
    }
  }
  const uniqueCards = [...new Map(cards.map(card => [card.id, card])).values()];
  const rows = [definitions.map(column => csvCell(column.label)).join(';')];
  for (const card of uniqueCards) rows.push(selectedColumns.map(column => csvCell(valueFor(card, column))).join(';'));
  return '\ufeff' + rows.join('\r\n') + '\r\n';
}
