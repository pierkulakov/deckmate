import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActivityAttribution } from '../client/components/ActivityAttribution.tsx';
import { AgentQueueHint } from '../client/components/AgentQueueHint.tsx';
import { setLang } from '../client/i18n.ts';
import { questText } from '../client/onboarding/quests.ts';
import type { DeckActivityEvent } from '../src/activity-contracts.ts';

vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal('window', new EventTarget());
});
vi.mock('../client/catalog-store.ts', () => ({ catalogStore: () => ({
  subscribe: () => () => {}, getSnapshot: () => ({ catalog: { members: [
    { id: 'leo', label: 'Leo Park', kind: 'human' },
    { id: 'build-agent', label: 'Build Agent', kind: 'agent' },
  ] } }), load: vi.fn(),
}) }));
afterEach(() => setLang('en'));

const event: DeckActivityEvent = { schema: 1, id: 'event', at: '2026-11-10T00:00:00Z', action: 'set-card-state', actor: 'Deckmate',
  actorMemberId: 'leo', cards: [], deckIds: [], details: [], summary: 'Returned', transitions: [
    { cardId: 'collision', from: 'review', to: 'started', reason: 'Fix the collision.' },
    { cardId: 'other', from: 'review', to: 'started', reason: 'Check another card.' },
    { cardId: 'accepted', from: 'review', to: 'done', reason: 'Not a return.' },
  ] };

it.each(['en', 'ru'] as const)('%s: history names humans and agents and shows a card-specific return reason without disclosure', lang => {
  setLang(lang);
  const html = renderToStaticMarkup(<ActivityAttribution event={event} source="sandbox" cardId="collision" />);
  expect(html).toContain('Leo Park · ' + (lang === 'ru' ? 'Человек' : 'Person'));
  expect(html).toContain('Fix the collision.');
  expect(html).not.toContain('Check another card.');
  expect(html).not.toContain('Not a return.');
  const agent = renderToStaticMarkup(<ActivityAttribution event={{ ...event, actorMemberId: 'build-agent' }} source="sandbox" />);
  expect(agent).toContain('Build Agent · ' + (lang === 'ru' ? 'Агент' : 'Agent'));
  expect(agent).toContain('Check another card.');
});

it('does not invent authorship from Deckmate or an owner for old records or removed members', () => {
  setLang('ru');
  expect(renderToStaticMarkup(<ActivityAttribution event={{ ...event, actorMemberId: null }} source="sandbox" />)).toContain('Автор неизвестен');
  expect(renderToStaticMarkup(<ActivityAttribution event={{ ...event, actorMemberId: 'removed' }} source="sandbox" />)).toContain('removed · Вид участника неизвестен');
});

it.each(['en', 'ru'] as const)('%s: queue hints distinguish assignment, Hand and launching; onboarding calls next a read', lang => {
  setLang(lang);
  const owner = renderToStaticMarkup(<AgentQueueHint />);
  const hand = renderToStaticMarkup(<AgentQueueHint assignment="hand" />);
  expect(owner).toContain('Hand');
  expect(owner).toContain(lang === 'ru' ? 'Назначение не запускает агента' : 'Assigning does not start an agent');
  expect(hand).toContain(lang === 'ru' ? 'когда его запустят отдельно' : 'launched separately');
  expect(owner).toContain('overflow-wrap:anywhere');
  expect(questText[lang].agentOwnerBody).toContain('Hand');
  expect(questText[lang].agentReportBody).toContain(lang === 'ru' ? 'а не запускает модель' : 'does not start a model');
});
