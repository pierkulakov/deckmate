type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** 2026-11-05: migrate each preference on demand; an existing Deckmate value always wins. */
export function readStoredValue(storage: PreferenceStorage, key: string): string | null {
  const current = storage.getItem(key);
  if (current !== null || !/^deckmate(?=[:.-])/u.test(key)) return current;
  const previousKey = key.replace(/^deckmate/u, 'freetion');
  const previous = storage.getItem(previousKey);
  if (previous === null) return null;
  try {
    storage.setItem(key, previous);
    storage.removeItem(previousKey);
  } catch { /* A full or restricted store must not hide the saved preference or delete its only copy. */ }
  return previous;
}
