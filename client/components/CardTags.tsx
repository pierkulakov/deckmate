import { Fragment, type CSSProperties } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ArrowUpRight } from 'lucide-react';
import { tagDecoration, tagIconDataUrl, type ProjectTag } from '../../src/project-tags.ts';
import { contrastRatio, rgbOf } from '../color-contrast.ts';
import { defineText, useText } from '../i18n.ts';
import '../card-tags.css';

const text = defineText({
  tags: 'Tags', projectTags: 'Project tags',
  tagged: (names: string) => `Tags: ${names}`,
  more: (count: number) => `${count} more tags`,
  missingCard: 'Card not found',
  projectTag: 'Project tag', outsideRegistry: 'Outside registry', tagCard: 'Tag card',
}, {
  tags: 'Теги', projectTags: 'Теги проекта',
  tagged: (names: string) => `Теги: ${names}`,
  more: (count: number) => `Ещё тегов: ${count}`,
  missingCard: 'Карточка не найдена',
  projectTag: 'Тег проекта', outsideRegistry: 'Вне реестра', tagCard: 'Карточка тега',
});

function TagGlyph({ tag }: { tag: ProjectTag }) {
  if (tag.emoji) return <span className="card-tag-emoji" aria-hidden="true">{tag.emoji}</span>;
  const icon = tagIconDataUrl(tag);
  return icon ? <img className="card-tag-icon" src={icon} alt="" aria-hidden="true" /> : null;
}

/** Only registry membership makes a project tag; synthetic picker entries remain outside the registry. */
export function TagBadge({ name, definition, compact = false }: { name: string; definition?: ProjectTag; compact?: boolean }) {
  const decoration = definition ? tagDecoration(definition) : 'none';
  const marked = definition && (decoration === 'emoji' || (decoration === 'icon' && tagIconDataUrl(definition)));
  const colored = definition && decoration === 'color';
  const colorStyle = colored ? {
    '--tag-glyph-background': definition.color,
    '--tag-color-ink': contrastRatio(rgbOf(definition.color), [255, 255, 255]) >= 4.5 ? 'var(--tag-foreground)' : 'var(--tag-color-dark-ink)',
  } as CSSProperties : undefined;
  return <span className={'tag-badge ' + (definition ? 'is-project' : 'is-personal') + (compact ? ' is-compact' : '')} title={name}>
    {marked && <span className="tag-badge-glyph"><TagGlyph tag={definition} /></span>}
    {colored && <span className="tag-badge-glyph is-color" style={colorStyle} aria-hidden="true">#</span>}
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

type TagCards = ReadonlyMap<string, { title: string }>;

function TagInfo({ name, definition, cardsById }: { name: string; definition?: ProjectTag; cardsById?: TagCards }) {
  const t = useText(text);
  const cardTitle = definition?.cardId && cardsById?.get(definition.cardId)?.title;
  return <span className="card-tag-info">
    <TagBadge name={name} definition={definition} />
    <span className="card-tag-type">{definition ? t.projectTag : t.outsideRegistry}</span>
    {definition?.cardId && <span className="card-tag-tooltip-card"><ArrowUpRight size={12} aria-hidden="true" />{cardTitle ?? (cardsById ? t.missingCard : t.tagCard)}</span>}
  </span>;
}

function ProjectTagList({ tags }: { tags: readonly ProjectTag[] }) {
  const t = useText(text);
  return <><span className="card-project-tags-title">{t.projectTags}</span>
    {tags.map(tag => <TagInfo key={tag.name} name={tag.name} definition={tag} />)}</>;
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
    <ProjectTagList tags={projectTags} />
  </Tooltip.Content></Tooltip.Portal></Tooltip.Root></Tooltip.Provider>;
}

function pieBackground(tags: readonly ProjectTag[]) {
  if (tags.length === 1) return tags[0].color;
  const step = 100 / tags.length;
  return `conic-gradient(${tags.map((tag, index) => `${tag.color} ${index * step}% ${(index + 1) * step}%`).join(', ')})`;
}

/** The dot is a sibling of the card opener so its tooltip is reachable without nesting focus targets. */
export function TagColorIndicator({ tags = [], definitions = [], disabled = false }: {
  tags?: readonly string[]; definitions?: readonly ProjectTag[]; disabled?: boolean;
}) {
  const t = useText(text);
  const projectTags = resolveProjectTags(tags, definitions);
  const colored = projectTags.filter(tag => tagDecoration(tag) === 'color');
  if (!colored.length) return null;
  return <Tooltip.Provider delayDuration={200} disableHoverableContent><Tooltip.Root><Tooltip.Trigger asChild>
    <span className="card-tag-pie" role="img" tabIndex={disabled ? -1 : 0} aria-disabled={disabled || undefined}
      style={{ '--tag-pie-background': pieBackground(colored) } as CSSProperties}
      aria-label={t.tagged(projectTags.map(tag => tag.name).join(', '))} />
  </Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="card-project-tags card-tag-pie-tooltip" side="right" align="start" sideOffset={6}>
    <ProjectTagList tags={projectTags} />
  </Tooltip.Content></Tooltip.Portal></Tooltip.Root></Tooltip.Provider>;
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
  const visible = maxVisible === undefined ? unique : unique.slice(0, Math.max(0, maxVisible));
  const hidden = unique.slice(visible.length);
  return <Tooltip.Provider delayDuration={200}><span className={'card-tags' + (maxVisible === undefined ? '' : ' is-bounded')} aria-label={t.tagged(unique.join(', '))}>
    {visible.map(name => {
      const definition = byName.get(name);
      const badge = <TagBadge name={name} definition={definition} compact={compact} />;
      const cardId = definition?.cardId;
      const onClick = cardId && onOpenCard ? () => onOpenCard(cardId) : onEditTags;
      if (!onClick) return <Fragment key={name}>{badge}</Fragment>;
      const button = <button key={name} type="button" className="tag-badge-link" aria-label={name} disabled={disabled} onClick={onClick}>{badge}</button>;
      return <Tooltip.Root key={name}><Tooltip.Trigger asChild>
        {button}
      </Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="card-tag-tooltip" side="top" sideOffset={6}>
        <TagInfo name={name} definition={definition} cardsById={cardsById} />
      </Tooltip.Content></Tooltip.Portal></Tooltip.Root>;
    })}
    {hidden.length > 0 && <DropdownMenu.Root modal={false}>
      <Tooltip.Root><Tooltip.Trigger asChild><DropdownMenu.Trigger asChild>
        <button type="button" className="tag-overflow" disabled={disabled} aria-label={t.more(hidden.length)}
          onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>+{hidden.length}</button>
      </DropdownMenu.Trigger></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="card-project-tags" side="top" sideOffset={6}>
        <span className="card-project-tags-title">{t.tags}</span>
        {hidden.map(name => <TagInfo key={name} name={name} definition={byName.get(name)} cardsById={cardsById} />)}
      </Tooltip.Content></Tooltip.Portal></Tooltip.Root>
      <DropdownMenu.Portal><DropdownMenu.Content className="card-tag-menu" aria-label={t.tags} sideOffset={6} align="start" collisionPadding={12}
        onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onEscapeKeyDown={event => event.stopPropagation()}>
        <DropdownMenu.Label className="card-project-tags-title">{t.tags}</DropdownMenu.Label>
        {hidden.map(name => {
          const definition = byName.get(name);
          const cardId = definition?.cardId;
          const activate = cardId && onOpenCard ? () => onOpenCard(cardId) : onEditTags;
          const content = <TagInfo name={name} definition={definition} cardsById={cardsById} />;
          if (activate) return <DropdownMenu.Item className="card-tag-menu-item" key={name} disabled={disabled} onSelect={activate}>{content}</DropdownMenu.Item>;
          const source = new URLSearchParams(typeof window === 'undefined' ? '' : window.location?.search ?? '').get('catalogSource') === 'live' ? 'live' : 'sandbox';
          const query = new URLSearchParams({ view: 'deck', scope: 'all', catalogSource: source, ...(cardId ? { card: cardId } : { tag: name }) });
          return <DropdownMenu.Item asChild key={name} disabled={disabled}><a className="card-tag-menu-item" href={'/?' + query}>{content}</a></DropdownMenu.Item>;
        })}
      </DropdownMenu.Content></DropdownMenu.Portal>
    </DropdownMenu.Root>}
  </span></Tooltip.Provider>;
}
