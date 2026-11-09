import { useEffect, useRef, useState } from 'react';
import './done-impact.css';

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
