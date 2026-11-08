// Global card search opens with "/" from anywhere.
// The query language itself (words, tags, owners, deck:/kind:/state:, property and content filters, $ID / gd: / gc:
// navigation) lives in search-query.ts; active filters show as removable pills below the search bar.
import { useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import type { CatalogCard, CatalogDeck, CatalogMember } from '../../src/catalog-contracts.ts';
import type { ProjectTag } from '../../src/project-tags.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import { useCatalog } from '../useCatalog.ts';
import { currentMember } from '../current-member.ts';
import { matchShortcut, shortcutTargetBlocked } from '../keyboard-shortcuts.ts';
import { RESULT_LIMIT, runSearch, parseSearch, toggleTagOr, withoutToken, type FilterToken, type NavigationTarget } from '../search-query.ts';
import { cardIcons } from './CatalogCardTile.tsx';
import { CardOwnerAvatar } from './CardQuickSettings.tsx';
import { CardTags, TagBadge, TagTitlePrefix } from './CardTags.tsx';
import { StatusBadge } from './StatusMenu.tsx';
import { defineText, locale, useLang, useText } from '../i18n.ts';
import { kindLabel } from '../locales/common.ts';
import { emitSignal } from '../onboarding/signals.ts';
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
  contains: (query: string) => `contains '${query}'`,
  results: 'Search results',
  content: 'Content',
  goToCard: 'Go to card',
  empty: 'Nothing found. Try a different query or filters.',
  noCards: 'The project has no cards yet.',
  found: (total: number, limit: number) => `Found ${total.toLocaleString(locale())} — showing the first ${limit.toLocaleString(locale())}.`,
  goTo: (title: string) => `Go to: ${title}`,
  goToLabel: 'Go to:',
  deck: (title: string) => `Deck: ${title}`,
  open: (title: string) => `Open: ${title}`,
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
  contains: (query: string) => `содержит «${query}»`,
  results: 'Результаты поиска',
  content: 'Содержимое',
  goToCard: 'Перейти к карточке',
  empty: 'Ничего не найдено. Измените запрос или фильтры.',
  noCards: 'В проекте пока нет карточек.',
  found: (total: number, limit: number) => `Найдено ${total.toLocaleString(locale())} — показаны первые ${limit.toLocaleString(locale())}.`,
  goTo: (title: string) => `Перейти: ${title}`,
  goToLabel: 'Перейти:',
  deck: (title: string) => `Колода: ${title}`,
  open: (title: string) => `Открыть: ${title}`,
});

type GoToTarget = Exclude<NavigationTarget, { kind: 'ambiguous' }>;

/** One combined list row: a navigation suggestion ("Go to: ...") or a plain search result. */
type SearchEntry = { type: 'navigation'; target: GoToTarget } | { type: 'card'; card: CatalogCard };

function SearchFilterLabel({ token, definitions = [] }: { token: FilterToken; definitions?: readonly ProjectTag[] }) {
  if (token.kind !== 'tag') return <span>{token.raw}</span>;
  const names = token.raw.replace(/^!?#/u, '').split('|').map(name => name.replace(/^#/u, '')).filter(Boolean);
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

export function GlobalSearch({ snapshot, refreshKey, onOpenCard }: {
  snapshot: WorkspaceSnapshot;
  refreshKey: number;
  onOpenCard: (id: string) => void;
}) {
  const { catalog, error } = useCatalog(snapshot, refreshKey);
  const t = useText(text);
  const lang = useLang();
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const fieldRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const deferredValue = useDeferredValue(value);
  // My Cards and hand:in/not use the same member: the last hand selection, otherwise the first registered human.
  const member = useMemo(() => currentMember(catalog?.members ?? []), [catalog]);
  const results = useMemo(() => catalog && deferredValue.trim() ? runSearch(catalog, deferredValue, member?.id ?? null) : null, [catalog, deferredValue, member, lang]);
  // Ambiguous short references show an explanation above the list, outside keyboard navigation.
  const goTo = useMemo<GoToTarget[]>(() => results
    ? results.navigation.filter((target): target is GoToTarget => target.kind !== 'ambiguous')
    : [], [results]);
  const ambiguous = useMemo(() => results?.navigation.filter(target => target.kind === 'ambiguous') ?? [], [results]);
  const entries = useMemo<SearchEntry[]>(() => [
    ...goTo.map(target => ({ type: 'navigation' as const, target })),
    ...results?.cards.map(card => ({ type: 'card' as const, card })) ?? [],
  ], [goTo, results]);

  // Filter pills use the current input rather than deferred input so removal appears immediately.
  const pills = useMemo(() => parseSearch(value).filter((token): token is FilterToken => token.kind !== 'nav'), [value]);
  const tagPills = pills.filter(token => token.kind === 'tag' && !token.negated);
  const tagValues = tagPills.flatMap(token => token.alternatives ?? [token.value]);
  // Multiple tags show an "or" pill that toggles between AND and OR.
  const tagOrActive = tagPills.some(token => (token.alternatives?.length ?? 0) > 1);

  function removeFilter(token: FilterToken) {
    const next = withoutToken(value, token);
    setValue(next);
    if (!next.trim()) setOpen(false);
    inputRef.current?.focus();
  }

  function toggleOr() {
    setValue(toggleTagOr(value));
    inputRef.current?.focus();
  }

  // "/" focuses the field; "q" toggles My Cards.
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      // One registry and one «typing / dialog open» check for every shortcut (keyboard-shortcuts.ts).
      const shortcut = matchShortcut(event);
      if (!shortcut || shortcutTargetBlocked(event)) return;
      if (shortcut.id === 'focus-search') {
        event.preventDefault();
        inputRef.current?.focus();
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
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [member, value]);
  // 2026-11-05: quests count a settled search, not each keystroke; the same query twice in a row is one search.
  const lastSearched = useRef('');
  useEffect(() => {
    if (!value.trim()) return;
    const timer = setTimeout(() => { if (value !== lastSearched.current) { lastSearched.current = value; emitSignal({ type: 'search', query: value }); } }, 800);
    return () => clearTimeout(timer);
  }, [value]);

  useEffect(() => { setHighlighted(0); }, [results]);

  // Clicking outside a focusable element still counts as leaving the search.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!fieldRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (highlighted === 0) return;
    document.getElementById(`global-search-option-${highlighted}`)?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  function openResult(card: CatalogCard) {
    setOpen(false);
    onOpenCard(card.id);
    inputRef.current?.blur();
  }

  function openNavigation(target: NavigationTarget) {
    if (target.kind === 'ambiguous') return;
    setOpen(false);
    if (target.kind === 'deck') {
      // Deck reads ?deck=<id> only on mount (Deck.tsx, initialScope).
      // Search has no open-deck callback, so navigation reloads the page.
      location.href = `/?view=deck&catalogSource=${encodeURIComponent(snapshot.source)}&deck=${encodeURIComponent(target.deck.id)}`;
      return;
    }
    onOpenCard(target.card.id);
    inputRef.current?.blur();
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      // Escape removes the last filter pill; with no pills left, it closes the overlay.
      if (pills.length) { removeFilter(pills[pills.length - 1]); return; }
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    const count = entries.length;
    if (!count) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setHighlighted(index => (index + step + count) % count);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const entry = entries[highlighted] ?? entries[0];
      if (entry.type === 'navigation') openNavigation(entry.target); else openResult(entry.card);
    }
  }

  const decksById = useMemo(() => new Map(catalog?.decks.map(deck => [deck.id, deck])), [catalog]);
  const members = catalog?.members ?? [];
  // 2026-11-04: operators describe filters/navigation, not literal content; matching stays in search-query.ts.
  const query = deferredValue.trim();
  const hasOperators = query.split(/\s+/u).some(token => /^(?:\$.+|[!#@]|(?:t|sub|gd|gc|deck|kind|state|effort|priority|run|milestone|hand|due):)/iu.test(token));

  return <div className="global-search" ref={fieldRef}>
    <div className={`global-search-field${open ? ' is-open' : ''}`}>
      <Search size={20} strokeWidth={1.75} aria-hidden="true" />
      <input ref={inputRef} type="search" role="combobox" aria-label={t.searchCards} aria-expanded={open}
        aria-controls="global-search-results" aria-activedescendant={open && entries.length ? `global-search-option-${highlighted}` : undefined}
        aria-autocomplete="list" placeholder={t.searchPlaceholder} autoComplete="off" spellCheck={false}
        value={value} onKeyDown={onKeyDown}
        onFocus={() => { if (value.trim()) setOpen(true); }}
        onBlur={event => { if (!fieldRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false); }}
        onChange={event => { setValue(event.target.value); setOpen(Boolean(event.target.value.trim())); }} />
      <kbd className="global-search-key" aria-hidden="true">/</kbd>
    </div>
    {open && <div className="global-search-pop">
      {error && <p className="global-search-empty" role="alert">{error}</p>}
      {!error && !catalog && <p className="global-search-empty" role="status">{t.loading}</p>}
      {!error && catalog && <div className="global-search-sections">
        {pills.length > 0 && <div className="global-search-pills" role="group" aria-label={t.activeFilters}>
          {pills.map(token => <button key={token.start} type="button" className="global-search-pill"
            onMouseDown={event => event.preventDefault()}
            title={t.removeFilter} aria-label={t.removeFilterNamed(token.raw)}
            onClick={() => removeFilter(token)}>
            <SearchFilterLabel token={token} definitions={catalog.projectTags} /><X size={11} aria-hidden="true" />
          </button>)}
          {tagValues.length >= 2 && <button type="button"
            className={`global-search-pill is-toggle${tagOrActive ? ' is-on' : ''}`}
            onMouseDown={event => event.preventDefault()}
            aria-pressed={tagOrActive}
            title={tagOrActive ? t.disableOr : t.enableOr}
            onClick={toggleOr}>{t.or}</button>}
        </div>}
        <section className="global-search-content" aria-labelledby="global-search-content-label">
          <h3 id="global-search-content-label" className="global-search-section-label">{t.content}</h3>
          <p className="global-search-query">{hasOperators ? query : t.contains(query)}</p>
        </section>
        <div id="global-search-results" role="listbox" aria-label={t.results} className="global-search-navigation">
          <div role="group" aria-labelledby="global-search-navigation-label">
            <h3 id="global-search-navigation-label" className="global-search-section-label">{t.goToCard}</h3>
            {ambiguous.map(({ message }, index) => <p key={`ambiguous-${index}`} className="global-search-nav-note" role="status">{message}</p>)}
            <ul role="presentation" className="global-search-results">
              {entries.map((entry, index) => entry.type === 'navigation'
                ? <NavigationRow key={entry.target.kind === 'deck' ? `nav-deck-${entry.target.deck.id}` : `nav-card-${entry.target.card.id}`}
                    entry={entry} index={index} highlighted={highlighted} decksById={decksById} tagDefinitions={catalog.projectTags}
                    onHover={() => setHighlighted(index)} onOpen={openNavigation} />
                : <ResultRow key={`result-${entry.card.id}`} card={entry.card} index={index} highlighted={highlighted}
                    decksById={decksById} members={members} tagDefinitions={catalog.projectTags}
                    onHover={() => setHighlighted(index)} onOpen={openResult} />)}
            </ul>
          </div>
        </div>
        {/* 2026-11-06: in a project without cards the query is not at fault, so the message says what is missing. */}
        {results && !entries.length && !ambiguous.length && <p className="global-search-empty" role="status">{catalog.cards.length ? t.empty : t.noCards}</p>}
        {results && results.cards.length > 0 && results.cards.length < results.total
          && <p className="global-search-empty global-search-total" role="status">{t.found(results.total, RESULT_LIMIT)}</p>}
      </div>}
      <footer className="global-search-syntax" aria-hidden="true">{t.syntaxHint}</footer>
    </div>}
  </div>;
}

/** Leading navigation rows link to cards via $ID/gc: or decks via gd:. */
function NavigationRow({ entry, index, highlighted, decksById, tagDefinitions, onHover, onOpen }: {
  entry: { type: 'navigation'; target: GoToTarget };
  index: number;
  highlighted: number;
  decksById: Map<string, CatalogDeck>;
  tagDefinitions?: readonly ProjectTag[];
  onHover: () => void;
  onOpen: (target: NavigationTarget) => void;
}) {
  const target = entry.target;
  const t = useText(text);
  const deck = target.kind === 'card' && target.card.deckId ? decksById.get(target.card.deckId) : undefined;
  const title = target.kind === 'deck' ? target.deck.title : target.card.title;
  return <li id={`global-search-option-${index}`} role="option" aria-selected={index === highlighted}>
    <button type="button" className="global-search-row global-search-nav" onMouseDown={event => event.preventDefault()}
      onMouseEnter={onHover} onClick={() => onOpen(target)}
      title={t.goTo(title)}>
      <span className="global-search-kind is-nav" aria-hidden="true"><ArrowRight size={12} /></span>
      <span className="global-search-card-main">
        <span className="global-search-title"><span className="global-search-nav-label">{t.goToLabel}</span> {target.kind === 'card' && <TagTitlePrefix tags={target.card.tags} definitions={tagDefinitions} />}{title}</span>
        {target.kind === 'card' && <CardTags tags={target.card.tags} definitions={tagDefinitions} compact />}
      </span>
      {target.kind === 'deck' && <span className="global-search-deck-dot" style={{ '--deck-color': target.deck.color } as CSSProperties} aria-label={t.deck(title)} />}
      {deck && <span className="global-search-deck" style={{ '--deck-color': deck.color } as CSSProperties} title={deck.title}>
        <span className="global-search-deck-dot" aria-hidden="true" />{deck.title}</span>}
    </button>
  </li>;
}

function ResultRow({ card, index, highlighted, decksById, members, tagDefinitions, onHover, onOpen }: {
  card: CatalogCard;
  index: number;
  highlighted: number;
  decksById: Map<string, CatalogDeck>;
  members: CatalogMember[];
  tagDefinitions?: readonly ProjectTag[];
  onHover: () => void;
  onOpen: (card: CatalogCard) => void;
}) {
  const deck: CatalogDeck | undefined = card.deckId ? decksById.get(card.deckId) : undefined;
  const t = useText(text);
  const lang = useLang();
  const Icon = cardIcons[card.kind];
  return <li id={`global-search-option-${index}`} role="option" aria-selected={index === highlighted}>
    <button type="button" className="global-search-row" onMouseDown={event => event.preventDefault()}
      onMouseEnter={onHover} onClick={event => { event.preventDefault(); onOpen(card); }}
      title={t.open(card.title)}>
      <span className={`global-search-kind is-${card.kind}`} aria-hidden="true"><Icon size={12} /></span>
      <span className="visually-hidden">{kindLabel(card.kind, lang)}</span>
      <span className="global-search-card-main">
        <span className="global-search-title"><TagTitlePrefix tags={card.tags} definitions={tagDefinitions} />{card.title}</span>
        <CardTags tags={card.tags} definitions={tagDefinitions} compact maxVisible={2} />
        <span className="global-search-card-meta">
          {deck && <span className="global-search-deck" style={{ '--deck-color': deck.color } as CSSProperties} title={deck.title}>
            <span className="global-search-deck-dot" aria-hidden="true" />{deck.title}</span>}
          {card.state && <StatusBadge state={card.state} />}
          {card.owner && <CardOwnerAvatar owner={card.owner} members={members} />}
        </span>
      </span>
    </button>
  </li>;
}
