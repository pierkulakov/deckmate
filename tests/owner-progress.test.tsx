import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CardOwnerAvatar, ownerInitials, ownerProgressLabel } from '../client/components/CardOwnerAvatar.tsx';
import { setLang } from '../client/i18n.ts';

vi.hoisted(() => vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' }));
beforeEach(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  setLang('en');
});
afterEach(() => vi.unstubAllGlobals());

it.each(['en', 'ru'] as const)('uses the same Unicode initials for people in %s', lang => {
  setLang(lang);
  expect(ownerInitials('  Мария   Иванова Петрова ', lang)).toBe('МИ');
  expect(ownerInitials('éclair 😀 test', lang)).toBe('É😀');
  expect(ownerInitials('   ', lang)).toBe('');
  expect(ownerInitials(null, lang)).toBe('');
  const html = renderToStaticMarkup(<CardOwnerAvatar owner="  Мария   Иванова Петрова " members={[]} />);
  expect(html).toContain('>МИ</span>');
});

// 2026-11-10: the owner medallion has no ring, which read as a heavy outline;
// the checklist stays in the owner's accessible name and tooltip.
describe('owner checklist label', () => {
  it('names only the owner without a checklist', () => {
    expect(ownerProgressLabel('Maya Chen')).toBe('Owner: Maya Chen');
    expect(ownerProgressLabel('Maya Chen', { done: 0, total: 0 })).toBe('Owner: Maya Chen');
    expect(ownerProgressLabel(null)).toBe('Owner: Unassigned');
  });

  it.each(['en', 'ru'] as const)('names the owner and checklist on human and agent avatars, without a ring (%s)', lang => {
    setLang(lang);
    for (const kind of ['human', 'agent'] as const) {
      const html = renderToStaticMarkup(<CardOwnerAvatar owner="maya" members={[{ id: 'maya', label: 'Maya Chen', kind, aliases: [] }]} progress={{ done: 1, total: 3 }} />);
      const label = lang === 'en' ? 'Owner: Maya Chen · checklist 1 of 3' : 'Исполнитель: Maya Chen · чек-лист 1 из 3';
      expect(html).toContain(`role="img" title="${label}" aria-label="${label}"`);
      expect(html).not.toContain('owner-progress-ring');
      if (kind === 'human') { expect(html).toContain('>MC</span>'); expect(html).not.toContain('lucide-user-round'); }
      else expect(html).toContain('lucide-bot');
    }
  });
});
