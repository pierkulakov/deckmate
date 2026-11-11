import { Fragment } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { ArrowUpRight } from 'lucide-react';
import { tagIconDataUrl, type ProjectTag } from '../../src/project-tags.ts';
import { defineText, useText } from '../i18n.ts';
import '../card-tags.css';

const text = defineText({
  tags: 'Tags', projectTags: 'Project tags',
  tagged: (names: string) => `Tags: ${names}`,
  more: (count: number) => `${count} more tags`,
  missingCard: 'Card not found',
}, {
  tags: 'Теги', projectTags: 'Теги проекта',
  tagged: (names: string) => `Теги: ${names}`,
  more: (count: number) => `Ещё тегов: ${count}`,
  missingCard: 'Карточка не найдена',
});

export function TagGlyph({ tag }: { tag: ProjectTag }) {
  if (tag.emoji) return <span className="card-tag-emoji" aria-hidden="true">{tag.emoji}</span>;
  const icon = tagIconDataUrl(tag);
  return icon ? <img className="card-tag-icon" src={icon} alt="" aria-hidden="true" /> : null;
}

/** 2026-11-05: only registry membership makes a project tag; synthetic picker entries remain personal hashtags. */
export function TagBadge({ name, definition, compact = false }: { name: string; definition?: ProjectTag; compact?: boolean }) {
  const marked = definition && (definition.emoji || tagIconDataUrl(definition));
  return <span className={'tag-badge ' + (definition ? 'is-project' : 'is-personal') + (compact ? ' is-compact' : '')} title={name}>
    {marked && <span className="tag-badge-glyph"><TagGlyph tag={definition} /></span>}
    <span className="tag-badge-name">{definition ? name : '#' + name}</span>
  </span>;
}

function resolveProjectTags(tags: readonly string[], definitions: readonly ProjectTag[]) {
  const byName = new Map(definitions.map(tag => [tag.name, tag]));
  return [...new Set(tags)].flatMap(name => { const tag = byName.get(name); return tag ? [tag] : []; });
}

function glyphTags(tags: readonly ProjectTag[]) {
  return tags.filter(tag => tag.emoji || tagIconDataUrl(tag));
}

/** Glyphs alone for places that already name the card, such as a Sub Card's Hero strip. */
export function TagGlyphs({ tags = [], definitions = [] }: { tags?: readonly string[]; definitions?: readonly ProjectTag[] }) {
  const marked = glyphTags(resolveProjectTags(tags, definitions));
  if (!marked.length) return null;
  return <span className="card-title-tags" aria-hidden="true">{marked.map(tag => <TagGlyph key={tag.name} tag={tag} />)}</span>;
}

export function TagTitlePrefix({ tags = [], definitions = [] }: { tags?: readonly string[]; definitions?: readonly ProjectTag[] }) {
  const t = useText(text);
  const projectTags = resolveProjectTags(tags, definitions);
  const marked = glyphTags(projectTags);
  if (!marked.length) return null;
  return <Tooltip.Provider delayDuration={200}><Tooltip.Root><Tooltip.Trigger asChild>
    <span className="card-title-tags" aria-label={t.tagged(marked.map(tag => tag.name).join(', '))}>
      {marked.map(tag => <TagGlyph key={tag.name} tag={tag} />)}
    </span>
  </Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="card-project-tags" side="top" align="start" sideOffset={6}>
    <span className="card-project-tags-title">{t.projectTags}</span>
    {projectTags.map(tag => <TagBadge key={tag.name} name={tag.name} definition={tag} />)}
  </Tooltip.Content></Tooltip.Portal></Tooltip.Root></Tooltip.Provider>;
}

/** One quiet line on a tile; the opener and the open card retain every tag name. */
export function CardTagSummary({ tags = [], definitions = [], sharedTags = [] }: { tags?: readonly string[]; definitions?: readonly ProjectTag[]; sharedTags?: readonly string[] }) {
  const t = useText(text);
  const names = [...new Set(tags)].filter(name => !sharedTags.includes(name));
  if (!names.length) return null;
  const first = names[0];
  const label = definitions.some(tag => tag.name === first) ? first : '#' + first;
  return <span className="card-tag-summary" title={t.tagged(names.join(', '))} aria-label={t.tagged(names.join(', '))}>
    <span>{label}</span>{names.length > 1 && <span className="tag-overflow" aria-label={t.more(names.length - 1)}>+{names.length - 1}</span>}
  </span>;
}

export function CardTags({ tags = [], definitions = [], compact = false, maxVisible, cardsById, onOpenCard, onEditTags, disabled = false }: {
  tags?: readonly string[]; definitions?: readonly ProjectTag[]; compact?: boolean; maxVisible?: number;
  cardsById?: ReadonlyMap<string, { title: string }>; onOpenCard?: (cardId: string) => void;
  onEditTags?: () => void; disabled?: boolean;
}) {
  const t = useText(text);
  if (!tags.length) return null;
  const byName = new Map(definitions.map(tag => [tag.name, tag]));
  const unique = [...new Set(tags)];
  const visible = maxVisible === undefined ? unique : unique.slice(0, maxVisible);
  const hiddenCount = unique.length - visible.length;
  return <Tooltip.Provider delayDuration={200}><span className={'card-tags' + (maxVisible === undefined ? '' : ' is-bounded')} aria-label={t.tagged(unique.join(', '))}>
    {visible.map(name => {
      const definition = byName.get(name);
      const badge = <TagBadge name={name} definition={definition} compact={compact} />;
      const cardId = definition?.cardId;
      const onClick = cardId && onOpenCard ? () => onOpenCard(cardId) : onEditTags;
      if (!onClick) return <Fragment key={name}>{badge}</Fragment>;
      const button = <button key={name} type="button" className="tag-badge-link" aria-label={name} disabled={disabled} onClick={onClick}>{badge}</button>;
      if (!cardId) return button;
      return <Tooltip.Root key={name}><Tooltip.Trigger asChild>
        {button}
      </Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="card-tag-tooltip" side="top" sideOffset={6}>
        <span>{name}</span><span className="card-tag-tooltip-card"><ArrowUpRight size={11} aria-hidden="true" />{cardsById?.get(cardId)?.title ?? t.missingCard}</span>
      </Tooltip.Content></Tooltip.Portal></Tooltip.Root>;
    })}
    {hiddenCount > 0 && <Tooltip.Root><Tooltip.Trigger asChild>
      <span className="tag-overflow" title={unique.join(', ')} aria-label={t.more(hiddenCount)}>+{hiddenCount}</span>
    </Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="card-project-tags" side="top" sideOffset={6}>
      <span className="card-project-tags-title">{t.tags}</span>
      {unique.map(name => <TagBadge key={name} name={name} definition={byName.get(name)} />)}
    </Tooltip.Content></Tooltip.Portal></Tooltip.Root>}
  </span></Tooltip.Provider>;
}
