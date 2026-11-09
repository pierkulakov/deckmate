import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Activity, ArrowRightLeft, Check, Image, Link2, LoaderCircle, Pencil, Plus, RefreshCw, Route, Unlock } from 'lucide-react';
import type { DeckActivityEvent, DeckActivityPage } from '../../src/activity-contracts.ts';
import { activityEventGroups, activityGroupChips, eventMatchesGroups, type ActivityEventGroup } from '../../src/activity-groups.ts';
import type { DataSource } from '../../src/workspace-contracts.ts';
import { Button } from './ui/button.tsx';
import '../deck-activity.css';
import { defineText, formatNumber, locale, textNow, useLang, useText } from '../i18n.ts';
import { stateLabel } from '../locales/common.ts';
import { emitSignal } from '../onboarding/signals.ts';

const text = defineText({
  loadFailedStatus: (status: number) => `Could not load activity (${status}).`,
  invalidPage: 'The server returned an invalid activity page.', connectionFailed: 'Could not reach the server. Try again.',
  loadFailed: 'Could not load activity.', emptyPage: 'No events for this deck in this part of the activity log. You can load earlier entries.',
  emptyWarnings: 'No entries available. Check the activity warnings.', empty: 'This deck’s history starts with the first change through Deckmate.',
  heading: 'Latest activity', refresh: 'Refresh activity', filters: 'Event type filters',
  created: 'Created', status: 'States', properties: 'Properties', content: 'Content', links: 'Links', reset: 'Reset',
  noMatches: 'No loaded events match the filters. Load more or reset the filters.',
  warnings: 'Activity warnings', loadingMore: 'Loading more…', loading: 'Loading activity…', retry: 'Try again', more: 'Show more',
  hideDetails: 'Hide details', details: 'Details',
  moreCards: (count: number) => `${new Intl.NumberFormat('en-US').format(count)} more ${new Intl.PluralRules('en-US').select(count) === 'one' ? 'card' : 'cards'}`,
  moreDetails: (count: number) => `${new Intl.NumberFormat('en-US').format(count)} more ${new Intl.PluralRules('en-US').select(count) === 'one' ? 'detail' : 'details'}`,
}, {
  loadFailedStatus: (status: number) => `Не удалось загрузить журнал (${status}).`,
  invalidPage: 'Сервер вернул некорректную страницу журнала.', connectionFailed: 'Не удалось связаться с сервером. Повторите попытку.',
  loadFailed: 'Не удалось загрузить журнал.', emptyPage: 'В этой части журнала нет событий колоды. Можно загрузить более ранние записи.',
  emptyWarnings: 'Нет доступных записей. Проверьте замечания к журналу.', empty: 'История этой колоды начнётся с первого изменения через Deckmate.',
  heading: 'Последние события', refresh: 'Обновить журнал', filters: 'Фильтры типов событий',
  created: 'Создано', status: 'Статусы', properties: 'Свойства', content: 'Текст', links: 'Связи', reset: 'Сбросить',
  noMatches: 'Среди загруженных событий нет совпадений с фильтрами. Загрузите ещё или сбросьте фильтры.',
  warnings: 'Замечания к журналу', loadingMore: 'Загружаем ещё…', loading: 'Загружаем журнал…', retry: 'Повторить', more: 'Показать ещё',
  hideDetails: 'Скрыть подробности', details: 'Подробности',
  moreCards: (count: number) => `Ещё ${new Intl.NumberFormat('ru-RU').format(count)} карточек`,
  moreDetails: (count: number) => `Ещё ${new Intl.NumberFormat('ru-RU').format(count)} подробностей`,
});

interface DeckActivityProps {
  deckId: string;
  source: DataSource;
  refreshKey: string | number;
  disabled: boolean;
  onOpen: (cardId: string) => void;
}

interface ActivityState extends DeckActivityPage {
  key: string;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  requestCursor: string | null;
}

const actionIcons: Record<string, typeof Activity> = {
  'create-card': Plus, 'create-deck': Plus, 'update-card-content': Pencil, 'update-block': Pencil,
  'update-deck': Pencil, 'set-card-parent': Link2, 'set-card-links': Link2, 'set-card-dependencies': Link2,
  'assign-deck': ArrowRightLeft, 'bulk-assign-deck': ArrowRightLeft, 'move-deck': ArrowRightLeft,
  'set-tracks': Route, 'bulk-add-track': Route, 'apply-journey': Route, 'create-journey': Route,
  'upload-cover': Image, 'update-status': Check, 'card-unlocked': Unlock,
};

function emptyState(key: string): ActivityState {
  return { key, events: [], nextCursor: null, warnings: [], status: 'loading', error: null, requestCursor: null };
}

// 2026-11-09: the last loaded feed of each deck (source, deck, language). The summary remounts whenever an open card closes;
// starting from "Loading…" grew the feed by its events a moment later and pushed the source files below it down (~170 px).
// The remembered feed stays on screen until the fresh page replaces it, like a refresh.
const loadedFeeds = new Map<string, ActivityState>();
const loadedFeedLimit = 20;

function rememberFeed(feed: string, state: ActivityState) {
  loadedFeeds.delete(feed);
  loadedFeeds.set(feed, state);
  if (loadedFeeds.size > loadedFeedLimit) loadedFeeds.delete(loadedFeeds.keys().next().value!);
}

function initialState(feed: string, key: string): ActivityState {
  const remembered = loadedFeeds.get(feed);
  return remembered ? { ...remembered, key } : emptyState(key);
}

async function readActivityPage(response: Response): Promise<DeckActivityPage> {
  const t = textNow(text);
  const result = await response.json();
  if (!response.ok) throw new Error(result?.message ?? result?.error ?? t.loadFailedStatus(response.status));
  if (!result || !Array.isArray(result.events) || !Array.isArray(result.warnings)
    || (result.nextCursor !== null && typeof result.nextCursor !== 'string')) {
    throw new Error(t.invalidPage);
  }
  return result as DeckActivityPage;
}

function activityFailure(error: unknown): string {
  const t = textNow(text);
  if (error instanceof TypeError) return t.connectionFailed;
  if (error instanceof SyntaxError) return t.invalidPage;
  if (error instanceof Error) return error.message;
  return t.loadFailed;
}

function emptyMessage(page: DeckActivityPage): string {
  const t = textNow(text);
  if (page.nextCursor) return t.emptyPage;
  if (page.warnings.length) return t.emptyWarnings;
  return t.empty;
}

/** The journal identifies Deckmate actions; card owners are never event authors. */
export function DeckActivity({ deckId, source, refreshKey, disabled, onOpen }: DeckActivityProps) {
  const t = useText(text);
  const lang = useLang();
  // 2026-11-09: built once per language; four formatters per render took ~2 ms of each deck open and card close.
  const { dayFormat, timeFormat, fullTimeFormat } = useMemo(() => ({
    dayFormat: new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: 'long', year: 'numeric' }),
    timeFormat: new Intl.DateTimeFormat(locale(lang), { hour: '2-digit', minute: '2-digit' }),
    fullTimeFormat: new Intl.DateTimeFormat(locale(lang), { dateStyle: 'full', timeStyle: 'long' }),
  }), [lang]);
  const headingId = useId();
  const key = JSON.stringify([source, deckId, refreshKey, lang]);
  const feed = JSON.stringify([source, deckId, lang]);
  const [state, setState] = useState<ActivityState>(() => initialState(feed, key));
  // Event filters allow multiple selections; an empty set shows all events.
  const [groupFilter, setGroupFilter] = useState<ReadonlySet<ActivityEventGroup>>(() => new Set());
  const requestNumber = useRef(0);
  const requestController = useRef<AbortController | null>(null);

  const load = useCallback(async (cursor: string | null) => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    const request = ++requestNumber.current;
    // A refresh keeps the loaded list on screen until the new page replaces it, so nothing below jumps (2026-11-05).
    setState(previous => ({ ...(previous.key === key ? previous : initialState(feed, key)), status: 'loading', error: null, requestCursor: cursor }));
    const parameters = new URLSearchParams({ source, deckId, limit: '10' });
    if (cursor) parameters.set('cursor', cursor);
    try {
      const response = await fetch(`/api/activity?${parameters}`, { signal: controller.signal, cache: 'no-store' });
      const page = await readActivityPage(response);
      if (controller.signal.aborted || request !== requestNumber.current) return;
      setState(previous => {
        if (previous.key !== key) return previous;
        const combined = new Map<string, DeckActivityEvent>();
        const existing = cursor === null ? [] : previous.events;
        for (const event of [...existing, ...page.events]) if (!combined.has(event.id)) combined.set(event.id, event);
        const warnings = [...new Set([...(cursor === null ? [] : previous.warnings), ...page.warnings])];
        return { key, events: [...combined.values()], nextCursor: page.nextCursor, warnings, status: 'ready', error: null, requestCursor: cursor };
      });
    } catch (error) {
      if (controller.signal.aborted || request !== requestNumber.current) return;
      const message = activityFailure(error);
      setState(previous => previous.key === key ? { ...previous, status: 'error', error: message, requestCursor: cursor } : previous);
    }
  }, [key, feed, source, deckId]);

  useEffect(() => {
    void load(null);
    return () => {
      requestNumber.current += 1;
      requestController.current?.abort();
    };
  }, [load]);
  // 2026-11-05: Deck mounts this feed only while its panel is open (Deck.tsx), so mounting is the person seeing it.
  useEffect(() => { emitSignal({ type: 'panel-opened', panel: 'activity' }); }, []);

  useEffect(() => { if (state.key === key && state.status === 'ready') rememberFeed(feed, state); }, [state, key, feed]);

  // Suppress the previous deck immediately, before the new effect has run.
  const current = state.key === key ? state : initialState(feed, key);
  const loading = current.status === 'loading';
  const refreshing = loading && current.requestCursor === null && current.events.length > 0;
  // Chip counts include all loaded events in each group, independent of the selected filters.
  const loadedCounts = new Map<ActivityEventGroup, number>();
  for (const event of current.events) for (const group of activityEventGroups(event)) loadedCounts.set(group, (loadedCounts.get(group) ?? 0) + 1);
  const visibleEvents = current.events.filter(event => eventMatchesGroups(event, groupFilter));
  const groups = new Map<string, DeckActivityEvent[]>();
  for (const event of visibleEvents) {
    const date = new Date(event.at);
    const minute = `${dayFormat.format(date)} · ${timeFormat.format(date)}`;
    const events = groups.get(minute) ?? [];
    events.push(event);
    groups.set(minute, events);
  }

  return <section className="deck-activity" aria-labelledby={headingId} aria-busy={loading}>
    <header className="deck-activity-heading"><h2 id={headingId}>{t.heading}</h2>
      <Button variant="ghost" size="icon" disabled={disabled || loading} onClick={() => void load(null)} aria-label={t.refresh} title={t.refresh}><RefreshCw size={14} className={refreshing ? 'spin' : undefined} /></Button>
    </header>
    <div className="deck-activity-filters" role="group" aria-label={t.filters}>
      {activityGroupChips.map(chip => {
        const active = groupFilter.has(chip.id);
        return <button type="button" key={chip.id} className="deck-activity-chip" aria-pressed={active}
          disabled={disabled} onClick={() => setGroupFilter(previous => {
            const next = new Set(previous);
            if (next.has(chip.id)) next.delete(chip.id); else next.add(chip.id);
            return next;
          })}>
          {chip.id === 'done' ? stateLabel('done', lang) : t[chip.id]}{loadedCounts.get(chip.id) !== undefined && <span>{formatNumber(loadedCounts.get(chip.id)!, 3, lang)}</span>}
        </button>; })}
      {groupFilter.size > 0 && <button type="button" className="deck-activity-chip deck-activity-chip-clear" disabled={disabled} onClick={() => setGroupFilter(new Set())}>{t.reset}</button>}
    </div>
    {[...groups].map(([minute, events]) => <div className="deck-activity-day" key={minute}>
      <h3><time dateTime={events[0].at} title={fullTimeFormat.format(new Date(events[0].at))}>{minute}</time></h3>
      <ol>{events.map(event => <ActivityEntry key={event.id} event={event} disabled={disabled} onOpen={onOpen} />)}</ol>
    </div>)}
    {current.status === 'ready' && visibleEvents.length === 0 && <p className="deck-activity-empty">
      {groupFilter.size > 0 && current.events.length > 0
        ? t.noMatches
        : emptyMessage(current)}</p>}
    {current.warnings.length > 0 && <details className="deck-activity-warnings"><summary>{t.warnings} · {formatNumber(current.warnings.length, 3, lang)}</summary><ul>{current.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}
    {loading && !refreshing && <p className="deck-activity-loading" role="status"><LoaderCircle size={14} className="spin" />{current.requestCursor !== null ? t.loadingMore : t.loading}</p>}
    {current.error && <div className="deck-activity-error"><p role="alert">{current.error}</p><Button variant="outline" size="sm" disabled={disabled} onClick={() => void load(current.requestCursor)}>{t.retry}</Button></div>}
    {current.nextCursor && (current.status === 'ready' || refreshing) && <div className="deck-activity-more"><Button variant="outline" size="sm" disabled={disabled || loading} onClick={() => void load(current.nextCursor)}>{t.more}</Button></div>}
  </section>;
}

function ActivityEntry({ event, disabled, onOpen }: { event: DeckActivityEvent; disabled: boolean; onOpen: (cardId: string) => void }) {
  const t = useText(text);
  const [expanded, setExpanded] = useState(false);
  const [detailLimit, setDetailLimit] = useState(20);
  const [cardLimit, setCardLimit] = useState(20);
  const Icon = actionIcons[event.action] ?? Activity;
  const visibleCards = event.cards.slice(0, 3);
  const hasDetails = event.details.length > 0 || event.cards.length > 1;
  const detailsId = useId();
  // 2026-11-04: the member ID is recorded authorship; a card owner is not an event author.
  const actor = event.actorMemberId ?? event.actor;
  const actorLabel = event.actorMemberId ? `${event.actorMemberId} · ${event.actor}` : event.actor;
  return <li className="deck-activity-event">
    <span className="deck-activity-avatar" role="img" aria-label={actorLabel} title={actorLabel}>{actor.slice(0, 1).toUpperCase()}</span>
    <div className="deck-activity-event-body">
      <div className="deck-activity-event-line">
        <span className="deck-activity-icon" aria-hidden="true"><Icon size={16} /></span>
        <div className="deck-activity-description">
          {visibleCards.length > 0 && <span className="deck-activity-cards">{visibleCards.map(card => <button type="button" key={card.id} disabled={disabled} onClick={() => onOpen(card.id)} title={card.title}>{card.title}</button>)}</span>}
          {hasDetails ? <button type="button" className="deck-activity-summary deck-activity-disclosure" aria-expanded={expanded} aria-controls={detailsId}
            aria-label={`${expanded ? t.hideDetails : t.details}: ${event.summary}`} title={event.summary} onClick={() => setExpanded(!expanded)}>{event.summary}</button>
            : <span className="deck-activity-summary" title={event.summary}>{event.summary}</span>}
        </div>
      </div>
      <div id={detailsId} hidden={!expanded} className="deck-activity-details">
        {expanded && <><p>{event.summary}</p><div className="deck-activity-cards">{event.cards.slice(0, cardLimit).map(card => <button type="button" key={card.id} disabled={disabled} onClick={() => onOpen(card.id)} title={card.title}>{card.title}</button>)}</div>
          {event.cards.length > cardLimit && <Button variant="ghost" size="sm" onClick={() => setCardLimit(limit => limit + 20)}>{t.moreCards(Math.min(20, event.cards.length - cardLimit))}</Button>}</>}
        {expanded && event.details.length > 0 && <><ul>{event.details.slice(0, detailLimit).map((detail, index) => <li key={index}>{detail}</li>)}</ul>
          {event.details.length > detailLimit && <Button variant="ghost" size="sm" onClick={() => setDetailLimit(limit => limit + 20)}>{t.moreDetails(Math.min(20, event.details.length - detailLimit))}</Button>}</>}
      </div>
    </div>
  </li>;
}
