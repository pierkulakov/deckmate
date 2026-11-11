import { moveFocus } from '../focus.ts';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Bell, CalendarClock, ChevronDown, ChevronUp, Eye, UserRound, X } from 'lucide-react';
import type { NotificationCard, NotificationStack, NotificationStackId, NotificationsView } from '../../src/notification-contracts.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import { onMemberChange, rememberMember, storedMemberId } from '../current-member.ts';
import { defineText, locale, textNow, useLang, useText } from '../i18n.ts';
import { relativeTimeAgo } from '../relative-time.ts';
import { stateLabel } from '../locales/common.ts';
import { failureMessage } from '../failure-message.ts';
import { ErrorState } from './ErrorState.tsx';
import { LoadingState } from './LoadingState.tsx';
import { Button } from './ui/button.tsx';
import { readOnlyDescription } from '../source-access.ts';
import { prepareEntrance } from '../prepared-motion.ts';
import { useSelectEscapeGuard } from '../select-escape.ts';
import '../notifications.css';

const text = defineText({
  failure: 'Could not get notifications. Check that Deckmate is running.',
  notifications: 'Notifications',
  loading: 'Loading notifications…',
  readOnly: 'Notifications can be dismissed in a source with write access.',
  close: 'Close notifications',
  entry: (count: number) => `Notifications: ${count.toLocaleString(locale())}`,
  for: 'Acting as',
  member: 'Acting member',
  noneFor: (name: string) => `No notifications for ${name}`,
  none: 'No notifications',
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
  loading: 'Загружаем уведомления…',
  readOnly: 'Уведомления можно убрать в источнике с разрешённой записью.',
  close: 'Закрыть уведомления',
  entry: (count: number) => `Уведомления: ${count.toLocaleString(locale())}`,
  for: 'От имени',
  member: 'Действующий участник',
  noneFor: (name: string) => `Нет уведомлений для ${name}`,
  none: 'Нет уведомлений',
  dueHint: 'Напоминание о сроке кнопкой не убирается: карточка уйдёт, когда её примут, уберут в архив, сменят срок или исполнителя; иначе — завтра.',
  dueAccepted: 'уйдёт, когда карточка принята',
  noDeck: 'Без колоды',
  dueToday: 'Срок сегодня',
  moreChanges: (count: number) => `и ещё изменений: ${count.toLocaleString(locale())}`,
  moreCards: (count: number) => `Ещё карточек: ${count.toLocaleString(locale())} — покажутся, когда уберёте эти.`,
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

// Keep the existing Due Cards key so an earlier collapse choice is not lost.
const collapsedKey = (memberId: string, stack: NotificationStackId) => `deckmate-notifications-${stack}-collapsed:${memberId}`;
function storedCollapsed(memberId: string, stack: NotificationStackId): boolean | undefined {
  try {
    const value = localStorage.getItem(collapsedKey(memberId, stack));
    if (value === '1') return true;
    if (value === '0') return false;
  } catch { /* a blocked store keeps the choice in memory only */ }
  return undefined;
}
function rememberCollapsed(memberId: string, stack: NotificationStackId, collapsed: boolean): void {
  try { localStorage.setItem(collapsedKey(memberId, stack), collapsed ? '1' : '0'); }
  catch { /* a full or blocked store keeps the choice in memory only */ }
}

function useCompactNotifications(): boolean {
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 480px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 480px)');
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return compact;
}

type DismissTarget = { cardId: string } | { stack: 'owned' | 'watching' };

export function Notifications({ snapshot, refreshKey, onOpenCard, open: controlledOpen, onOpenChange }: {
  snapshot: WorkspaceSnapshot;
  refreshKey: number;
  onOpenCard: (id: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  useSelectEscapeGuard();
  const [memberId, setMemberId] = useState(() => storedMemberId() ?? '');
  const t = useText(text);
  const lang = useLang();
  const [view, setView] = useState<NotificationsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const trigger = useRef<HTMLButtonElement>(null);
  const interactedOutside = useRef(false);
  const restoreFocus = useRef(false);
  const requestNumber = useRef(0);
  const currentView = useRef<NotificationsView | null>(null);
  const lastSeen = useRef('');
  const compact = useCompactNotifications();
  const [collapsedBy, setCollapsedBy] = useState<Record<string, Partial<Record<NotificationStackId, boolean>>>>({});
  // The toggled control unmounts, so focus moves to its counterpart instead of falling to the page.
  const focusAfterToggle = useRef<{ stack: NotificationStackId; target: 'pill' | 'collapse' } | null>(null);
  currentView.current = view;
  const token = (snapshot as WorkspaceSnapshot & { token?: string }).token;

  const load = useCallback(async () => {
    const selectedRequest = ++requestNumber.current;
    setLoading(true);
    try {
      const member = memberId ? `&member=${encodeURIComponent(memberId)}` : '';
      const response = await fetch(`/api/notifications?source=${snapshot.source}${member}`, { cache: 'no-store' });
      const result: unknown = await response.json();
      if (!response.ok) throw result;
      if (selectedRequest !== requestNumber.current) return;
      const next = result as NotificationsView;
      setView(next);
      setError(null);
    } catch (failure) {
      if (selectedRequest === requestNumber.current) setError(failureMessage(failure, textNow(text).failure));
    } finally {
      if (selectedRequest === requestNumber.current) setLoading(false);
    }
  }, [snapshot.source, memberId, lang]);

  useEffect(() => { void load(); return () => { requestNumber.current++; }; }, [load, refreshKey]);
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
      if (selectedRequest === requestNumber.current) setError(failureMessage(failure, textNow(text).failure));
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

  function changeOpen(next: boolean) {
    restoreFocus.current = !next && !interactedOutside.current;
    if (next) interactedOutside.current = false;
    if (onOpenChange) onOpenChange(next);
    else setLocalOpen(next);
  }

  function openCard(card: NotificationCard) {
    if (card.latestAt) {
      lastSeen.current = card.cardId + '@' + card.latestAt;
      void dismiss({ cardId: card.cardId }, card.latestAt);
    }
    interactedOutside.current = true;
    changeOpen(false);
    onOpenCard(card.cardId);
  }

  // 2026-11-05: one cursor covers hidden cards too, without marking the other journal stack as seen.
  function dismissStack(stack: NotificationStack) {
    if (!stack.latestAt || stack.id === 'due') return;
    void dismiss({ stack: stack.id }, stack.latestAt);
  }

  const viewerId = view?.member?.id ?? '';
  function collapseStack(stack: NotificationStackId, collapsed: boolean) {
    if (!viewerId) return;
    focusAfterToggle.current = { stack, target: collapsed ? 'pill' : 'collapse' };
    setCollapsedBy(current => ({ ...current, [viewerId]: { ...current[viewerId], [stack]: collapsed } }));
    rememberCollapsed(viewerId, stack, collapsed);
  }
  const focusOnMount = (stack: NotificationStackId, target: 'pill' | 'collapse') => (element: HTMLButtonElement | null) => {
    if (!element || focusAfterToggle.current?.stack !== stack || focusAfterToggle.current.target !== target) return;
    focusAfterToggle.current = null;
    moveFocus(element);
  };

  const visibleStacks = view?.stacks.filter(stack => stack.total > 0) ?? [];
  const total = visibleStacks.reduce((count, stack) => count + stack.total, 0);
  return <Dialog.Root modal={false} open={open} onOpenChange={changeOpen}>
    <Dialog.Trigger asChild><Button ref={trigger} variant="ghost" size="icon" className="notifications-trigger"
      aria-label={t.entry(total)} title={t.notifications + (view?.member ? ` · ${t.for} ${view.member.label}` : '')}>
      <Bell size={18} aria-hidden="true" />{total > 0 && <span className="page-number">{total.toLocaleString(locale(lang))}</span>}
      {error && <span className="notifications-failure-mark" aria-hidden="true">!</span>}
    </Button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Content ref={prepareEntrance} className="notifications-panel dialog-panel" aria-describedby={undefined}
      onInteractOutside={() => { interactedOutside.current = true; restoreFocus.current = false; }}
      onCloseAutoFocus={event => {
        event.preventDefault();
        if (restoreFocus.current) moveFocus(trigger.current, { preventScroll: true });
        restoreFocus.current = false;
      }}>
      <header className="dialog-head"><Dialog.Title className="dialog-title">{t.notifications}</Dialog.Title>
        <Dialog.Close asChild><Button variant="ghost" size="icon" className="notifications-close" aria-label={t.close}><X size={18} /></Button></Dialog.Close>
      </header>
      <div className="notifications-body dialog-body">
    {view && view.members.length > 0 && <label className="notifications-member"><span>{t.member}</span>
      <select className="control-field" value={view.member?.id ?? ''} onChange={event => rememberMember(event.target.value)} aria-label={t.member}>
        {view.members.map(member => <option key={member.id} value={member.id}>{member.label}</option>)}
      </select>
    </label>}
    <ErrorState variant="inline" className="notifications-error" message={error} onRetry={load} pending={loading} />
    <LoadingState variant="keep-data" active={loading} message={t.loading} />
    {visibleStacks.map(stack => viewerId && (collapsedBy[viewerId]?.[stack.id] ?? storedCollapsed(viewerId, stack.id) ?? compact)
      ? <CollapsedStack key={stack.id} stack={stack} buttonRef={focusOnMount(stack.id, 'pill')} onExpand={() => collapseStack(stack.id, false)} />
      : <NotificationStackView key={stack.id} stack={stack} canDismiss={Boolean(view?.writable && token) && !busy}
        onOpen={openCard} onDismiss={() => dismissStack(stack)}
        collapse={viewerId ? { ref: focusOnMount(stack.id, 'collapse'), onCollapse: () => collapseStack(stack.id, true) } : undefined} />)}
    {!visibleStacks.length && !error && !loading && <p className="notifications-note" role="status">{view?.member ? t.noneFor(view.member.label) : t.none}</p>}
    {view && !view.writable && visibleStacks.some(stack => stack.dismissible) && <p className="notifications-note">{readOnlyDescription(snapshot)} {t.readOnly}</p>}
    {view?.warnings.map(warning => <p key={warning} className="notifications-note" role="status">{warning}</p>)}
      </div>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
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
    <header className="notification-stack-header panel-head">
      <Icon size={14} aria-hidden="true" />
      <h3 id={headingId}>{stack.title}</h3>
      <span className="notification-stack-count page-number">{stack.total.toLocaleString(locale(lang))}</span>
      {stack.dismissible
        ? <HoldToDismiss label={stack.title} disabled={!canDismiss || !stack.latestAt} onDismiss={onDismiss} />
        // 2026-11-05: name the condition that removes a due card to avoid implying it will disappear shortly.
        : <span className="notification-stack-hint" title={t.dueHint}>{t.dueAccepted}</span>}
      {collapse && <button ref={collapse.ref} type="button" className="notification-collapse control control-ghost" aria-expanded={true}
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
              <span className="notification-meta">{change.actor} · <time dateTime={change.at} title={new Intl.DateTimeFormat(locale(lang), { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(change.at))}>{relativeTimeAgo(change.at, lang)}</time></span>
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
  return <button ref={buttonRef} type="button" className="notification-pill control" aria-expanded={false} aria-label={label} title={label} onClick={onExpand}>
    <Icon size={14} aria-hidden="true" />
    <span className="notification-pill-title">{stack.title}</span>
    <span className="notification-stack-count page-number">{count}</span>
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
  useEffect(() => { if (disabled) cancel(); }, [disabled, cancel]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) cancel(); };
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', hidden); };
  }, [cancel]);
  function start() {
    if (disabled || timer.current) return;
    clearTimeout(hintTimer.current);
    setHint(false);
    setHolding(true);
    timer.current = setTimeout(() => { timer.current = undefined; setHolding(false); onDismiss(); }, holdToDismissMs);
  }
  return <span className="notification-hold-wrap">
    <button type="button" className={`notification-hold control${holding ? ' is-holding' : ''}`} disabled={disabled}
      style={{ '--hold-ms': `${holdToDismissMs}ms` } as CSSProperties}
      aria-label={t.dismissStack(label)} title={t.holdTitle}
      onPointerDown={event => { if (event.button === 0) start(); }} onPointerUp={releaseEarly} onPointerLeave={cancel} onPointerCancel={cancel} onBlur={cancel}
      onKeyDown={event => { if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); start(); } }}
      onKeyUp={event => { if (event.key === ' ' || event.key === 'Enter') releaseEarly(); }}>
      <span className="notification-hold-fill" aria-hidden="true" />
      <span className="notification-hold-label">{t.dismiss}</span>
    </button>
    <span className="notification-hold-hint" role="status">{hint ? t.keepHolding : ''}</span>
  </span>;
}
