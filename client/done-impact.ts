import { useEffect, useRef, useState } from 'react';
import type { CatalogCard } from '../src/catalog-contracts.ts';
import './done-impact.css';

/** A Hero is finished when every Task Sub Card is done or decided against, and at least one is done (2026-11-06). */
export function familyFinished(children: readonly Pick<CatalogCard, 'kind' | 'state'>[]): boolean {
  const tasks = children.filter(child => child.kind === 'task');
  return tasks.some(child => child.state === 'done') && tasks.every(child => child.state === 'done' || child.state === 'wont-do');
}

/**
 * True for a moment after the card turns finished in front of the person (2026-11-06): the tile or the preview plays
 * the done impact once. Opening a finished card or switching cards never plays it.
 */
export function useJustFinished(finished: boolean, cardId: string): boolean {
  const seen = useRef({ cardId, finished });
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const before = seen.current;
    seen.current = { cardId, finished };
    if (!finished) { setPlaying(false); return; }
    if (before.cardId !== cardId || before.finished) return;
    setPlaying(true);
    const timer = setTimeout(() => setPlaying(false), 900);
    return () => clearTimeout(timer);
  }, [cardId, finished]);
  return playing;
}
