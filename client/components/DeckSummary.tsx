import { useMemo, type CSSProperties } from 'react';
import { FileText, Gauge, Layers, NotebookText, PanelLeftClose, Route } from 'lucide-react';
import type { CatalogCard, CatalogDeck, CatalogView } from '../../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import type { CardPriority } from '../../src/catalog-contracts.ts';
import { isActiveCatalogCard } from '../../src/catalog-hand.ts';
import { CardOwnerAvatar } from './CardOwnerAvatar.tsx';
import { DeckActivity } from './DeckActivity.tsx';
import { JourneyPriorityIcon } from './JourneyMiniCard.tsx';
import { statusClass } from './StatusMenu.tsx';
import { Button } from './ui/button.tsx';
import '../deck-summary.css';
import { defineText, formatNumber, useLang, useText } from '../i18n.ts';
import { priorityLabel, stateLabel } from '../locales/common.ts';

const text = defineText({
  summary: (title: string) => `Deck summary: ${title}`, collapse: 'Collapse summary', metrics: 'Deck metrics',
  tasks: (count: number): string => new Intl.PluralRules('en-US').select(count) === 'one' ? 'task' : 'tasks',
  documents: (count: number): string => new Intl.PluralRules('en-US').select(count) === 'one' ? 'document' : 'documents',
  cards: 'Cards', subCards: 'Sub Cards', noState: 'No state',
  states: (kind: string) => `${kind} states`,
  effort: 'Effort',
  effortHint: (estimated: string, total: string, kind: string) => `Effort set for ${estimated} of ${total} ${kind}`,
  accepted: (label: string, accepted: string, total: string, kind: string) => `${label}: ${accepted} of ${total} ${kind}`,
  noSubCards: 'Cards in this deck have no Sub Cards yet.', tracks: 'Deck tracks', sourceFiles: 'Source files',
  openCard: (title: string, path: string) => `Open card “${title}” from ${path}`,
  priorities: 'Priorities', noPriority: 'No priority', owners: 'Owners', unassigned: 'Unassigned',
  priorityShare: (label: string, done: string, total: string) => `${label}: ${done} of ${total} done`,
}, {
  summary: (title: string) => `Сводка колоды ${title}`, collapse: 'Свернуть сводку', metrics: 'Показатели колоды',
  tasks: (_count: number) => 'задач', documents: (_count: number) => 'документов',
  cards: 'Карточки', subCards: 'Sub Cards', noState: 'Без состояния',
  states: (kind: string) => `Состояния ${kind}`,
  effort: 'Оценка',
  effortHint: (estimated: string, total: string, kind: string) => `Оценка указана у ${estimated} из ${total} ${kind}`,
  accepted: (label: string, accepted: string, total: string, kind: string) => `${label} ${accepted} из ${total} ${kind}`,
  noSubCards: 'У карточек этой колоды ещё нет Sub Cards.', tracks: 'Треки колоды', sourceFiles: 'Исходные файлы',
  openCard: (title: string, path: string) => `Открыть карточку «${title}» из ${path}`,
  priorities: 'Приоритеты', noPriority: 'Без приоритета', owners: 'Исполнители', unassigned: 'Без исполнителя',
  priorityShare: (label: string, done: string, total: string) => `${label}: принято ${done} из ${total}`,
});

interface DeckSummaryProps {
  deck: CatalogDeck;
  cards: CatalogCard[];
  catalog: CatalogView;
  source: WorkspaceSnapshot['source'];
  refreshKey: string;
  onOpen: (cardId: string) => void;
  disabled: boolean;
  onTrack: (id: string) => void;
  onCollapse: () => void;
}

// Show done first, then review, work, iteration, discussion, and plan; include declined only when present.
const chipStates = ['done', 'review', 'started', 'in-iteration', 'discussing', 'not-started'];
const priorities: (CardPriority | null)[] = ['high', 'medium', 'low', null];
export function DeckSummary({ deck, cards, catalog, source, refreshKey, onOpen, disabled, onTrack, onCollapse }: DeckSummaryProps) {
  const t = useText(text);
  const lang = useLang();
  const summary = useMemo(() => {
    const deckCards = [...new Map(cards.filter(isActiveCatalogCard).map(card => [card.id, card])).values()];
    const heroIds = new Set(deckCards.filter(card => card.kind === 'hero').map(card => card.id));
    // Hero estimates can already aggregate children; only Task estimates enter this total.
    const taskCandidates = deck.kind === 'asset'
      ? catalog.cards.filter(card => isActiveCatalogCard(card) && card.kind === 'task' && card.parentId !== null && heroIds.has(card.parentId))
      : deckCards.filter(card => card.kind === 'task');
    const tasks = [...new Map(taskCandidates.map(card => [card.id, card])).values()];
    const stateCounts = new Map<string, number>();
    for (const task of tasks) {
      const state = task.state || '';
      stateCounts.set(state, (stateCounts.get(state) ?? 0) + 1);
    }
    const states = [...chipStates, ...['wont-do', ''].filter(state => stateCounts.has(state))].map(state => ({ state, count: stateCounts.get(state) ?? 0 }));
    const priorityStats = priorities.map(priority => {
      const list = tasks.filter(task => (task.priority ?? null) === priority);
      return { priority, total: list.length, done: list.filter(task => task.state === 'done').length };
    });
    const ownerCounts = new Map<string | null, number>();
    for (const task of tasks) ownerCounts.set(task.owner ?? null, (ownerCounts.get(task.owner ?? null) ?? 0) + 1);
    const owners = [...ownerCounts].map(([owner, count]) => ({ owner, count })).sort((left, right) => right.count - left.count || (left.owner ?? '').localeCompare(right.owner ?? ''));
    const estimated = tasks.filter(task => typeof task.effort === 'number' && Number.isFinite(task.effort) && task.effort >= 0);
    const related = [...deckCards, ...tasks];
    const trackIds = new Set(related.flatMap(card => card.trackIds));
    const files = [...new Map(related.map(card => [card.path, card])).values()].sort((first, second) => first.path.localeCompare(second.path));
    return {
      cardCount: deckCards.length, tasks, states, priorityStats, owners,
      accepted: tasks.filter(task => task.state === 'done').length,
      estimatedCount: estimated.length, effort: estimated.reduce((total, task) => total + task.effort!, 0),
      files, tracks: catalog.tracks.filter(track => trackIds.has(track.id)),
    };
  }, [deck.kind, cards, catalog.cards, catalog.tracks]);
  const taskLabel = deck.kind === 'asset' ? t.subCards : t.tasks(summary.tasks.length);
  const percentage = summary.tasks.length ? Math.round(summary.accepted / summary.tasks.length * 100) : 0;
  // Hand-edited catalogs can carry a broken color; the CSS accent fallback covers everything that is not #rrggbb.
  const overviewAccent = /^#[\da-f]{6}$/iu.test(deck.color) ? deck.color : undefined;

  return <aside className="deck-overview" aria-label={t.summary(deck.title)} style={overviewAccent ? { '--overview-accent': overviewAccent } as CSSProperties : undefined}>
    <div className={`deck-overview-intro${deck.description ? ' has-description' : ''}`}>
      {deck.description && <p>{deck.description}</p>}
      <Button variant="ghost" size="icon" className="deck-overview-collapse" onClick={onCollapse} aria-label={t.collapse} title={t.collapse}><PanelLeftClose size={15} /></Button>
    </div>

    <section className="deck-overview-stats" aria-label={t.metrics}>
      <div className="deck-overview-row">
        <div className="deck-overview-states" role="list" aria-label={t.states(taskLabel)}>
          {summary.states.map(({ state, count }) => { const label = `${state ? stateLabel(state, lang) : t.noState}: ${formatNumber(count, 3, lang)}`;
            return <span role="listitem" key={state} className={`deck-overview-state state-${statusClass(state)}${count ? '' : ' is-empty'}`} title={label} aria-label={label}><strong>{count ? formatNumber(count, 3, lang) : '–'}</strong></span>; })}
        </div>
        <div className="deck-overview-priorities" role="list" aria-label={t.priorities}>
          {summary.priorityStats.map(({ priority, total, done }) => { const most = Math.max(1, ...summary.priorityStats.map(item => item.total));
            const label = t.priorityShare(priority ? priorityLabel(priority, lang) : t.noPriority, formatNumber(done, 3, lang), formatNumber(total, 3, lang));
            return <span role="listitem" key={priority ?? 'none'} className="deck-overview-priority" title={label} aria-label={label}>
              <JourneyPriorityIcon priority={priority} size={16} /><i style={{ width: total ? Math.max(5, Math.round(total / most * 32)) : 5 }} aria-hidden="true" /></span>; })}
        </div>
      </div>
      <div className="deck-overview-effort" title={t.effortHint(formatNumber(summary.estimatedCount, 3, lang), formatNumber(summary.tasks.length, 3, lang), taskLabel)}>
        <span><Gauge size={16} aria-hidden="true" /><span className="visually-hidden">{t.effort}</span><strong>{formatNumber(summary.effort, 2, lang)}</strong></span>
        <strong>{formatNumber(percentage, 3, lang)}%</strong>
      </div>
      <progress className="deck-overview-progress" value={summary.accepted} max={Math.max(1, summary.tasks.length)} aria-label={t.accepted(stateLabel('done', lang), formatNumber(summary.accepted, 3, lang), formatNumber(summary.tasks.length, 3, lang), taskLabel)} />
      <div className="deck-overview-count">
        {deck.kind === 'knowledge' ? <NotebookText size={16} aria-hidden="true" /> : <Layers size={16} aria-hidden="true" />}
        <strong>{formatNumber(summary.cardCount, 3, lang)} {deck.kind === 'knowledge' ? t.documents(summary.cardCount) : t.cards}</strong>
        {deck.kind === 'asset' && <span>· {formatNumber(summary.tasks.length, 3, lang)} {t.subCards}</span>}
      </div>
      {deck.kind === 'asset' && summary.tasks.length === 0 && <p className="deck-overview-note">{t.noSubCards}</p>}
      {summary.owners.length > 0 && <div className="deck-overview-owners" role="list" aria-label={t.owners}>
        {summary.owners.map(({ owner, count }) => { const most = summary.owners[0].count; const label = `${owner ?? t.unassigned}: ${formatNumber(count, 3, lang)}`;
          return <span role="listitem" key={owner ?? 'none'} className="deck-overview-owner" title={label} aria-label={label}>
            <i style={{ height: Math.max(4, Math.round(count / most * 64)) }} aria-hidden="true" />
            {owner ? <CardOwnerAvatar owner={owner} members={catalog.members ?? []} /> : <span className="deck-overview-unassigned" aria-hidden="true">–</span>}
          </span>; })}
      </div>}
    </section>

    {summary.tracks.length > 0 && <nav className="deck-overview-tracks" aria-label={t.tracks}>
      {summary.tracks.map(track => <button key={track.id} type="button" disabled={disabled} onClick={() => onTrack(track.id)}><Route size={13} aria-hidden="true" /><span>{track.title}</span></button>)}
    </nav>}

    <DeckActivity deckId={deck.id} source={source} refreshKey={refreshKey} disabled={disabled} onOpen={onOpen} />

    <details className="deck-overview-files">
      <summary>{t.sourceFiles} <span>{formatNumber(summary.files.length, 3, lang)}</span></summary>
      <div>{summary.files.map(card => <button key={card.path} type="button" disabled={disabled} onClick={() => onOpen(card.id)} title={t.openCard(card.title, card.path)}><FileText size={13} aria-hidden="true" /><span>{card.path}</span></button>)}</div>
    </details>
  </aside>;
}
