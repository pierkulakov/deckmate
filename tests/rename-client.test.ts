import { afterAll, expect, it, vi } from 'vitest';
import { readStoredValue } from '../client/storage.ts';
import { affectsCatalog } from '../client/catalog-store.ts';
import { boardAccessOf, boardCardIdOf, boardCustomValue, isBoardProtocolLink } from '../src/board-contracts.ts';

vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
});
afterAll(() => vi.unstubAllGlobals());

function preferenceStore(entries: Record<string, string>) {
  const values = new Map(Object.entries(entries));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

it.each([':recent-decks:root', '.attachments.sort', '-theme', '-timeline:sandbox:root'])(
  'migrates a legacy local/session preference with suffix %s on its first read', suffix => {
    const storage = preferenceStore({ ['freetion' + suffix]: 'saved' });
    expect(readStoredValue(storage, 'deckmate' + suffix)).toBe('saved');
    expect(storage.values.has('freetion' + suffix)).toBe(false);
    expect(storage.values.get('deckmate' + suffix)).toBe('saved');
    storage.values.set('deckmate' + suffix, 'changed');
    expect(readStoredValue(storage, 'deckmate' + suffix)).toBe('changed');
  },
);

it('prefers an existing new value including an empty string and leaves unrelated keys alone', () => {
  const storage = preferenceStore({ 'freetion-theme': 'dark', 'deckmate-theme': '', 'freetionOther': 'outside' });
  expect(readStoredValue(storage, 'deckmate-theme')).toBe('');
  expect(storage.values.get('freetion-theme')).toBe('dark');
  expect(readStoredValue(storage, 'deckmateOther')).toBeNull();
  expect(readStoredValue(storage, 'unrelated')).toBeNull();
});

it('uses the saved legacy preference without deleting it when migration cannot write', () => {
  const storage = preferenceStore({ 'freetion-theme': 'light' });
  storage.setItem = () => { throw new Error('Storage quota exceeded'); };
  expect(readStoredValue(storage, 'deckmate-theme')).toBe('light');
  expect(storage.values.get('freetion-theme')).toBe('light');
  expect(storage.values.has('deckmate-theme')).toBe(false);
});

it('keeps old board access flags without mutating the scene, with a valid new flag taking priority', () => {
  const scene = { appState: { freetionAccess: 'locked' } };
  expect(boardAccessOf(scene)).toBe('locked');
  expect(scene).toEqual({ appState: { freetionAccess: 'locked' } });
  expect(boardAccessOf({ appState: { freetionAccess: 'readonly' } })).toBe('readonly');
  expect(boardAccessOf({ appState: { deckmateAccess: 'editable', freetionAccess: 'locked' } })).toBe('editable');
  expect(boardAccessOf({ appState: { deckmateAccess: 'unknown', freetionAccess: 'locked' } })).toBe('locked');
});

it('reads old card, view, smart, video and caption metadata without adding or changing fields', () => {
  const customData = Object.freeze({ freetionCardId: 'card:old', freetionCardView: 'full',
    freetionSmart: { deckId: 'sound', state: null }, freetionVideo: 'https://youtu.be/video', freetionCaptionFor: 'image' });
  expect(boardCardIdOf({ customData })).toBe('card:old');
  expect(boardCustomValue(customData, 'CardView')).toBe('full');
  expect(boardCustomValue(customData, 'Smart')).toEqual({ deckId: 'sound', state: null });
  expect(boardCustomValue(customData, 'Video')).toBe('https://youtu.be/video');
  expect(boardCustomValue(customData, 'CaptionFor')).toBe('image');
  expect(Object.keys(customData)).toHaveLength(5);
  expect(boardCardIdOf({ customData: { ...customData, deckmateCardId: 'card:new' } })).toBe('card:new');
  expect(boardCustomValue({ ...customData, deckmateSmart: null }, 'Smart')).toBeNull();
  expect(boardCardIdOf({ customData: { deckmateCardId: 42 } })).toBeNull();
  expect(boardCardIdOf({})).toBeNull();
});

it('recognizes both board protocols and excludes both activity directories from catalog updates', () => {
  expect(isBoardProtocolLink('freetion://smart/sound')).toBe(true);
  expect(isBoardProtocolLink('deckmate://smart/sound')).toBe(true);
  expect(isBoardProtocolLink('https://freetion.example/')).toBe(false);
  expect(affectsCatalog('tasks/freetion-activity/event.md')).toBe(false);
  expect(affectsCatalog('tasks/deckmate-activity/event.md')).toBe(false);
  expect(affectsCatalog('tasks/freetion.md')).toBe(true);
  expect(affectsCatalog('tasks/deckmate.md')).toBe(true);
});
