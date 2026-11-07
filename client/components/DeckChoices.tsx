import type { CSSProperties } from 'react';
import { Layers } from 'lucide-react';
import { deckAcceptsCard, type CardKind, type CatalogDeck, type CatalogView } from '../../src/catalog-contracts.ts';
import type { DataSource } from '../../src/workspace-contracts.ts';
import { attachmentFileUrl } from '../attachments.ts';
import { cardIcons, cardKinds } from './CatalogCardTile.tsx';
import type { QuickSettingsChoice } from './QuickSettingsList.tsx';
import { defineText, textNow } from '../i18n.ts';

const text = defineText({ space: 'Space' }, { space: 'Пространство' });

const cardKindOrder: readonly CardKind[] = ['hero', 'task', 'doc'];

export function DeckThumb({ deck, source }: { deck: CatalogDeck | undefined; source: DataSource | undefined }) {
  const art = source && deck?.style === 'artwork' && deck.cover ? attachmentFileUrl(source, deck.cover) : null;
  return <span className={'deck-thumb' + (deck ? '' : ' is-empty')} style={deck ? { '--deck-color': deck.color } as CSSProperties : undefined} aria-hidden="true">
    {art ? <img src={art} alt="" style={{ objectPosition: `center ${deck?.coverPosition ?? 50}%` }} /> : !deck && <Layers size={12} />}
  </span>;
}

export function deckChoices(catalog: CatalogView, decks: readonly CatalogDeck[], source?: DataSource, projectName?: string, noneLabel?: string): QuickSettingsChoice[] {
  const t = textNow(text);
  const spaces = new Map(catalog.spaces.map(space => [space.id, space.title]));
  const order = [...spaces.keys(), ...new Set(decks.map(deck => deck.spaceId).filter(spaceId => !spaces.has(spaceId)))];
  const choices: QuickSettingsChoice[] = order.flatMap(spaceId => decks.filter(deck => deck.spaceId === spaceId).map(deck => ({
    key: deck.id, label: deck.title, search: deck.description,
    group: { key: spaceId, label: [projectName, spaces.get(spaceId) ?? t.space].filter(Boolean).join(' · ') },
    icon: <DeckThumb deck={deck} source={source} />,
    detail: cardKindOrder.filter(kind => deckAcceptsCard(deck.kind, kind)).map(kind => {
      const Icon = cardIcons[kind];
      return <Icon key={kind} size={16} className="deck-choice-kind" role="img" aria-label={cardKinds[kind]} />;
    }),
  })));
  if (noneLabel !== undefined) choices.push({ key: '', label: noneLabel, icon: <DeckThumb deck={undefined} source={source} /> });
  return choices;
}
