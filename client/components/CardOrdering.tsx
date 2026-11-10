import * as Tooltip from '@radix-ui/react-tooltip';
import { defineText, locale, textNow, useLang, useText } from '../i18n.ts';
import { stateLabel } from '../locales/common.ts';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, CircleHelp, Globe, UserRound } from 'lucide-react';
import { useId, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { canBeSecondary, canCompact, type CardOrderKey, type CardOrdering as CardOrderingValue, type CardSortStep, type SortDirection, type TagScope } from '../catalog-ordering.ts';
import '../card-ordering.css';
import '../deck-panels.css';

const text = defineText({
  directionLabel: (label: string, descending: boolean) => `${label}: ${descending ? 'descending' : 'ascending'} order`,
  tagLabel: (label: string) => `Tags: ${label}`,
  moreLess: "More → less",
  lessMore: "Less → more",
  laterEarlier: "Later → earlier",
  earlierLater: "Earlier → later",
  learnMore: "Learn more",
  tagsHint: (label: string) => `Tags · ${label}. Cannot be a secondary order or use Compact.`,
  manualHint: "Manual · drag order and Deck zones, shared by everyone",
  ascending: "ascending",
  descending: "descending",
  flipHint: (label: string, direction: string) => `${label} · ${direction}. Click again to reverse.`,
  multiSortHint: "Adds secondary orders; Ctrl+click an order for the same effect",
  compactHint: "All cards in one lane",
  hideEmptyHint: "Hides empty zones in Manual order",
  resetHint: "Restore the default Deck order",
  saveHint: "Use this Deck order for anyone without a personal order",
  helpPrimary: "Click an order to make it the primary one",
  helpSecondary: "Ctrl+click (⌘ on Mac) adds a secondary order, like the Multi Sort switch",
  helpDefault: "Reset / Save manage this deck's default order",
  uiPriority: "Priority",
  uiHighLow: "High → low",
  uiLowHigh: "Low → high",
  uiEffort: "Effort",
  uiState: "State",
  uiRun: "Run",
  uiMilestone: "Milestone",
  uiProjectTags: "Project Tags",
  uiProjectPersonalTags: "Project & Personal Tags",
  uiPersonalTags: "Personal Tags",
  uiManual: "Manual",
  uiOwner: "Owner",
  uiLastUpdated: "Last updated",
  uiLastUpdatedFull: "Last updated",
  uiCreationDate: "Creation date",
  uiTitle: "Title",
  uiHeroCard: "Hero Card",
  uiDeck: "Deck",
  uiOrdering: "Ordering",
  uiTags: "Tags",
  uiMultiSort: "Multi Sort",
  uiCompact: "Compact",
  uiHideEmpty: "Hide empty",
  uiTable: "Table",
  uiDefaultView: "Default view",
  uiReset: "Reset",
  uiSave: "Save"
}, {
  directionLabel: (label: string, descending: boolean) => `${label}: ${descending ? 'по убыванию' : 'по возрастанию'}`,
  tagLabel: (label: string) => `Теги: ${label}`,
  moreLess: "Больше → меньше",
  lessMore: "Меньше → больше",
  laterEarlier: "Поздние → ранние",
  earlierLater: "Ранние → поздние",
  learnMore: "Подробнее",
  tagsHint: (label: string) => `Теги · ${label}. Не бывают вторичным порядком и не сворачиваются в компактный вид.`,
  manualHint: "Вручную · порядок перетаскиванием и зоны колоды, общий для всех",
  ascending: "по возрастанию",
  descending: "по убыванию",
  flipHint: (label: string, direction: string) => `${label} · ${direction}. Повторное нажатие меняет направление.`,
  multiSortHint: "Добавляет вторичные порядки; Ctrl+клик по кнопке порядка — то же без переключателя",
  compactHint: "Все карточки в одной полосе",
  hideEmptyHint: "Скрывает пустые зоны ручного порядка",
  resetHint: "Вернуть порядок колоды по умолчанию",
  saveHint: "Сделать этот порядок порядком колоды для всех, кто ещё не выбрал свой",
  helpPrimary: "Щелчок по порядку делает его основным",
  helpSecondary: "Ctrl+клик (⌘ на Mac) добавляет вторичный порядок — как переключатель мультисортировки",
  helpDefault: "Сбросить / Сохранить — порядок колоды по умолчанию",
  uiPriority: "Приоритет",
  uiHighLow: "Высокий → низкий",
  uiLowHigh: "Низкий → высокий",
  uiEffort: "Оценка",
  uiState: "Состояние",
  uiRun: "Run",
  uiMilestone: "Milestone",
  uiProjectTags: "Теги проекта",
  uiProjectPersonalTags: "Теги проекта и личные",
  uiPersonalTags: "Личные теги",
  uiManual: "Вручную",
  uiOwner: "Исполнитель",
  /* 2026-11-08: the one-tap button shows the short label to fit the 120 px column (audit DW-06); the full wording stays in its title. */
  uiLastUpdated: "Изменено",
  uiLastUpdatedFull: "Последнее изменение",
  uiCreationDate: "Дата создания",
  uiTitle: "Название",
  uiHeroCard: "Hero Card",
  uiDeck: "Колода",
  uiOrdering: "Порядок",
  uiTags: "Теги",
  uiMultiSort: "Мультисортировка",
  uiCompact: "Компактно",
  uiHideEmpty: "Скрыть пустые",
  uiTable: "Таблица",
  uiDefaultView: "Вид по умолчанию",
  uiReset: "Сбросить",
  uiSave: "Сохранить"
});


// Ordering panel:
// rows with two direction buttons, the Tags row, one-tap orders, switches, then the deck's Default View.


const tagScopes = [
  { scope: 'project', get label() { return textNow(text).uiProjectTags; }, content: <Globe size={16} aria-hidden="true" /> },
  { scope: 'both', get label() { return textNow(text).uiProjectPersonalTags; }, content: <span aria-hidden="true">&amp;</span> },
  { scope: 'personal', get label() { return textNow(text).uiPersonalTags; }, content: <UserRound size={16} aria-hidden="true" /> },
] as const satisfies readonly { scope: TagScope; label: string; content: ReactNode }[];

// One-tap orders: the first tap takes the natural direction; dates and Title flip on a repeat tap.
// Cards have no creator field or change-order definition, so neither is offered as an order.
// hintLabel is the full wording for the title when the visible label is shortened.
const oneTapOrders: readonly { key: CardOrderKey; label: string; hintLabel?: string; natural: SortDirection; flips: boolean }[] = [
  { key: 'manual', get label() { return textNow(text).uiManual; }, natural: 'asc', flips: false },
  { key: 'owner', get label() { return textNow(text).uiOwner; }, natural: 'asc', flips: false },
  { key: 'updated', get label() { return textNow(text).uiLastUpdated; }, get hintLabel() { return textNow(text).uiLastUpdatedFull; }, natural: 'desc', flips: true },
  { key: 'created', get label() { return textNow(text).uiCreationDate; }, natural: 'desc', flips: true },
  { key: 'title', get label() { return textNow(text).uiTitle; }, natural: 'asc', flips: true },
  { key: 'hero', get label() { return textNow(text).uiHeroCard; }, natural: 'asc', flips: false },
  { key: 'deck', get label() { return textNow(text).uiDeck; }, natural: 'asc', flips: false },
];

export interface DefaultViewControls { canReset: boolean; canSave: boolean; onReset: () => void; onSave: () => void }

// Shared 28×12 toggle for Ordering and New Card's "Create another card after this one".
export function Switch({ label, checked, disabled, hint, onChange }: { label: string; checked: boolean; disabled?: boolean; hint?: string; onChange: (checked: boolean) => void }) {
  const switchId = useId();
  // The label is part of the target: a click on the name flips the switch too.
  return <div className="deck-panel-switch-row" title={hint}>
    <label htmlFor={switchId}>{label}</label>
    <button type="button" role="switch" id={switchId} className="deck-panel-switch" aria-checked={checked} disabled={disabled}
      onClick={() => onChange(!checked)}><span /></button>
  </div>;
}

export function CardOrdering({ value, onChange, disabled = false, inDeck = false, hideEmpty = false, onHideEmpty, view, onViewChange, defaultView }: {
  value: CardOrderingValue;
  onChange: (value: CardOrderingValue) => void;
  disabled?: boolean;
  /** Inside one deck: Manual and Hide empty; outside: the Deck order. */
  inDeck?: boolean;
  hideEmpty?: boolean;
  onHideEmpty?: (hidden: boolean) => void;
  view?: 'cards' | 'table';
  onViewChange?: (view: 'cards' | 'table') => void;
  defaultView?: DefaultViewControls;
}) {
  const t = useText(text);
  const lang = useLang();
  const directionRows = [
    { key: 'priority', get label() { return textNow(text).uiPriority; }, descending: t.uiHighLow, ascending: t.uiLowHigh },
    { key: 'effort', get label() { return textNow(text).uiEffort; }, descending: t.moreLess, ascending: t.lessMore },
    { key: 'state', get label() { return textNow(text).uiState; }, descending: `${stateLabel('done', lang)} → ${stateLabel('discussing', lang).toLocaleLowerCase(locale(lang))}`, ascending: `${stateLabel('discussing', lang)} → ${stateLabel('done', lang).toLocaleLowerCase(locale(lang))}` },
    { key: 'run', get label() { return textNow(text).uiRun; }, descending: t.laterEarlier, ascending: t.earlierLater },
    { key: 'milestone', get label() { return textNow(text).uiMilestone; }, descending: t.laterEarlier, ascending: t.earlierLater },
  ] as const satisfies readonly { key: CardOrderKey; label: string; descending: string; ascending: string }[];
  const headingId = useId();
  const [multiSortMode, setMultiSortMode] = useState(false);
  const manual = value.order === 'manual';
  const multiSort = !manual && (multiSortMode || value.then.length > 0);

  function rankOf(step: CardSortStep): number | null {
    if (value.order === step.order && value.direction === step.direction) return 1;
    const index = value.then.findIndex(entry => entry.order === step.order && entry.direction === step.direction);
    return index < 0 ? null : index + 2;
  }

  // Multi Sort (switch or ctrl/cmd + click) ranks the clicked order below the others; repeating the same button removes it.
  function choose(step: CardSortStep, event: MouseEvent, tagScope?: TagScope) {
    const additive = (multiSort || event.ctrlKey || event.metaKey) && !manual && canBeSecondary(step.order) && step.order !== value.order;
    if (additive) {
      const index = value.then.findIndex(entry => entry.order === step.order);
      let then: CardSortStep[];
      if (index < 0) then = [...value.then, step];
      else if (value.then[index].direction === step.direction) then = value.then.filter((_, position) => position !== index);
      else then = value.then.map((entry, position) => position === index ? step : entry);
      if (event.ctrlKey || event.metaKey) setMultiSortMode(true);
      onChange({ ...value, then });
      return;
    }
    if (step.order === 'manual') setMultiSortMode(false);
    onChange({ ...value, order: step.order, direction: step.direction, tagScope: tagScope ?? value.tagScope,
      then: step.order === 'manual' ? [] : value.then.filter(entry => entry.order !== step.order) });
  }

  function rankBadge(rank: number | null) {
    return multiSort && rank !== null ? <span className="card-ordering-rank" aria-hidden="true">{new Intl.NumberFormat(locale(lang)).format(rank)}</span> : null;
  }

  return <section className="deck-panel card-ordering glass-panel" aria-labelledby={headingId}>
    <div className="card-ordering-heading panel-head">
      <h3 className="panel-title" id={headingId}>{t.uiOrdering}</h3>
      <Tooltip.Provider delayDuration={250}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button type="button" className="card-ordering-help control control-ghost" aria-label={t.learnMore}><CircleHelp size={16} aria-hidden="true" /></button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content className="card-ordering-help-card" side="bottom" align="end" sideOffset={6}>
              <p>{t.helpPrimary}</p>
              <p>{t.helpSecondary}</p>
              <p>{t.helpDefault}</p>
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>
    </div>
    <fieldset className="card-ordering-body" disabled={disabled}>
      <legend className="visually-hidden">{t.uiOrdering}</legend>
      <div className="card-ordering-blocks">
        <div className="card-ordering-rows">
          {directionRows.map(row => <div key={row.key} className="card-ordering-row">
            <span>{row.label}</span>
            <div className="card-ordering-pair" role="group" aria-label={row.label}>
              {(['desc', 'asc'] as const).map(direction => {
                const step = { order: row.key, direction };
                const rank = rankOf(step);
                const Icon = direction === 'desc' ? ArrowDownWideNarrow : ArrowUpNarrowWide;
                return <button key={direction} type="button" className="deck-panel-button control is-icon" aria-pressed={rank !== null}
                  aria-label={t.directionLabel(row.label, direction === 'desc')}
                  title={`${row.label} · ${direction === 'desc' ? row.descending : row.ascending}`}
                  onClick={event => choose(step, event)}><Icon size={16} aria-hidden="true" />{rankBadge(rank)}</button>;
              })}
            </div>
          </div>)}
          <div className="card-ordering-row">
            <span>{t.uiTags}</span>
            <div className="card-ordering-pair" role="group" aria-label={t.uiTags}>
              {tagScopes.map(entry => {
                const pressed = value.order === 'tags' && value.tagScope === entry.scope;
                return <button key={entry.scope} type="button" className={'deck-panel-button control is-icon' + (entry.scope === 'both' ? ' is-narrow' : '')} aria-pressed={pressed}
                  aria-label={t.tagLabel(entry.label)} title={t.tagsHint(entry.label)}
                  onClick={event => choose({ order: 'tags', direction: 'asc' }, event, entry.scope)}>{entry.content}{rankBadge(pressed ? 1 : null)}</button>;
              })}
            </div>
          </div>
        </div>
        <div className="card-ordering-list">
          {oneTapOrders.filter(order => order.key === 'manual' ? inDeck : order.key === 'deck' ? !inDeck : true).map(order => {
            const selected = value.order === order.key;
            const secondary = value.then.find(entry => entry.order === order.key);
            const current = selected ? value.direction : secondary?.direction;
            let next: SortDirection = order.natural;
            if (current) next = order.flips ? (current === 'asc' ? 'desc' : 'asc') : current;
            const shown = current ?? order.natural;
            const hintLabel = order.hintLabel ?? order.label;
            let hint: string = hintLabel;
            if (order.key === 'manual') hint = t.manualHint;
            else if (order.flips) hint = t.flipHint(hintLabel, shown === 'asc' ? t.ascending : t.descending);
            return <button key={order.key} type="button" className="deck-panel-button control is-wide" aria-pressed={selected || Boolean(secondary)} title={hint}
              onClick={event => choose({ order: order.key, direction: next }, event)}>
              <span>{order.label}</span>{rankBadge(selected ? 1 : secondary ? value.then.indexOf(secondary) + 2 : null)}
            </button>;
          })}
        </div>
        <div className="card-ordering-switches">
          <Switch label={t.uiMultiSort} checked={multiSort} disabled={manual} hint={t.multiSortHint}
            onChange={checked => { setMultiSortMode(checked); if (!checked && value.then.length) onChange({ ...value, then: [] }); }} />
          <Switch label={t.uiCompact} checked={value.compact && canCompact(value.order)} disabled={!canCompact(value.order)} hint={t.compactHint}
            onChange={checked => onChange({ ...value, compact: checked })} />
          {inDeck && onHideEmpty && <Switch label={t.uiHideEmpty} checked={hideEmpty} disabled={!manual} hint={t.hideEmptyHint} onChange={onHideEmpty} />}
          {view && onViewChange && <Switch label={t.uiTable} checked={view === 'table'} onChange={checked => onViewChange(checked ? 'table' : 'cards')} />}
        </div>
      </div>
      {defaultView && <div className="card-ordering-default" role="group" aria-label={t.uiDefaultView}>
        <span>{t.uiDefaultView}</span>
        <div>
          <button type="button" className="deck-panel-button control" disabled={!defaultView.canReset} title={t.resetHint} onClick={defaultView.onReset}>{t.uiReset}</button>
          <button type="button" className="deck-panel-button control" disabled={!defaultView.canSave} title={t.saveHint} onClick={defaultView.onSave}>{t.uiSave}</button>
        </div>
      </div>}
    </fieldset>
  </section>;
}
