import { useId, useMemo } from 'react';
import type { CatalogCard } from '../../src/catalog-contracts.ts';
import type { ProjectTag } from '../../src/project-tags.ts';
import { TagBadge } from './CardTags.tsx';
import { EmptyState } from './EmptyState.tsx';
import '../deck-panels.css';
import { defineText, locale, useLang, useText } from '../i18n.ts';

const text = defineText({
  heading: 'Tags', selectByTags: 'Display and select by tags', match: 'Tag match',
  empty: 'No tags on these cards yet. Assign tags in card properties.',
  noVisibleCards: 'No cards are shown, so there are no tags to pick.',
  allTags: 'Cards with all selected tags', anyTag: 'Cards with any selected tag',
  selectUntagged: 'Select cards without tags', notTagged: 'Not tagged',
  selectTag: (name: string) => `Select cards tagged #${name}`,
  purpose: 'Tag action', show: 'Show', select: 'Select', all: 'All', any: 'Any', reset: 'Reset',
  showUntagged: 'Show cards without tags', showTag: (name: string) => `Show cards tagged #${name}`,
  shown: (shown: string, total: string) => `Showing ${shown} of ${total}`,
  selected: (selected: string, total: string) => `Selected ${selected} · visible ${total}`,
}, {
  heading: 'Теги', selectByTags: 'Показ и выбор по тегам', match: 'Совпадение тегов',
  empty: 'Тегов на этих карточках пока нет. Назначайте теги в свойствах карточки.',
  noVisibleCards: 'Карточки не показаны, поэтому выбирать теги не из чего.',
  allTags: 'Карточки со всеми выбранными тегами', anyTag: 'Карточки с любым из выбранных тегов',
  selectUntagged: 'Выбрать карточки без тегов', notTagged: 'Без тегов',
  selectTag: (name: string) => `Выбрать карточки с тегом #${name}`,
  purpose: 'Действие с тегами', show: 'Показать', select: 'Выделить', all: 'Все', any: 'Любой', reset: 'Сбросить',
  showUntagged: 'Показать карточки без тегов', showTag: (name: string) => `Показать карточки с тегом #${name}`,
  shown: (shown: string, total: string) => `Показано ${shown} из ${total}`,
  selected: (selected: string, total: string) => `Выделено ${selected} · видно ${total}`,
});

/** Showing filters the deck; selection keeps the deck visible for bulk actions. */
export interface TagPick { tags: string[]; notTagged: boolean; mode: 'and' | 'or'; purpose?: 'show' | 'select' }

export const emptyTagPick: TagPick = { tags: [], notTagged: false, mode: 'and', purpose: 'show' };

function cardTags(card: CatalogCard): string[] {
  return (card.tags ?? []).filter(tag => tag.trim());
}

export function tagPickSize(pick: TagPick): number {
  return pick.tags.length + (pick.notTagged ? 1 : 0);
}

/** IDs of the shown cards the pick selects, in their shown order. */
export function cardsMatchingTagPick(cards: readonly CatalogCard[], pick: TagPick): string[] {
  if (tagPickSize(pick) === 0) return [];
  return cards.filter(card => {
    const tags = cardTags(card);
    const matches = [...pick.tags.map(tag => tags.includes(tag)), ...(pick.notTagged ? [tags.length === 0] : [])];
    return pick.mode === 'and' ? matches.every(Boolean) : matches.some(Boolean);
  }).map(card => card.id);
}

export function DeckTagsPanel({ cards, projectTags = [], pick, active, selectedCount, disabled = false, onPick }: {
  cards: readonly CatalogCard[];
  projectTags?: readonly ProjectTag[];
  pick: TagPick;
  /** The pick is still the current selection; any other selection change ends it. */
  active: boolean;
  selectedCount?: number;
  disabled?: boolean;
  onPick: (pick: TagPick) => void;
}) {
  const t = useText(text);
  const lang = useLang();
  const numberFormat = new Intl.NumberFormat(locale(lang));
  const headingId = useId();
  const purpose = pick.purpose ?? 'show';
  const current = active ? pick : { ...emptyTagPick, mode: pick.mode, purpose };
  const projectByName = useMemo(() => new Map(projectTags.map(tag => [tag.name, tag])), [projectTags]);
  // Registry tags lead; unregistered assignments stay available to the whole team.
  const rows = useMemo(() => {
    const tagCollator = new Intl.Collator(locale(lang), { numeric: true, sensitivity: 'base' });
    const counts = new Map<string, number>();
    let notTagged = 0;
    for (const card of cards) {
      const tags = cardTags(card);
      if (tags.length === 0) notTagged += 1;
      for (const tag of new Set(tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    const tags = [...counts].map(([name, count]) => ({ name, count, project: projectByName.get(name) }))
      .sort((first, second) => Number(Boolean(second.project)) - Number(Boolean(first.project)) || tagCollator.compare(first.name, second.name));
    return { notTagged, tags };
  }, [cards, projectByName, lang]);
  const combinable = tagPickSize(current) >= 2;
  const matchingCount = cardsMatchingTagPick(cards, current).length;
  const shownCount = tagPickSize(current) > 0 ? matchingCount : cards.length;
  const selectionCount = selectedCount ?? matchingCount;
  const canReset = tagPickSize(current) > 0 || (purpose === 'select' && selectionCount > 0);

  function toggleTag(name: string) {
    const tags = current.tags.includes(name) ? current.tags.filter(tag => tag !== name) : [...current.tags, name];
    onPick({ ...current, tags });
  }

  return <section className="deck-panel deck-tags-panel glass-panel" aria-labelledby={headingId}>
    <header className="panel-head"><h3 className="panel-title" id={headingId}>{t.heading}</h3><span className="panel-count page-number">{numberFormat.format(rows.tags.length)}</span></header>
    <fieldset className="deck-tags-body" disabled={disabled}>
      <legend className="visually-hidden">{t.selectByTags}</legend>
      <div className="deck-tags-purpose control-segmented" role="group" aria-label={t.purpose}>
        {(['show', 'select'] as const).map(value => <button key={value} type="button" aria-pressed={purpose === value}
          onClick={() => onPick({ ...current, purpose: value })}>{t[value]}</button>)}
      </div>
      <div className="deck-tags-modes" role="group" aria-label={t.match}>
        <span>{t.match}</span>
        {(['and', 'or'] as const).map(mode => <button key={mode} type="button" className="deck-panel-button control" disabled={!combinable}
          aria-pressed={current.mode === mode} title={mode === 'and' ? t.allTags : t.anyTag}
          onClick={() => onPick({ ...current, mode })}>{mode === 'and' ? t.all : t.any}</button>)}
      </div>
      <div className="deck-tags-list">
        {rows.tags.length === 0 && <EmptyState message={cards.length === 0 ? t.noVisibleCards : t.empty} />}
        <button type="button" className="deck-panel-button control is-wide deck-tag-row" aria-pressed={current.notTagged} disabled={rows.notTagged === 0}
          title={purpose === 'show' ? t.showUntagged : t.selectUntagged} onClick={() => onPick({ ...current, notTagged: !current.notTagged })}>
          <span className="deck-tag-name">{t.notTagged}</span><span className="deck-tag-count page-number">{numberFormat.format(rows.notTagged)}</span>
        </button>
        {rows.tags.map(tag => <button key={tag.name} type="button" className={'deck-panel-button control is-wide deck-tag-row' + (tag.project ? ' is-project' : '')}
          aria-pressed={current.tags.includes(tag.name)} title={purpose === 'show' ? t.showTag(tag.name) : t.selectTag(tag.name)} onClick={() => toggleTag(tag.name)}>
          <TagBadge name={tag.name} definition={tag.project} />
          <span className="deck-tag-count page-number">{numberFormat.format(tag.count)}</span>
        </button>)}
      </div>
      <div className="deck-tags-summary">
        <p role="status">{purpose === 'show' ? t.shown(numberFormat.format(shownCount), numberFormat.format(cards.length))
          : t.selected(numberFormat.format(selectionCount), numberFormat.format(cards.length))}</p>
        {canReset && <button type="button" className="deck-tags-reset deck-panel-button control control-ghost"
          onClick={() => onPick({ ...emptyTagPick, mode: current.mode, purpose })}>{t.reset}</button>}
      </div>
    </fieldset>
  </section>;
}
