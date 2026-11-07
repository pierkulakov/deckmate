import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readNewCardDraft, removeNewCardDraft, writeNewCardDraft, type NewCardDraft } from '../client/card-drafts.ts';

// 2026-11-05 write path: an unsaved New Card survives closing the composer; damaged storage must read as no draft,
// never as a half-parsed object reaching the composer.
const source = 'live';
const place = 'deck/tasks';
const key = 'deckmate:new-card-draft:live:deck/tasks';
const draft = { deckId: 'tasks', kind: 'task', draft: '# Новая карта\n\nТекст', owner: 'Ася', trackIds: ['track-1'], effort: '3', priority: 'high' } satisfies NewCardDraft;

let values: Record<string, string> = {};

beforeEach(() => {
  values = {};
  vi.stubGlobal('localStorage', {
    getItem: (name: string) => values[name] ?? null,
    setItem: (name: string, value: string) => { values[name] = value; },
    removeItem: (name: string) => { delete values[name]; },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('new card draft storage', () => {
  it('round-trips a written draft and removes it on demand', () => {
    writeNewCardDraft(source, place, draft);
    expect(readNewCardDraft(source, place)).toEqual(draft);
    removeNewCardDraft(source, place);
    expect(readNewCardDraft(source, place)).toBeNull();
  });

  it('reads damaged storage as no draft', () => {
    values[key] = '{ не JSON';
    expect(readNewCardDraft(source, place)).toBeNull();
    // JSON.stringify drops an undefined property, so this record has no draft.
    values[key] = JSON.stringify({ ...draft, draft: undefined });
    expect(readNewCardDraft(source, place)).toBeNull();
    values[key] = JSON.stringify({ ...draft, trackIds: 'track-1' });
    expect(readNewCardDraft(source, place)).toBeNull();
  });
});
