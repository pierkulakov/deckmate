import type { CSSProperties, ReactNode } from 'react';
import { Bell, Hand as HandIcon, Link2, Trash2 } from 'lucide-react';
import type { CatalogCard, CatalogMember, CatalogView } from '../../src/catalog-contracts.ts';
import { localIsoDate } from '../../src/catalog-hand.ts';
import { openDependencies } from '../../src/dependency-contracts.ts';
import type { CardTileLookups } from '../card-tile-equality.ts';
import { currentLang, defineText, formatNumber, locale, useLang, useText, type Lang } from '../i18n.ts';
import { stateLabel } from '../locales/common.ts';
import { workdaysUntil } from '../planning-metrics.ts';
import { runLabel } from '../run-label.ts';
import { memberForOwner } from './CardOwnerAvatar.tsx';
import '../card-indicators.css';

type DueTone = 'urgent' | 'soon' | 'later';
type RunPhase = 'past' | 'current' | 'future' | 'unknown';
const text = defineText({
  past: 'past', current: 'current', future: 'future', unknown: 'not in registry',
  overdue: 'overdue', today: 'today',
  workdays: (count: number) => `${new Intl.NumberFormat(locale('en')).format(count)} working ${new Intl.PluralRules(locale('en')).select(count) === 'one' ? 'day' : 'days'}`,
  unknownRun: (id: string) => `Run ${id} · not in registry`,
  changeRun: (label: string) => `${label}, change Run`,
  changeMilestone: (label: string) => `${label}, change Milestone`,
  run: (label: string, start: string, end: string, phase: string) => `${label} · ${start} – ${end} · ${phase}`,
  hands: (members: string) => 'Hands: ' + members,
  noSlot: 'no slot',
  slot: (number: string) => 'slot ' + number,
  milestone: (title: string, date: string, total: number, acceptedState: string, accepted: string) => `Milestone: ${title} · ${date} · ${new Intl.NumberFormat(locale('en')).format(total)} ${new Intl.PluralRules(locale('en')).select(total) === 'one' ? 'card' : 'cards'} · ${acceptedState} ${accepted}`,
  unknownMilestone: (id: string) => `Milestone ${id} · not in registry`,
  dependencies: (incoming: string, open: string, outgoing: string) => `Dependencies: incoming ${incoming} (${open} open), outgoing ${outgoing}`,
  cardProperties: 'Card properties',
  deleted: 'In Trash',
  due: (date: string, label: string) => `Due: ${date} · ${label}`,
  notStarted: 'Not started', archived: 'Archived',
  waiting: (count: string) => `Waiting: ${count}`,
  questions: (count: string) => `Questions: ${count}`,
  dueShort: (date: string) => `Due ${date}`, dueToday: 'Today', dueOverdue: 'Overdue',
}, {
  past: 'прошлый', current: 'текущий', future: 'будущий', unknown: 'нет в реестре',
  overdue: 'просрочен', today: 'сегодня',
  workdays: (count: number) => `${new Intl.NumberFormat(locale('ru')).format(count)} рабочих дней`,
  unknownRun: (id: string) => `Run ${id} · нет в реестре`,
  changeRun: (label: string) => `${label}, изменить Run`,
  changeMilestone: (label: string) => `${label}, изменить Milestone`,
  run: (label: string, start: string, end: string, phase: string) => `${label} · ${start} – ${end} · ${phase}`,
  hands: (members: string) => 'Hand: ' + members,
  noSlot: 'без слота',
  slot: (number: string) => 'слот ' + number,
  milestone: (title: string, date: string, total: number, acceptedState: string, accepted: string) => `Milestone: ${title} · ${date} · карточек: ${new Intl.NumberFormat(locale('ru')).format(total)} · ${acceptedState} ${accepted}`,
  unknownMilestone: (id: string) => `Milestone ${id} · нет в реестре`,
  dependencies: (incoming: string, open: string, outgoing: string) => `Зависимости: вход ${incoming} (не закрыто ${open}), выход ${outgoing}`,
  cardProperties: 'Свойства карточки',
  deleted: 'В корзине',
  due: (date: string, label: string) => `Срок: ${date} · ${label}`,
  notStarted: 'Не начата', archived: 'В архиве',
  waiting: (count: string) => `Ждёт ${count}`,
  questions: (count: string) => `Вопросов: ${count}`,
  dueShort: (date: string) => `До ${date}`, dueToday: 'Сегодня', dueOverdue: 'Просрочено',
});

function parseDay(iso: string): Date {
  return new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

function dueDetails(iso: string, today: string, t: typeof text.en, formatDate: (iso: string) => string): { tone: DueTone; label: string } {
  if (iso < today) return { tone: 'urgent', label: t.overdue };
  if (iso === today) return { tone: 'urgent', label: t.today };
  const workdays = workdaysUntil(today, iso);
  if (workdays <= 5) return { tone: 'soon', label: t.workdays(workdays) };
  return { tone: 'later', label: formatDate(iso) };
}

/** Lifecycle and attention share one place; the accessible name also retains the underlying workflow and full date. */
export function cardFaceStatus(card: CatalogCard, lookups: CardTileLookups, lang: Lang = currentLang(), today = localIsoDate()) {
  const t = text[lang];
  const state = card.state ?? 'not-started';
  let workflow = '';
  if (card.kind === 'task') workflow = state === 'not-started' ? t.notStarted : stateLabel(state, lang);
  if (card.deleted || card.archived) {
    const label = card.deleted ? t.deleted : t.archived;
    return { label, workflow, attention: true, questions: '', due: '', dueTitle: '', urgent: false, accessible: [label, workflow].filter(Boolean).join(', ') };
  }
  const blocked = openDependencies([...new Set(card.dependsOn ?? [])], lookups.cardById).length;
  const questionCount = card.kind === 'doc' ? card.openQuestions?.length ?? 0 : 0;
  const questions = questionCount ? t.questions(formatNumber(questionCount, 0, lang)) : '';
  let label = workflow;
  if (questions) label = questions;
  if (blocked) label = t.waiting(formatNumber(blocked, 0, lang));
  let due = '', dueTitle = '', urgent = false;
  if (card.kind === 'task' && card.dueDate && state !== 'done' && state !== 'wont-do') {
    const formatDate = (iso: string) => new Intl.DateTimeFormat(locale(lang), { year: 'numeric', month: '2-digit', day: '2-digit' }).format(parseDay(iso));
    const details = dueDetails(card.dueDate, today, t, formatDate);
    dueTitle = t.due(formatDate(card.dueDate), details.label);
    urgent = details.tone === 'urgent';
    if (card.dueDate < today) due = t.dueOverdue;
    else if (card.dueDate === today) due = t.dueToday;
    else if (details.tone === 'soon') due = t.dueShort(new Intl.DateTimeFormat(locale(lang), { month: '2-digit', day: '2-digit' }).format(parseDay(card.dueDate)));
  }
  return { label, workflow, attention: Boolean(blocked || questions), questions: blocked ? questions : '', due, dueTitle, urgent,
    accessible: [...new Set([workflow, label, questions, dueTitle].filter(Boolean))].join(', ') };
}

export function CardFaceStatus({ status, hideWorkflow = false, children }: {
  status: ReturnType<typeof cardFaceStatus>; hideWorkflow?: boolean; children?: ReactNode;
}) {
  const label = hideWorkflow && !status.attention ? '' : status.label;
  if (!label && !status.due && !children) return null;
  return <span className="card-face-status">
    <span className="card-face-status-row">
      {label && <span className="card-face-state" title={status.accessible}>{label}</span>}{!status.due && children}
    </span>
    {status.questions && <span className="card-face-state">{status.questions}</span>}
    {status.due && <span className="card-face-status-row"><span className={'card-face-due' + (status.urgent ? ' is-urgent' : '')} title={status.dueTitle}>{status.due}</span>{children}</span>}
  </span>;
}

function RunGlyph() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect className="card-run-body" x="2" y="2.5" width="12" height="11" rx="2.5" />
    <path className="card-run-detail" d="M2.5 6h11M5 1.8v2M11 1.8v2" />
  </svg>;
}

function MilestoneGlyph({ filled }: { filled: boolean }) {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8 14.2 8 8 14.2 1.8 8Z" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" /></svg>;
}

function dependencyCount(value: number, numberFormat: Intl.NumberFormat): string {
  return value > 9 ? '9+' : numberFormat.format(value);
}

function PlanningIndicator({ tab, className, title, actionLabel, style, disabled, onOpen, children }: {
  tab: 'run' | 'milestone'; className: string; title: string; actionLabel: string; style?: CSSProperties;
  disabled?: boolean; onOpen?: (anchor: HTMLButtonElement) => void; children: ReactNode;
}) {
  if (!onOpen) return <span className={className} role="img" title={title} aria-label={title} style={style}>{children}</span>;
  return <button type="button" className={className + ' card-indicator-button'} title={actionLabel} aria-label={actionLabel} style={style} disabled={disabled}
    data-quick-settings-tab={tab} aria-haspopup="dialog" aria-expanded={false}
    onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onOpen(event.currentTarget); }}>{children}</button>;
}

export function CardIndicators({ card, lookups, members, catalog, currentMemberId, handPositions, variant, onQuickSettings, quickSettingsDisabled, onDependencies, dependenciesDisabled }: {
  card: CatalogCard;
  lookups: CardTileLookups;
  members: CatalogMember[];
  catalog?: Pick<CatalogView, 'runs' | 'milestones'>;
  currentMemberId?: string;
  /** 2026-11-11: one-based positions from the visible Hands; persisted handOrder is a sparse sorting key. */
  handPositions?: Readonly<Record<string, number>>;
  variant: 'tile' | 'table' | 'preview';
  onQuickSettings?: (tab: 'run' | 'milestone', anchor: HTMLButtonElement) => void;
  quickSettingsDisabled?: boolean;
  onDependencies?: () => void;
  dependenciesDisabled?: boolean;
}) {
  const t = useText(text);
  const lang = useLang();
  if (variant === 'tile') return <CardFaceStatus status={cardFaceStatus(card, lookups, lang)} />;
  const numberFormat = new Intl.NumberFormat(locale(lang));
  const dateFormat = new Intl.DateTimeFormat(locale(lang), { year: 'numeric', month: '2-digit', day: '2-digit' });
  const formatDate = (iso: string) => dateFormat.format(parseDay(iso));
  const today = localIsoDate();
  const handMemberIds = [...new Set(card.handMemberIds ?? [])];
  const defaultMemberId = currentMemberId ?? members.find(member => member.kind === 'human')?.id ?? members[0]?.id ?? '';
  const ownerMemberId = memberForOwner(card.owner, members)?.id ?? '';
  let primaryHandId = handMemberIds.includes(defaultMemberId) ? defaultMemberId : '';
  if (!primaryHandId && handMemberIds.includes(ownerMemberId)) primaryHandId = ownerMemberId;
  if (!primaryHandId && handMemberIds.length) {
    primaryHandId = handMemberIds.reduce((best, memberId) => {
      const bestSlot = handPositions?.[best] ?? Number.MAX_SAFE_INTEGER;
      const candidateSlot = handPositions?.[memberId] ?? Number.MAX_SAFE_INTEGER;
      return candidateSlot < bestSlot ? memberId : best;
    });
  }

  const incoming = [...new Set(card.dependsOn ?? [])];
  const outgoing = lookups.outgoingByCard.get(card.id) ?? [];
  const isAccepted = (cardId: string) => lookups.cardById.get(cardId)?.state === 'done';
  const incomingAccepted = incoming.filter(isAccepted).length;
  const outgoingAccepted = outgoing.filter(isAccepted).length;
  const incomingOpen = openDependencies(incoming, lookups.cardById).length;
  const hasGate = incoming.length > 0 || outgoing.length > 0;
  const run = catalog?.runs?.find(candidate => candidate.id === card.run);
  const milestone = catalog?.milestones?.find(candidate => candidate.id === card.milestone);
  const showDue = card.kind === 'task' && Boolean(card.dueDate);
  const showRun = Boolean(catalog && card.run);
  const showMilestone = Boolean(catalog && card.milestone);
  if (!card.deleted && !showDue && !showRun && !showMilestone && !primaryHandId && !hasGate) return null;

  let runPhase: RunPhase = 'unknown';
  let runTitle = t.unknownRun(card.run ?? '');
  if (run) {
    if (run.finishedAt || run.end < today) runPhase = 'past';
    else if (run.start > today) runPhase = 'future';
    else runPhase = 'current';
    runTitle = t.run(runLabel(run, lang), formatDate(run.start), formatDate(run.end), t[runPhase]);
    if (!run.configurationId && run.goal) runTitle += ` · ${run.goal}`;
  }
  const due = card.dueDate ? dueDetails(card.dueDate, today, t, formatDate) : null;
  const primarySlot = handPositions?.[primaryHandId];
  const handTitle = t.hands(handMemberIds.map(memberId => {
    const label = members.find(member => member.id === memberId)?.label ?? memberId;
    if (!handPositions) return label;
    const slot = handPositions[memberId];
    return `${label} · ${slot === undefined ? t.noSlot : t.slot(numberFormat.format(slot))}`;
  }).join('; '));
  const milestoneCounts = milestone ? lookups.milestoneProgress.get(milestone.id) : undefined;
  const milestoneTitle = milestone
    ? t.milestone(milestone.title, formatDate(milestone.date), milestoneCounts?.total ?? 0, stateLabel('done', lang).toLocaleLowerCase(locale(lang)), numberFormat.format(milestoneCounts?.accepted ?? 0))
    : t.unknownMilestone(card.milestone ?? '');
  const gateTitle = t.dependencies(numberFormat.format(incoming.length), numberFormat.format(incomingOpen), numberFormat.format(outgoing.length));
  const dueLabel = card.dueDate && due ? t.due(formatDate(card.dueDate), due.label) : '';
  const Gate = onDependencies ? 'button' : 'span';

  return <span className={`card-indicators is-${variant}`} role="group" aria-label={t.cardProperties}>
    {card.deleted && <span className="card-indicator card-trash-indicator" role="img" title={t.deleted} aria-label={t.deleted}><Trash2 aria-hidden="true" /></span>}
    {showDue && due && <span className={`card-indicator card-due-indicator is-${due.tone}`} role="img" title={dueLabel} aria-label={dueLabel}><Bell aria-hidden="true" /></span>}
    {showRun && <PlanningIndicator tab="run" className={`card-indicator card-run-indicator is-${runPhase}`} title={runTitle} actionLabel={t.changeRun(runTitle)} disabled={quickSettingsDisabled}
      onOpen={onQuickSettings ? anchor => onQuickSettings('run', anchor) : undefined}><RunGlyph /></PlanningIndicator>}
    {showMilestone && <PlanningIndicator tab="milestone" className={`card-indicator card-milestone-indicator${milestone && milestone.date < today ? ' is-past' : ' is-future'}`} title={milestoneTitle} actionLabel={t.changeMilestone(milestoneTitle)} style={{ color: milestone?.color }} disabled={quickSettingsDisabled}
      onOpen={onQuickSettings ? anchor => onQuickSettings('milestone', anchor) : undefined}><MilestoneGlyph filled={Boolean(milestone && milestone.date >= today)} /></PlanningIndicator>}
    {primaryHandId && <span className={`card-indicator card-hand-indicator${primaryHandId === defaultMemberId ? ' is-mine' : ' is-foreign'}`} role="img" title={handTitle} aria-label={handTitle}>
      <HandIcon fill={primaryHandId === defaultMemberId ? 'currentColor' : 'none'} aria-hidden="true" />
      {primarySlot !== undefined && <strong>{numberFormat.format(primarySlot)}</strong>}
    </span>}
    {hasGate && <Gate type={onDependencies ? 'button' : undefined} disabled={onDependencies ? dependenciesDisabled : undefined} onClick={onDependencies} className={`card-indicator card-gate-indicator${incomingOpen > 0 ? ' is-blocked' : ''}${onDependencies ? ' card-indicator-button' : ''}`} role={onDependencies ? undefined : 'img'} title={gateTitle} aria-label={gateTitle}>
      <span className="card-gate-numbers"><span>{dependencyCount(incoming.length, numberFormat)}</span><Link2 aria-hidden="true" /><span>{dependencyCount(outgoing.length, numberFormat)}</span></span>
      <span className="card-gate-tracks" aria-hidden="true"><span><i style={{ width: `${incoming.length ? incomingAccepted / incoming.length * 100 : 0}%` }} /></span><span><i style={{ width: `${outgoing.length ? outgoingAccepted / outgoing.length * 100 : 0}%` }} /></span></span>
    </Gate>}
  </span>;
}
