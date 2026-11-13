import { moveFocus } from '../focus.ts';
// Global card search opens with "/" from anywhere.
// The query language itself (words, tags, owners, deck:/kind:/state:, property and content filters, $ID / gd: / gc:
// navigation) lives in search-query.ts; active filters show as removable pills below the search bar.
import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import type { CatalogCard, CatalogDeck, CatalogMember } from '../../src/catalog-contracts.ts';
import type { ProjectTag } from '../../src/project-tags.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import { useCatalog } from '../useCatalog.ts';
import { currentMember, onMemberChange, storedMemberId } from '../current-member.ts';
import { matchShortcut, shortcutTargetBlocked } from '../keyboard-shortcuts.ts';
import { RESULT_LIMIT, runSearch, parseSearch, toggleTagOr, withoutToken, suggestTagFilters, completeTagFilter, matchedTagsFirst, searchTagNames, type FilterToken, type NavigationTarget, type TagFilterSuggestion } from '../search-query.ts';
import { cardIcons } from './CatalogCardTile.tsx';
import { memberForOwner, ownerProgressLabel } from './CardOwnerAvatar.tsx';
import { CardTags, TagBadge } from './CardTags.tsx';
import { CardFaceStatus, cardFaceStatus } from './CardIndicators.tsx';
import { CardMetrics } from './CardMetrics.tsx';
import { buildCatalogLookups } from '../catalog-lookups.ts';
import type { CardTileLookups } from '../card-tile-equality.ts';
import { defineText, locale, useLang, useText } from '../i18n.ts';
import { kindLabel } from '../locales/common.ts';
import { emitSignal } from '../onboarding/signals.ts';
import { EmptyState } from './EmptyState.tsx';
import { LoadingState } from './LoadingState.tsx';
import { ErrorState } from './ErrorState.tsx';
import { Button } from './ui/button.tsx';
import { Keys } from './Keys.tsx';
import '../global-search.css';

const text = defineText({
  syntaxHint: 'words · #tag (#a|#b — OR) · @owner · @none · !exclude · deck:Deck · kind:hero|task|doc · state:done|archived|deleted · '
    + 'effort:3+|3- · priority:high|medium|low · run:current|future|past|none · milestone:Title|none · hand:in|not · due:today|soon|any · '
    + 't:title · sub:card · $ID · gd:Deck · gc:Card · Q — my cards',
  searchCards: 'Search cards',
  searchPlaceholder: 'Search cards…',
  loading: 'Loading cards…',
  activeFilters: 'Active filters',
  removeFilter: 'Remove filter',
  removeFilterNamed: (raw: string) => `Remove filter: ${raw}`,
  disableOr: 'Any of the tags — turn off',
  enableOr: 'Show cards with any of the tags',
  or: 'or',
  results: 'Search results',
  syntax: 'Search syntax',
  close: 'Close search',
  noCards: 'The project has no cards yet.',
  found: (total: number, limit: number) => `Found ${total.toLocaleString(locale())} — showing the first ${limit.toLocaleString(locale())}.`,
  goTo: (title: string) => `Go to: ${title}`,
  goToLabel: 'Go to:',
  deck: (title: string) => `Deck: ${title}`,
  open: (title: string) => `Open: ${title}`,
  tagSuggestions: 'Tag suggestions',
  applyTag: (name: string) => `Filter by tag: ${name}`,
  tagCards: (count: number) => `Cards: ${count.toLocaleString(locale())}`,
}, {
  syntaxHint: 'слова · #тег (#a|#b — ИЛИ) · @исполнитель · @none · !исключить · deck:Колода · kind:hero|task|doc · state:done|archived|deleted · '
    + 'effort:3+|3- · priority:high|medium|low · run:current|future|past|none · milestone:Название|none · hand:in|not · due:today|soon|any · '
    + 't:заголовок · sub:карточка · $ID · gd:Колода · gc:Карточка · Q — мои карточки',
  searchCards: 'Поиск карточек',
  searchPlaceholder: 'Поиск карточек…',
  loading: 'Загружаем карточки…',
  activeFilters: 'Активные фильтры',
  removeFilter: 'Снять фильтр',
  removeFilterNamed: (raw: string) => `Снять фильтр: ${raw}`,
  disableOr: 'Любой из тегов — выключить',
  enableOr: 'Показать карточки с любым из тегов',
  or: 'или',
  results: 'Результаты поиска',
  syntax: 'Синтаксис поиска',
  close: 'Закрыть поиск',
  noCards: 'В проекте пока нет карточек.',
  found: (total: number, limit: number) => `Найдено ${total.toLocaleString(locale())} — показаны первые ${limit.toLocaleString(locale())}.`,
  goTo: (title: string) => `Перейти: ${title}`,
  goToLabel: 'Перейти:',
  deck: (title: string) => `Колода: ${title}`,
  open: (title: string) => `Открыть: ${title}`,
  tagSuggestions: 'Подсказки тегов',
  applyTag: (name: string) => `Фильтр по тегу: ${name}`,
  tagCards: (count: number) => `Карточек: ${count.toLocaleString(locale())}`,
});

type GoToTarget = Exclude<NavigationTarget, { kind: 'ambiguous' }>;

/** One combined list row: a navigation suggestion ("Go to: ...") or a plain search result. */
type SearchEntry = { type: 'tag'; suggestion: TagFilterSuggestion } | { type: 'navigation'; target: GoToTarget } | { type: 'card'; card: CatalogCard };

function SearchFilterLabel({ token, definitions = [] }: { token: FilterToken; definitions?: readonly ProjectTag[] }) {
  if (token.kind !== 'tag') return <span>{token.raw}</span>;
  const names = searchTagNames(token);
  return <span className="global-search-tag-filter">
    {token.negated && <span aria-hidden="true">!</span>}
    {names.map((name, index) => {
      const definition = definitions.find(tag => tag.name.toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru'));
      return <span key={index} className="global-search-tag-alternative">
        {index > 0 && <span aria-hidden="true">|</span>}
        <TagBadge name={definition?.name ?? name} definition={definition} compact />
      </span>;
    })}
  </span>;
}

export function GlobalSearch({ snapshot, refreshKey, onOpenCard, onOpenDeck, disabled = false }: {
  snapshot: WorkspaceSnapshot;
  refreshKey: number;
  onOpenCard: (id: string) => void;
  onOpenDeck: (id: string) => void;
  disabled?: boolean;
}) {
  const { catalog, error, refresh } = useCatalog(snapshot, refreshKey);
  const t = useText(text);
  const lang = useLang();
  const [value, setValueState] = useState('');
  const [caret, setCaret] = useState(0);
  const completionCaret = useRef<number | null>(null);
  const [open, setOpenState] = useState(false);
  const pendingEnter = useRef<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [syntaxOpen, setSyntaxOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const fieldRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const deferredValue = useDeferredValue(value);
  const [memberId, setMemberId] = useState(storedMemberId);
  useEffect(() => onMemberChange(setMemberId), []);
  const member = useMemo(() => memberId ? catalog?.members?.find(candidate => candidate.id === memberId) ?? null : currentMember(catalog?.members ?? []), [catalog, memberId]);
  useLayoutEffect(() => { if (expanded) moveFocus(inputRef.current); }, [expanded]);
  const results = useMemo(() => catalog && deferredValue.trim() ? runSearch(catalog, deferredValue, member?.id ?? null) : null, [catalog, deferredValue, member, lang]);
  // Ambiguous short references show an explanation above the list, outside keyboard navigation.
  const goTo = useMemo<GoToTarget[]>(() => results
    ? results.navigation.filter((target): target is GoToTarget => target.kind !== 'ambiguous')
    : [], [results]);
  const ambiguous = useMemo(() => results?.navigation.filter(target => target.kind === 'ambiguous') ?? [], [results]);
  const suggestions = useMemo(() => catalog ? suggestTagFilters(catalog, value, caret) : [], [catalog, value, caret]);
  const entries = useMemo<SearchEntry[]>(() => [
    ...suggestions.map(suggestion => ({ type: 'tag' as const, suggestion })),
    ...goTo.map(target => ({ type: 'navigation' as const, target })),
    ...results?.cards.map(card => ({ type: 'card' as const, card })) ?? [],
  ], [suggestions, goTo, results]);

  useLayoutEffect(() => {
    if (completionCaret.current === null) return;
    inputRef.current?.setSelectionRange(completionCaret.current, completionCaret.current);
    completionCaret.current = null;
  }, [value]);

  function setValue(next: string) {
    pendingEnter.current = null;
    setValueState(next);
  }

  function setOpen(next: boolean) {
    if (!next) pendingEnter.current = null;
    setOpenState(next);
  }

  function completeTag(suggestion: TagFilterSuggestion) {
    const next = completeTagFilter(value, suggestion);
    const nextCaret = suggestion.end + next.length - value.length;
    completionCaret.current = nextCaret;
    setValue(next); setCaret(nextCaret); setOpen(true);
    moveFocus(inputRef.current);
  }

  // Filter pills use the current input rather than deferred input so removal appears immediately.
  const pills = useMemo(() => parseSearch(value).filter((token): token is FilterToken => token.kind !== 'nav' && token.kind !== 'word'), [value]);
  const tagPills = pills.filter(token => token.kind === 'tag' && !token.negated);
  const tagValues = tagPills.flatMap(token => token.alternatives ?? [token.value]);
  // Multiple tags show an "or" pill that toggles between AND and OR.
  const tagOrActive = tagPills.some(token => (token.alternatives?.length ?? 0) > 1);

  function removeFilter(token: FilterToken) {
    const next = withoutToken(value, token);
    setValue(next);
    if (!next.trim()) setOpen(false);
    moveFocus(inputRef.current);
  }

  function toggleOr() {
    setValue(toggleTagOr(value));
    moveFocus(inputRef.current);
  }

  // "/" focuses the field; "q" toggles My Cards.
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (disabled) return;
      // 2026-11-10: only the exact generated owner query opts out of the normal typing guard.
      if (event.code === 'KeyQ' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
        && !event.repeat && !event.isComposing && event.target === inputRef.current && member && value === '@' + member.id) {
        event.preventDefault();
        setValue('');
        setOpen(false);
        inputRef.current?.blur();
        return;
      }
      // One registry and one «typing / dialog open» check for every shortcut (keyboard-shortcuts.ts).
      const shortcut = matchShortcut(event);
      if (!shortcut || shortcutTargetBlocked(event)) return;
      if (shortcut.id === 'focus-search') {
        event.preventDefault();
        setExpanded(true);
        moveFocus(inputRef.current);
        inputRef.current?.select();
        return;
      }
      if (shortcut.id !== 'search-my-cards') return;
      if (!member) return;
      event.preventDefault();
      // Query owners use registry IDs without spaces; ownerMatches resolves them to labels.
      const myQuery = '@' + member.id;
      if (value === myQuery) {
        setValue('');
        setOpen(false);
        inputRef.current?.blur();
        return;
      }
      setValue(myQuery);
      setOpen(true);
      setExpanded(true);
      moveFocus(inputRef.current);
      inputRef.current?.select();
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [member, value, disabled]);
  // 2026-11-05: quests count a settled search, not each keystroke; the same query twice in a row is one search.
  const lastSearched = useRef('');
  useEffect(() => {
    if (!value.trim()) return;
    const timer = setTimeout(() => { if (value !== lastSearched.current) { lastSearched.current = value; emitSignal({ type: 'search', query: value }); } }, 800);
    return () => clearTimeout(timer);
  }, [value]);

  useEffect(() => { setHighlighted(0); }, [results, suggestions]);

  // Clicking outside a focusable element still counts as leaving the search.
  useEffect(() => {
    if (!open && !expanded) return;
    function onPointerDown(event: PointerEvent) {
      if (!fieldRef.current?.contains(event.target as Node)) { setOpen(false); setExpanded(false); }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, expanded]);

  useEffect(() => {
    const box = scrollRef.current;
    const row = box?.querySelector<HTMLElement>(`#global-search-option-${highlighted}`);
    if (!box || !row) return;
    const bounds = box.getBoundingClientRect(), active = row.getBoundingClientRect();
    if (active.top < bounds.top) box.scrollTop += active.top - bounds.top;
    else if (active.bottom > bounds.bottom) box.scrollTop += active.bottom - bounds.bottom;
  }, [highlighted, entries, open]);

  function closeSearch() {
    // 2026-11-13: focus first so the input's onFocus cannot reopen the dismissed results.
    if (triggerRef.current?.getBoundingClientRect().width) moveFocus(triggerRef.current);
    else moveFocus(inputRef.current);
    setOpen(false); setExpanded(false);
  }

  function openResult(card: CatalogCard) {
    if (disabled) return;
    setOpen(false);
    setExpanded(false);
    onOpenCard(card.id);
    inputRef.current?.blur();
  }

  function openNavigation(target: NavigationTarget) {
    if (disabled || target.kind === 'ambiguous') return;
    setOpen(false);
    setExpanded(false);
    if (target.kind === 'deck') {
      onOpenDeck(target.deck.id);
      inputRef.current?.blur();
      return;
    }
    onOpenCard(target.card.id);
    inputRef.current?.blur();
  }

  function activateEntry(entry: SearchEntry | undefined) {
    if (!entry) return;
    if (entry.type === 'tag') completeTag(entry.suggestion);
    else if (entry.type === 'navigation') openNavigation(entry.target);
    else openResult(entry.card);
  }

  // 2026-11-13: Enter follows the typed query, even while deferred results still belong to its predecessor.
  useLayoutEffect(() => {
    const query = pendingEnter.current;
    if (query === null) return;
    if (!open || disabled || error || query !== value) {
      pendingEnter.current = null;
      return;
    }
    if (!catalog || deferredValue !== query) return;
    pendingEnter.current = null;
    activateEntry(entries[0]);
  });

  function onSearchKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing || event.key !== 'Escape') return;
    event.preventDefault(); event.stopPropagation();
    // 2026-11-13: Escape closes search from any place inside it, filters included; Backspace removes the last pill.
    closeSearch();
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    const last = pills.at(-1);
    if (event.key === 'Backspace' && last && event.currentTarget.selectionStart === value.length
      && event.currentTarget.selectionEnd === value.length && !value.slice(last.end).trim()) {
      event.preventDefault(); removeFilter(last); return;
    }
    if (event.key === 'Enter') {
      if (!open || disabled || error) return;
      event.preventDefault();
      const query = event.currentTarget.value;
      if (!catalog || value !== query || deferredValue !== query) {
        pendingEnter.current = query;
        return;
      }
      pendingEnter.current = null;
      activateEntry(entries[highlighted] ?? entries[0]);
      return;
    }
    const count = entries.length;
    if (!count) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setHighlighted(index => (index + step + count) % count);
    }
  }

  const decksById = useMemo(() => new Map(catalog?.decks.map(deck => [deck.id, deck])), [catalog]);
  const lookups = useMemo(() => buildCatalogLookups(catalog?.cards ?? [], catalog?.subCardOrder), [catalog]);
  const members = catalog?.members ?? [];
  return <div className={`global-search${expanded ? ' is-expanded' : ''}`} ref={fieldRef} onKeyDown={onSearchKeyDown} data-local-escape={open || expanded || undefined}>
    <Button ref={triggerRef} variant="ghost" size="icon" className="global-search-trigger" aria-label={t.searchCards} aria-expanded={expanded}
      disabled={disabled} onClick={() => { if (expanded) closeSearch(); else setExpanded(true); }}><Search size={18} aria-hidden="true" /></Button>
    <div className={`global-search-field control-field${open ? ' is-open' : ''}`}>
      <Search size={18} aria-hidden="true" />
      <input ref={inputRef} type="search" role="combobox" aria-label={t.searchCards} aria-expanded={open}
        aria-controls="global-search-results" aria-activedescendant={open && entries.length ? `global-search-option-${highlighted}` : undefined}
        aria-autocomplete="list" placeholder={t.searchPlaceholder} autoComplete="off" spellCheck={false}
        value={value} onKeyDown={onKeyDown} disabled={disabled}
        onSelect={event => setCaret(event.currentTarget.selectionStart ?? value.length)}
        onFocus={() => { if (value.trim()) setOpen(true); }}
        onBlur={event => { if (!fieldRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false); }}
        onChange={event => { setValue(event.target.value); setCaret(event.target.selectionStart ?? event.target.value.length); setOpen(Boolean(event.target.value.trim())); }} />
      <Keys className="global-search-key" combo={{ key: '/' }} ariaHidden />
      <Button variant="ghost" size="icon" className="global-search-close" aria-label={t.close} onClick={closeSearch}><X size={18} /></Button>
    </div>
    {open && <div className="global-search-pop dialog-panel">
      <ErrorState variant="inline" className="global-search-empty" message={error} onRetry={refresh} />
      {!error && !catalog && <LoadingState message={t.loading} />}
      {!error && catalog && <div ref={scrollRef} className="global-search-sections">
        {pills.length > 0 && <div className="global-search-pills" role="group" aria-label={t.activeFilters}>
          {pills.map(token => <button key={token.start} type="button" className="global-search-pill control"
            onMouseDown={event => event.preventDefault()}
            title={t.removeFilter} aria-label={t.removeFilterNamed(token.raw)}
            onClick={() => removeFilter(token)}>
            <SearchFilterLabel token={token} definitions={catalog.projectTags} /><X size={11} aria-hidden="true" />
          </button>)}
          {tagValues.length >= 2 && <button type="button"
            className={`global-search-pill control is-toggle${tagOrActive ? ' is-on' : ''}`}
            onMouseDown={event => event.preventDefault()}
            aria-pressed={tagOrActive}
            title={tagOrActive ? t.disableOr : t.enableOr}
            onClick={toggleOr}>{t.or}</button>}
        </div>}
        <div id="global-search-results" role="listbox" aria-label={t.results}>
          {suggestions.length > 0 && <div className="global-search-tag-suggestions" role="group" aria-labelledby="global-search-tags-label">
            <h3 id="global-search-tags-label" className="global-search-section-label">{t.tagSuggestions}</h3>
            <ul role="presentation" className="global-search-results">
              {suggestions.map((suggestion, index) => <li key={suggestion.name} id={`global-search-option-${index}`} role="option" aria-selected={highlighted === index}>
                <button type="button" className="global-search-row global-search-tag-suggestion" aria-label={t.applyTag(suggestion.name)}
                  onMouseDown={event => event.preventDefault()} onMouseEnter={() => setHighlighted(index)} onClick={() => completeTag(suggestion)}>
                  <TagBadge name={suggestion.name} definition={catalog.projectTags?.find(tag => tag.name === suggestion.name)} compact />
                  <span className="page-number" aria-label={t.tagCards(suggestion.count)}>{suggestion.count.toLocaleString(locale(lang))}</span>
                </button>
              </li>)}
            </ul>
          </div>}
          <div role="group" aria-labelledby="global-search-navigation-label">
            <h3 id="global-search-navigation-label" className="global-search-section-label">{t.results} · {((results?.total ?? 0) + goTo.length).toLocaleString(locale(lang))}</h3>
            {ambiguous.map(({ message }, index) => <p key={`ambiguous-${index}`} className="global-search-nav-note" role="status">{message}</p>)}
            <ul role="presentation" className="global-search-results">
              {entries.map((entry, index) => {
                if (entry.type === 'tag') return null;
                if (entry.type === 'navigation') return <NavigationRow key={entry.target.kind === 'deck' ? `nav-deck-${entry.target.deck.id}` : `nav-card-${entry.target.card.id}`}
                    entry={entry} index={index} highlighted={highlighted} decksById={decksById} tagDefinitions={catalog.projectTags} members={members} lookups={lookups}
                    onHover={() => setHighlighted(index)} onOpen={openNavigation} />;
                return <ResultRow key={`result-${entry.card.id}`} card={entry.card} index={index} highlighted={highlighted}
                    decksById={decksById} members={members} tagDefinitions={catalog.projectTags} lookups={lookups} query={deferredValue}
                    onHover={() => setHighlighted(index)} onOpen={openResult} />;
              })}
            </ul>
          </div>
        </div>
        {/* 2026-11-06: in a project without cards the query is not at fault, so the message says what is missing. */}
        {results && !entries.length && !ambiguous.length && (catalog.cards.length
          ? <EmptyState variant="filtered" className="global-search-empty" onReset={() => { setValue(''); setOpen(false); moveFocus(inputRef.current); }} />
          : <EmptyState className="global-search-empty" message={t.noCards} />)}
        {results && results.cards.length > 0 && results.cards.length < results.total
          && <p className="global-search-empty global-search-total" role="status">{t.found(results.total, RESULT_LIMIT)}</p>}
        <div className="global-search-syntax"><button type="button" className="control control-ghost" aria-expanded={syntaxOpen} onClick={() => setSyntaxOpen(current => !current)}>{t.syntax}</button>
          {syntaxOpen && <p>{t.syntaxHint}</p>}
        </div>
      </div>}
    </div>}
  </div>;
}

/** Leading navigation rows link to cards via $ID/gc: or decks via gd:. */
function NavigationRow({ entry, index, highlighted, decksById, tagDefinitions, members, lookups, onHover, onOpen }: {
  entry: { type: 'navigation'; target: GoToTarget };
  index: number;
  highlighted: number;
  decksById: Map<string, CatalogDeck>;
  tagDefinitions?: readonly ProjectTag[];
  members: CatalogMember[];
  lookups: CardTileLookups;
  onHover: () => void;
  onOpen: (target: NavigationTarget) => void;
}) {
  const target = entry.target;
  const t = useText(text);
  if (target.kind === 'card') return <ResultRow card={target.card} index={index} highlighted={highlighted}
    decksById={decksById} members={members} tagDefinitions={tagDefinitions} lookups={lookups} navigation
    onHover={onHover} onOpen={() => onOpen(target)} />;
  const title = target.deck.title;
  return <li id={`global-search-option-${index}`} role="option" aria-selected={index === highlighted}>
    <button type="button" className="global-search-row global-search-nav" onMouseDown={event => event.preventDefault()}
      onMouseEnter={onHover} onClick={() => onOpen(target)}
      title={t.goTo(title)}>
      <span className="global-search-kind is-nav" aria-hidden="true"><ArrowRight size={12} /></span>
      <span className="global-search-card-main">
        <span className="global-search-title"><span className="global-search-nav-label">{t.goToLabel}</span> {title}</span>
      </span>
      <span className="global-search-deck-dot" style={{ '--deck-color': target.deck.color } as CSSProperties} aria-label={t.deck(title)} />
    </button>
  </li>;
}

function ResultRow({ card, index, highlighted, decksById, members, tagDefinitions, lookups, query = '', navigation = false, onHover, onOpen }: {
  card: CatalogCard;
  index: number;
  highlighted: number;
  decksById: Map<string, CatalogDeck>;
  members: CatalogMember[];
  tagDefinitions?: readonly ProjectTag[];
  lookups: CardTileLookups;
  query?: string;
  navigation?: boolean;
  onHover: () => void;
  onOpen: (card: CatalogCard) => void;
}) {
  const deck: CatalogDeck | undefined = card.deckId ? decksById.get(card.deckId) : undefined;
  const t = useText(text);
  const lang = useLang();
  const Icon = cardIcons[card.kind];
  const status = cardFaceStatus(card, lookups, lang);
  const owner = memberForOwner(card.owner, members)?.label ?? card.owner;
  const ownerLabel = ownerProgressLabel(owner, lookups.checklistByCard.get(card.id), lang);
  return <li id={`global-search-option-${index}`} role="option" aria-selected={index === highlighted}>
    <button type="button" className={`global-search-row${navigation ? ' global-search-nav' : ''}`} onMouseDown={event => event.preventDefault()}
      onMouseEnter={onHover} onClick={event => { event.preventDefault(); onOpen(card); }}
      title={navigation ? t.goTo(card.title) : t.open(card.title)}>
      <span className={`global-search-kind is-${card.kind}`} aria-hidden="true"><Icon size={12} /></span>
      <span className="visually-hidden">{kindLabel(card.kind, lang)}</span>
      <span className="global-search-card-main">
        <span className="global-search-title">{navigation && <span className="global-search-nav-label">{t.goToLabel} </span>}{card.title}</span>
        <CardTags tags={matchedTagsFirst(card.tags, query)} definitions={tagDefinitions} compact maxVisible={2} />
        <span className="global-search-card-meta">
          <CardMetrics card={card} lookups={lookups} />
          {deck && <span className="global-search-deck" style={{ '--deck-color': deck.color } as CSSProperties} title={deck.title}>
            <span className="global-search-deck-dot" aria-hidden="true" />{deck.title}</span>}
          {owner && <span className="global-search-owner" title={ownerLabel} aria-label={ownerLabel}>{owner}</span>}
        </span>
        <CardFaceStatus status={status} hideQuestions />
      </span>
    </button>
  </li>;
}
