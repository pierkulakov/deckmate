import { useSyncExternalStore } from 'react';
import { readStoredValue } from '../storage.ts';

// 2026-11-05: quest progress is personal and stays in this browser, one record per project. It is not written into the
// project files: a tutorial is nobody else's business in the repository, and a teammate learns the tool by doing it.

const prefix = 'deckmate-onboarding:';
const changeEvent = 'deckmate:onboarding-progress';

/** Quest id → ISO time of completion. */
export type QuestProgress = Readonly<Record<string, string>>;

const empty: QuestProgress = Object.freeze({});
const cache = new Map<string, QuestProgress>();

function storageKey(projectKey: string): string {
  return prefix + projectKey;
}

function read(projectKey: string): QuestProgress {
  const cached = cache.get(projectKey);
  if (cached) return cached;
  let progress = empty;
  try {
    const parsed: unknown = JSON.parse(readStoredValue(localStorage, storageKey(projectKey)) ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      progress = Object.freeze(Object.fromEntries(Object.entries(parsed).filter(([, at]) => typeof at === 'string')) as Record<string, string>);
    }
  } catch { /* unreadable or blocked storage starts from zero */ }
  cache.set(projectKey, progress);
  return progress;
}

/** Mark quests done; already finished ones keep their first time. Returns the ids that were new. */
export function completeQuests(projectKey: string, questIds: readonly string[], at = new Date().toISOString()): string[] {
  const current = read(projectKey);
  const fresh = questIds.filter(id => !current[id]);
  if (fresh.length === 0) return [];
  const next = Object.freeze({ ...current, ...Object.fromEntries(fresh.map(id => [id, at])) });
  cache.set(projectKey, next);
  try { localStorage.setItem(storageKey(projectKey), JSON.stringify(next)); } catch { /* without storage progress lasts until reload */ }
  window.dispatchEvent(new Event(changeEvent));
  return fresh;
}

function subscribe(listener: () => void): () => void {
  // Another tab of the same project finished a quest: drop the cache so the next read sees it.
  const fromOtherTab = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(prefix)) {
      cache.clear();
      listener();
    }
  };
  window.addEventListener(changeEvent, listener);
  window.addEventListener('storage', fromOtherTab);
  return () => {
    window.removeEventListener(changeEvent, listener);
    window.removeEventListener('storage', fromOtherTab);
  };
}

/** Quest progress of the project for render; re-renders when any quest completes, here or in another tab. */
export function useQuestProgress(projectKey: string): QuestProgress {
  return useSyncExternalStore(subscribe, () => read(projectKey), () => empty);
}

/** Progress outside render (signal handlers). */
export function questProgressNow(projectKey: string): QuestProgress {
  return read(projectKey);
}
