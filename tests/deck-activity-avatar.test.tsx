import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActivityEntry } from '../client/components/DeckActivity.tsx';
import { setLang } from '../client/i18n.ts';
import type { DeckActivityEvent } from '../src/activity-contracts.ts';
import type { CatalogMember } from '../src/catalog-contracts.ts';

// The avatar resolves from the members prop; the member line beside it reads the same roster through the shared store.
const members = vi.hoisted((): CatalogMember[] => [
  { id: 'maya', label: 'Maya Chen', kind: 'human', aliases: [] },
  { id: 'glm', label: 'GLM', kind: 'agent', aliases: [] },
  { id: 'build-agent', label: 'Build Agent', kind: 'agent', aliases: [] },
]);

vi.mock('../client/catalog-store.ts', () => ({ catalogStore: () => ({
  subscribe: () => () => {}, getSnapshot: () => ({ catalog: { members } }), load: vi.fn(),
}) }));

// i18n writes to document.documentElement at import time, before any hook runs.
vi.hoisted(() => vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' }));

beforeEach(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  setLang('en');
});
afterEach(() => vi.unstubAllGlobals());

function rowEvent(actorMemberId: string | null): DeckActivityEvent {
  return { schema: 1, id: 'event', at: '2026-11-12T00:00:00Z', action: 'set-card-state', actor: 'Deckmate',
    actorMemberId, summary: 'Accepted the card', cards: [{ id: 'card', title: 'Collision fix' }], deckIds: [], details: [] };
}

function row(actorMemberId: string | null): string {
  return renderToStaticMarkup(<ActivityEntry event={rowEvent(actorMemberId)} source="sandbox" disabled={false} onOpen={() => {}} members={members} />);
}

// 2026-11-12: the history row wears the shared owner medallion — an agent shows its symbol, not the first letter of its name.
it('draws an agent author with the shared agent avatar, not a name letter', () => {
  const html = row('glm');
  expect(html).toContain('card-owner-avatar is-agent');
  expect(html).toContain('data-agent="glm"');
  expect(html).toContain('lucide-network');
  expect(html).not.toContain('deck-activity-avatar');
  const plain = row('build-agent');
  expect(plain).toContain('card-owner-avatar is-agent');
  expect(plain).toContain('lucide-bot');
});

it('draws a human author with initials', () => {
  const html = row('maya');
  expect(html).toContain('>MC</span>');
  expect(html).not.toContain('is-agent');
});

it('draws the unassigned silhouette for records without an author', () => {
  const html = row(null);
  expect(html).toContain('lucide-user-round');
  expect(html).not.toContain('is-agent');
  expect(html).toContain('Author unknown');
});

it('draws initials for a participant who left the roster', () => {
  const html = row('removed');
  expect(html).toContain('>R</span>');
  expect(html).not.toContain('deck-activity-avatar');
  expect(html).not.toContain('is-agent');
  expect(html).toContain('removed · Member type unknown');
});
