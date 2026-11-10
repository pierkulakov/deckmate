// 2026-11-05: the quest engine turns app signals and server facts into quest progress. It owns no timers: the folder
// facts are re-read on mount, on every workspace refresh (refreshKey), when the window regains focus and when the
// Level panel opens (the badge calls refreshFacts), so a changed project folder is noticed without polling.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { OnboardingFacts } from '../../src/onboarding-contracts.ts';
import { questsCompletedBy, type Quest } from './model.ts';
import { completeQuests, questProgressNow } from './progress.ts';
import { chapters } from './quests.ts';
import { emitSignal, onSignal } from './signals.ts';

/** Trust only a well-formed answer: anything else counts as no news, like a failed request. */
function parseFacts(payload: unknown): OnboardingFacts | null {
  if (payload && typeof payload === 'object' && typeof (payload as { agentSkill?: unknown }).agentSkill === 'boolean') {
    return { agentSkill: (payload as { agentSkill: boolean }).agentSkill };
  }
  return null;
}

export function useQuestEngine(projectKey: string, refreshKey: number, onCompleted: (quests: Quest[]) => void) {
  const [factsFailed, setFactsFailed] = useState(false);
  const [factsLoading, setFactsLoading] = useState(false);
  const requestNumber = useRef(0);
  // One subscription for the session; the listener reads the current project and callback through the ref,
  // because the project may change and the callback closes over render state.
  const latest = useRef({ projectKey, onCompleted });
  latest.current = { projectKey, onCompleted };

  useEffect(() => onSignal(signal => {
    const { projectKey: key, onCompleted: report } = latest.current;
    const finished = questsCompletedBy(signal, chapters, new Set(Object.keys(questProgressNow(key))));
    if (finished.length === 0) return;
    const fresh = new Set(completeQuests(key, finished.map(quest => quest.id)));
    if (fresh.size === 0) return;
    report(finished.filter(quest => fresh.has(quest.id)));
  }), []);

  const refreshFacts = useCallback(async (): Promise<void> => {
    const request = ++requestNumber.current;
    setFactsLoading(true);
    try {
      const response = await fetch('/api/onboarding-facts', { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const facts = parseFacts(await response.json());
      if (!facts) throw new Error();
      if (request !== requestNumber.current) return;
      emitSignal({ type: 'facts', facts });
      setFactsFailed(false);
    } catch {
      if (request === requestNumber.current) setFactsFailed(true);
    } finally {
      if (request === requestNumber.current) setFactsLoading(false);
    }
  }, [projectKey]);

  useEffect(() => () => { requestNumber.current += 1; }, [projectKey]);

  useEffect(() => { void refreshFacts(); }, [refreshFacts, refreshKey]);

  useEffect(() => {
    const onFocus = () => { void refreshFacts(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshFacts]);

  return { refreshFacts, factsFailed, factsLoading };
}
