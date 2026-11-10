import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogCard } from '../src/catalog-contracts.ts';
import { resolveCardStateAction } from '../client/card-state-actions.ts';

vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined });

const { setLang } = await import('../client/i18n.ts');
const { ALL_SHORTCUTS, OPEN_CARD_SHORTCUTS, matchShortcut, resolveCardShortcutAction, shortcutGroupsFor } = await import('../client/keyboard-shortcuts.ts');

beforeEach(() => setLang('en'));
afterAll(() => vi.unstubAllGlobals());

describe('shortcut labels and matching', () => {
  it('resolves labels after a language switch while preserving registry identity and matching', () => {
    const event = { code: 'KeyW', key: 'ц', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false } as KeyboardEvent;
    const shortcut = matchShortcut(event, OPEN_CARD_SHORTCUTS);
    expect(shortcut?.id).toBe('open-card-done');
    expect(shortcut?.label).toBe('Mark done or reopen; in Review, focus Accept review');

    setLang('ru');
    expect(matchShortcut(event, OPEN_CARD_SHORTCUTS)).toBe(shortcut);
    expect(shortcut?.label).toBe('Принять или открыть снова; на приёмке — фокус на «Принять результат»');
    expect(ALL_SHORTCUTS.find(item => item.id === shortcut?.id)).toBe(shortcut);
  });

  it('keeps screen and write-permission filtering intact in both languages', () => {
    for (const lang of ['en', 'ru'] as const) {
      setLang(lang);
      const readOnly = shortcutGroupsFor(['app', 'cards'], false).flatMap(group => group.items);
      const writable = shortcutGroupsFor(['app', 'cards'], true).flatMap(group => group.items);
      expect(readOnly.every(item => !item.edits && (item.screen === 'app' || item.screen === 'cards'))).toBe(true);
      expect(readOnly.some(item => item.id === 'focus-search')).toBe(true);
      expect(readOnly.some(item => item.id === 'new-card')).toBe(false);
      expect(writable.some(item => item.id === 'new-card')).toBe(true);
      expect(writable.some(item => item.id === 'open-card-done')).toBe(false);
    }
  });
});

const member = { label: 'Maya Chen', aliases: ['Maya'] };
const card = (state: CatalogCard['state'], overrides: Partial<CatalogCard> = {}): CatalogCard => ({
  id: 'card:task', kind: 'task', title: 'Task', markdown: '', path: 'cards/task.md', range: null,
  version: null, state, owner: member.label, sourceHash: 'hash', deckId: null, trackIds: [], parentId: null, ...overrides,
});

describe('one resolver for Play, Space and individual W', () => {
  it.each([null, 'not-started', 'discussing', 'in-iteration', 'started'] as const)('keeps work and two-step assignment for %s', state => {
    const work = { kind: 'state', state: state === 'started' ? 'not-started' : 'started' };
    expect(resolveCardStateAction(card(state), 'play')).toEqual(work);
    expect(resolveCardStateAction(card(state), 'space', { member })).toEqual(work);
    expect(resolveCardStateAction(card(state, { owner: 'Maya' }), 'space', { member })).toEqual(work);
    expect(resolveCardStateAction(card(state, { owner: 'Leo' }), 'space', { member })).toEqual(state === 'started' ? work : { kind: 'assign', owner: member.label });
    expect(resolveCardStateAction(card(state), 'space')).toEqual(state === 'started' ? work : { kind: 'member-required' });
    expect(resolveCardStateAction(card(state), 'done')).toEqual({ kind: 'state', state: 'done' });
    expect(resolveCardStateAction(card(state), 'check')).toEqual({ kind: 'state', state: 'done' });
    expect(resolveCardStateAction(card(state), 'review')).toEqual({ kind: 'state', state: 'review' });
  });

  it.each([null, 'Leo', member.label])('never returns or assigns Review owned by %s, even without a selected member', owner => {
    for (const actingMember of [member, null]) {
      expect(resolveCardStateAction(card('review', { owner }), 'play', { member: actingMember })).toEqual({ kind: 'none' });
      expect(resolveCardStateAction(card('review', { owner }), 'space', { member: actingMember })).toEqual({ kind: 'review', focus: 'popover' });
      expect(resolveCardStateAction(card('review', { owner }), 'done', { member: actingMember })).toEqual({ kind: 'review', focus: 'accept' });
      expect(resolveCardStateAction(card('review', { owner }), 'review', { member: actingMember })).toEqual({ kind: 'review', focus: 'popover' });
      expect(resolveCardStateAction(card('review', { owner }), 'check', { member: actingMember })).toEqual({ kind: 'state', state: 'done' });
    }
  });

  it.each(['done', 'wont-do'] as const)('requires explicit reopening for %s without starting or assigning', state => {
    const task = card(state, { owner: 'Leo' });
    for (const trigger of ['play', 'space'] as const) expect(resolveCardStateAction(task, trigger, { member })).toEqual({ kind: 'reopen-required' });
    expect(resolveCardStateAction(task, 'done', { member })).toEqual({ kind: 'state', state: 'not-started' });
    expect(resolveCardStateAction(task, 'check', { member })).toEqual({ kind: 'state', state: state === 'done' ? 'not-started' : 'done' });
    expect(resolveCardStateAction(task, 'review', { member })).toEqual({ kind: 'state', state: 'review' });
  });

  it.each(['not-started', 'started', 'review', 'done', 'wont-do'] as const)('preserves availability guards for %s', state => {
    for (const trigger of ['play', 'space', 'done', 'check', 'review'] as const) {
      expect(resolveCardStateAction(card(state), trigger, { member, disabled: true })).toEqual({ kind: 'none' });
      expect(resolveCardStateAction(card(state, { archived: true }), trigger, { member })).toEqual({ kind: 'none' });
      expect(resolveCardStateAction(card(state, { deleted: true }), trigger, { member })).toEqual({ kind: 'none' });
      expect(resolveCardStateAction(undefined, trigger, { member })).toEqual({ kind: 'none' });
    }
  });

  it('preserves Doc assignment and the separate manual/aggregate Hero model', () => {
    for (const kind of ['hero', 'doc'] as const) {
      const item = card(null, { kind });
      expect(resolveCardStateAction(item, 'play')).toEqual({ kind: 'none' });
      expect(resolveCardStateAction(item, 'space', { member })).toEqual({ kind: 'none' });
      expect(resolveCardStateAction({ ...item, owner: null }, 'space', { member })).toEqual({ kind: 'assign', owner: member.label });
      expect(resolveCardStateAction(item, 'done')).toEqual({ kind: 'none' });
      expect(resolveCardStateAction(item, 'review')).toEqual({ kind: 'none' });
      expect(resolveCardStateAction(item, 'check')).toEqual({ kind: 'none' });
    }
    expect(resolveCardStateAction(card(null, { kind: 'hero' }), 'done', { manualHeroDone: true })).toEqual({ kind: 'state', state: 'done' });
    expect(resolveCardStateAction(card('done', { kind: 'hero' }), 'done', { manualHeroDone: true })).toEqual({ kind: 'state', state: 'not-started' });
    expect(resolveCardStateAction(card(null, { kind: 'doc' }), 'done', { manualHeroDone: true })).toEqual({ kind: 'none' });
  });

  it('routes open/hover keys identically and leaves bulk W/Space out of the individual resolver', () => {
    for (const state of [null, 'not-started', 'discussing', 'in-iteration', 'started', 'review', 'done', 'wont-do'] as const) {
      for (const suffix of ['work', 'done']) {
        const open = ALL_SHORTCUTS.find(shortcut => shortcut.id === 'open-card-' + suffix)!;
        const hover = ALL_SHORTCUTS.find(shortcut => shortcut.id === 'hover-' + suffix)!;
        expect(resolveCardShortcutAction(open, card(state), { member })).toEqual(resolveCardShortcutAction(hover, card(state), { member }));
        expect(open.label).toBe(hover.label);
      }
    }
    for (const id of ['bulk-done', 'bulk-assign-me']) expect(resolveCardShortcutAction(ALL_SHORTCUTS.find(shortcut => shortcut.id === id)!, card('review'), { member })).toBeNull();
  });

  it.each(['en', 'ru'] as const)('explains the safe Space target and deliberate W decision in %s', lang => {
    setLang(lang);
    const space = ALL_SHORTCUTS.find(shortcut => shortcut.id === 'open-card-work')!;
    const done = ALL_SHORTCUTS.find(shortcut => shortcut.id === 'open-card-done')!;
    expect(space.label).toContain(lang === 'ru' ? 'без выбора решения' : 'without selecting a decision');
    expect(done.label).toContain(lang === 'ru' ? 'фокус на «Принять результат»' : 'focus Accept review');
  });
});
