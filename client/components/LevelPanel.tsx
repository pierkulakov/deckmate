// 2026-11-05: the Level panel docks under the top bar on the right: level, the XP line, chapters with their quests.
// It is not modal — the page keeps working — and closes with the cross, Escape (focus inside) or the badge itself.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, Lock, X } from 'lucide-react';
import { defineText, locale, useLang, useText, type Lang } from '../i18n.ts';
import { chapterStatuses, earnedXp, levelOf, totalXp, type Chapter, type ChapterStatus, type Quest } from '../onboarding/model.ts';
import { useQuestProgress } from '../onboarding/progress.ts';
import { chapters, questText, type QuestTextKey } from '../onboarding/quests.ts';
import { showQuestTarget } from '../onboarding/show-me.ts';
import type { AppView } from '../onboarding/signals.ts';
import { Button } from './ui/button.tsx';
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
}, {
  regionLabel: 'Уровень и задания',
  close: 'Закрыть',
  levelTitle: (level: number) => `Уровень ${level}`,
  xpRange: (earned: string, next: string) => `${earned} / ${next} XP`,
  allDone: 'Все задания выполнены',
  unlockHint: 'Закончите главу выше — откроется следующая',
  chapterProgress: (done: number, total: number) => `выполнено заданий: ${done} из ${total}`,
  showMe: 'Показать',
});

interface LevelPanelProps {
  projectKey: string;
  onClose: () => void;
  /** Switch the top-bar tab, for «Show me» in a quest; the panel stays open. */
  onNavigate: (view: AppView) => void;
}

/** Share of the current level done, 0…100; painting only — the level rules themselves live in model.ts. */
export function levelShare(xp: number, floor: number, next: number | null): number {
  if (next === null) return 100;
  return Math.min(100, Math.max(0, ((xp - floor) / (next - floor)) * 100));
}

function xpText(xp: number, lang: Lang): string {
  return `${new Intl.NumberFormat(locale(lang)).format(xp)} XP`;
}

/** Quest texts mark interface names with backticks; those become code spans. */
function questBody(body: string): ReactNode {
  return body.split(/(`[^`]+`)/g).map((part, index) =>
    part.length > 2 && part.startsWith('`') && part.endsWith('`') ? <code key={index}>{part.slice(1, -1)}</code> : part);
}

function QuestRow({ quest, isDone, hintOpen, onToggleHint, onNavigate }: {
  quest: Quest<QuestTextKey>;
  isDone: boolean;
  hintOpen: boolean;
  onToggleHint: () => void;
  onNavigate: (view: AppView) => void;
}) {
  const t = useText(text);
  const strings = useText(questText);
  const lang = useLang();
  if (isDone) return <div className="level-quest is-done">
    <Check size={13} aria-hidden="true" />
    <span className="level-quest-title">{strings[quest.title]}</span>
    <span className="level-quest-xp">{xpText(quest.xp, lang)}</span>
  </div>;
  const view = quest.view;
  const target = quest.target;
  function showMe() {
    // Switch the tab only when the person is elsewhere: navigating remounts the view, which would close their open
    // card and deck — on the quest's own tab the ring alone is the answer (2026-11-05).
    if (view && new URLSearchParams(location.search).get('view') !== view) onNavigate(view);
    if (target) showQuestTarget(target);
  }
  return <div className="level-quest is-open">
    <button type="button" className="level-quest-row" aria-expanded={hintOpen} aria-controls={`level-hint-${quest.id}`} onClick={onToggleHint}>
      <ChevronRight size={13} aria-hidden="true" />
      <span className="level-quest-title">{strings[quest.title]}</span>
      <span className="level-quest-chip">{xpText(quest.xp, lang)}</span>
    </button>
    {hintOpen && <div id={`level-hint-${quest.id}`} className="level-quest-hint">
      <p>{questBody(strings[quest.body])}</p>
      {(view || target) && <Button variant="outline" size="sm" onClick={showMe}>{t.showMe}</Button>}
    </div>}
  </div>;
}

function ChapterSection({ chapter, status, done, folded, onToggleFold, openHints, onToggleHint, onNavigate }: {
  chapter: Chapter<QuestTextKey>;
  status: ChapterStatus;
  done: ReadonlySet<string>;
  folded: boolean;
  onToggleFold: (fold: boolean) => void;
  openHints: ReadonlySet<string>;
  onToggleHint: (questId: string) => void;
  onNavigate: (view: AppView) => void;
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
      <ChevronDown size={14} className="level-chapter-chevron" aria-hidden="true" />
      <span className="visually-hidden">{t.chapterProgress(questsDone, chapter.quests.length)}</span>
    </button>
    {!folded && <div className="level-chapter-quests">
      {chapter.quests.map(quest => <QuestRow key={quest.id} quest={quest} isDone={done.has(quest.id)}
        hintOpen={openHints.has(quest.id)} onToggleHint={() => onToggleHint(quest.id)} onNavigate={onNavigate} />)}
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

export function LevelPanel({ projectKey, onClose, onNavigate }: LevelPanelProps) {
  const lang = useLang();
  const t = useText(text);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Fold state lives only while the panel is open: open chapters start expanded, done ones collapsed.
  const [folds, setFolds] = useState<Readonly<Record<string, boolean>>>({});
  const [openHints, setOpenHints] = useState<ReadonlySet<string>>(new Set());
  const progress = useQuestProgress(projectKey);
  const done = useMemo(() => new Set(Object.keys(progress)), [progress]);
  const statuses = useMemo(() => chapterStatuses(chapters, done), [done]);
  const total = useMemo(() => totalXp(chapters), []);
  const level = useMemo(() => levelOf(earnedXp(chapters, done), total), [done, total]);
  const locked = chapters.filter((chapter, index) => statuses[index] === 'locked');

  useEffect(() => { titleRef.current?.focus(); }, []);

  function toggleHint(questId: string) {
    setOpenHints(current => {
      const next = new Set(current);
      if (next.has(questId)) next.delete(questId); else next.add(questId);
      return next;
    });
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
      <Button variant="ghost" size="icon" aria-label={t.close} onClick={onClose}><X size={17} aria-hidden="true" /></Button>
    </header>
    <div className="level-panel-xpbar" aria-hidden="true"><i style={{ width: `${levelShare(level.xp, level.floor, level.next)}%` }} /></div>
    <div className="level-panel-body">
      {chapters.map((chapter, index) => statuses[index] === 'locked' ? null
        : <ChapterSection key={chapter.id} chapter={chapter} status={statuses[index]} done={done}
          folded={folds[chapter.id] ?? statuses[index] === 'done'}
          onToggleFold={fold => setFolds(current => ({ ...current, [chapter.id]: fold }))}
          openHints={openHints} onToggleHint={toggleHint} onNavigate={onNavigate} />)}
      {locked.length > 0 && <>
        <p className="level-divider">{t.unlockHint}</p>
        {locked.map(chapter => <LockedChapter key={chapter.id} chapter={chapter} />)}
      </>}
    </div>
  </aside>;
}
