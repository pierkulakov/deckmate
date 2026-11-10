import { readStoredValue } from '../storage.ts';
import { failureMessage } from '../failure-message.ts';
import { useCallback, useEffect, useId, useMemo, useRef, useState, Fragment, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type CollisionDetection, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ArrowDownUp, Check, Crown, Filter, Gauge, GripVertical, History as HistoryIcon, Layers, Link2, LoaderCircle, LockKeyhole, LockOpen, NotebookText, Plus, Search, X } from 'lucide-react';
import type { DeckActivityEvent } from '../../src/activity-contracts.ts';
import type { CatalogCard, CatalogMember, CatalogView } from '../../src/catalog-contracts.ts';
import { dependencyCycle, openDependencies, waitingCards, type CardHistoryCreated, type SetCardDependenciesEdit } from '../../src/dependency-contracts.ts';
import type { DataSource } from '../../src/workspace-contracts.ts';
import { orderSubCards } from '../catalog-lookups.ts';
import { cardOrdering, groupAndSortCards, laneOrderOf, type CardOrdering } from '../catalog-ordering.ts';
import { subCardStateLabel, subCardVisualState, subCardWeight } from '../sub-card-state.ts';
import type { CatalogAction } from '../useCatalog.ts';
import { Button } from './ui/button.tsx';
import { CardOwnerAvatar, CardQuickSettings, type CardQuickSettingsTab } from './CardQuickSettings.tsx';
import { CardFamilyComposer, type CreateFamilyCardAction } from './CardFamilyComposer.tsx';
import { DependencyStateBadge } from './DependencyWarning.tsx';
import { CardTags, TagGlyphs, TagTitlePrefix } from './CardTags.tsx';
import '../card-family.css';
import '../card-dependencies.css';
import '../card-history.css';
import { useCardLayoutMotion } from '../useCardLayoutMotion.ts';
import { defineText, locale, textNow, useLang, useText } from '../i18n.ts';
import { moveFocus } from '../focus.ts';
import { kindLabel, priorityLabel, stateLabel } from '../locales/common.ts';
import { runLabel } from '../run-label.ts';
import { CardValueHint } from './CardValueHint.tsx';
import { ActivityAttribution } from './ActivityAttribution.tsx';

/** One count label for the preview toggle and the family popover. Russian keeps the product term Sub Cards
 *  untranslated, as every other Russian string does, so the count goes after a colon instead of a declined noun. */
export const subCardsCount = {
  en: (count: number) => `${count} ${new Intl.PluralRules('en-US').select(count) === 'one' ? 'Sub Card' : 'Sub Cards'}`,
  ru: (count: number) => `Sub Cards: ${count}`,
};

const text = defineText({
  progress: (done: number, total: number) => `${done} of ${total} done`,
  openSubCard: (label: string) => `Open Sub Card: ${label}`,
  noPriority: 'No priority',
  gate: (incoming: number, outgoing: number, open: number) => `Dependencies: waiting on ${incoming}, waiting on this card ${outgoing}${open ? ` — ${open} open incoming` : ''}`,
  revealDependencies: '. Open dependencies section',
  legacyReadonly: 'Legacy card dependencies are stored in the project file — they are read-only here.',
  journeyReadonly: 'Journey sets this card’s dependencies — separate editing is unavailable.',
  sourceReadonly: 'This source is read-only.',
  cycle: (names: string) => `This dependency creates a cycle: ${names}.`,
  changeNotSaved: 'Change not saved — check the catalog message above.',
  saveDependenciesFailed: 'Could not save dependencies.',
  dependencies: (title: string) => `Dependencies: ${title}`,
  closeDependencies: 'Close dependencies section',
  waitsOn: 'Waiting on',
  removeDependency: (title: string) => `Remove dependency: ${title}`,
  removeDependencyHint: 'This card will stop waiting on that one',
  noIncoming: 'No incoming dependencies.',
  searchDependency: 'Search card for dependency',
  findCard: 'Find card',
  cancelAdd: 'Cancel adding',
  addCard: 'Add card',
  noResults: 'Nothing found.',
  waitedOnBy: 'Waiting on this card',
  removeWait: (title: string) => `Remove waiting: ${title}`,
  removeWaitHint: 'That card will stop waiting on this one',
  noOutgoing: 'No cards are waiting on this card.',
  historyLoad: (status: number) => `Could not load history (${status}).`,
  invalidHistory: 'The server returned an invalid history page.',
  serverUnavailable: 'Could not reach the server. Try again.',
  historyFailed: 'Could not load history.',
  retryHistory: 'Try again',
  closeHistory: 'Close history',
  noCreated: 'no creation entry in the journal',
  historyEmpty: 'This card’s history will start with its first change through Deckmate.',
  historyWarnings: (warnings: string) => `Journal warnings: ${warnings}`,
  loadingMore: 'Loading more…',
  loadingHistory: 'Loading history…',
  showMore: 'Show more',
  parentHero: 'A Hero Card cannot be a Sub Card',
  journeyLink: 'Link set by Journey',
  nestedFamilies: 'The card has Sub Cards: nested families are unavailable',
  createReason: 'Create new Sub Card · Shift+C',
  chooseFirst: 'First choose a Hero or Doc Card using Select',
  refreshFailed: 'Could not refresh the catalog. The order is already saved; try refreshing again.',
  listChanged: 'The list changed during the move. Repeat the reorder using current data.',
  orderNotSaved: 'Order not saved. The current list has been restored; try again.',
  orderFailed: 'Could not save the order. The reorder was cancelled.',
  emptyChoose: 'Choose a Hero or Doc Card using Select to open its Sub Cards.',
  emptyFiltered: 'No matches with these filters.',
  emptyCreate: 'Create a New Sub Card or attach an existing one using Attach.',
  panel: 'Hero Card and Sub Cards',
  closeParent: 'Close parent card picker',
  chooseParent: 'Choose Hero or Doc Card',
  removeParent: 'Remove the parent card link',
  hasOwnChildren: 'This card has its own Sub Cards.',
  noParentChosen: 'No parent card selected.',
  toggleComposer: 'Show or hide the Sub Card draft',
  showAll: 'Show all Sub Cards',
  onlyOpen: 'Only open Sub Cards',
  draftSaved: 'The draft is saved in this panel. Click New Sub Card to continue.',
  searchSubCards: 'Search Sub Cards',
  findSubCard: 'Find Sub Card',
  findSubCards: 'Find Sub Cards',
  newSubCard: 'New Sub Card',
  attachSubCards: 'Attach existing Sub Cards',
  changeOrder: 'Change order',
  onlyOpenShown: 'Only open cards shown',
  reorderFiltered: 'Turn off search and the filter to change the order.',
  reorderManual: 'Drag to reorder in Manual order.',
  orderSaved: 'Order saved. Refresh the catalog before the next reorder.',
  refreshingCatalog: 'Refreshing catalog…',
  refreshCatalog: 'Refresh catalog',
  dragInstructions: 'Press Space to lift a Sub Card. Up and down arrows change its position. Space finishes the move, Escape cancels it.',
  dragStart: (name: string) => `Lifted card “${name}”.`,
  dragOver: (name: string, position: number, total: number) => `Card “${name}”, position ${position} of ${total}.`,
  outsideList: 'Outside the list.',
  dragEnd: (name: string, position: number) => `Card “${name}” moved to position ${position}.`,
  dragCancel: 'Move cancelled.',
  deckUnavailable: 'Deck unavailable',
  noDeck: 'No deck',
  withoutDeckCount: (count: number) => `No deck: ${count}`,
  dependenciesTitle: 'Open card dependencies: waiting on / waiting on this card',
  dependenciesAction: 'Dependencies',
  historyTitle: 'Open card change history',
  moveSubCard: (title: string) => `Move Sub Card: ${title}`,
  reorderHint: 'Change order · Space and arrows',
  owner: (owner: string) => `Owner: ${owner}`,
  assignOwner: (title: string, owner: string) => `Assign Owner: ${title} · ${owner}`,
  notInRegistry: 'not in registry',
  waiting: 'waiting on:',
  journeyDetach: 'Link set by Journey: these Sub Cards cannot be detached separately.',
  detachHero: 'Detach from Hero; keep the card and its deck',
  detachFrom: (title: string) => `Detach from Hero: ${title}`,
  detachConfirm: (title: string) => `Confirm detaching ${title}`,
  detachMessage: (hero: string, deck: string | null) => `Detach from “${hero}”? The card will remain ${deck ? `in deck “${deck}”` : 'without a deck'}.`,
  cancel: 'Cancel',
  detach: 'Detach',
  taskProgress: (done: number, total: number) => `${done} of ${total} Task Sub Cards done`,
  acceptedCount: (count: number) => `${count} done`,
  parentStrip: (title: string) => `Hero ${title} · Sub Cards`,
  subCardsOf: (title: string) => `Sub Cards: ${title}`,
  noSubCards: 'No Sub Cards yet.',
  effort: 'Effort',
  priorityOf: (priority: string) => `Priority: ${priority}`,
  docCard: 'Doc Card',
  historyOf: (title: string) => `History: ${title}`,
  historyHeading: (title: string) => `History · ${title}`,
  created: 'Created',
  parentDoc: 'Parent Doc Card',
  heroCardHeading: 'Hero Card',
  change: 'Change',
  select: 'Select',
  remove: 'Remove',
  subCardsHeading: 'Sub Cards',
  orderMenu: 'Order Sub Cards',
  historyAction: 'History',
  runPrefix: (reference: string) => `Run ${reference}`,
  unassigned: 'Unassigned',
  milestoneOf: (label: string) => `Milestone: ${label}`,
  orderManual: 'Manual',
  orderPriority: 'Priority',
  orderState: 'State',
  orderOwner: 'Owner',
  orderEffort: 'Effort',
  orderTitle: 'Title',
  subCardFallback: 'Sub Card',
  subCardsCount: subCardsCount.en,
}, {
  progress: (done: number, total: number) => `${done} из ${total} принято`,
  openSubCard: (label: string) => `Открыть Sub Card: ${label}`,
  noPriority: 'Без приоритета',
  gate: (incoming: number, outgoing: number, open: number) => `Зависимости: ждёт ${incoming}, ждут её ${outgoing}${open ? ` — незакрытых входящих ${open}` : ''}`,
  revealDependencies: '. Открыть секцию зависимостей',
  legacyReadonly: 'Зависимости legacy-карточки хранятся в файле проекта — здесь они только читаются.',
  journeyReadonly: 'Зависимости карточки Journey задаёт сам Journey — отдельная правка недоступна.',
  sourceReadonly: 'Источник доступен только для чтения.',
  cycle: (names: string) => `Такая зависимость образует цикл: ${names}.`,
  changeNotSaved: 'Изменение не сохранено — проверьте сообщение каталога вверху.',
  saveDependenciesFailed: 'Не удалось сохранить зависимости.',
  dependencies: (title: string) => `Зависимости: ${title}`,
  closeDependencies: 'Закрыть секцию зависимостей',
  waitsOn: 'Ждёт',
  removeDependency: (title: string) => `Убрать зависимость: ${title}`,
  removeDependencyHint: 'Карточка перестанет ждать эту',
  noIncoming: 'Нет входящих зависимостей.',
  searchDependency: 'Поиск карточки для зависимости',
  findCard: 'Найти карточку',
  cancelAdd: 'Отменить добавление',
  addCard: 'Добавить карточку',
  noResults: 'Ничего не найдено.',
  waitedOnBy: 'Ждут её',
  removeWait: (title: string) => `Снять ожидание: ${title}`,
  removeWaitHint: 'Эта карточка перестанет ждать текущую',
  noOutgoing: 'Никто не ждёт эту карточку.',
  historyLoad: (status: number) => `Не удалось загрузить историю (${status}).`,
  invalidHistory: 'Сервер вернул некорректную страницу истории.',
  serverUnavailable: 'Не удалось связаться с сервером. Повторите попытку.',
  historyFailed: 'Не удалось загрузить историю.',
  retryHistory: 'Повторить',
  closeHistory: 'Закрыть историю',
  noCreated: 'записи о создании нет в журнале',
  historyEmpty: 'История этой карточки начнётся с первого изменения через Deckmate.',
  historyWarnings: (warnings: string) => `Замечания к журналу: ${warnings}`,
  loadingMore: 'Загружаем ещё…',
  loadingHistory: 'Загружаем историю…',
  showMore: 'Показать ещё',
  parentHero: 'Hero Card не может быть Sub Card',
  journeyLink: 'Связь задана Journey',
  nestedFamilies: 'У карточки есть Sub Cards: вложенные семьи недоступны',
  createReason: 'Новая Sub Card · Shift+C',
  chooseFirst: 'Сначала выберите Hero или Doc Card кнопкой «Выбрать»',
  refreshFailed: 'Не удалось обновить каталог. Порядок уже сохранён; повторите обновление.',
  listChanged: 'Список изменился во время переноса. Повторите перестановку по актуальным данным.',
  orderNotSaved: 'Порядок не сохранён. Восстановлен актуальный список; попробуйте снова.',
  orderFailed: 'Не удалось сохранить порядок. Перестановка отменена.',
  emptyChoose: 'Выберите Hero или Doc Card кнопкой «Выбрать», чтобы открыть её Sub Cards.',
  emptyFiltered: 'Нет совпадений с этими фильтрами.',
  emptyCreate: 'Создайте Sub Card или прикрепите существующую кнопкой «Прикрепить».',
  panel: 'Hero Card и Sub Cards',
  closeParent: 'Закрыть выбор родительской карточки',
  chooseParent: 'Выбрать Hero или Doc Card',
  removeParent: 'Снять связь с родительской карточкой',
  hasOwnChildren: 'У этой карточки есть собственные Sub Cards.',
  noParentChosen: 'Родительская карточка не выбрана.',
  toggleComposer: 'Показать или скрыть черновик Sub Card',
  showAll: 'Показать все Sub Cards',
  onlyOpen: 'Только открытые Sub Cards',
  draftSaved: 'Черновик сохранён в этой панели. Нажмите «Новая Sub Card», чтобы продолжить.',
  searchSubCards: 'Поиск Sub Cards',
  findSubCard: 'Найти Sub Card',
  findSubCards: 'Найти Sub Cards',
  newSubCard: 'Новая Sub Card',
  attachSubCards: 'Прикрепить существующие Sub Cards',
  changeOrder: 'Изменить порядок',
  onlyOpenShown: 'Показаны только открытые',
  reorderFiltered: 'Для изменения порядка отключите поиск и фильтр.',
  reorderManual: 'Перетаскивание доступно при ручном порядке.',
  orderSaved: 'Порядок сохранён. Обновите каталог перед следующей перестановкой.',
  refreshingCatalog: 'Обновляем каталог…',
  refreshCatalog: 'Обновить каталог',
  dragInstructions: 'Нажмите пробел, чтобы поднять Sub Card. Стрелки вверх и вниз меняют позицию. Пробел завершает перенос, Escape отменяет.',
  dragStart: (name: string) => `Поднята карточка «${name}».`,
  dragOver: (name: string, position: number, total: number) => `Карточка «${name}», позиция ${position} из ${total}.`,
  outsideList: 'За пределами списка.',
  dragEnd: (name: string, position: number) => `Карточка «${name}» перемещена на позицию ${position}.`,
  dragCancel: 'Перенос отменён.',
  deckUnavailable: 'Колода недоступна',
  noDeck: 'Без колоды',
  withoutDeckCount: (count: number) => `Без колоды: ${count}`,
  dependenciesTitle: 'Зависимости открытой карточки: ждёт / ждут её',
  dependenciesAction: 'Зависимости',
  historyTitle: 'История изменений открытой карточки',
  moveSubCard: (title: string) => `Переместить Sub Card: ${title}`,
  reorderHint: 'Изменить порядок · Пробел и стрелки',
  owner: (owner: string) => `Исполнитель: ${owner}`,
  assignOwner: (title: string, owner: string) => `Назначить исполнителя: ${title} · ${owner}`,
  notInRegistry: 'нет в реестре',
  waiting: 'ждёт:',
  journeyDetach: 'Связь задана Journey: такие Sub Cards нельзя отвязывать отдельно.',
  detachHero: 'Отвязать от Hero; сохранить карточку и её колоду',
  detachFrom: (title: string) => `Отвязать от Hero: ${title}`,
  detachConfirm: (title: string) => `Подтверждение отвязки ${title}`,
  detachMessage: (hero: string, deck: string | null) => `Отвязать от «${hero}»? Карточка останется ${deck ? `в колоде «${deck}»` : 'без колоды'}.`,
  cancel: 'Отмена',
  detach: 'Отвязать',
  taskProgress: (done: number, total: number) => `Принято ${done} из ${total} Task Sub Cards`,
  acceptedCount: (count: number) => `${count} принято`,
  parentStrip: (title: string) => `Hero ${title} · Sub Cards`,
  subCardsOf: (title: string) => `Sub Cards: ${title}`,
  noSubCards: 'Sub Cards ещё нет.',
  effort: 'Оценка',
  priorityOf: (priority: string) => `Приоритет: ${priority}`,
  docCard: 'Doc Card',
  historyOf: (title: string) => `История: ${title}`,
  historyHeading: (title: string) => `История · ${title}`,
  created: 'Создано',
  parentDoc: 'Родительская Doc Card',
  heroCardHeading: 'Hero Card',
  change: 'Изменить',
  select: 'Выбрать',
  remove: 'Убрать',
  subCardsHeading: 'Sub Cards',
  orderMenu: 'Порядок Sub Cards',
  historyAction: 'История',
  runPrefix: (reference: string) => `Run ${reference}`,
  unassigned: 'Без исполнителя',
  milestoneOf: (label: string) => `Milestone: ${label}`,
  orderManual: 'Вручную',
  orderPriority: 'Приоритет',
  orderState: 'Состояние',
  orderOwner: 'Исполнитель',
  orderEffort: 'Оценка',
  orderTitle: 'Название',
  subCardFallback: 'Sub Card',
  subCardsCount: subCardsCount.ru,
});

/**
 * Sub Cards ordering: Manual uses the saved family order and is the only mode that allows dragging.
 * Other orders only regroup the view, as in Decks. The browser remembers the selected order.
 */
const subCardOrders = [
  { key: 'manual' },
  { key: 'priority', ordering: cardOrdering('priority', 'desc') },
  { key: 'state', ordering: cardOrdering('state', 'asc') },
  { key: 'owner', ordering: cardOrdering('owner', 'asc') },
  { key: 'effort', ordering: { ...cardOrdering('effort', 'desc'), compact: true } },
  { key: 'title', ordering: cardOrdering('title', 'asc') },
] as const satisfies readonly { key: string; ordering?: CardOrdering }[];
type SubCardOrder = typeof subCardOrders[number]['key'];
const subCardOrderStorageKey = 'deckmate-subcard-order';

function readSubCardOrder(): SubCardOrder {
  const stored = readStoredValue(localStorage, subCardOrderStorageKey);
  return subCardOrders.find(option => option.key === stored)?.key ?? 'manual';
}

/** One ordered, state-colored strip for Hero tiles and the Deck table; each step is as long as its Sub Card's weight. */
export function SubCardProgress({ cards, cardsById, disabled = false, onOpen }: {
  cards: CatalogCard[]; cardsById: ReadonlyMap<string, CatalogCard>; disabled?: boolean; onOpen?: (card: CatalogCard) => void;
}) {
  const t = useText(text);
  const lang = useLang();
  if (!cards.length) return null;
  const accepted = cards.filter(card => card.state === 'done').length;
  const label = t.progress(accepted, cards.length);
  return <div className="sub-card-progress" role={onOpen ? 'group' : 'img'} title={label} aria-label={label} style={{ '--sub-card-steps': cards.length } as CSSProperties}>
    {cards.map(card => {
      const state = subCardVisualState(card, cardsById);
      const stepLabel = `${card.title} · ${subCardStateLabel(state, lang)}`;
      const style = { '--sub-card-weight': subCardWeight(card) } as CSSProperties;
      if (onOpen) return <button key={card.id} type="button" className="sub-card-progress-segment" data-state={state} style={style} disabled={disabled}
        title={stepLabel} aria-label={t.openSubCard(stepLabel)} onClick={() => onOpen(card)} />;
      return <span key={card.id} className="sub-card-progress-segment" data-state={state} style={style} title={stepLabel} aria-hidden="true" />;
    })}
  </div>;
}

/**
 * Effort, priority, and owner of a card. The compact family row uses 16 px icons,
 * a numeric effort, and an icon-only priority, matching the deck tile.
 */
export function CardMetrics({ card, members = [], showOwner = true, compact = false }: { card: CatalogCard; members?: CatalogMember[]; showOwner?: boolean; compact?: boolean }) {
  const t = useText(text);
  const lang = useLang();
  const icon = compact ? 16 : 12;
  const priority = card.priority ? priorityLabel(card.priority, lang) : null;
  return <span className={'card-metrics' + (compact ? ' is-compact' : '')}>
    <span title={t.effort}><Gauge size={icon} />{card.effort ?? '—'}</span>
    <span title={priority ? t.priorityOf(priority) : t.noPriority} aria-label={priority ? t.priorityOf(priority) : t.noPriority}><Layers size={icon} />{compact ? <span className="visually-hidden">{priority ?? t.noPriority}</span> : priority ?? '—'}</span>
    {showOwner && card.owner && <span className="card-metrics-owner" title={card.owner}><CardOwnerAvatar owner={card.owner} members={members} /><span>{card.owner}</span></span>}
  </span>;
}

/** Dependency gate segment: the linked card's state color, or gray when unavailable. */
function dependencySegmentState(card: CatalogCard | undefined): 'accepted' | 'working' | 'review' | 'blocked' | 'planned' {
  if (!card || card.archived || card.deleted) return 'planned';
  if (card.state === 'done') return 'accepted';
  if (card.state === 'started') return 'working';
  if (card.state === 'review') return 'review';
  return 'blocked';
}

function formatGateCount(count: number): string {
  return count > 9 ? '9+' : String(count);
}

/**
 * Dependency gate: prerequisite count on the left, dependent count on the right,
 * with linked-card state strips below. Red indicates unfinished prerequisites.
 * Hidden when both counts are zero; shared by the family panel and open card.
 */
export function DependencyGate({ card, cardsById, disabled = false, onReveal }: {
  card: CatalogCard; cardsById: ReadonlyMap<string, CatalogCard>; disabled?: boolean; onReveal?: (card: CatalogCard) => void;
}) {
  const t = useText(text);
  const incoming = (card.dependsOn ?? []).map(id => cardsById.get(id)).filter((dep): dep is CatalogCard => Boolean(dep));
  const outgoing = waitingCards(card.id, [...cardsById.values()]).filter(dep => !dep.archived && !dep.deleted);
  if (!incoming.length && !outgoing.length) return null;
  const open = openDependencies(card.dependsOn, cardsById);
  const icon = open.length ? <LockKeyhole size={11} /> : <LockOpen size={11} />;
  const label = t.gate(incoming.length, outgoing.length, open.length);
  return <button type="button" className={'dependency-gate' + (open.length ? ' is-blocked' : '')} disabled={disabled}
    title={label} aria-label={label + (onReveal ? t.revealDependencies : '')} onClick={() => onReveal?.(card)}>
    <span>{formatGateCount(incoming.length)}</span>{icon}<span>{formatGateCount(outgoing.length)}</span>
    <span className="dependency-gate-bar" aria-hidden="true">
      {[...incoming, ...outgoing].map((dependency, index) => <span key={dependency.id + ':' + index} data-state={dependencySegmentState(dependency)} />)}
    </span>
  </button>;
}

/**
 * The open card's dependency section lists prerequisites and dependents, with catalog search to add
 * and a remove button to unlink. Writes native-card dependsOn; legacy and Journey cards are read-only.
 */
export function CardDependenciesSection({ card, catalog, cardsById, disabled, writable, onEdit, onOpen, onClose }: {
  card: CatalogCard; catalog: CatalogView; cardsById: ReadonlyMap<string, CatalogCard>; disabled: boolean; writable: boolean;
  onEdit?: (action: CatalogAction) => Promise<boolean>; onOpen: (card: CatalogCard) => void; onClose: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const t = useText(text);
  const lang = useLang();
  const languageTag = locale(lang);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  useEffect(() => { setAdding(false); setQuery(''); setNotice(''); setSavingId(null); }, [card.id]);
  const incoming = (card.dependsOn ?? []).map(id => cardsById.get(id)).filter((dep): dep is CatalogCard => Boolean(dep));
  const outgoing = waitingCards(card.id, catalog.cards).filter(dep => !dep.archived && !dep.deleted);
  const canEdit = writable && !disabled && Boolean(onEdit) && card.id.startsWith('card:') && !card.journey && !card.archived && !card.deleted;
  const readonlyReason = !card.id.startsWith('card:')
    ? t.legacyReadonly
    : card.journey ? t.journeyReadonly
    : !writable ? t.sourceReadonly : null;
  const existingIds = new Set(card.dependsOn ?? []);
  const queryText = query.trim().toLocaleLowerCase(languageTag);
  const candidates = catalog.cards.filter(candidate => candidate.id !== card.id && !candidate.archived && !candidate.deleted
    && !existingIds.has(candidate.id)
    && (!queryText || [candidate.title, candidate.owner ?? ''].join(' ').toLocaleLowerCase(languageTag).includes(queryText))).slice(0, 8);

  async function apply(target: CatalogCard, next: string[]) {
    if (!onEdit || savingId) return;
    const cycle = dependencyCycle(catalog.cards, target.id, next);
    if (cycle) {
      const names = cycle.map(id => cardsById.get(id)?.title ?? id).join(' → ');
      setNotice(t.cycle(names));
      return;
    }
    setSavingId(target.id); setNotice('');
    try {
      const saved = await onEdit(({ action: 'set-card-dependencies', cardId: target.id, sourceHash: target.sourceHash, dependsOn: next }));
      if (!saved) setNotice(t.changeNotSaved);
    } catch (error) {
      setNotice(failureMessage(error, t.saveDependenciesFailed));
    } finally {
      setSavingId(null);
    }
  }

  function addDependency(dependency: CatalogCard) {
    const next = [...(card.dependsOn ?? []), dependency.id]
      .sort((first, second) => (cardsById.get(first)?.title ?? first).localeCompare(cardsById.get(second)?.title ?? second, languageTag));
    setQuery(''); setAdding(false);
    void apply(card, next);
  }

  return <section className="card-dependencies" aria-label={t.dependencies(card.title)}>
    <div className="card-dependencies-heading">
      <h3 title={card.title} aria-label={t.dependencies(card.title)}>{t.dependenciesAction}</h3>
      <Button type="button" variant="ghost" size="icon" aria-label={t.closeDependencies} onClick={onClose}><X size={15} /></Button>
    </div>
    {readonlyReason && <p className="card-dependencies-note">{readonlyReason}</p>}
    <div className="card-dependencies-group">
      <h4>{t.waitsOn} <span>{incoming.length}</span></h4>
      <div className="card-dependencies-rows">
        {incoming.map(dependency => <div key={dependency.id} className="card-dependencies-row">
          <DependencyStateBadge card={dependency} />
          <button type="button" className="dependency-card-title" disabled={disabled} onClick={() => onOpen(dependency)}>{dependency.title}</button>
          <Button type="button" variant="ghost" size="icon" disabled={!canEdit || savingId !== null} aria-label={t.removeDependency(dependency.title)}
            title={canEdit ? t.removeDependencyHint : readonlyReason ?? ''} onClick={() => void apply(card, (card.dependsOn ?? []).filter(id => id !== dependency.id))}><X size={13} /></Button>
        </div>)}
        {!incoming.length && <p className="card-dependencies-empty">{t.noIncoming}</p>}
      </div>
      {canEdit && (adding
        ? <div className="card-dependencies-search">
          <Search size={14} /><span className="visually-hidden">{t.searchDependency}</span>
          <input type="search" value={query} disabled={savingId !== null} onChange={event => setQuery(event.target.value)} placeholder={t.findCard} autoFocus />
          <Button type="button" variant="ghost" size="icon" aria-label={t.cancelAdd} onClick={() => { setAdding(false); setQuery(''); }}><X size={13} /></Button>
        </div>
        : <div className="card-dependencies-add"><Button type="button" variant="ghost" size="sm" disabled={savingId !== null} onClick={() => setAdding(true)}><Plus size={13} />{t.addCard}</Button></div>)}
      {adding && <div className="card-dependencies-results">
        {candidates.map(candidate => <button key={candidate.id} type="button" className="card-dependencies-option" disabled={savingId !== null} onClick={() => addDependency(candidate)}>
          <strong>{candidate.title}</strong><small>{candidate.kind !== 'task' || !candidate.state ? kindLabel(candidate.kind, lang) : stateLabel(candidate.state, lang)}</small>
        </button>)}
        {!candidates.length && <p className="card-dependencies-empty">{t.noResults}</p>}
      </div>}
    </div>
    <div className="card-dependencies-group">
      <h4>{t.waitedOnBy} <span>{outgoing.length}</span></h4>
      <div className="card-dependencies-rows">
        {outgoing.map(waiter => <div key={waiter.id} className="card-dependencies-row">
          <DependencyStateBadge card={waiter} />
          <button type="button" className="dependency-card-title" disabled={disabled} onClick={() => onOpen(waiter)}>{waiter.title}</button>
          <Button type="button" variant="ghost" size="icon" disabled={!canEdit || savingId !== null} aria-label={t.removeWait(waiter.title)}
            title={canEdit ? t.removeWaitHint : readonlyReason ?? ''} onClick={() => void apply(waiter, (waiter.dependsOn ?? []).filter(id => id !== card.id))}><X size={13} /></Button>
        </div>)}
        {!outgoing.length && <p className="card-dependencies-empty">{t.noOutgoing}</p>}
      </div>
    </div>
    {notice && <p className="card-dependencies-notice" role="status">{notice}</p>}
  </section>;
}

interface CardHistoryState {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  events: DeckActivityEvent[];
  nextCursor: string | null;
  warnings: string[];
  created: CardHistoryCreated | null;
  requestCursor: string | null;
}

/** Diff row with clickable card names in Hero changes and comma-separated lists. */
function HistoryDetailLine({ detail, titlePattern, titlesById, disabled, onOpenById }: {
  detail: string; titlePattern: RegExp | null; titlesById: ReadonlyMap<string, string>; disabled: boolean; onOpenById: (cardId: string) => void;
}) {
  // Match names as substrings, leaving field labels and commas as plain text.
  const parts = titlePattern ? detail.split(titlePattern) : [detail];
  if (parts.length < 2) return <li>{detail}</li>;
  return <li>{parts.map((part, index) => part && <Fragment key={index}>
    {titlesById.has(part)
      ? <button type="button" disabled={disabled} onClick={() => onOpenById(titlesById.get(part)!)}>{part}</button>
      : part}
  </Fragment>)}</li>;
}

const escapedPattern = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** Only unambiguous card names can become links in History. */
export function uniqueCardTitles(cards: readonly CatalogCard[]): Map<string, string> {
  const byTitle = new Map<string, string[]>();
  for (const card of cards) byTitle.set(card.title, [...(byTitle.get(card.title) ?? []), card.id]);
  const unique = new Map<string, string>();
  for (const [title, ids] of byTitle) if (ids.length === 1) unique.set(title, ids[0]);
  return unique;
}

/** Match longer card names first so "Card 1" cannot consume the start of "Card 11". */
function detailTitlePattern(titlesById: ReadonlyMap<string, string>): RegExp | null {
  if (!titlesById.size) return null;
  const alternatives = [...titlesById.keys()].sort((first, second) => second.length - first.length).map(escapedPattern);
  return new RegExp('(' + alternatives.join('|') + ')', 'gu');
}

/**
 * Card History uses the earliest journal entry for Created and lists events newest first, with cursor pagination.
 * The journal is written only to the test copy. Deck passes source explicitly; the default is sandbox.
 */
export function CardHistorySection({ card, source = 'sandbox', refreshKey, disabled, titlesById, onOpenById, onClose }: {
  card: CatalogCard; source?: DataSource; refreshKey: string; disabled: boolean;
  titlesById: ReadonlyMap<string, string>; onOpenById: (cardId: string) => void; onClose: () => void;
}) {
  const t = useText(text);
  const lang = useLang();
  const historyDayFormat = useMemo(() => new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: 'long', year: 'numeric' }), [lang]);
  const historyTimeFormat = useMemo(() => new Intl.DateTimeFormat(locale(lang), { hour: '2-digit', minute: '2-digit' }), [lang]);
  const historyFullFormat = useMemo(() => new Intl.DateTimeFormat(locale(lang), { dateStyle: 'full', timeStyle: 'long' }), [lang]);
  const titlePattern = useMemo(() => detailTitlePattern(titlesById), [titlesById]);
  const [state, setState] = useState<CardHistoryState>({ status: 'loading', error: null, events: [], nextCursor: null, warnings: [], created: null, requestCursor: null });
  const requestNumber = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const historyHeading = useRef<HTMLHeadingElement>(null);
  const retryFocused = useRef(false);
  // 2026-11-07: a catalog reindex (refresh) refetches the first page in the background and merges it into the
  // loaded list, so older pages and the scroll position survive the constant reindexing while an agent works.
  const load = useCallback(async (cursor: string | null, refresh = false) => {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    const request = ++requestNumber.current;
    if (!refresh) {
      setState(previous => ({ ...previous, status: 'loading', requestCursor: cursor }));
    }
    const parameters = new URLSearchParams({ source, cardId: card.id, limit: '20' });
    if (cursor) parameters.set('cursor', cursor);
    try {
      const response = await fetch(`/api/card-activity?${parameters}`, { signal: active.signal, cache: 'no-store' });
      const result = await response.json() as CardHistoryResponse & { message?: string };
      if (!response.ok) throw new Error(result?.message ?? textNow(text).historyLoad(response.status));
      if (!result || !Array.isArray(result.events) || !Array.isArray(result.warnings)
        || (result.nextCursor !== null && typeof result.nextCursor !== 'string')
        || (result.created !== null && (typeof result.created !== 'object' || typeof result.created.at !== 'string'))) {
        throw new Error(textNow(text).invalidHistory);
      }
      if (active.signal.aborted || request !== requestNumber.current) return;
      setState(previous => {
        if (refresh && previous.events.length > 0) {
          const merged = [...new Map([...result.events, ...previous.events].map(event => [event.id, event])).values()];
          return { ...previous, status: 'ready', error: null, events: merged, warnings: [...new Set([...previous.warnings, ...result.warnings])], created: result.created };
        }
        const combined = cursor === null ? result.events : [...new Map([...previous.events, ...result.events].map(event => [event.id, event])).values()];
        return { status: 'ready', error: null, events: combined, nextCursor: result.nextCursor,
          warnings: [...new Set([...(cursor === null ? [] : previous.warnings), ...result.warnings])],
          created: cursor === null ? result.created : previous.created, requestCursor: cursor };
      });
    } catch (error) {
      if (active.signal.aborted || request !== requestNumber.current) return;
      const message = error instanceof TypeError ? textNow(text).serverUnavailable
        : error instanceof Error ? error.message : textNow(text).historyFailed;
      setState(previous => ({ ...previous, status: 'error', error: message, requestCursor: cursor }));
    }
  }, [source, card.id]);
  useEffect(() => {
    void load(null);
    return () => { requestNumber.current += 1; controller.current?.abort(); };
  }, [load]);
  const loadedKey = useRef(refreshKey);
  // 2026-11-07: load() aborts the previous request, so a refresh waits until no page request is pending;
  // otherwise it would cancel a "Show more" page and reset the loaded pages to the first one.
  useEffect(() => {
    if (loadedKey.current === refreshKey || state.status === 'loading') return;
    loadedKey.current = refreshKey;
    void load(null, true);
  }, [load, refreshKey, state.status]);
  const current = state;
  const loading = current.status === 'loading';
  useEffect(() => {
    if (!current.error && retryFocused.current) {
      retryFocused.current = false;
      moveFocus(historyHeading.current, { preventScroll: true });
    }
  }, [current.error]);
  let previousDay = '';
  return <section className="card-history" aria-label={t.historyOf(card.title)} aria-busy={loading}>
    <div className="card-history-heading">
      <h3 ref={historyHeading} tabIndex={-1} title={card.title} aria-label={t.historyHeading(card.title)}>{t.historyAction}</h3>
      <Button type="button" variant="ghost" size="icon" aria-label={t.closeHistory} onClick={onClose}><X size={15} /></Button>
    </div>
    {current.status === 'ready' && <p className="card-history-created">
      <strong>{t.created}</strong>
      {current.created
        ? <><time dateTime={current.created.at} title={historyFullFormat.format(new Date(current.created.at))}>{historyDayFormat.format(new Date(current.created.at))}</time><span>{current.created.actor}</span></>
        : <span>{t.noCreated}</span>}
    </p>}
    <div className="card-history-feed">
      {current.events.map(event => {
        const date = new Date(event.at);
        const day = historyDayFormat.format(date);
        const dayHeading = day !== previousDay ? day : null;
        previousDay = day;
        return <Fragment key={event.id}>
          {dayHeading && <h4 className="card-history-day">{dayHeading}</h4>}
          <article className="card-history-event">
            <time dateTime={event.at} title={historyFullFormat.format(date)}>{historyTimeFormat.format(date)}</time>
            <div className="card-history-event-body">
              <ActivityAttribution event={event} source={source} cardId={card.id} /><p>{event.summary}</p>
              {event.details.length > 0 && <ul className="card-history-details">
                {event.details.slice(0, 8).map((detail, index) => <HistoryDetailLine key={index} detail={detail} titlePattern={titlePattern} titlesById={titlesById} disabled={disabled} onOpenById={onOpenById} />)}
              </ul>}
            </div>
          </article>
        </Fragment>;
      })}
    </div>
    {current.status === 'ready' && current.events.length === 0 && <p className="card-history-empty">{t.historyEmpty}</p>}
    {current.warnings.length > 0 && <p className="card-history-warning">{t.historyWarnings(current.warnings.join(' '))}</p>}
    {loading && <p className="card-history-loading" role="status"><LoaderCircle size={12} className="spin" />{current.events.length ? t.loadingMore : t.loadingHistory}</p>}
    {current.error && <div className="card-history-error" role="alert"><p>{current.error}</p><Button ref={retryButton} type="button" variant="outline" size="sm" disabled={loading} onClick={() => { retryFocused.current = document.activeElement === retryButton.current; void load(current.requestCursor); }}>{t.retryHistory}</Button></div>}
    {current.nextCursor && current.status === 'ready' && <div className="card-history-more"><Button type="button" variant="outline" size="sm" disabled={disabled || loading} onClick={() => void load(current.nextCursor)}>{t.showMore}</Button></div>}
  </section>;
}

interface CardHistoryResponse {
  events: DeckActivityEvent[];
  nextCursor: string | null;
  warnings: string[];
  created: CardHistoryCreated | null;
}

interface DragBaseline { heroId: string; sourceHash: string; manifestHash: string; ids: string[] }
interface OptimisticOrder { heroId: string; ids: string[]; manifestHash: string; acknowledged: boolean }

export function CardFamilyPanel({ hero, card, children, openedId, catalog, disabled, pending = false, writable, parentPicker, createRequest, source, onOpen, onOpenSubCard, onCreate, onCreateCard, onCreated, onCreateDirtyChange, onCreateSessionChange, onCreateRequestHandled, onEdit, onAttach, onDetach, onChooseParent, onCancelParentPicker, onReorder, onRefresh }: {
  hero?: CatalogCard; card: CatalogCard; children: CatalogCard[]; openedId: string; catalog: CatalogView;
  disabled: boolean; writable: boolean; onOpen: (card: CatalogCard) => void; onCreate: (heroId: string) => void; onAttach: () => void;
  onOpenSubCard?: (card: CatalogCard) => void;
  onDetach?: (card: CatalogCard) => void;
  onChooseParent?: () => void;
  onCancelParentPicker?: () => void;
  parentPicker?: ReactNode;
  pending?: boolean;
  createRequest?: number;
  /** History source defaults to sandbox, where the journal is written. */
  source?: DataSource;
  onCreateRequestHandled?: (sequence: number) => void;
  onCreateSessionChange?: (parentId: string | null) => void;
  onCreateCard?: (action: CreateFamilyCardAction) => Promise<boolean>;
  onCreated?: (cardId: string, deckId: string) => void;
  onCreateDirtyChange?: (dirty: boolean) => void;
  onEdit?: (action: CatalogAction) => Promise<boolean>;
  onReorder?: (cardIds: string[]) => Promise<boolean>;
  onRefresh?: () => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const t = useText(text);
  const lang = useLang();
  const languageTag = locale(lang);
  const [searchOpen, setSearchOpen] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [order, setOrder] = useState<SubCardOrder>(readSubCardOrder);
  const [detachingId, setDetachingId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<OptimisticOrder | null>(null);
  const [reordering, setReordering] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [reorderNotice, setReorderNotice] = useState('');
  const [composerMounted, setComposerMounted] = useState(false);
  const [creating, setCreating] = useState(false);
  const [creationDirty, setCreationDirty] = useState(false);
  const [ownerCard, setOwnerCard] = useState<CatalogCard | null>(null);
  const [settingsTab, setSettingsTab] = useState<CardQuickSettingsTab>('owner');
  const [dependenciesOpen, setDependenciesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const ownerTrigger = useRef<HTMLButtonElement | null>(null);
  const newTrigger = useRef<HTMLButtonElement>(null);
  const creationOpener = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLElement>(null);
  const handledCreateRequest = useRef(0);
  const dirtyCallback = useRef(onCreateDirtyChange);
  dirtyCallback.current = onCreateDirtyChange;
  const sessionCallback = useRef(onCreateSessionChange);
  sessionCallback.current = onCreateSessionChange;
  const searchInput = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const baseline = useRef<DragBaseline | null>(null);
  const mutation = useRef(false);
  const refreshInFlight = useRef(false);
  const operation = useRef(0);
  const searchId = useId();
  const familyParent = hero ?? card;
  const parentActive = !familyParent.archived && !familyParent.deleted;
  const canContainChildren = parentActive && (familyParent.kind === 'hero' || familyParent.kind === 'doc') && !familyParent.parentId && !familyParent.journey;
  const currentHasChildren = catalog.cards.some(candidate => candidate.parentId === card.id);
  const canChooseParent = card.kind !== 'hero' && !card.journey && !currentHasChildren && !card.archived && !card.deleted;
  const activeChildren = children.filter(child => !child.archived && !child.deleted);
  // A Sub Card without a deck is an indication only: the heading count and row badges never block anything (2026-11-09).
  const withoutDeck = activeChildren.filter(child => child.deckId === null);
  let parentReason = t.parentHero;
  if (card.journey) parentReason = t.journeyLink;
  else if (currentHasChildren) parentReason = t.nestedFamilies;
  const creationReason = canContainChildren ? t.createReason : t.chooseFirst;
  const searchText = search.trim().toLocaleLowerCase(languageTag);
  const cardsById = useMemo(() => new Map(catalog.cards.map(card => [card.id, card])), [catalog.cards]);
  const ordered = optimistic?.heroId === familyParent.id ? orderSubCards(children, optimistic.ids) : children;
  const shown = ordered.filter(card => !card.archived && !card.deleted && (!onlyOpen || card.state !== 'done') && (!searchText || [card.title, card.version, card.owner].join(' ').toLocaleLowerCase(languageTag).includes(searchText)));
  const filtered = Boolean(searchText) || onlyOpen;
  const orderOption = subCardOrders.find(option => option.key === order) ?? subCardOrders[0];
  const orderLabels: Record<SubCardOrder, string> = { manual: t.orderManual, priority: t.orderPriority, state: t.orderState, owner: t.orderOwner, effort: t.orderEffort, title: t.orderTitle };
  const manualOrder = !('ordering' in orderOption);
  // Other orders regroup only what is shown; Manual keeps the saved family order and is the one where rows are dragged.
  const groups = 'ordering' in orderOption ? groupAndSortCards(shown, cardsById, orderOption.ordering) : null;
  const displayed = groups ? groups.flatMap(group => group.cards) : shown;
  const groupHeadings = 'ordering' in orderOption && laneOrderOf(orderOption.ordering) !== null;
  const childKey = JSON.stringify(children.map(card => card.id));
  // A saved write may return before the catalog can rebuild. Stop saving, but never
  // authorize the next reorder against that stale manifest (2026-11-03).
  const awaitingCatalog = Boolean(optimistic?.acknowledged && optimistic.heroId === familyParent.id
    && catalog.manifestHash === optimistic.manifestHash && childKey !== JSON.stringify(optimistic.ids));
  const busy = disabled || pending || reordering || creationDirty;
  const canReorder = Boolean(onReorder) && writable && canContainChildren && !busy && !awaitingCatalog && !refreshing && !filtered && manualOrder && !detachingId && activeChildren.length > 1;
  const interacting = busy || activeId !== null;
  const ids = ordered.map(card => card.id);
  const familyMotion = useCardLayoutMotion<HTMLDivElement>({ layoutKey: order + ':' + displayed.map(card => card.id).join('|'), resetKey: familyParent.id, dragging: activeId !== null || reordering });
  const listRef = useCallback((node: HTMLDivElement | null) => { list.current = node; familyMotion(node); }, [familyMotion]);
  const deckNames = new Map(catalog.decks.map(deck => [deck.id, deck.title]));
  const draggedCard = activeId ? ordered.find(card => card.id === activeId) : undefined;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const collisions: CollisionDetection = arguments_ => {
    const pointer = arguments_.pointerCoordinates;
    const bounds = list.current?.getBoundingClientRect();
    if (pointer && bounds && (pointer.x < bounds.left || pointer.x > bounds.right || pointer.y < bounds.top - 6 || pointer.y > bounds.bottom + 6)) return [];
    return closestCenter(arguments_);
  };

  useEffect(() => {
    operation.current += 1; mutation.current = false; refreshInFlight.current = false; baseline.current = null;
    setActiveId(null); setOptimistic(null); setReordering(false); setRefreshing(false); setReorderNotice('');
    setSearch(''); setSearchOpen(false); setOnlyOpen(false); setDetachingId(null);
    setDependenciesOpen(false); setHistoryOpen(false);
  }, [familyParent.id]);
  // 2026-11-05: switching cards closes an empty composer and Quick Settings; a Sub Card draft guards navigation through Deck.
  useEffect(() => {
    setOwnerCard(null);
    if (!composerMounted || creationDirty) return;
    setComposerMounted(false); setCreating(false); sessionCallback.current?.(null);
  }, [card.id]);
  useEffect(() => () => { operation.current += 1; }, []);
  useEffect(() => {
    if (!createRequest || !Number.isSafeInteger(createRequest) || createRequest <= handledCreateRequest.current) return;
    // 2026-11-03: a request is an event, never a toggle or a queued write after a lock clears.
    handledCreateRequest.current = createRequest;
    onCreateRequestHandled?.(createRequest);
    if (pending || reordering || activeId || parentPicker || !writable || !canContainChildren || !onCreateCard || (disabled && !composerMounted)) return;
    creationOpener.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    setDetachingId(null); sessionCallback.current?.(familyParent.id); setComposerMounted(true); setCreating(true);
  }, [createRequest, pending, reordering, activeId, parentPicker, writable, canContainChildren, onCreateCard, disabled, composerMounted, onCreateRequestHandled]);
  useEffect(() => { dirtyCallback.current?.(creationDirty); }, [creationDirty]);
  useEffect(() => () => {
    dirtyCallback.current?.(false);
    sessionCallback.current?.(null);
  }, []);
  useEffect(() => { if (searchOpen) moveFocus(searchInput.current); }, [searchOpen]);
  // The sections open under the Sub Card list; a gate on a row reveals them out of sight otherwise.
  useEffect(() => {
    if (dependenciesOpen || historyOpen) panel.current?.querySelector('.card-dependencies, .card-history')?.scrollIntoView({ block: 'nearest' });
  }, [dependenciesOpen, historyOpen]);
  useEffect(() => {
    if (!optimistic?.acknowledged || reordering) return;
    if (optimistic.heroId !== familyParent.id || childKey === JSON.stringify(optimistic.ids) || catalog.manifestHash !== optimistic.manifestHash) setOptimistic(null);
  }, [optimistic, reordering, familyParent.id, childKey, catalog.manifestHash]);

  function cancelDrag() { baseline.current = null; setActiveId(null); }

  function chooseOrder(next: SubCardOrder) { setOrder(next); localStorage.setItem(subCardOrderStorageKey, next); }

  function toggleComposer() {
    if (pending || reordering || activeId) return;
    if (composerMounted) { setCreating(previous => !previous); return; }
    if (disabled || !canContainChildren || !writable) return;
    if (!onCreateCard) { onCreate(familyParent.id); return; }
    creationOpener.current = newTrigger.current;
    setDetachingId(null); sessionCallback.current?.(familyParent.id); setComposerMounted(true); setCreating(true);
  }

  function closeComposer() {
    if (pending) return;
    setComposerMounted(false); setCreating(false); setCreationDirty(false); sessionCallback.current?.(null);
    requestAnimationFrame(() => {
      // The trigger is found by a stable attribute: its aria-label follows the interface language.
      const target = creationOpener.current?.isConnected ? creationOpener.current : panel.current?.querySelector<HTMLButtonElement>('[data-new-subcard]');
      moveFocus(target, { preventScroll: true });
    });
  }

  function closeOwner() {
    setOwnerCard(null);
  }

  async function refreshSavedOrder() {
    if (!onRefresh || !awaitingCatalog || busy || refreshInFlight.current) return;
    const request = operation.current;
    refreshInFlight.current = true;
    setRefreshing(true);
    setReorderNotice('');
    try { await onRefresh(); }
    catch {
      if (request === operation.current) setReorderNotice(t.refreshFailed);
    } finally {
      if (request === operation.current) { refreshInFlight.current = false; setRefreshing(false); }
    }
  }

  async function finishDrag(event: DragEndEvent) {
    const start = baseline.current;
    cancelDrag();
    if (!canReorder || !onReorder || mutation.current || !start || !event.over || event.active.id === event.over.id) return;
    if (start.heroId !== familyParent.id || start.sourceHash !== familyParent.sourceHash || start.manifestHash !== catalog.manifestHash || JSON.stringify(start.ids) !== childKey) {
      setReorderNotice(t.listChanged); return;
    }
    const from = start.ids.indexOf(String(event.active.id));
    const to = start.ids.indexOf(String(event.over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(start.ids, from, to);
    const request = ++operation.current;
    mutation.current = true; setReordering(true); setReorderNotice('');
    setOptimistic({ heroId: familyParent.id, ids: next, manifestHash: catalog.manifestHash, acknowledged: false });
    try {
      const saved = await onReorder(next);
      if (request !== operation.current) return;
      if (saved) setOptimistic(previous => previous ? { ...previous, acknowledged: true } : null);
      else { setOptimistic(null); setReorderNotice(t.orderNotSaved); }
    } catch {
      if (request === operation.current) { setOptimistic(null); setReorderNotice(t.orderFailed); }
    } finally {
      if (request === operation.current) { mutation.current = false; setReordering(false); }
    }
  }

  function cardName(id: string | number) { return ordered.find(card => card.id === id)?.title ?? t.subCardFallback; }
  // A row's gate reveals that card's dependencies, opening the card first when needed.
  function revealDependencies(target: CatalogCard) {
    if (disabled) return;
    setHistoryOpen(false);
    setDependenciesOpen(true);
    if (target.id !== card.id) onOpen(target);
  }
  const titlesById = useMemo(() => uniqueCardTitles(catalog.cards), [catalog.cards]);
  const openCardById = useCallback((cardId: string) => {
    const target = cardsById.get(cardId);
    if (target) onOpen(target);
  }, [cardsById, onOpen]);
  let emptyMessage = t.emptyChoose;
  if (activeChildren.length) emptyMessage = t.emptyFiltered;
  else if (canContainChildren) emptyMessage = t.emptyCreate;

  return <aside ref={panel} className="card-family-panel" aria-label={t.panel}>
    <div className="card-family-parent-heading"><h2>{hero?.kind === 'doc' ? t.parentDoc : t.heroCardHeading}</h2>
      {writable && onChooseParent && (!hero || hero.id !== card.id) && <div className="card-family-parent-actions">
        {parentPicker ? <Button type="button" variant="outline" size="sm" disabled={pending || !onCancelParentPicker} title={t.closeParent} onClick={onCancelParentPicker}>{t.cancel}</Button>
          : <Button type="button" variant="outline" size="sm" disabled={interacting || !canChooseParent} title={canChooseParent ? t.chooseParent : parentReason} onClick={onChooseParent}>{hero ? t.change : t.select}</Button>}
        {!parentPicker && hero && onDetach && <Button type="button" variant="ghost" size="sm" disabled={interacting || !canChooseParent} title={canChooseParent ? t.removeParent : parentReason} onClick={() => onDetach(card)}>{t.remove}</Button>}
      </div>}
    </div>
    {hero && parentActive ? <button type="button" className={'card-family-hero' + (openedId === hero.id ? ' is-current' : '')} data-kind={hero.kind} disabled={interacting} onClick={() => onOpen(hero)} aria-current={openedId === hero.id ? 'true' : undefined}>
      <span className="card-family-hero-title"><span className="card-family-hero-icon" aria-hidden="true">{hero.kind === 'doc' ? <NotebookText size={10} /> : <Crown size={10} />}</span><strong><TagTitlePrefix tags={hero.tags} definitions={catalog.projectTags} />{hero.title}</strong></span>
      <CardTags tags={hero.tags} definitions={catalog.projectTags} compact />
      <CardMetrics card={hero} members={catalog.members} compact />
    </button> : <p className="card-family-parent-empty">{currentHasChildren ? t.hasOwnChildren : t.noParentChosen}</p>}
    {parentPicker ? <div className="card-family-parent-slot">{parentPicker}</div> : <div className="card-family-subcards-slot">
    {/* Title and search stay left; add, attach, and filter controls stay right. */}
    <div className="card-family-heading">
      <div className="card-family-heading-title"><h2>{t.subCardsHeading}</h2>{withoutDeck.length > 0 && <span className="card-family-no-deck-count">{t.withoutDeckCount(withoutDeck.length)}</span>}
        <Button type="button" variant="ghost" size="icon" title={t.findSubCards} aria-label={t.findSubCards} aria-expanded={searchOpen} aria-controls={searchId} disabled={interacting} onClick={() => { setSearchOpen(!searchOpen); if (searchOpen) setSearch(''); }}><Search size={16} /></Button>
      </div>
      <div className="card-family-actions">
        {(writable || composerMounted) && <div className="card-family-action-group"><Button type="button" variant="ghost" size="icon" title={composerMounted ? t.toggleComposer : creationReason} aria-label={t.newSubCard} data-new-subcard aria-pressed={creating}
          disabled={pending || reordering || Boolean(activeId) || (!composerMounted && (disabled || !canContainChildren))}
          onClick={event => { newTrigger.current = event.currentTarget; toggleComposer(); }}><Plus size={16} /></Button><Button type="button" variant="ghost" size="icon" title={canContainChildren ? t.attachSubCards : creationReason} aria-label={t.attachSubCards} disabled={interacting || !canContainChildren || !writable} onClick={onAttach}><Link2 size={16} /></Button></div>}
        <div className="card-family-action-group"><DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild><Button type="button" variant="ghost" size="icon" className={manualOrder ? undefined : 'is-active'} title={t.changeOrder + ' · ' + orderLabels[orderOption.key]} aria-label={t.changeOrder} disabled={interacting}><ArrowDownUp size={16} /></Button></DropdownMenu.Trigger>
          <DropdownMenu.Portal><DropdownMenu.Content className="dropdown card-family-order-menu" align="end" sideOffset={6} collisionPadding={12}>
            <DropdownMenu.Label className="dropdown-label">{t.orderMenu}</DropdownMenu.Label>
            <DropdownMenu.RadioGroup value={order} onValueChange={value => chooseOrder(value as SubCardOrder)}>
              {subCardOrders.map(option => <DropdownMenu.RadioItem key={option.key} value={option.key} className="dropdown-item">
                <span className="card-family-order-check"><DropdownMenu.ItemIndicator><Check size={14} /></DropdownMenu.ItemIndicator></span>{orderLabels[option.key]}
              </DropdownMenu.RadioItem>)}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content></DropdownMenu.Portal>
        </DropdownMenu.Root><Button type="button" variant="ghost" size="icon" title={onlyOpen ? t.showAll : t.onlyOpen} aria-label={t.onlyOpen} aria-pressed={onlyOpen} disabled={interacting} onClick={() => setOnlyOpen(!onlyOpen)}><Filter size={16} /></Button></div>
      </div>
    </div>
    {composerMounted && onCreateCard && <div className="card-family-composer-slot" hidden={!creating}>
      <CardFamilyComposer key={familyParent.id} parent={familyParent} catalog={catalog} initialDeckId={card.deckId ?? undefined} active={creating} pending={pending} readOnly={!writable}
        onCreate={onCreateCard} onCancel={closeComposer} onDirtyChange={setCreationDirty}
        onCreated={(cardId, deckId) => { setComposerMounted(false); setCreating(false); setCreationDirty(false); sessionCallback.current?.(null); dirtyCallback.current?.(false); onCreated?.(cardId, deckId); }} />
    </div>}
    <div className="card-family-cards-slot" hidden={creating}>
    {composerMounted && creationDirty && <p className="card-family-draft-hint" role="status">{t.draftSaved}</p>}
    {searchOpen && <label className="card-family-search" id={searchId}><Search size={14} /><span className="visually-hidden">{t.searchSubCards}</span><input ref={searchInput} type="search" value={search} disabled={interacting} onChange={event => setSearch(event.target.value)} placeholder={t.findSubCard} /></label>}
    {onlyOpen && <p className="card-family-filter-hint">{t.onlyOpenShown}</p>}
    {writable && onReorder && (filtered || !manualOrder) && <p className="card-family-reorder-hint">{filtered ? t.reorderFiltered : t.reorderManual}</p>}
    {awaitingCatalog && <div className="card-family-reorder-notice card-family-refresh-notice" role="status">
      <span>{t.orderSaved}</span>
      {onRefresh && <Button type="button" variant="outline" size="sm" disabled={busy || refreshing} onClick={() => void refreshSavedOrder()}>{refreshing && <LoaderCircle size={12} className="spin" />}{refreshing ? t.refreshingCatalog : t.refreshCatalog}</Button>}
    </div>}
    {reorderNotice && <p className="card-family-reorder-notice" role="status">{reorderNotice}</p>}
    <DndContext key={familyParent.id} sensors={sensors} collisionDetection={collisions} onDragStart={event => {
      if (!canReorder) return;
      baseline.current = { heroId: familyParent.id, sourceHash: familyParent.sourceHash, manifestHash: catalog.manifestHash, ids };
      setActiveId(String(event.active.id)); setReorderNotice('');
    }} onDragEnd={event => void finishDrag(event)} onDragCancel={cancelDrag} accessibility={{
      screenReaderInstructions: { draggable: t.dragInstructions },
      announcements: {
        onDragStart: ({ active }) => t.dragStart(cardName(active.id)),
        onDragOver: ({ active, over }) => over ? t.dragOver(cardName(active.id), ids.indexOf(String(over.id)) + 1, ids.length) : t.outsideList,
        onDragEnd: ({ active, over }) => over ? t.dragEnd(cardName(active.id), ids.indexOf(String(over.id)) + 1) : t.dragCancel,
        onDragCancel: () => t.dragCancel,
      },
    }}>
      <SortableContext items={displayed.map(card => card.id)} strategy={verticalListSortingStrategy}>
        <div className={'card-family-list' + (activeId ? ' is-dragging' : '')} ref={listRef}>{(groups ?? [{ key: 'manual', title: '', cards: shown }]).map(group => <Fragment key={group.key}>
          {groupHeadings && <h3 className="card-family-group">{group.title}<span>{group.cards.length}</span></h3>}
          {group.cards.map(card => <SortableSubCard key={card.id} card={card} hero={familyParent} current={card.id === openedId} deckName={card.deckId ? deckNames.get(card.deckId) ?? t.deckUnavailable : t.noDeck}
          writable={writable} disabled={interacting} canReorder={canReorder} showHandle={writable && Boolean(onReorder) && manualOrder} confirming={detachingId === card.id} members={catalog.members} cardsById={cardsById} catalog={catalog}
          onOpen={onOpenSubCard ?? onOpen} onOwner={onEdit ? (selected, trigger) => { ownerTrigger.current = trigger; setSettingsTab('owner'); setOwnerCard(selected); } : undefined}
          onDependencies={revealDependencies}
          onDetach={onDetach} onConfirm={() => setDetachingId(detachingId === card.id ? null : card.id)} onCancel={() => setDetachingId(null)} />)}
        </Fragment>)}</div>
      </SortableContext>
      {createPortal(<DragOverlay dropAnimation={null} adjustScale={false} zIndex={140} style={{ pointerEvents: 'none' }}>{draggedCard && <div className="card-family-row card-family-drag-overlay" data-kind={draggedCard.kind} data-state={draggedCard.state ?? undefined} data-progress-state={subCardVisualState(draggedCard, cardsById)} aria-hidden="true"><strong><TagTitlePrefix tags={draggedCard.tags} definitions={catalog.projectTags} />{draggedCard.title}</strong><CardTags tags={draggedCard.tags} definitions={catalog.projectTags} compact /><CardMetrics card={draggedCard} members={catalog.members} compact /></div>}</DragOverlay>, document.body)}
    </DndContext>
    {shown.length === 0 && <p className="card-family-empty">{emptyMessage}</p>}
    </div>
    </div>}
    {/* History stays below the family to keep family controls together. */}
    {!parentPicker && <>
      <div className="card-family-card-tools">
        <DependencyGate card={card} cardsById={cardsById} disabled={disabled} onReveal={revealDependencies} />
        <Button type="button" variant="ghost" size="sm" aria-pressed={dependenciesOpen} disabled={interacting}
          title={t.dependenciesTitle} onClick={() => { const next = !dependenciesOpen; setDependenciesOpen(next); if (next) setHistoryOpen(false); }}><Link2 size={14} />{t.dependenciesAction}</Button>
        <Button type="button" variant="ghost" size="sm" aria-pressed={historyOpen} disabled={interacting}
          title={t.historyTitle} onClick={() => { const next = !historyOpen; setHistoryOpen(next); if (next) setDependenciesOpen(false); }}><HistoryIcon size={14} />{t.historyAction}</Button>
      </div>
      {dependenciesOpen && <CardDependenciesSection card={card} catalog={catalog} cardsById={cardsById} disabled={disabled || pending} writable={writable}
        onEdit={onEdit} onOpen={onOpen} onClose={() => setDependenciesOpen(false)} />}
      {historyOpen && <CardHistorySection card={card} source={source} refreshKey={catalog.indexedAt} disabled={disabled}
        titlesById={titlesById} onOpenById={openCardById} onClose={() => setHistoryOpen(false)} />}
    </>}
    {ownerCard && onEdit && <CardQuickSettings key={ownerCard.id} card={catalog.cards.find(candidate => candidate.id === ownerCard.id) ?? ownerCard} catalog={catalog} source={source}
      tab={settingsTab} onTabChange={setSettingsTab} anchor={ownerTrigger.current} disabled={pending || !writable} onEdit={onEdit} onClose={closeOwner} />}
  </aside>;
}

function SortableSubCard({ card, hero, current, deckName, disabled, writable, canReorder, showHandle, confirming, members = [], cardsById, catalog, onOpen, onOwner, onDependencies, onDetach, onConfirm, onCancel }: {
  card: CatalogCard; hero: CatalogCard; current: boolean; deckName: string; disabled: boolean; writable: boolean; canReorder: boolean; showHandle: boolean; confirming: boolean;
  members?: CatalogMember[]; cardsById: ReadonlyMap<string, CatalogCard>; catalog: Pick<CatalogView, 'runs' | 'milestones' | 'projectTags'>;
  onOwner?: (card: CatalogCard, trigger: HTMLButtonElement) => void;
  onDependencies?: (card: CatalogCard) => void;
  onOpen: (card: CatalogCard) => void; onDetach?: (card: CatalogCard) => void; onConfirm: () => void; onCancel: () => void;
}) {
  const sortable = useSortable({ id: card.id, disabled: !canReorder, transition: { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' } });
  const t = useText(text);
  const lang = useLang();
  const transform = sortable.transform ? `translate3d(${sortable.transform.x}px, ${sortable.transform.y}px, 0)` : undefined;
  const visualState = subCardVisualState(card, cardsById);
  const waitingNames = (card.dependsOn ?? []).filter(id => cardsById.get(id)?.state !== 'done').map(id => cardsById.get(id)?.title ?? id);
  const runReference = card.run?.trim();
  const milestoneReference = card.milestone?.trim();
  const run = catalog.runs?.find(candidate => candidate.id === runReference);
  const milestone = catalog.milestones?.find(candidate => candidate.id === milestoneReference);
  let runName = runReference ? t.runPrefix(runReference) : null;
  if (run) runName = runLabel(run, lang);
  let runTitle = runName ?? '';
  if (run && !run.configurationId) runTitle += ' · ' + run.goal;
  if (!run) runTitle += ' · ' + t.notInRegistry;
  const milestoneLabel = milestoneReference ? milestone?.title || milestoneReference : null;
  function startPointerDrag(event: PointerEvent<HTMLDivElement>) {
    if (!canReorder || event.defaultPrevented) return;
    const target = event.target as Element;
    if (target.closest('.card-family-detach, .card-family-detach-confirm')) return;
    const control = target.closest('button, a, input, select, textarea, [role="button"], [contenteditable="true"]');
    if (control && !control.matches('.card-family-row-open, .card-family-drag-handle')) return;
    // PointerSensor waits for 6px, then suppresses the release click at document capture.
    // A normal click still reaches the open button, including clicks on its title/metrics.
    sortable.listeners?.onPointerDown?.(event);
  }
  return <div ref={sortable.setNodeRef} data-card-id={card.id} className={'card-family-sortable' + (sortable.isDragging ? ' is-drag-source' : '')} style={{ transform, transition: sortable.transition }}>
    <div className={'card-family-row' + (current ? ' is-current' : '') + (canReorder ? ' is-reorderable' : '')} data-kind={card.kind} data-state={card.state ?? undefined} data-progress-state={visualState} onPointerDown={startPointerDrag} onClick={event => {
      if (!disabled && !sortable.isDragging && !(event.target as Element).closest('button, a, input, select, textarea, [role="button"], .card-family-detach, .card-family-detach-confirm')) onOpen(card);
    }}>
      <div className="card-family-row-main">
        {showHandle && <button type="button" ref={sortable.setActivatorNodeRef} className="card-family-drag-handle" {...sortable.attributes} onKeyDown={event => sortable.listeners?.onKeyDown?.(event)} aria-disabled={!canReorder} tabIndex={canReorder ? 0 : -1} aria-label={t.moveSubCard(card.title)} title={t.reorderHint}><GripVertical size={16} /></button>}
        <div className="card-family-row-body">
          <CardValueHint text={card.title} measure=".card-family-row-open > strong"><button type="button" className="card-family-row-open" disabled={disabled} onClick={() => onOpen(card)} aria-current={current ? 'true' : undefined} aria-label={t.openSubCard(card.title) + ' · ' + deckName + (card.state ? ' · ' + stateLabel(card.state, lang) : '')} title={card.title + ' · ' + deckName + (card.state ? ' · ' + stateLabel(card.state, lang) : '')}>
            <strong>{card.version && <small>{card.version}</small>}<TagTitlePrefix tags={card.tags} definitions={catalog.projectTags} />{card.title}</strong>
          </button></CardValueHint>
          <CardTags tags={card.tags} definitions={catalog.projectTags} compact />
          <div className="card-family-row-details">{card.kind === 'task' && <span className="card-family-row-state">{visualState === 'accepted' && <Check size={16} aria-hidden="true" />}{stateLabel(card.state ?? 'not-started', lang)}</span>}<CardMetrics card={card} members={members} showOwner={false} compact />
            <button type="button" className="card-family-row-owner" disabled={disabled || !writable || !onOwner} title={t.owner(card.owner ?? t.unassigned)}
              aria-label={t.assignOwner(card.title, card.owner ?? t.unassigned)} onClick={event => onOwner?.(card, event.currentTarget)}>
              <CardOwnerAvatar owner={card.owner} members={members} />{card.owner && <span>{card.owner}</span>}
            </button>
            {card.deckId === null && <span className="card-family-row-no-deck">{t.noDeck}</span>}
            {(runName || milestoneLabel) && <span className="card-family-row-planning">
              {runName && <span title={runTitle}>{runName}</span>}
              {runName && milestoneLabel && <span className="card-family-row-planning-separator" aria-hidden="true">·</span>}
              {milestoneLabel && <span title={t.milestoneOf(milestoneLabel) + (milestone ? '' : ' · ' + t.notInRegistry)} aria-label={t.milestoneOf(milestoneLabel)}>{milestoneLabel}</span>}
            </span>}
            <DependencyGate card={card} cardsById={cardsById} disabled={disabled} onReveal={onDependencies} />
          </div>
          {visualState === 'blocked' && <span className="card-family-row-waiting"><LockKeyhole size={12} /><span>{t.waiting} {waitingNames.join(', ')}</span></span>}
        </div>
        {writable && onDetach && <span className="card-family-detach" title={card.journey ? t.journeyDetach : t.detachHero}><Button type="button" variant="ghost" size="icon" disabled={disabled || Boolean(card.journey)} aria-label={t.detachFrom(card.title)} aria-expanded={confirming} onClick={onConfirm}><X size={16} /></Button></span>}
      </div>
      {writable && onDetach && card.journey && <span className="card-family-journey-note">{t.journeyLink}</span>}
      {confirming && writable && onDetach && !card.journey && <div className="card-family-detach-confirm" role="group" aria-label={t.detachConfirm(card.title)}>
        <p>{t.detachMessage(hero.title, card.deckId ? deckName : null)}</p>
        <div><Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onCancel}>{t.cancel}</Button><Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => { onCancel(); onDetach(card); }}>{t.detach}</Button></div>
      </div>}
    </div>
  </div>;
}

/** A separate trigger keeps opening a card and browsing its family distinct. */
export function CardFamilyPopover({ hero, children: allChildren, disabled, members, projectTags, onOpen, onOpenChange }: {
  hero: CatalogCard; children: CatalogCard[]; disabled: boolean; onOpen: (card: CatalogCard, trigger?: HTMLButtonElement) => void;
  members?: CatalogMember[];
  projectTags?: CatalogView['projectTags'];
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const t = useText(text);
  const lang = useLang();
  const trigger = useRef<HTMLButtonElement>(null);
  const openChange = useRef(onOpenChange);
  openChange.current = onOpenChange;
  const children = allChildren.filter(card => !card.archived && !card.deleted);
  const tasks = children.filter(card => card.kind === 'task');
  const accepted = tasks.filter(card => card.state === 'done').length;
  const unavailable = disabled || Boolean(hero.archived || hero.deleted);
  useEffect(() => { if (unavailable) setOpen(false); }, [unavailable]);
  useEffect(() => { openChange.current?.(open && !unavailable); }, [open, unavailable]);
  useEffect(() => () => openChange.current?.(false), []);
  function select(card: CatalogCard) { setOpen(false); onOpen(card, trigger.current ?? undefined); }
  return <DropdownMenu.Root modal={false} open={open && !unavailable} onOpenChange={setOpen}>
    <DropdownMenu.Trigger asChild><button ref={trigger} type="button" className="card-family-trigger" disabled={unavailable} aria-label={t.parentStrip(hero.title)}>
      <span className="card-material-glare" aria-hidden="true" />
      {/* The Hero strip uses its tag emoji instead of a kind icon; the Sub Card's tags stay before its title. */}
      <span><TagGlyphs tags={hero.tags} definitions={projectTags} />{hero.title}</span>
    </button></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content className="card-family-popover" side="right" align="start" sideOffset={6} collisionPadding={12} aria-label={t.subCardsOf(hero.title)}>
      <DropdownMenu.Arrow className="card-family-popover-arrow" width={12} height={7} />
      <DropdownMenu.Item className="card-family-popover-hero" onSelect={() => select(hero)}>{hero.kind === 'doc' ? <NotebookText size={15} /> : <Crown size={15} />}<strong><TagTitlePrefix tags={hero.tags} definitions={projectTags} />{hero.title}</strong>{tasks.length > 0 && <progress value={accepted} max={tasks.length} aria-label={t.taskProgress(accepted, tasks.length)} />}<CardTags tags={hero.tags} definitions={projectTags} compact /></DropdownMenu.Item>
      <DropdownMenu.Label className="card-family-popover-label"><strong>{t.subCardsCount(children.length)}</strong><span>{t.acceptedCount(accepted)}</span></DropdownMenu.Label>
      <div className="card-family-popover-list">{children.map(card => <DropdownMenu.Item key={card.id} className="card-family-popover-row" data-kind={card.kind} data-state={card.state ?? undefined} onSelect={() => select(card)}>
        <strong><TagTitlePrefix tags={card.tags} definitions={projectTags} />{card.title}</strong><span>{card.state === 'done' && <Check size={12} />}{card.state ? stateLabel(card.state, lang) : (card.kind === 'doc' ? t.docCard : kindLabel(card.kind, lang))}</span><CardTags tags={card.tags} definitions={projectTags} compact /><CardMetrics card={card} members={members} />
      </DropdownMenu.Item>)}</div>
      {!children.length && <p className="card-family-empty">{t.noSubCards}</p>}
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
