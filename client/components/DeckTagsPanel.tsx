import { useId, useMemo } from 'react';
import type { CatalogCard } from '../../src/catalog-contracts.ts';
import type { ProjectTag } from '../../src/project-tags.ts';
import { TagBadge } from './CardTags.tsx';
import '../deck-panels.css';
import { defineText, locale, useLang, useText } from '../i18n.ts';

const text = defineText({
  heading: 'Tags', selectByTags: 'Display and select by tags', match: 'Tag match',
  allTags: 'Cards with all selected tags', anyTag: 'Cards with any selected tag',
  selectUntagged: 'Select cards without tags', notTagged: 'Not tagged',
  selectTag: (name: string) => `Select cards tagged #${name}`,
}, {
  heading: 'Теги', selectByTags: 'Показ и выбор по тегам', match: 'Совпадение тегов',
  allTags: 'Карты со всеми выбранными тегами', anyTag: 'Карты с любым из выбранных тегов',
  selectUntagged: 'Выбрать карты без тегов', notTagged: 'Без тегов',
  selectTag: (name: string) => `Выбрать карты с тегом #${name}`,
});

/**
 * List tags of the shown cards with counts. Tag buttons select matching cards, combining tags with "and" or "or".
 * Selection keeps the whole deck visible so the bulk toolbar can act on the selected cards.
 */
export interface TagPick { tags: string[]; notTagged: boolean; mode: 'and' | 'or' }

export const emptyTagPick: TagPick = { tags: [], notTagged: false, mode: 'and' };

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

export function DeckTagsPanel({ cards, projectTags = [], pick, active, disabled = false, onPick }: {
  cards: readonly CatalogCard[];
  projectTags?: readonly ProjectTag[];
  pick: TagPick;
  /** The pick is still the current selection; any other selection change ends it. */
  active: boolean;
  disabled?: boolean;
  onPick: (pick: TagPick) => void;
}) {
  const t = useText(text);
  const lang = useLang();
  const numberFormat = new Intl.NumberFormat(locale(lang));
  const headingId = useId();
  const current = active ? pick : { ...emptyTagPick, mode: pick.mode };
  const projectByName = useMemo(() => new Map(projectTags.map(tag => [tag.name, tag])), [projectTags]);
  // Sort project tags first, then personal tags, alphabetically within each group.
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

  function toggleTag(name: string) {
    const tags = current.tags.includes(name) ? current.tags.filter(tag => tag !== name) : [...current.tags, name];
    onPick({ ...current, tags });
  }

  return <section className="deck-panel deck-tags-panel" aria-labelledby={headingId}>
    <h3 id={headingId}>{t.heading}</h3>
    <fieldset className="deck-tags-body" disabled={disabled}>
      <legend className="visually-hidden">{t.selectByTags}</legend>
      <div className="deck-tags-modes" role="group" aria-label={t.match}>
        {(['and', 'or'] as const).map(mode => <button key={mode} type="button" className="deck-panel-button" disabled={!combinable}
          aria-pressed={combinable && current.mode === mode} title={mode === 'and' ? t.allTags : t.anyTag}
          onClick={() => onPick({ ...current, mode })}>{mode}</button>)}
      </div>
      <div className="deck-tags-list">
        <button type="button" className="deck-panel-button is-wide deck-tag-row" aria-pressed={current.notTagged} disabled={rows.notTagged === 0}
          title={t.selectUntagged} onClick={() => onPick({ ...current, notTagged: !current.notTagged })}>
          <span className="deck-tag-name">{t.notTagged}</span><span className="deck-tag-count">{numberFormat.format(rows.notTagged)}</span>
        </button>
        {rows.tags.map(tag => <button key={tag.name} type="button" className={'deck-panel-button is-wide deck-tag-row' + (tag.project ? ' is-project' : '')}
          aria-pressed={current.tags.includes(tag.name)} title={t.selectTag(tag.name)} onClick={() => toggleTag(tag.name)}>
          <TagBadge name={tag.name} definition={tag.project} />
          <span className="deck-tag-count">{numberFormat.format(tag.count)}</span>
        </button>)}
      </div>
    </fieldset>
  </section>;
}
