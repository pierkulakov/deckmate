import { moveFocus } from '../focus.ts';
// 2026-11-05: the Level panel docks under the top bar on the right: level, the XP line, chapters with their quests.
// It is not modal — the page keeps working — and closes with the cross, Escape (focus inside) or the badge itself.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, Lock, X } from 'lucide-react';
import { defineText, locale, useLang, useText } from '../i18n.ts';
import { chapterStatuses, earnedXp, levelOf, totalXp, type Chapter, type ChapterStatus, type Quest } from '../onboarding/model.ts';
import { useQuestProgress } from '../onboarding/progress.ts';
import { chapters, questText, type QuestTextKey } from '../onboarding/quests.ts';
import { showQuestTarget } from '../onboarding/show-me.ts';
import type { AppView } from '../onboarding/signals.ts';
import { Button } from './ui/button.tsx';
import { ErrorState } from './ErrorState.tsx';
import { LoadingState } from './LoadingState.tsx';
import '../level-panel.css';

const text = defineText({
  regionLabel: 'Level and quests',
  close: 'Close',
  levelTitle: (level: number) => `Level ${level}`,
  xpRange: (earned: string, next: string) => `${earned} / ${next} XP`,
  allDone: 'All quests done',
  unlockHint: 'Finish a chapter above to unlock the next',
  chapterProgress: (done: number, total: number) => `${done} of ${total} quests done`,
  showMe: 'Show me',
  factsFailed: 'Could not refresh quests; showing the last known progress.',
}, {
  regionLabel: 'Уровень и задания',
  close: 'Закрыть',
  levelTitle: (level: number) => `Уровень ${level}`,
  xpRange: (earned: string, next: string) => `${earned} / ${next} XP`,
  allDone: 'Все задания выполнены',
  unlockHint: 'Закончите главу выше — откроется следующая',
  chapterProgress: (done: number, total: number) => `выполнено заданий: ${done} из ${total}`,
  showMe: 'Показать',
  factsFailed: 'Не удалось обновить задания — показан последний известный прогресс.',
});

interface LevelPanelProps {
  factsFailed?: boolean;
  factsLoading?: boolean;
  onRefreshFacts?: () => Promise<void>;
  projectKey: string;
  /** True when the loaded catalog has no decks: quests swap their «click a deck» wording for an action that exists (2026-11-11). */
  withoutDecks?: boolean;
  onClose: (restoreFocus?: boolean) => void;
  /** Switch the top-bar tab, for «Show me» in a quest; the panel stays open. */
  onNavigate: (view: AppView) => void;
}

/** Share of the current level done, 0…100; painting only — the level rules themselves live in model.ts. */
export function levelShare(xp: number, floor: number, next: number | null): number {
  if (next === null) return 100;
  return Math.min(100, Math.max(0, ((xp - floor) / (next - floor)) * 100));
}

/** Quest texts mark interface names with backticks; those become code spans. */
function questBody(body: string): ReactNode {
  return body.split(/(`[^`]+`)/g).map((part, index) =>
    part.length > 2 && part.startsWith('`') && part.endsWith('`') ? <code key={index}>{part.slice(1, -1)}</code> : part);
}

function QuestRow({ quest, isDone, withoutDecks, hintOpen, onToggleHint, onNavigate, onClose }: {
  quest: Quest<QuestTextKey>;
  isDone: boolean;
  withoutDecks: boolean;
  hintOpen: boolean;
  onToggleHint: () => void;
  onNavigate: (view: AppView) => void;
  onClose: (restoreFocus?: boolean) => void;
}) {
  const t = useText(text);
  const strings = useText(questText);
  if (isDone) return <div className="level-quest is-done">
    <Check size={13} aria-hidden="true" />
    <span className="level-quest-title">{strings[quest.title]}</span>
  </div>;
  const view = quest.view;
  // An empty project has no deck cover: the quest's no-decks wording points at creating one instead (2026-11-11).
  const body = withoutDecks && quest.bodyWithoutDecks ? quest.bodyWithoutDecks : quest.body;
  const target = withoutDecks && quest.targetWithoutDecks ? quest.targetWithoutDecks : quest.target;
  function showMe() {
    // Switch the tab only when the person is elsewhere: navigating remounts the view, which would close their open
    // card and deck — on the quest's own tab the ring alone is the answer (2026-11-05).
    if (view && new URLSearchParams(location.search).get('view') !== view) onNavigate(view);
    // 2026-11-08: the overlay covers the target on narrow screens, so reveal the page before ringing it.
    if (window.matchMedia('(max-width: 899px)').matches) onClose(false);
    if (target) showQuestTarget(target);
  }
  return <div className="level-quest is-open">
    <button type="button" className="level-quest-row" aria-expanded={hintOpen} aria-controls={`level-hint-${quest.id}`} onClick={onToggleHint}>
      <ChevronRight size={13} aria-hidden="true" />
      <span className="level-quest-title">{strings[quest.title]}</span>
    </button>
    {hintOpen && <div id={`level-hint-${quest.id}`} className="level-quest-hint">
      <p>{questBody(strings[body])}</p>
      {(view || target) && <Button variant="outline" size="sm" onClick={showMe}>{t.showMe}</Button>}
    </div>}
  </div>;
}

function ChapterSection({ chapter, status, done, folded, withoutDecks, onToggleFold, openHints, recommendedQuest, onToggleHint, onNavigate, onClose }: {
  chapter: Chapter<QuestTextKey>;
  status: ChapterStatus;
  done: ReadonlySet<string>;
  folded: boolean;
  withoutDecks: boolean;
  onToggleFold: (fold: boolean) => void;
  openHints: Readonly<Record<string, boolean>>;
  recommendedQuest: string | undefined;
  onToggleHint: (questId: string) => void;
  onNavigate: (view: AppView) => void;
  onClose: (restoreFocus?: boolean) => void;
}) {
  const t = useText(text);
  const strings = useText(questText);
  const Icon = chapter.icon;
  const questsDone = chapter.quests.filter(quest => done.has(quest.id)).length;
  return <section className={`level-chapter${status === 'done' ? ' is-done' : ''}`}>
    <button type="button" className="level-chapter-head" aria-expanded={!folded} onClick={() => onToggleFold(!folded)}>
      <Icon size={15} aria-hidden="true" />
      {status === 'done'
        ? <Check size={13} className="level-chapter-check" aria-hidden="true" />
        : <span className="level-chapter-bar" aria-hidden="true"><i style={{ width: `${(questsDone / chapter.quests.length) * 100}%` }} /></span>}
      <span className="level-chapter-title" title={strings[chapter.title]}>{strings[chapter.title]}</span>
      <span className="level-chapter-progress" aria-hidden="true">{questsDone} / {chapter.quests.length}</span>
      <ChevronDown size={14} className="level-chapter-chevron" aria-hidden="true" />
      <span className="visually-hidden">{t.chapterProgress(questsDone, chapter.quests.length)}</span>
    </button>
    {!folded && <div className="level-chapter-quests">
      {chapter.quests.map(quest => <QuestRow key={quest.id} quest={quest} isDone={done.has(quest.id)} withoutDecks={withoutDecks}
        hintOpen={openHints[quest.id] ?? quest.id === recommendedQuest} onToggleHint={() => onToggleHint(quest.id)} onNavigate={onNavigate} onClose={onClose} />)}
    </div>}
  </section>;
}

function LockedChapter({ chapter }: { chapter: Chapter<QuestTextKey> }) {
  const strings = useText(questText);
  const Icon = chapter.icon;
  return <div className="level-chapter is-locked">
    <Icon size={15} aria-hidden="true" />
    <span className="level-chapter-title" title={strings[chapter.title]}>{strings[chapter.title]}</span>
    <Lock size={13} aria-hidden="true" />
  </div>;
}

export function LevelPanel({ projectKey, withoutDecks = false, onClose, onNavigate, factsFailed, factsLoading, onRefreshFacts }: LevelPanelProps) {
  const lang = useLang();
  const t = useText(text);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [folds, setFolds] = useState<Readonly<Record<string, boolean>>>({});
  const [openHints, setOpenHints] = useState<Readonly<Record<string, boolean>>>({});
  const progress = useQuestProgress(projectKey);
  const done = useMemo(() => new Set(Object.keys(progress)), [progress]);
  const statuses = useMemo(() => chapterStatuses(chapters, done), [done]);
  const total = useMemo(() => totalXp(chapters), []);
  const level = useMemo(() => levelOf(earnedXp(chapters, done), total), [done, total]);
  const locked = chapters.filter((_, index) => statuses[index] === 'locked');
  const recommendedChapter = chapters.find((_, index) => statuses[index] === 'open');
  const recommendedQuest = recommendedChapter?.quests.find(quest => !done.has(quest.id))?.id;

  useEffect(() => { moveFocus(titleRef.current); }, []);
  // 2026-11-09: the page narrows by a root attribute instead of .global-shell:has(.level-panel). That :has() anchor sat
  // above the whole board, so every DOM change under it restyled every element of the page (a card open: twice ~2000).
  useLayoutEffect(() => {
    document.documentElement.toggleAttribute('data-level-panel', true);
    return () => document.documentElement.removeAttribute('data-level-panel');
  }, []);

  function toggleHint(questId: string) {
    setOpenHints(current => ({ ...current, [questId]: !(current[questId] ?? questId === recommendedQuest) }));
  }
  const format = (value: number) => new Intl.NumberFormat(locale(lang)).format(value);

  return <aside id="level-panel" className="level-panel" aria-label={t.regionLabel}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header className="level-panel-head">
      <span className="level-panel-card" aria-hidden="true">{level.level}</span>
      <div className="level-panel-heading">
        <h2 ref={titleRef} tabIndex={-1}>{t.levelTitle(level.level)}</h2>
        <span className={level.next === null ? 'level-panel-xp is-done' : 'level-panel-xp'}>{level.next === null ? t.allDone : t.xpRange(format(level.xp), format(level.next))}</span>
      </div>
      <Button variant="ghost" size="icon" aria-label={t.close} onClick={() => onClose()}><X size={17} aria-hidden="true" /></Button>
    </header>
    <div className="level-panel-xpbar" aria-hidden="true"><i style={{ width: `${levelShare(level.xp, level.floor, level.next)}%` }} /></div>
    <div className="level-panel-body">
      <ErrorState variant="inline" className="ui-error-quiet" message={factsFailed ? t.factsFailed : null}
        pending={factsLoading} onRetry={() => onRefreshFacts?.()} />
      <LoadingState variant="keep-data" active={factsLoading ?? false} />
      {chapters.map((chapter, index) => statuses[index] === 'locked' ? null
        : <ChapterSection key={chapter.id} chapter={chapter} status={statuses[index]} done={done} withoutDecks={withoutDecks}
          folded={folds[chapter.id] ?? chapter.id !== recommendedChapter?.id}
          onToggleFold={fold => setFolds(current => ({ ...current, [chapter.id]: fold }))}
          openHints={openHints} recommendedQuest={recommendedQuest} onToggleHint={toggleHint} onNavigate={onNavigate} onClose={onClose} />)}
      {locked.length > 0 && <>
        <p className="level-divider">{t.unlockHint}</p>
        {locked.map(chapter => <LockedChapter key={chapter.id} chapter={chapter} />)}
      </>}
    </div>
  </aside>;
}
