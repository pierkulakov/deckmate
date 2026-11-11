import { moveFocus } from '../focus.ts';
import { useCallback, useEffect, useMemo, useRef, useState, type AnimationEvent as ReactAnimationEvent } from 'react';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import { defineText, locale, useLang, useText } from '../i18n.ts';
import { useQuestEngine } from '../onboarding/engine.ts';
import { earnedXp, levelOf, totalXp, type Quest } from '../onboarding/model.ts';
import { useQuestProgress } from '../onboarding/progress.ts';
import { chapters } from '../onboarding/quests.ts';
import type { AppView } from '../onboarding/signals.ts';
import { LevelPanel, levelShare } from './LevelPanel.tsx';

export interface LevelBadgeProps {
  snapshot: WorkspaceSnapshot;
  /** Workspace update counter: changes after every batch of file events. */
  refreshKey: number;
  /** Switch the top-bar tab, for «Show me» in a quest. */
  onNavigate: (view: AppView) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const text = defineText({
  badgeLabel: (level: number, xp: string, next: string | null) => `Level ${level} · ${next === null ? `${xp} XP` : `${xp} / ${next} XP`}`,
}, {
  badgeLabel: (level: number, xp: string, next: string | null) => `Уровень ${level} · ${next === null ? `${xp} XP` : `${xp} / ${next} XP`}`,
});

/** The top-bar level badge (2026-11-05): a small card with the level number and a thin bar to the next level.
 * Holds the quest engine, the «+XP» toast and the level-up pop of the card itself. */
export function LevelBadge({ snapshot, refreshKey, onNavigate, open, onOpenChange }: LevelBadgeProps) {
  const lang = useLang();
  const t = useText(text);
  const projectKey = snapshot.projectName;
  const badgeRef = useRef<HTMLButtonElement>(null);
  const [localOpen, setLocalOpen] = useState(false);
  const panelOpen = open ?? localOpen;
  const setPanelOpen = onOpenChange ?? setLocalOpen;
  // One toast per burst: several quests at once show the sum; a later burst adds to a still-visible toast.
  const [gain, setGain] = useState<{ total: number } | null>(null);
  // Counts level rises and never resets: the card <span> is never replaced (2026-11-05). A keyed remount
  // removed an element that had just run the pop's transform animation, and its last composited frame could
  // stay painted beside the fresh card, making a second badge appear in the bar. One element, one badge, always.
  const [pop, setPop] = useState(0);
  const cardRef = useRef<HTMLSpanElement>(null);

  const onCompleted = useCallback((quests: Quest[]) => {
    const sum = quests.reduce((total, quest) => total + quest.xp, 0);
    setGain(previous => previous ? { total: previous.total + sum } : { total: sum });
  }, []);
  const { refreshFacts, factsFailed, factsLoading } = useQuestEngine(projectKey, refreshKey, onCompleted);

  const progress = useQuestProgress(projectKey);
  const done = useMemo(() => new Set(Object.keys(progress)), [progress]);
  const level = useMemo(() => levelOf(earnedXp(chapters, done), totalXp(chapters)), [done]);
  // Only a rise answers with the pop of the card: progress can also reset when the project changes.
  const seenLevel = useRef(level.level);
  useEffect(() => {
    if (level.level > seenLevel.current) setPop(key => key + 1);
    seenLevel.current = level.level;
  }, [level.level]);

  // Replay the pop on the same element instead of remounting it: drop the class, force one style
  // recalculation so the browser forgets the finished animation, add the class back — it starts anew.
  useEffect(() => {
    if (pop === 0) return;
    const card = cardRef.current;
    if (!card) return;
    card.classList.remove('is-pop');
    void card.offsetWidth;
    card.classList.add('is-pop');
  }, [pop]);

  const format = useCallback((value: number) => new Intl.NumberFormat(locale(lang)).format(value), [lang]);
  const label = t.badgeLabel(level.level, format(level.xp), level.next === null ? null : format(level.next));

  // The class leaves when this very animation ends; one that never runs or is cancelled (reduced
  // motion, hidden tab) is stripped by the next rise, so nothing ever waits on an animation finishing.
  function removePop(event: ReactAnimationEvent<HTMLSpanElement>) {
    if (event.animationName === 'level-pop') event.currentTarget.classList.remove('is-pop');
  }

  function togglePanel() {
    if (panelOpen) { closePanel(); return; }
    void refreshFacts(); // opening the panel is one of the facts refresh points (engine.ts)
    setPanelOpen(true);
  }
  function closePanel(restoreFocus = true) {
    setPanelOpen(false);
    if (restoreFocus) moveFocus(badgeRef.current);
  }

  return <>
    <button ref={badgeRef} type="button" className="level-badge" aria-label={label} title={label}
      aria-expanded={panelOpen} aria-controls="level-panel" onClick={togglePanel}>
      <span ref={cardRef} className="level-badge-card" onAnimationEnd={removePop}>{level.level}</span>
      <span className="level-badge-bar" aria-hidden="true"><i style={{ width: `${levelShare(level.xp, level.floor, level.next)}%` }} /></span>
      {gain !== null && <span className="level-badge-toast" role="status"
        onAnimationEnd={() => setGain(null)}>+{format(gain.total)} XP</span>}
    </button>
    {panelOpen && <LevelPanel projectKey={projectKey} onClose={closePanel} onNavigate={onNavigate}
      factsFailed={factsFailed} factsLoading={factsLoading} onRefreshFacts={refreshFacts} />}
  </>;
}
