import * as Tooltip from '@radix-ui/react-tooltip';
import { ArrowUpRight } from 'lucide-react';
import { tagDecoration, tagIconDataUrl, type ProjectTag } from '../../src/project-tags.ts';
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
  missingCard: 'Карта не найдена',
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

function pieBackground(tags: readonly ProjectTag[]) {
  if (tags.length === 1) return tags[0].color;
  const step = 100 / tags.length;
  return `conic-gradient(${tags.map((tag, index) => `${tag.color} ${index * step}% ${(index + 1) * step}%`).join(', ')})`;
}

/** Color dot inside card buttons; it is not a tab stop because the card button carries the tag names. */
export function TagColorIndicator({ tags = [], definitions = [] }: { tags?: readonly string[]; definitions?: readonly ProjectTag[] }) {
  const t = useText(text);
  // Only color-decorated tags make the dot; emoji and icon tags show their glyph instead.
  const colored = resolveProjectTags(tags, definitions).filter(tag => tagDecoration(tag) === 'color');
  if (!colored.length) return null;
  return <Tooltip.Provider delayDuration={200}><Tooltip.Root><Tooltip.Trigger asChild>
    <span className="card-tag-pie" style={{ background: pieBackground(colored) }}
      aria-label={t.tagged(colored.map(tag => tag.name).join(', '))} />
  </Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="card-project-tags" side="top" sideOffset={6}>
    <span className="card-project-tags-title">{t.projectTags}</span>
    {colored.map(tag => <TagBadge key={tag.name} name={tag.name} definition={tag} />)}
  </Tooltip.Content></Tooltip.Portal></Tooltip.Root></Tooltip.Provider>;
}

export function CardTags({ tags = [], definitions = [], compact = false, maxVisible, cardsById, onOpenCard }: {
  tags?: readonly string[]; definitions?: readonly ProjectTag[]; compact?: boolean; maxVisible?: number;
  cardsById?: ReadonlyMap<string, { title: string }>; onOpenCard?: (cardId: string) => void;
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
      if (!definition?.cardId || !onOpenCard) return <TagBadge key={name} name={name} definition={definition} compact={compact} />;
      const cardId = definition.cardId;
      return <Tooltip.Root key={name}><Tooltip.Trigger asChild>
        <button type="button" className="tag-badge-link" aria-label={name} onClick={() => onOpenCard(cardId)}><TagBadge name={name} definition={definition} compact={compact} /></button>
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
