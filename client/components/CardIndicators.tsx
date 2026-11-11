import { Bell, Link2, Trash2 } from 'lucide-react';
import type { CatalogCard, CatalogMember, CatalogView } from '../../src/catalog-contracts.ts';
import { localIsoDate } from '../../src/catalog-hand.ts';
import { openDependencies } from '../../src/dependency-contracts.ts';
import type { CardTileLookups } from '../card-tile-equality.ts';
import { currentLang, defineText, formatNumber, locale, useLang, useText, type Lang } from '../i18n.ts';
import { stateLabel } from '../locales/common.ts';
import { workdaysUntil } from '../planning-metrics.ts';
import { runLabel } from '../run-label.ts';
import { memberForOwner } from './CardOwnerAvatar.tsx';
import { HandIcon } from './HandIcon.tsx';
import '../card-indicators.css';

type DueTone = 'urgent' | 'soon' | 'later';
type RunPhase = 'past' | 'current' | 'future' | 'unknown';
const text = defineText({
  past: 'past', current: 'current', future: 'future', unknown: 'not in registry',
  overdue: 'overdue', today: 'today',
  workdays: (count: number) => `${new Intl.NumberFormat(locale('en')).format(count)} working ${new Intl.PluralRules(locale('en')).select(count) === 'one' ? 'day' : 'days'}`,
  unknownRun: (id: string) => `Run ${id} · not in registry`,
  run: (label: string, start: string, end: string, phase: string) => `${label} · ${start} – ${end} · ${phase}`,
  hands: (members: string) => 'Hands: ' + members,
  inHand: (member: string, slot: string) => `In ${member}’s Hand, ${slot}`,
  noSlot: 'no slot',
  slot: (number: string) => 'slot ' + number,
  milestone: (title: string, date: string, total: number, acceptedState: string, accepted: string) => `Milestone: ${title} · ${date} · ${new Intl.NumberFormat(locale('en')).format(total)} ${new Intl.PluralRules(locale('en')).select(total) === 'one' ? 'card' : 'cards'} · ${acceptedState} ${accepted}`,
  unknownMilestone: (id: string) => `Milestone ${id} · not in registry`,
  dependencies: (incoming: string, open: string, outgoing: string) => `Dependencies: incoming ${incoming} (${open} open), outgoing ${outgoing}`,
  cardProperties: 'Card properties',
  deleted: 'In Trash',
  due: (date: string, label: string) => `Due: ${date} · ${label}`,
  archived: 'Archived',
  waiting: (count: string) => `Waiting: ${count}`,
  questions: (count: string) => `Questions: ${count}`,
  dueOverdue: 'Overdue', blocked: 'Blocked',
}, {
  past: 'прошлый', current: 'текущий', future: 'будущий', unknown: 'нет в реестре',
  overdue: 'просрочен', today: 'сегодня',
  workdays: (count: number) => `${new Intl.NumberFormat(locale('ru')).format(count)} рабочих дней`,
  unknownRun: (id: string) => `Run ${id} · нет в реестре`,
  run: (label: string, start: string, end: string, phase: string) => `${label} · ${start} – ${end} · ${phase}`,
  hands: (members: string) => 'Hand: ' + members,
  inHand: (member: string, slot: string) => `В Hand у ${member}, ${slot}`,
  noSlot: 'без слота',
  slot: (number: string) => 'слот ' + number,
  milestone: (title: string, date: string, total: number, acceptedState: string, accepted: string) => `Milestone: ${title} · ${date} · карточек: ${new Intl.NumberFormat(locale('ru')).format(total)} · ${acceptedState} ${accepted}`,
  unknownMilestone: (id: string) => `Milestone ${id} · нет в реестре`,
  dependencies: (incoming: string, open: string, outgoing: string) => `Зависимости: вход ${incoming} (не закрыто ${open}), выход ${outgoing}`,
  cardProperties: 'Свойства карточки',
  deleted: 'В корзине',
  due: (date: string, label: string) => `Срок: ${date} · ${label}`,
  archived: 'В архиве',
  waiting: (count: string) => `Ждёт ${count}`,
  questions: (count: string) => `Вопросов: ${count}`,
  dueOverdue: 'Просрочено', blocked: 'Заблокирована',
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

/** The face names active work and overdue attention; calendar dates belong to the open card. */
export function cardFaceStatus(card: CatalogCard, lookups: CardTileLookups, lang: Lang = currentLang(), today = localIsoDate()) {
  const t = text[lang];
  const state = card.state ?? 'not-started';
  let workflow = '';
  if (card.kind === 'task') workflow = stateLabel(state, lang);
  if (card.deleted || card.archived) {
    const label = card.deleted ? t.deleted : t.archived;
    return { label, workflow, attention: true, questions: '', due: '', dueTitle: '', urgent: false, accessible: [label, workflow].filter(Boolean).join(', ') };
  }
  const blocked = openDependencies([...new Set(card.dependsOn ?? [])], lookups.cardById).length;
  const questionCount = card.kind === 'doc' ? card.openQuestions?.length ?? 0 : 0;
  const questions = questionCount ? t.questions(formatNumber(questionCount, 0, lang)) : '';
  let label = state === 'started' || state === 'review' ? workflow : '';
  if (questions) label = questions;
  if (blocked) label = t.blocked;
  const urgent = card.kind === 'task' && Boolean(card.dueDate && card.dueDate < today) && state !== 'done' && state !== 'wont-do';
  const due = urgent ? t.dueOverdue : '';
  const dueTitle = urgent && card.dueDate
    ? t.due(new Intl.DateTimeFormat(locale(lang), { year: 'numeric', month: '2-digit', day: '2-digit' }).format(parseDay(card.dueDate)), t.overdue) : '';
  return { label, workflow, attention: Boolean(blocked || questions), questions: blocked ? questions : '', due, dueTitle, urgent,
    accessible: [...new Set([workflow, label, questions, blocked ? t.waiting(formatNumber(blocked, 0, lang)) : '', due].filter(Boolean))].join(', ') };
}

// 2026-11-11: the tile can suppress workflow and due text on its face while retaining both in its accessible name.
export function CardFaceStatus({ status, hideWorkflow = false, hideDue = false }: {
  status: ReturnType<typeof cardFaceStatus>; hideWorkflow?: boolean; hideDue?: boolean;
}) {
  const label = hideWorkflow && !status.attention ? '' : status.label;
  const due = hideDue ? '' : status.due;
  if (!label && !due) return null;
  return <span className="card-face-status" title={status.accessible}>
    {label && <span className="card-face-state">{label}</span>}
    {due && <span className={'card-face-due' + (status.urgent ? ' is-urgent' : '')}>{due}</span>}
  </span>;
}

/** The viewer's Hand wins, then the owner's, then the earliest known slot. */
export function cardHandStatus(card: CatalogCard, members: CatalogMember[], currentMemberId?: string,
  handPositions?: Readonly<Record<string, number>>, lang: Lang = currentLang()) {
  const handMemberIds = [...new Set(card.handMemberIds ?? [])];
  if (!handMemberIds.length || card.deleted || card.archived) return null;
  const t = text[lang];
  const defaultMemberId = currentMemberId ?? members.find(member => member.kind === 'human')?.id ?? members[0]?.id ?? '';
  const ownerMemberId = memberForOwner(card.owner, members)?.id ?? '';
  let primaryHandId = handMemberIds.includes(defaultMemberId) ? defaultMemberId : '';
  if (!primaryHandId && handMemberIds.includes(ownerMemberId)) primaryHandId = ownerMemberId;
  if (!primaryHandId) primaryHandId = handMemberIds.reduce((best, memberId) =>
    (handPositions?.[memberId] ?? Number.MAX_SAFE_INTEGER) < (handPositions?.[best] ?? Number.MAX_SAFE_INTEGER) ? memberId : best);
  const memberLabel = (id: string) => members.find(member => member.id === id)?.label ?? id;
  const slotLabel = (id: string) => handPositions?.[id] === undefined ? t.noSlot : t.slot(formatNumber(handPositions[id], 0, lang));
  return {
    mine: primaryHandId === defaultMemberId,
    slot: handPositions?.[primaryHandId],
    accessible: [primaryHandId, ...handMemberIds.filter(id => id !== primaryHandId)].map(id => t.inHand(memberLabel(id), slotLabel(id))).join('; '),
    title: t.hands(handMemberIds.map(id => memberLabel(id) + (handPositions ? ' · ' + slotLabel(id) : '')).join('; ')),
  };
}

export function CardHandIndicator({ hand }: { hand: ReturnType<typeof cardHandStatus> }) {
  const lang = useLang();
  if (!hand) return null;
  return <span className={`card-indicator card-hand-indicator${hand.mine ? ' is-mine' : ' is-foreign'}`} role="img" title={hand.title} aria-label={hand.accessible}>
    <HandIcon size={16} mine={hand.mine} />
    {hand.slot !== undefined && <strong className="card-hand-number">{formatNumber(hand.slot, 0, lang)}</strong>}
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

export function CardIndicators({ card, lookups, members, catalog, currentMemberId, handPositions, variant, onDependencies, dependenciesDisabled }: {
  card: CatalogCard;
  lookups: CardTileLookups;
  members: CatalogMember[];
  catalog?: Pick<CatalogView, 'runs' | 'milestones'>;
  currentMemberId?: string;
  /** 2026-11-11: one-based positions from the visible Hands; persisted handOrder is a sparse sorting key. */
  handPositions?: Readonly<Record<string, number>>;
  variant: 'table';
  onDependencies?: () => void;
  dependenciesDisabled?: boolean;
}) {
  const t = useText(text);
  const lang = useLang();
  const hand = cardHandStatus(card, members, currentMemberId, handPositions, lang);
  const numberFormat = new Intl.NumberFormat(locale(lang));
  const dateFormat = new Intl.DateTimeFormat(locale(lang), { year: 'numeric', month: '2-digit', day: '2-digit' });
  const formatDate = (iso: string) => dateFormat.format(parseDay(iso));
  const today = localIsoDate();
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
  if (!card.deleted && !showDue && !showRun && !showMilestone && !hand && !hasGate) return null;

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
    {showRun && <span className={`card-indicator card-run-indicator is-${runPhase}`} role="img" title={runTitle} aria-label={runTitle}><RunGlyph /></span>}
    {showMilestone && <span className={`card-indicator card-milestone-indicator${milestone && milestone.date < today ? ' is-past' : ' is-future'}`} role="img" title={milestoneTitle} aria-label={milestoneTitle} style={{ color: milestone?.color }}><MilestoneGlyph filled={Boolean(milestone && milestone.date >= today)} /></span>}
    <CardHandIndicator hand={hand} />
    {hasGate && <Gate type={onDependencies ? 'button' : undefined} disabled={onDependencies ? dependenciesDisabled : undefined} onClick={onDependencies} className={`card-indicator card-gate-indicator${incomingOpen > 0 ? ' is-blocked' : ''}${onDependencies ? ' card-indicator-button' : ''}`} role={onDependencies ? undefined : 'img'} title={gateTitle} aria-label={gateTitle}>
      <span className="card-gate-numbers"><span>{dependencyCount(incoming.length, numberFormat)}</span><Link2 aria-hidden="true" /><span>{dependencyCount(outgoing.length, numberFormat)}</span></span>
      <span className="card-gate-tracks" aria-hidden="true"><span><i style={{ width: `${incoming.length ? incomingAccepted / incoming.length * 100 : 0}%` }} /></span><span><i style={{ width: `${outgoing.length ? outgoingAccepted / outgoing.length * 100 : 0}%` }} /></span></span>
    </Gate>}
  </span>;
}
