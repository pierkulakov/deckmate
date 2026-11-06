import { useEffect, useId, useMemo, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { BookOpen, Crown, LayoutGrid, ListChecks, LoaderCircle, TriangleAlert, type LucideIcon } from 'lucide-react';
import { deckAcceptsCard, type CatalogCard, type CatalogDeck, type CatalogJourney, type DeckKind } from '../../src/catalog-contracts.ts';
import { deckTypeChangeIssue } from '../../src/deck-type-policy.ts';
import { Button } from './ui/button.tsx';
import '../deck-type-picker.css';
import { defineText, textNow, useLang, useText } from '../i18n.ts';

const text = defineText({
  asset: 'Asset Deck', task: 'Task Deck', knowledge: 'Knowledge', mixed: 'Mixed Deck',
  assetAccepts: 'Accepts Hero Cards', taskAccepts: 'Accepts Task Cards', knowledgeAccepts: 'Accepts Doc Cards', mixedAccepts: 'Accepts Hero, Task and Doc Cards',
  assetDescription: 'Hero Cards for the core parts of the project: characters, levels, features. Holds Journey templates that create repeatable Sub Cards.',
  taskDescription: 'Implementation work that brings Assets to life. One deck per discipline gives each team a focused backlog; Journey steps can target it.',
  knowledgeDescription: 'Standalone reference material: wikis, handbooks, meeting notes. Doc Cards stay documents without a task state.',
  mixedDescription: 'A flexible deck for any card kind, for workflows the Asset / Task split does not fit. Can hold Journeys and receive their steps.',
  sandboxOnly: 'The deck type can only be changed in sandbox.',
  catalogChanged: 'The catalog changed. Close and reopen the type picker.', saveFailed: 'Could not save the deck type.',
  notSaved: 'The type was not saved. Check the catalog message and try again.',
  saving: (label: string) => 'Saving type ' + label + '…', pending: 'The catalog is saving another change. Type selection will be available afterward.',
  type: (label: string) => 'Deck type: ' + label, change: ' · change', heading: 'Set deck type',
  examples: (names: string, rest: string) => 'For example: ' + names + rest + '.',
  remaining: (count: number) => ' and ' + new Intl.NumberFormat('en-US').format(count) + ' more',
  trash: ' · Trash', archive: ' · Archive',
}, {
  asset: 'Asset Deck', task: 'Task Deck', knowledge: 'Knowledge', mixed: 'Mixed Deck',
  assetAccepts: 'Принимает Hero Cards', taskAccepts: 'Принимает Task Cards', knowledgeAccepts: 'Принимает Doc Cards', mixedAccepts: 'Принимает Hero, Task и Doc Cards',
  assetDescription: 'Hero Cards для ключевых частей проекта: персонажи, уровни, фичи. Хранит шаблоны Journey, из которых создаются повторяемые Sub Cards.',
  taskDescription: 'Работа, которая воплощает Asset. Колода на направление даёт команде сфокусированный бэклог; шаги Journey могут приходить сюда.',
  knowledgeDescription: 'Самостоятельные справочные материалы: вики, руководства, заметки встреч. Doc Cards остаются документами без состояния задачи.',
  mixedDescription: 'Гибкая колода для любых карт — для процессов, где деления Asset / Task мало. Может хранить Journey и принимать их шаги.',
  sandboxOnly: 'Тип колоды меняется только в sandbox.',
  catalogChanged: 'Каталог изменился. Закройте и снова откройте выбор типа.', saveFailed: 'Не удалось сохранить тип колоды.',
  notSaved: 'Тип не сохранён. Проверьте сообщение каталога и повторите.',
  saving: (label: string) => 'Сохраняем тип ' + label + '…', pending: 'Каталог сохраняет другое изменение. Выбор станет доступен после него.',
  type: (label: string) => 'Тип колоды: ' + label, change: ' · изменить', heading: 'Выбрать тип колоды',
  examples: (names: string, rest: string) => 'Например: ' + names + rest + '.',
  remaining: (count: number) => ' и ещё ' + new Intl.NumberFormat('ru-RU').format(count),
  trash: ' · корзина', archive: ' · архив',
});

interface DeckTypeOption {
  kind: DeckKind;
  label: string;
  Icon: LucideIcon;
  description: string;
  accepts: string;
}

type DeckTypeError = { key: 'sandboxOnly' | 'catalogChanged' | 'saveFailed' | 'notSaved' } | { kind: DeckKind } | { message: string };

// Deck type tiles show accepted card kinds using the same rules as deckAcceptsCard.
function deckTypeOptions(t: typeof text.en): Record<DeckKind, DeckTypeOption> {
  return {
    asset: { kind: 'asset', label: t.asset, Icon: Crown, accepts: t.assetAccepts, description: t.assetDescription },
    task: { kind: 'task', label: t.task, Icon: ListChecks, accepts: t.taskAccepts, description: t.taskDescription },
    knowledge: { kind: 'knowledge', label: t.knowledge, Icon: BookOpen, accepts: t.knowledgeAccepts, description: t.knowledgeDescription },
    mixed: { kind: 'mixed', label: t.mixed, Icon: LayoutGrid, accepts: t.mixedAccepts, description: t.mixedDescription },
  };
}
const deckTypeOrder: DeckKind[] = ['asset', 'task', 'knowledge', 'mixed'];

export interface DeckTypePickerProps {
  deck: CatalogDeck;
  cards: CatalogCard[];
  journeys: CatalogJourney[];
  pending: boolean;
  writable: boolean;
  manifestHash: string;
  onChange: (kind: DeckKind, manifestHash: string) => Promise<boolean>;
}

/** Header control that shows the saved Deck Type and changes it only through onChange. */
export function DeckTypePicker({ deck, cards, journeys, pending, writable, manifestHash, onChange }: DeckTypePickerProps) {
  const t = useText(text);
  const lang = useLang();
  const options = deckTypeOptions(t);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<DeckKind | null>(null);
  const [error, setError] = useState<DeckTypeError | null>(null);
  const [shownDeck, setShownDeck] = useState({ id: deck.id, kind: deck.kind });
  const request = useRef(0);
  const baselineHash = useRef(manifestHash);
  const headingId = useId();
  const current = options[deck.kind];

  // Another deck or a refreshed type makes the open picker's message and any in-flight answer stale.
  if (shownDeck.id !== deck.id || shownDeck.kind !== deck.kind) {
    if (shownDeck.id !== deck.id) { setOpen(false); setSaving(null); }
    setShownDeck({ id: deck.id, kind: deck.kind });
    setError(null);
  }
  useEffect(() => () => { request.current += 1; }, [deck.id]);

  const issues = useMemo(() => new Map(deckTypeOrder.map((kind): [DeckKind, string | null] => [kind,
    kind === deck.kind ? null : deckTypeChangeIssue(deck.id, kind, cards, journeys)])), [deck.id, deck.kind, cards, journeys, lang]);
  let errorMessage = '';
  if (error && 'key' in error) errorMessage = t[error.key];
  else if (error && 'kind' in error) errorMessage = options[error.kind].label + ': ' + (issues.get(error.kind) ?? '');
  else if (error) errorMessage = error.message;

  function changeOpen(next: boolean) {
    // The answer of a running save must land in the open picker.
    if (!next && saving) return;
    if (next) baselineHash.current = manifestHash;
    setOpen(next);
    setError(null);
  }

  async function choose(option: DeckTypeOption) {
    if (saving || pending) return;
    if (option.kind === deck.kind) { setOpen(false); return; }
    if (!writable) { setError({ key: 'sandboxOnly' }); return; }
    if (baselineHash.current !== manifestHash) { setError({ key: 'catalogChanged' }); return; }
    const issue = issues.get(option.kind);
    if (issue) { setError({ kind: option.kind }); return; }
    request.current += 1;
    const requestId = request.current;
    setSaving(option.kind);
    setError(null);
    let saved = false;
    let failure: DeckTypeError | null = null;
    try { saved = await onChange(option.kind, baselineHash.current); }
    catch (reason) { failure = reason instanceof Error && reason.message ? { message: reason.message } : { key: 'saveFailed' }; }
    if (requestId !== request.current) return;
    setSaving(null);
    if (saved) { setOpen(false); return; }
    setError(failure ?? { key: 'notSaved' });
  }

  let status = '';
  if (saving) status = t.saving(options[saving].label);
  else if (pending && open) status = t.pending;

  return <DropdownMenu.Root open={open} onOpenChange={changeOpen}>
    <DropdownMenu.Trigger asChild>
      <Button type="button" variant="ghost" size="icon" className="deck-type-trigger" disabled={pending && !open}
        aria-label={t.type(current.label)} title={t.type(current.label) + (writable ? t.change : '')}>
        <current.Icon size={16} aria-hidden="true" />
      </Button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="deck-type-menu" align="start" sideOffset={8} collisionPadding={12} aria-labelledby={headingId} aria-busy={saving !== null}
        onEscapeKeyDown={event => { if (saving) event.preventDefault(); }}>
        <DropdownMenu.Label id={headingId} className="deck-type-heading">{t.heading}</DropdownMenu.Label>
        <DropdownMenu.RadioGroup className="deck-type-options" value={deck.kind}>
          {deckTypeOrder.map(kind => <DeckTypeTile key={kind} option={options[kind]} deckId={deck.id} cards={cards}
            issue={issues.get(kind) ?? null} saving={saving === kind}
            unavailable={kind !== deck.kind && (!writable || pending || saving !== null || Boolean(issues.get(kind)))}
            onChoose={() => void choose(options[kind])} />)}
        </DropdownMenu.RadioGroup>
        <p className="deck-type-status" role="status">{status}</p>
        {error && <p className="deck-type-error" role="alert">{errorMessage}</p>}
        {!writable && !(error && 'key' in error && error.key === 'sandboxOnly') && <p className="deck-type-note">{t.sandboxOnly}</p>}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}

function DeckTypeTile({ option, deckId, cards, issue, saving, unavailable, onChoose }: { option: DeckTypeOption; deckId: string; cards: CatalogCard[]; issue: string | null; saving: boolean; unavailable: boolean; onChoose: () => void }) {
  const id = useId();
  const examples = issue ? incompatibleExamples(deckId, option.kind, cards) : '';
  const describedBy = [id + '-description', id + '-accepts', issue ? id + '-issue' : ''].filter(Boolean).join(' ');
  // Blocked tiles stay focusable with aria-disabled, so keyboard and screen reader users reach the reason.
  return <DropdownMenu.RadioItem value={option.kind} textValue={option.label} className={'deck-type-option' + (issue ? ' is-blocked' : '')}
    aria-labelledby={id + '-title'} aria-describedby={describedBy} aria-disabled={unavailable || undefined}
    onSelect={event => { event.preventDefault(); onChoose(); }}>
    <span className="deck-type-option-heading">
      <span id={id + '-title'} className="deck-type-option-title">{option.label}<option.Icon size={16} aria-hidden="true" /></span>
      <span className="deck-type-radio" aria-hidden="true">{saving && <LoaderCircle size={13} className="spin" />}</span>
    </span>
    <span id={id + '-description'} className="deck-type-option-description">{option.description}</span>
    <span id={id + '-accepts'} className="deck-type-option-accepts">{option.accepts}</span>
    {issue && <span id={id + '-issue'} className="deck-type-option-issue"><TriangleAlert size={13} aria-hidden="true" /><span>{issue}{examples && ' ' + examples}</span></span>}
  </DropdownMenu.RadioItem>;
}

/** Names up to three cards that block the type, marking inactive ones; the count itself comes from the shared policy. */
function incompatibleExamples(deckId: string, kind: DeckKind, cards: CatalogCard[]): string {
  const t = textNow(text);
  const blocked = cards.filter(card => card.deckId === deckId && !deckAcceptsCard(kind, card.kind));
  if (blocked.length === 0) return '';
  const names = blocked.slice(0, 3).map(card => '«' + card.title + '»' + cardPlace(card));
  const rest = blocked.length > 3 ? t.remaining(blocked.length - 3) : '';
  return t.examples(names.join(', '), rest);
}

function cardPlace(card: CatalogCard): string {
  const t = textNow(text);
  if (card.deleted) return t.trash;
  if (card.archived) return t.archive;
  return '';
}
