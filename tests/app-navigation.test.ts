import { describe, expect, it } from 'vitest';
import { cardNavigation, viewNavigation, type View } from '../client/app-navigation.ts';

const catalog = new URL('http://localhost/project/?view=deck&catalogSource=sandbox&deck=deck%3Aone&track=track%3Atwo&card=card%3Athree&q=title%3A%D1%82%D0%B5%D1%81%D1%82&order=priority&order=due&deckQ=art&layout=table&archive=1&lane=first&lane=second#card');

describe('app tab navigation', () => {
  it.each(['hand', 'decisions', 'timeline', 'vision'] as const)('keeps the catalog query when visiting %s and returning to Decks', next => {
    const away = viewNavigation(catalog.href, 'deck', next, 'sandbox');
    const back = viewNavigation(away.url.href, next, 'deck', 'sandbox');
    expect(away.changed).toBe(true);
    expect(back.changed).toBe(true);
    expect(back.url.href).toBe(catalog.href);
    const expected = new URL(catalog);
    expected.searchParams.set('view', next);
    expect(away.url.href).toBe(expected.href);
  });

  it.each<View>(['deck', 'hand', 'decisions', 'timeline', 'vision'])('does not request a remount for the active %s tab', view => {
    const navigation = viewNavigation(catalog.href, view, view, 'live');
    expect(navigation.changed).toBe(false);
    expect(navigation.url.searchParams.get('catalogSource')).toBe('live');
    expect(navigation.url.searchParams.get('deck')).toBe('deck:one');
    expect(navigation.url.searchParams.getAll('order')).toEqual(['priority', 'due']);
    expect(navigation.url.pathname).toBe('/project/');
    expect(navigation.url.hash).toBe('#card');
  });
});

it('opens a selected card on questions without changing ordinary card navigation', () => {
  const href = 'http://localhost/?view=decisions&handMember=maya&handTab=team';
  const questions = cardNavigation(href, 'card:one', 'sandbox', 'questions');
  expect(Object.fromEntries(questions.searchParams)).toEqual({ view: 'deck', catalogSource: 'sandbox', scope: 'all', card: 'card:one', handMember: 'maya', handTab: 'team', cardPanel: 'questions' });
  expect(cardNavigation(href, 'card:one', 'sandbox').searchParams.has('cardPanel')).toBe(false);
});
