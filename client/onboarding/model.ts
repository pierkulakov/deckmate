import type { LucideIcon } from 'lucide-react';
import type { AppView, OnboardingSignal } from './signals.ts';

// 2026-11-05: onboarding quests. Chapters unlock in order, quests inside an open chapter go in any order, and every
// quest completes on the real action it teaches. Texts live in quests.ts through defineText; here — only the rules.

export interface Quest<Key extends string = string> {
  /** Stable kebab-case id: progress is stored by it, so it never changes once released. */
  id: string;
  xp: number;
  /** Keys of `questText` in quests.ts. */
  title: Key;
  body: Key;
  /** The tab where the action happens; the panel offers to go there. */
  view?: AppView;
  /** Selector list of the action element, then the first steps when it needs an open card or deck (show-me.ts). */
  target?: string;
  /** Body key while the project has no decks: the default body assumes a cover exists to click (2026-11-11). */
  bodyWithoutDecks?: Key;
  /** Selector list while the project has no decks: actions that create the first deck or come from a template. */
  targetWithoutDecks?: string;
  /** True when the signal is the action this quest teaches. Pure and cheap: it reads the signal only. */
  done(signal: OnboardingSignal): boolean;
}

export interface Chapter<Key extends string = string> {
  id: string;
  title: Key;
  icon: LucideIcon;
  quests: readonly Quest<Key>[];
}

export type ChapterStatus = 'done' | 'open' | 'locked';

/** Finished chapters stay open, and so do the first three unfinished ones; each finished chapter opens the next. */
const openChapterLimit = 3;

export function chapterStatuses(chapters: readonly Chapter[], done: ReadonlySet<string>): ChapterStatus[] {
  let unfinished = 0;
  return chapters.map(chapter => {
    if (chapter.quests.every(quest => done.has(quest.id))) return 'done';
    unfinished += 1;
    return unfinished <= openChapterLimit ? 'open' : 'locked';
  });
}

/** Record real actions independently of chapter visibility; a pre-existing fact is not an action. */
export function questsCompletedBy(signal: OnboardingSignal, chapters: readonly Chapter[], done: ReadonlySet<string>): Quest[] {
  const statuses = signal.type === 'facts' ? chapterStatuses(chapters, done) : null;
  return chapters.flatMap((chapter, index) => {
    if (statuses && statuses[index] !== 'open') return [];
    return chapter.quests.filter(quest => !done.has(quest.id) && quest.done(signal));
  });
}

export function totalXp(chapters: readonly Chapter[]): number {
  return chapters.reduce((sum, chapter) => sum + chapter.quests.reduce((part, quest) => part + quest.xp, 0), 0);
}

export function earnedXp(chapters: readonly Chapter[], done: ReadonlySet<string>): number {
  return chapters.reduce((sum, chapter) => sum + chapter.quests.reduce((part, quest) => part + (done.has(quest.id) ? quest.xp : 0), 0), 0);
}

interface LevelProgress {
  /** 1-based level. */
  level: number;
  xp: number;
  /** XP where this level started. */
  floor: number;
  /** XP of the next level; null at the last level, reached when every quest is done. */
  next: number | null;
}

// Shares of all XP where each next level starts: early levels come quickly, the last one needs every quest.
const levelShares = [0, 0.06, 0.16, 0.32, 0.52, 0.75, 1];

/** Thresholds rounded to 10 XP; the last one is exactly the total, so the top level means «all quests done». */
function levelThresholds(total: number): number[] {
  return levelShares.map((share, index) => index === levelShares.length - 1 ? total : Math.round(total * share / 10) * 10);
}

export function levelOf(xp: number, total: number): LevelProgress {
  const thresholds = levelThresholds(total);
  let index = 0;
  while (index + 1 < thresholds.length && xp >= thresholds[index + 1]) index += 1;
  const next = index + 1 < thresholds.length ? thresholds[index + 1] : null;
  return { level: index + 1, xp, floor: thresholds[index], next };
}
