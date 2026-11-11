import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogCard, CatalogView } from '../src/catalog-contracts.ts';
import { shortReference } from '../src/references.ts';

vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
const { parseSearch, RESULT_LIMIT, runSearch, toggleTagOr, withoutToken, suggestTagFilters, completeTagFilter, matchedTagsFirst } = await import('../client/search-query.ts');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 5, 12));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
afterAll(() => vi.unstubAllGlobals());

function card(id: string, options: Partial<CatalogCard> = {}): CatalogCard {
  return {
    id, kind: 'task', path: 'cards/shared.md', version: null, title: id, state: null, owner: null,
    markdown: '', sourceHash: 'shared-file-hash', range: null, deckId: null, trackIds: [], parentId: null,
    ...options,
  };
}

function fixture(cards?: CatalogCard[]): CatalogView {
  return {
    rootIdentity: 'search-fixture', formatLanguage: 'ru', manifestHash: 'manifest', configured: true, indexedAt: '2026-11-05T12:00:00Z',
    documents: [], spaces: [], tracks: [], warnings: [],
    decks: [
      { id: 'audio', spaceId: 'work', title: 'Audio Desk', kind: 'mixed', description: '', color: '#123456', icon: '' },
      { id: 'assets', spaceId: 'work', title: 'Assets', kind: 'asset', description: '', color: '#234567', icon: '' },
      { id: 'notes', spaceId: 'work', title: 'Notes', kind: 'knowledge', description: '', color: '#345678', icon: '' },
    ],
    members: [
      { id: 'maria', label: 'Мария', kind: 'human', aliases: ['Masha', 'МАШЕНЬКА'] },
      { id: 'robot', label: 'Agent', kind: 'agent', aliases: ['Bot'] },
    ],
    runs: [
      { id: 'past', number: 1, start: '2026-10-01', end: '2026-11-04', goal: 'Previous Work' },
      { id: 'current', number: 2, start: '2026-11-05', end: '2026-11-05', goal: 'Current Work' },
      { id: 'future', number: 3, start: '2026-11-06', end: '2026-11-12', goal: 'Next Work' },
    ],
    milestones: [
      { id: 'release', title: 'Release Alpha', date: '2026-11-05', color: '#123456' },
      { id: 'later', title: 'Launch Later', date: '2026-12-01', color: '#234567' },
    ],
    cards: cards ?? [
      card('b', { title: 'Beta Task', markdown: 'Second ordinary note.', state: 'done', effort: 3,
        priority: 'medium', deckId: 'audio', tags: ['Blue'], run: 'past', dueDate: '2026-11-05' }),
      card('h', { kind: 'hero', title: 'Root Hero', markdown: 'Reference body.', deckId: 'assets' }),
      card('a', { title: 'Альфа Sound', markdown: 'ГРОМКИЙ сигнал #raw', state: 'not-started', owner: 'Мария', effort: 5,
        priority: 'high', deckId: 'audio', tags: ['RED', 'blue'], run: 'current', milestone: 'release',
        handMemberIds: ['maria'], dueDate: '2026-11-04', parentId: 'h' }),
      card('c', { kind: 'doc', title: 'Gamma Guide', markdown: 'Тихий сигнал', owner: 'Agent', effort: 0,
        priority: 'low', deckId: 'notes', tags: ['red'], run: 'future', milestone: 'later',
        handMemberIds: ['robot'], dueDate: '2026-11-12', parentId: 'h' }),
      card('u', { title: 'Unowned Delta', markdown: 'empty_owner marker', state: 'review', owner: '',
        run: 'missing-run', milestone: 'missing-milestone', dueDate: '2026-11-13', parentId: 'x' }),
      card('x', { kind: 'hero', title: 'Archived Hero', markdown: 'Archived сигнал', state: 'done',
        archived: true, owner: 'Мария', priority: 'high', deckId: 'audio' }),
      card('z', { title: 'Deleted Task', markdown: 'Deleted сигнал', state: 'done', deleted: true }),
      card('y', { title: 'Both Shelves', markdown: 'Hidden сигнал', state: 'not-started', archived: true, deleted: true }),
    ],
  };
}

function expectCards(catalog: CatalogView, query: string, expected: string[], member: string | null = 'maria'): void {
  const result = runSearch(catalog, query, member);
  expect(result.cards.map(candidate => candidate.id), query).toEqual(expected);
  expect(result.total, query).toBe(expected.length);
}

function checkCases(cases: ReadonlyArray<readonly [string, string[]]>): void {
  const catalog = fixture();
  for (const [query, expected] of cases) expectCards(catalog, query, expected);
}

describe('search query compatibility', () => {
  it('matches words across title and Markdown with Russian case folding and negation', () => {
    checkCases([
      ['СИГНАЛ', ['a', 'c']], ['альфа', ['a']], ['громкий сигнал', ['a']], ['!сигнал', ['b', 'h', 'u']],
      ['сигнал !громкий', ['c']], ['kind:task сигнал', ['a']], ['t:АЛЬФА', ['a']],
      ['t:сигнал', []], ['!t:task', ['h', 'a', 'c', 'u']],
    ]);
  });

  it('keeps tags exact and combines separate tags with AND, alternatives with OR', () => {
    checkCases([
      ['#RED', ['a', 'c']], ['#blue', ['b', 'a']], ['#red #blue', ['a']], ['#red|#blue', ['b', 'a', 'c']],
      ['#red|blue', ['b', 'a', 'c']], ['!#red|#blue', ['h', 'u']], ['#re', []], ['#raw', []],
    ]);
  });

  it('ignores empty tag alternatives without losing the remaining tag', () => {
    checkCases([['#RED|', ['a', 'c']], ['#|#RED', ['a', 'c']], ['!#RED||', ['b', 'h', 'u']]]);
  });

  it('suggests tag prefixes with and without #, counts cards once and commits an exact filter', () => {
    const catalog = fixture([
      card('play', { tags: ['bug', 'Playtest', 'Playtest'] }), card('longer', { tags: ['Playtesting'] }),
      card('hidden', { tags: ['Playtest'], archived: true }), card('trash', { tags: ['Playtest'], deleted: true }),
    ]);
    catalog.projectTags = [{ name: 'Playtest', color: '#cc5c65' }, { name: 'План', color: '#687e9c' }];
    for (const query of ['pla', '#PLA']) {
      const suggestions = suggestTagFilters(catalog, query);
      expect(suggestions.map(({ name, count }) => [name, count])).toEqual([['Playtest', 1], ['Playtesting', 1]]);
      const completed = completeTagFilter(query, suggestions[0]);
      expect(completed).toBe('#Playtest ');
      expectCards(catalog, completed, ['play']);
    }
    expectCards(catalog, '#pla', []);
    expect(suggestTagFilters(catalog, 'playtest').map(({ name }) => name)).toEqual(['Playtest', 'Playtesting']);
    expect(suggestTagFilters(catalog, '#пл').map(({ name, count }) => [name, count])).toEqual([['План', 0]]);
    expect(suggestTagFilters(catalog, 'lay')).toEqual([]);
    for (const query of ['#Playtest ', 'deck:pla', '@pla', '$pla']) expect(suggestTagFilters(catalog, query)).toEqual([]);
  });

  it('completes the current alternative without losing negation, OR or surrounding filters', () => {
    const catalog = fixture([card('both', { tags: ['bug', 'playtest'] }), card('other', { tags: ['playtesting'] })]);
    const query = 'kind:task !#bug|#pla @none';
    const caret = query.indexOf(' @none');
    const suggestion = suggestTagFilters(catalog, query, caret)[0];
    expect(completeTagFilter(query, suggestion)).toBe('kind:task !#bug|#playtest @none');
    expectCards(catalog, completeTagFilter(query, suggestion), ['other']);
    expect(toggleTagOr('#bug #playtest !#other')).toBe('#bug|#playtest !#other');
  });

  it('keeps quoted tag names exact, including spaces, pipes and quotes, through parsing and OR toggles', () => {
    const name = 'play test|"русский"';
    const catalog = fixture([card('exact', { tags: [name] }), card('prefix', { tags: [name + ' next'] })]);
    const query = '!#' + JSON.stringify(name);
    expect(parseSearch(query)).toMatchObject([{ kind: 'tag', value: name, negated: true, raw: query, start: 0, end: query.length }]);
    expectCards(catalog, query, ['prefix']);
    expectCards(catalog, query.slice(1), ['exact']);
    const completed = completeTagFilter('pla', suggestTagFilters(catalog, 'pla')[0]);
    expectCards(catalog, completed, ['exact']);
    const joined = toggleTagOr(query.slice(1) + ' #bug');
    expectCards(catalog, joined, ['exact']);
    expect(toggleTagOr(joined)).toBe(query.slice(1) + ' #bug');
    for (const token of parseSearch(joined)) expect(joined.slice(token.start, token.end)).toBe(token.raw);
  });

  it('puts positive matching tags before other badges without mutating assignments', () => {
    const tags = Object.freeze(['bug', 'audio', 'Playtest', 'later']);
    expect(matchedTagsFirst(tags, '#playtest !#bug')).toEqual(['Playtest', 'bug', 'audio', 'later']);
    expect(matchedTagsFirst(tags, 'pla')).toEqual(['Playtest', 'bug', 'audio', 'later']);
    expect(matchedTagsFirst(tags, '#audio|#playtest')).toEqual(['audio', 'Playtest', 'bug', 'later']);
    expect(tags).toEqual(['bug', 'audio', 'Playtest', 'later']);
  });

  it('preserves case-sensitive canonical IDs while matching parent titles without case', () => {
    const parent = card('hero:features/Audio.md#1', { kind: 'hero', title: 'Sound World' });
    const child = card('task:features/Audio.md#1.0', { parentId: parent.id });
    const catalog = fixture([parent, child]);
    expect(runSearch(catalog, '$' + parent.id).navigation).toEqual([{ kind: 'card', card: parent }]);
    expectCards(catalog, 'sub:' + parent.id, [child.id]);
    expectCards(catalog, '!sub:' + parent.id, [parent.id]);
    expectCards(catalog, 'sub:SOUND', [child.id]);
    expectCards(catalog, 'sub:' + shortReference('c', parent.id).toUpperCase(), [child.id]);
    parent.title = 'Sound: World';
    expectCards(catalog, 'sub:SOUND:', [child.id]);
  });

  it('resolves owners by label, member ID and aliases, preserving null versus empty', () => {
    checkCases([
      ['@мар', ['a']], ['@maria', ['a']], ['@MASHA', ['a']], ['@машенька', ['a']], ['@bot', ['c']],
      ['@none', ['b', 'h']], ['!@none', ['a', 'c', 'u']], ['!@masha', ['b', 'h', 'c', 'u']], ['@missing', []],
    ]);
    const catalog = fixture();
    catalog.members![0].aliases = ['new-alias'];
    expectCards(catalog, '@masha', []);
    expectCards(catalog, '@new-alias', ['a']);
  });

  it('matches deck, kind and state prefixes and rejects unknown positive filters', () => {
    checkCases([
      ['deck:Au', ['b', 'a']], ['!deck:audio', ['h', 'c', 'u']], ['kind:t', ['b', 'a', 'u']],
      ['kind:h', ['h']], ['kind:d', ['c']], ['state:план', ['a']], ['state:пр', ['b', 'u']],
      ['!state:принято', ['h', 'a', 'c', 'u']], ['deck:missing', []], ['kind:missing', []], ['state:missing', []],
      ['!deck:missing !kind:missing !state:missing', ['b', 'h', 'a', 'c', 'u']],
    ]);
  });

  it('R20 resolves exact members before partial owner matches, including aliases and Unicode', () => {
    const catalog = fixture([
      card('al', { owner: 'Alex' }), card('alias', { owner: 'АЛЕКС' }),
      card('sally', { owner: 'Sally' }), card('none'),
    ]);
    catalog.members = [
      { id: 'al', label: 'Alex', kind: 'human', aliases: ['Алекс'] },
      { id: 'sally', label: 'Sally', kind: 'human', aliases: ['Alexandra'] },
    ];
    for (const query of ['@al', '@Alex', '@АЛЕКС']) expectCards(catalog, query, ['al', 'alias']);
    expectCards(catalog, '!@al', ['sally', 'none']);
    expectCards(catalog, '@all', ['sally']);
    expectCards(catalog, '@unknown', []);
    expectCards(catalog, '@none', ['none']);
    catalog.members[1].aliases.push('Алекс');
    expectCards(catalog, '@алекс', []);
    expectCards(catalog, '@al', ['al', 'alias']);
  });

  it('R21 searches finite fractional effort with inclusive ranges and negation', () => {
    const catalog = fixture([card('zero', { effort: 0 }), card('half', { effort: .5 }), card('one', { effort: 1 }), card('none')]);
    for (const [query, expected] of [
      ['effort:0.5', ['half']], ['effort:0.5+', ['half', 'one']], ['effort:0.5-', ['zero', 'half']],
      ['!effort:0.5', ['zero', 'one', 'none']], ['effort:0', ['zero']], ['effort:0-', ['zero']],
    ] as const) expectCards(catalog, query, [...expected]);
    for (const value of ['-0.5', 'Infinity', 'NaN', '1.2.3', '1e999']) {
      expectCards(catalog, 'effort:' + value, []);
      expectCards(catalog, '!effort:' + value, ['zero', 'half', 'one', 'none']);
    }
  });

  it('R22 treats an early finished Run as past before its planned dates', () => {
    const catalog = fixture();
    catalog.runs![1].finishedAt = '2026-11-05T08:00:00Z';
    catalog.runs![2].finishedAt = '2026-11-05T09:00:00Z';
    expectCards(catalog, 'run:past', ['b', 'a', 'c']);
    expectCards(catalog, 'run:current', []);
    expectCards(catalog, 'run:future', []);
    expectCards(catalog, '!run:past', ['h', 'u']);
  });

  it('only exposes archive and trash for a positive shelf filter, with deleted taking precedence', () => {
    checkCases([
      ['!state:archived', ['b', 'h', 'a', 'c', 'u']], ['!state:deleted', ['b', 'h', 'a', 'c', 'u']],
      ['state:archived', ['x']], ['state:a', ['x']], ['state:deleted', ['z', 'y']],
      ['state:d !state:archived', ['z', 'y']], ['state:archived state:deleted', []],
      ['state:archived сигнал', ['x']], ['state:deleted !t:both', ['z']],
    ]);
  });

  it('preserves numeric effort and ranked priority ranges including missing or invalid values', () => {
    checkCases([
      ['effort:3', ['b']], ['effort:3+', ['b', 'a']], ['effort:3-', ['b', 'c']], ['effort:0', ['c']],
      ['!effort:3', ['h', 'a', 'c', 'u']], ['effort:3.5', []], ['effort:-1', []],
      ['!effort:bad', ['b', 'h', 'a', 'c', 'u']], ['priority:h', ['a']], ['priority:medium+', ['b', 'a']],
      ['priority:low-', ['c']], ['!priority:high', ['b', 'h', 'c', 'u']], ['priority:bad', []],
      ['!priority:bad', ['b', 'h', 'a', 'c', 'u']],
    ]);
  });

  it('resolves run phases, numbers and goals and handles dangling references', () => {
    checkCases([
      ['run:past', ['b']], ['run:current', ['a']], ['run:future', ['c']], ['run:none', ['h']],
      ['run:2', ['a']], ['run:prev', ['b']], ['run:next', ['c']], ['!run:current', ['b', 'h', 'c', 'u']],
      ['run:missing', []], ['!run:missing', ['b', 'h', 'a', 'c', 'u']],
    ]);
  });

  it('matches milestones by title or date and distinguishes no milestone from an unknown ID', () => {
    checkCases([
      ['milestone:rel', ['a']], ['milestone:2026-11-05', ['a']], ['milestone:launch', ['c']],
      ['milestone:none', ['b', 'h']], ['!milestone:none', ['a', 'c', 'u']], ['milestone:missing', []],
      ['!milestone:missing', ['b', 'h', 'a', 'c', 'u']],
    ]);
  });

  it('evaluates hand membership for the selected member on each search', () => {
    const catalog = fixture();
    expectCards(catalog, 'hand:in', ['a'], 'maria');
    expectCards(catalog, 'hand:in', ['c'], 'robot');
    expectCards(catalog, 'hand:in', [], null);
    expectCards(catalog, 'hand:not', ['b', 'h', 'c', 'u'], 'maria');
    expectCards(catalog, '!hand:not', ['a'], 'maria');
    expectCards(catalog, 'hand:bad', []);
    expectCards(catalog, '!hand:bad', ['b', 'h', 'a', 'c', 'u']);
  });

  it('uses local dates with inclusive due boundaries and refreshes phases after midnight', () => {
    checkCases([
      ['due:today', ['b', 'a']], ['due:soon', ['c']], ['due:any', ['b', 'a', 'c', 'u']],
      ['!due:today', ['h', 'c', 'u']], ['due:bad', []], ['!due:bad', ['b', 'h', 'a', 'c', 'u']],
    ]);
    const catalog = fixture();
    expectCards(catalog, 'run:current', ['a']);
    vi.setSystemTime(new Date(2026, 10, 6, 0, 1));
    expectCards(catalog, 'run:current', ['c']);
    expectCards(catalog, 'run:past', ['b', 'a']);
    expectCards(catalog, 'due:soon', ['c', 'u']);
  });

  it('resolves subcards by parent ID, short reference or title and permits archived parents', () => {
    const catalog = fixture();
    for (const query of ['sub:h', `sub:${shortReference('c', 'h')}`, 'sub:root']) expectCards(catalog, query, ['a', 'c']);
    expectCards(catalog, 'sub:archived', ['u']);
    expectCards(catalog, '!sub:root', ['b', 'h', 'u']);
    expectCards(catalog, 'sub:missing', []);
    expectCards(catalog, '!sub:missing', ['b', 'h', 'a', 'c', 'u']);
    catalog.cards.find(candidate => candidate.id === 'x')!.deleted = true;
    expectCards(catalog, 'sub:x', []);
  });

  it('keeps navigation separate, ordered and capped while explicit references reach archived cards', () => {
    const catalog = fixture();
    const result = runSearch(catalog, `$${shortReference('c', 'a')} gd:au gc:root $x $z kind:task`);
    expect(result.navigation.map(target => target.kind === 'card' ? target.card.id : target.kind === 'deck' ? target.deck.id : 'ambiguous'))
      .toEqual(['a', 'audio', 'h', 'x']);
    expect(result.cards.map(candidate => candidate.id)).toEqual(['b', 'a', 'u']);
    expect(result.total).toBe(3);
    expect(runSearch(catalog, 'gc:archived').navigation).toEqual([]);
    expect(runSearch(catalog, '$missing')).toEqual({ navigation: [], cards: [], total: 0 });
    expect(runSearch(catalog, '$a').cards).toEqual([]);
    expect(runSearch(catalog, '$a $a $a $a $a $h').navigation).toHaveLength(5);
  });

  it('reports an ambiguous short reference without discarding independent content results', () => {
    const catalog = fixture();
    catalog.cards.push({ ...catalog.cards.find(candidate => candidate.id === 'h')! });
    const result = runSearch(catalog, `$${shortReference('c', 'h')} kind:task`);
    expect(result.navigation).toEqual([{ kind: 'ambiguous', message: expect.any(String) }]);
    expect(result.cards.map(candidate => candidate.id)).toEqual(['b', 'a', 'u']);
    expectCards(catalog, `sub:${shortReference('c', 'h')}`, []);
  });

  it('preserves input order and counts every match beyond the result limit', () => {
    const cards = Array.from({ length: 65 }, (_, index) => card(`card-${65 - index}`, { title: `Item ${index}` }));
    cards.splice(10, 0, card('archived', { archived: true }));
    const result = runSearch(fixture(cards), 'kind:task');
    expect(result.total).toBe(65);
    expect(result.cards).toHaveLength(RESULT_LIMIT);
    expect(result.cards.map(candidate => candidate.id)).toEqual(cards.filter(candidate => !candidate.archived).slice(0, 50).map(candidate => candidate.id));
  });

  it('retains parser spans, negations, incomplete-prefix behavior and pill removal', () => {
    const query = '  KIND:Task\t!#Red  @none gd:Audio ';
    const tokens = parseSearch(query);
    expect(tokens.map(token => token.kind)).toEqual(['kind', 'tag', 'owner', 'nav']);
    for (const token of tokens) expect(query.slice(token.start, token.end)).toBe(token.raw);
    expect(tokens[1]).toMatchObject({ value: 'red', negated: true, raw: '!#Red' });
    expect(tokens[2]).toMatchObject({ value: 'none', none: true });
    expect(withoutToken(query, tokens[1])).toBe('KIND:Task @none gd:Audio');
    expect(withoutToken('kind:task', parseSearch('kind:task')[0])).toBe('');
    expect(parseSearch('# deck: gd: !gc:root !$a unknown:value').map(token => token.kind)).toEqual(Array(6).fill('word'));
    expect(runSearch(fixture(), ' \t ')).toEqual({ navigation: [], cards: [], total: 0 });
  });

  it('toggles tag pills between AND and OR without changing navigation, exclusions or case', () => {
    const query = 'kind:task #RED #Blue !#other gd:Audio';
    const joined = toggleTagOr(query);
    expect(joined).toBe('kind:task #RED|#Blue !#other gd:Audio');
    expect(toggleTagOr(joined)).toBe(query);
    expectCards(fixture(), query, ['a']);
    expectCards(fixture(), joined, ['b', 'a']);
    expect(toggleTagOr('#red !#blue')).toBe('#red !#blue');
  });
});

describe('lazy search text and revision cache', () => {
  it('never reads Markdown for any non-word filter, navigation, or their negations', () => {
    const catalog = fixture();
    for (const candidate of catalog.cards) Object.defineProperty(candidate, 'markdown', {
      get() { throw new Error(`Unexpected Markdown access for ${candidate.id}`); }, configurable: true,
    });
    const queries = ['kind:task', 'state:план', 'state:archived', 'state:deleted', 'deck:audio', '#red', '#red|#blue',
      '@masha', '@none', 'effort:3+', 'priority:medium+', 'run:current', 'run:next', 'run:none',
      'milestone:release', 'milestone:none', 'hand:in', 'hand:not', 'due:soon', 't:альфа', 'sub:root'];
    for (const query of queries) {
      expect(() => runSearch(catalog, query, 'maria'), query).not.toThrow();
      expect(() => runSearch(catalog, `!${query}`, 'maria'), `!${query}`).not.toThrow();
    }
    for (const query of ['', '$a', '$x', 'gd:au', 'gc:root', 'kind:task priority:high !@none']) {
      expect(() => runSearch(catalog, query), query).not.toThrow();
    }
  });

  it('normalizes lazily once per card revision and invalidates hash, title and Markdown changes', () => {
    const candidate = card('cache', { title: 'Cache Title', markdown: 'UNIQUE_CACHE_BODY first' });
    const catalog = fixture([candidate]);
    const normalized: string[] = [];
    const original = String.prototype.toLocaleLowerCase;
    vi.spyOn(String.prototype, 'toLocaleLowerCase').mockImplementation(function (this: string, locales?: Parameters<typeof original>[0]) {
      if (String(this).includes('UNIQUE_CACHE_BODY')) normalized.push(String(this));
      return original.call(this, locales);
    });
    expectCards(catalog, 'kind:task', ['cache']);
    expect(normalized).toHaveLength(0);
    expectCards(catalog, 'first', ['cache']);
    expectCards(catalog, 'first cache !absent', ['cache']);
    expectCards(catalog, 'title', ['cache']);
    expect(normalized).toHaveLength(1);
    candidate.sourceHash = 'revision-two';
    expectCards(catalog, 'first', ['cache']);
    expect(normalized).toHaveLength(2);
    candidate.title = 'Renamed';
    expectCards(catalog, 'renamed', ['cache']);
    expectCards(catalog, 'title', []);
    expect(normalized).toHaveLength(3);
    candidate.markdown = 'UNIQUE_CACHE_BODY second';
    expectCards(catalog, 'first', []);
    expectCards(catalog, 'second', ['cache']);
    expect(normalized).toHaveLength(4);
  });

  it('isolates cards and projects sharing IDs or hashes and sees replacement, addition and deletion', () => {
    const first = card('same-id', { markdown: 'firstword' });
    const second = card('other-id', { markdown: 'secondword' });
    const catalog = fixture([first, second]);
    expectCards(catalog, 'firstword', ['same-id']);
    expectCards(catalog, 'secondword', ['other-id']);
    const otherProject = { ...fixture([card('same-id', { markdown: 'otherproject' })]), rootIdentity: 'other-project' };
    expectCards(otherProject, 'firstword', []);
    expectCards(otherProject, 'otherproject', ['same-id']);
    catalog.cards[0] = { ...first, markdown: 'replacement' };
    expectCards(catalog, 'firstword', []);
    expectCards(catalog, 'replacement', ['same-id']);
    catalog.cards.push(card('added', { markdown: 'replacement' }));
    expectCards(catalog, 'replacement', ['same-id', 'added']);
    catalog.cards.splice(0, 1);
    expectCards(catalog, 'replacement', ['added']);
    expectCards(catalog, 'kind:task', ['other-id', 'added']);
  });
});
