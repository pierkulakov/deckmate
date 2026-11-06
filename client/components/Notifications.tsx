// The bottom-right corner groups notifications into three stacks: Cards you own (others' journal changes),
// Cards you watch (major changes to cards watched explicitly, through a deck or a live @-mention),
// and Due Cards (due today; removed automatically). Opening a card dismisses its changes;
// holding a stack's button dismisses the whole stack. Due cards cannot be dismissed manually.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { CalendarClock, ChevronDown, ChevronUp, Eye, UserRound } from 'lucide-react';
import type { NotificationCard, NotificationStack, NotificationsView } from '../../src/notification-contracts.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import { onMemberChange, rememberMember, storedMemberId } from '../current-member.ts';
import { defineText, locale, textNow, useLang, useText, type Lang } from '../i18n.ts';
import { stateLabel } from '../locales/common.ts';
import '../notifications.css';

const text = defineText({
  failure: 'Could not get notifications. Check that Deckmate is running.',
  notifications: 'Notifications',
  readOnly: 'The original is read-only: notifications can be dismissed in the test copy.',
  for: 'for',
  member: 'Whose notifications to show',
  noneFor: (name: string) => `No notifications for ${name}`,
  dueHint: 'A due reminder cannot be dismissed with the button: the card leaves when it is accepted, archived, given another due date or Owner; otherwise it leaves tomorrow.',
  dueAccepted: 'leaves when the card is accepted',
  noDeck: 'No deck',
  dueToday: 'Due today',
  moreChanges: (count: number) => `and ${count.toLocaleString(locale())} more ${new Intl.PluralRules('en-US').select(count) === 'one' ? 'change' : 'changes'}`,
  moreCards: (count: number) => `${count.toLocaleString(locale())} more ${new Intl.PluralRules('en-US').select(count) === 'one' ? 'card' : 'cards'} — shown after you dismiss these.`,
  dismissStack: (label: string) => `Dismiss the “${label}” stack: press and hold`,
  holdTitle: 'Press and hold to dismiss the whole stack',
  dismiss: 'Dismiss',
  keepHolding: 'Keep holding to dismiss',
  collapseStack: (label: string) => `Collapse “${label}”`,
  expandStack: (label: string, count: string) => `Show “${label}”: ${count}`,
}, {
  failure: 'Не удалось получить уведомления. Проверьте, что Deckmate запущен.',
  notifications: 'Уведомления',
  readOnly: 'Оригинал открыт только для чтения: уведомления убираются в тестовой копии.',
  for: 'для',
  member: 'Чьи уведомления показать',
  noneFor: (name: string) => `Нет уведомлений для ${name}`,
  dueHint: 'Напоминание о сроке кнопкой не убирается: карта уйдёт, когда её примут, уберут в архив, сменят срок или Owner; иначе — завтра.',
  dueAccepted: 'уйдёт, когда карта принята',
  noDeck: 'Без колоды',
  dueToday: 'Срок сегодня',
  moreChanges: (count: number) => `и ещё изменений: ${count.toLocaleString(locale())}`,
  moreCards: (count: number) => `Ещё карт: ${count.toLocaleString(locale())} — покажутся, когда уберёте эти.`,
  dismissStack: (label: string) => `Убрать стек «${label}»: нажмите и удерживайте`,
  holdTitle: 'Нажмите и удерживайте, чтобы убрать весь стек',
  dismiss: 'Убрать',
  keepHolding: 'Удерживайте, чтобы убрать',
  collapseStack: (label: string) => `Свернуть «${label}»`,
  expandStack: (label: string, count: string) => `Показать «${label}»: ${count}`,
});

const holdToDismissMs = 800;
const holdHintMs = 1600;
// Deck keeps the open card in the address through history.replaceState, which fires no event: a cheap check once a
// second tells that a card with news is open.
const openCardCheckMs = 1000;
// «Due today» changes at midnight without any file changing.
const dueRefreshMs = 60000;
const stackIcons = { owned: UserRound, watching: Eye, due: CalendarClock } as const;

// 2026-11-05: «Due Cards» cannot be dismissed by hand and covered the open card's last controls at 1280 px, so the viewer can
// fold it into a pill with the count; the choice is kept per viewer. Without storage it lasts until reload.
const dueCollapsedKey = (memberId: string) => `deckmate-notifications-due-collapsed:${memberId}`;
function storedDueCollapsed(memberId: string): boolean {
  try { return localStorage.getItem(dueCollapsedKey(memberId)) === '1'; } catch { return false; }
}
function rememberDueCollapsed(memberId: string, collapsed: boolean): void {
  try {
    if (collapsed) localStorage.setItem(dueCollapsedKey(memberId), '1');
    else localStorage.removeItem(dueCollapsedKey(memberId));
  } catch { /* a full or blocked store keeps the choice in memory only */ }
}

type DismissTarget = { cardId: string } | { stack: 'owned' | 'watching' };

function failureMessage(failure: unknown): string {
  if (failure && typeof failure === 'object' && 'message' in failure) return String(failure.message);
  return textNow(text).failure;
}

function ago(moment: string, lang: Lang): string {
  const relativeTime = new Intl.RelativeTimeFormat(locale(lang), { numeric: 'auto' });
  const minutes = Math.round((Date.parse(moment) - Date.now()) / 60000);
  if (Math.abs(minutes) < 60) return relativeTime.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  return Math.abs(hours) < 24 ? relativeTime.format(hours, 'hour') : relativeTime.format(Math.round(hours / 24), 'day');
}

/** 2026-11-05: the corner is fixed over the scrolling views. The height it covers from the window bottom becomes
 *  --notifications-clearance, the bottom padding of the scroll owners (styles.css, workspace.css), so their last rows scroll out from under it. */
function publishClearance(corner: HTMLElement | null) {
  if (!corner) return;
  const root = document.documentElement.style;
  const observer = new ResizeObserver(() => root.setProperty('--notifications-clearance', `${Math.ceil(innerHeight - corner.getBoundingClientRect().top)}px`));
  observer.observe(corner);
  return () => { observer.disconnect(); root.removeProperty('--notifications-clearance'); };
}

export function Notifications({ snapshot, refreshKey, onOpenCard }: {
  snapshot: WorkspaceSnapshot;
  refreshKey: number;
  onOpenCard: (id: string) => void;
}) {
  const [memberId, setMemberId] = useState(() => storedMemberId() ?? '');
  const t = useText(text);
  const lang = useLang();
  const [view, setView] = useState<NotificationsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestNumber = useRef(0);
  const currentView = useRef<NotificationsView | null>(null);
  const lastSeen = useRef('');
  const [dueCollapsedBy, setDueCollapsedBy] = useState<Record<string, boolean>>({});
  // The toggled control unmounts, so focus moves to its counterpart instead of falling to the page.
  const focusAfterToggle = useRef<'pill' | 'collapse' | null>(null);
  currentView.current = view;
  const token = (snapshot as WorkspaceSnapshot & { token?: string }).token;

  const load = useCallback(async () => {
    const selectedRequest = ++requestNumber.current;
    try {
      const member = memberId ? `&member=${encodeURIComponent(memberId)}` : '';
      const response = await fetch(`/api/notifications?source=${snapshot.source}${member}`, { cache: 'no-store' });
      const result: unknown = await response.json();
      if (!response.ok) throw result;
      if (selectedRequest !== requestNumber.current) return;
      const next = result as NotificationsView;
      setView(next);
      setError(null);
      // The default member becomes an explicit choice, so page edits are attributed to the same «me».
      if (!storedMemberId() && next.member) rememberMember(next.member.id);
    } catch (failure) {
      if (selectedRequest === requestNumber.current) setError(failureMessage(failure));
    }
  }, [snapshot.source, memberId, lang]);

  useEffect(() => { void load(); }, [load, refreshKey]);
  useEffect(() => {
    const timer = setInterval(() => void load(), dueRefreshMs);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => onMemberChange(setMemberId), []);

  const dismiss = useCallback(async (target: DismissTarget, at: string) => {
    const shown = currentView.current;
    if (!shown?.member || !shown.writable || !token) return;
    const selectedRequest = ++requestNumber.current;
    setBusy(true);
    try {
      const response = await fetch('/api/notifications/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-deckmate-token': token },
        body: JSON.stringify({ source: shown.source, memberId: shown.member.id, ...target, at }),
      });
      if (!response.ok) throw await response.json();
      if (selectedRequest === requestNumber.current) { await load(); setError(null); }
    } catch (failure) {
      if (selectedRequest === requestNumber.current) setError(failureMessage(failure));
    } finally { setBusy(false); }
  }, [token, load]);

  // Opening a card dismisses its changes regardless of which view opened it.
  useEffect(() => {
    const timer = setInterval(() => {
      const cardId = new URLSearchParams(location.search).get('card');
      if (!cardId) return;
      // Every journal stack of that card is seen at once, so the mark is its newest listed change.
      const latest = currentView.current?.stacks
        .flatMap(stack => stack.cards.filter(item => item.cardId === cardId && item.latestAt).map(item => item.latestAt!))
        .sort()
        .at(-1);
      if (!latest || lastSeen.current === cardId + '@' + latest) return;
      lastSeen.current = cardId + '@' + latest;
      void dismiss({ cardId }, latest);
    }, openCardCheckMs);
    return () => clearInterval(timer);
  }, [dismiss]);

  function openCard(card: NotificationCard) {
    if (card.latestAt) {
      lastSeen.current = card.cardId + '@' + card.latestAt;
      void dismiss({ cardId: card.cardId }, card.latestAt);
    }
    onOpenCard(card.cardId);
  }

  // 2026-11-05: one cursor covers hidden cards too, without marking the other journal stack as seen.
  function dismissStack(stack: NotificationStack) {
    if (!stack.latestAt || stack.id === 'due') return;
    void dismiss({ stack: stack.id }, stack.latestAt);
  }

  const viewerId = view?.member?.id ?? '';
  const dueCollapsed = viewerId !== '' && (dueCollapsedBy[viewerId] ?? storedDueCollapsed(viewerId));
  function collapseDue(collapsed: boolean) {
    if (!viewerId) return;
    focusAfterToggle.current = collapsed ? 'pill' : 'collapse';
    setDueCollapsedBy(current => ({ ...current, [viewerId]: collapsed }));
    rememberDueCollapsed(viewerId, collapsed);
  }
  const focusOnMount = (target: 'pill' | 'collapse') => (element: HTMLButtonElement | null) => {
    if (!element || focusAfterToggle.current !== target) return;
    focusAfterToggle.current = null;
    element.focus();
  };

  const visibleStacks = view?.stacks.filter(stack => stack.total > 0) ?? [];
  // 2026-11-05: keep the chooser available for a nondefault member even without news, so the user can switch back.
  // Hide the corner only when the default member has no news.
  const defaultMember = view?.members.find(member => member.kind === 'human') ?? view?.members[0];
  const otherMemberChosen = Boolean(view?.member && defaultMember && view.member.id !== defaultMember.id);
  if (!visibleStacks.length && !error && !otherMemberChosen) return null;
  return <section ref={publishClearance} className="notifications-corner" aria-label={t.notifications}>
    {error && <p className="notifications-error" role="alert">{error}</p>}
    {visibleStacks.map(stack => stack.id === 'due' && dueCollapsed
      ? <CollapsedStack key={stack.id} stack={stack} buttonRef={focusOnMount('pill')} onExpand={() => collapseDue(false)} />
      : <NotificationStackView key={stack.id} stack={stack} canDismiss={Boolean(view?.writable && token) && !busy}
        onOpen={openCard} onDismiss={() => dismissStack(stack)}
        collapse={stack.id === 'due' && viewerId ? { ref: focusOnMount('collapse'), onCollapse: () => collapseDue(true) } : undefined} />)}
    {!visibleStacks.length && !error && <p className="notifications-note">{t.noneFor(view?.member?.label ?? '')}</p>}
    {view && !view.writable && visibleStacks.some(stack => stack.dismissible) && <p className="notifications-note">{t.readOnly}</p>}
    {view && view.members.length > 1 && <label className="notifications-member"><span>{t.for}</span>
      <select value={view.member?.id ?? ''} onChange={event => rememberMember(event.target.value)} aria-label={t.member}>
        {view.members.map(member => <option key={member.id} value={member.id}>{member.label}</option>)}
      </select>
    </label>}
    {view?.warnings.map(warning => <p key={warning} className="notifications-note" role="status">{warning}</p>)}
  </section>;
}

function NotificationStackView({ stack, canDismiss, onOpen, onDismiss, collapse }: {
  stack: NotificationStack;
  canDismiss: boolean;
  onOpen: (card: NotificationCard) => void;
  onDismiss: () => void;
  collapse?: { ref: (element: HTMLButtonElement | null) => void; onCollapse: () => void };
}) {
  const headingId = `notification-stack-${stack.id}`;
  const t = useText(text);
  const lang = useLang();
  const Icon = stackIcons[stack.id];
  return <section className={`notification-stack notification-stack-${stack.id}`} aria-labelledby={headingId}>
    <header className="notification-stack-header">
      <Icon size={14} aria-hidden="true" />
      <h3 id={headingId}>{stack.title}</h3>
      <span className="notification-stack-count">{stack.total.toLocaleString(locale(lang))}</span>
      {stack.dismissible
        ? <HoldToDismiss label={stack.title} disabled={!canDismiss || !stack.latestAt} onDismiss={onDismiss} />
        // 2026-11-05: name the condition that removes a due card to avoid implying it will disappear shortly.
        : <span className="notification-stack-hint" title={t.dueHint}>{t.dueAccepted}</span>}
      {collapse && <button ref={collapse.ref} type="button" className="notification-collapse" aria-expanded={true}
        aria-label={t.collapseStack(stack.title)} title={t.collapseStack(stack.title)} onClick={collapse.onCollapse}>
        <ChevronDown size={14} aria-hidden="true" />
      </button>}
    </header>
    <ul className="notification-cards">
      {stack.cards.map(card => <li key={card.cardId}>
        <button type="button" className="notification-card" onClick={() => onOpen(card)}>
          <span className="notification-card-head"><strong>{card.title}</strong><small>{card.deckTitle ?? t.noDeck}</small></span>
          {stack.id === 'due'
            ? <span className="notification-line">{t.dueToday}{card.state ? ` · ${stateLabel(card.state, lang)}` : ''}</span>
            : card.changes.map(change => <span key={change.eventId} className="notification-change">
              <span className="notification-meta">{change.actor} · <time dateTime={change.at} title={new Intl.DateTimeFormat(locale(lang), { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(change.at))}>{ago(change.at, lang)}</time></span>
              {change.lines.map((line, index) => <span key={index} className="notification-line">{line}</span>)}
            </span>)}
          {card.hiddenChanges > 0 && <span className="notification-line notification-line-muted">{t.moreChanges(card.hiddenChanges)}</span>}
        </button>
      </li>)}
    </ul>
    {stack.hidden > 0 && <p className="notification-more">{t.moreCards(stack.hidden)}</p>}
  </section>;
}

function CollapsedStack({ stack, buttonRef, onExpand }: {
  stack: NotificationStack;
  buttonRef: (element: HTMLButtonElement | null) => void;
  onExpand: () => void;
}) {
  const t = useText(text);
  const lang = useLang();
  const Icon = stackIcons[stack.id];
  const count = stack.total.toLocaleString(locale(lang));
  const label = t.expandStack(stack.title, count);
  return <button ref={buttonRef} type="button" className="notification-pill" aria-expanded={false} aria-label={label} title={label} onClick={onExpand}>
    <Icon size={14} aria-hidden="true" />
    <span className="notification-stack-count">{count}</span>
    <ChevronUp size={12} aria-hidden="true" />
  </button>;
}

/** Hold to dismiss a whole stack, so a stray click never clears it.
 *  2026-11-05: releasing early shows a hold hint instead of appearing unresponsive. */
function HoldToDismiss({ label, disabled, onDismiss }: { label: string; disabled: boolean; onDismiss: () => void }) {
  const [holding, setHolding] = useState(false);
  const t = useText(text);
  const [hint, setHint] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    setHolding(false);
  }, []);
  const releaseEarly = useCallback(() => {
    if (!timer.current) return;
    cancel();
    clearTimeout(hintTimer.current);
    setHint(true);
    hintTimer.current = setTimeout(() => setHint(false), holdHintMs);
  }, [cancel]);
  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(hintTimer.current); }, []);
  function start() {
    if (disabled || timer.current) return;
    clearTimeout(hintTimer.current);
    setHint(false);
    setHolding(true);
    timer.current = setTimeout(() => { timer.current = undefined; setHolding(false); onDismiss(); }, holdToDismissMs);
  }
  return <span className="notification-hold-wrap">
    <button type="button" className={`notification-hold${holding ? ' is-holding' : ''}`} disabled={disabled}
      style={{ '--hold-ms': `${holdToDismissMs}ms` } as CSSProperties}
      aria-label={t.dismissStack(label)} title={t.holdTitle}
      onPointerDown={start} onPointerUp={releaseEarly} onPointerLeave={cancel} onPointerCancel={cancel}
      onKeyDown={event => { if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); start(); } }}
      onKeyUp={event => { if (event.key === ' ' || event.key === 'Enter') releaseEarly(); }}>
      <span className="notification-hold-fill" aria-hidden="true" />
      <span className="notification-hold-label">{t.dismiss}</span>
    </button>
    <span className="notification-hold-hint" role="status">{hint ? t.keepHolding : ''}</span>
  </span>;
}
