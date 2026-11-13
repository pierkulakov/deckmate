import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProjectIndex } from '../server/project-index.ts';
import type { CatalogCard, ProjectCatalog } from '../src/catalog-contracts.ts';

const EXPECTED_ORDER = [
  'balance-1.1', 'balance-1.2', 'balance-1.3',
  'match-1.1', 'match-1.2', 'match-2.1', 'match-2.2', 'match-9.9',
  'truck-1.1', 'truck-1.2', 'truck-1.3', 'truck-1.4',
];

it('preserves iteration, dependency and Journey provenance through search and reopen', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'deckmate-index-attributes-'));
  const filename = path.join(directory, 'index.sqlite');
  let index: ProjectIndex | null = new ProjectIndex(filename);
  try {
    const catalog = projectCatalog();
    const expected = { iteration: 3, dependsOn: ['parent-step'], journey: { journeyId: 'template', version: 2, stepId: 'review', instanceId: 'instance' } };
    Object.assign(catalog.cards[0], expected);
    index.replace(catalog);
    index.close(); index = new ProjectIndex(filename);
    expect(index.get(catalog.cards[0].id)).toMatchObject(expected);
    expect(index.search({ text: 'Условная цена' })[0]).toMatchObject(expected);
  } finally {
    index?.close();
    if (path.dirname(directory) !== tmpdir().replace(/[\\/]$/u, '') || !path.basename(directory).startsWith('deckmate-index-attributes-')) throw new Error('Unsafe fixture cleanup');
    await rm(directory, { recursive: true, force: true });
  }
});

function card(essential: Pick<CatalogCard, 'id' | 'path' | 'version' | 'title'>, overrides: Partial<CatalogCard> = {}): CatalogCard {
  return {
    kind: 'task', state: 'not-started', owner: '', markdown: '', sourceHash: 'sha256:fixture',
    range: { start: 0, end: 0 }, deckId: null, trackIds: [], parentId: null,
    ...essential, ...overrides,
  };
}

// Cover the catalog shape with 12 cards from 3 files, 2 spaces, 5 decks, and 2 tracks.
function projectCatalog(): ProjectCatalog {
  return {
    rootIdentity: 'demo-main',
    documents: [
      { path: 'features/match.md', title: 'Матч и штаб', hash: 'sha256:match' },
      { path: 'features/vehicles/truck.md', title: 'Грузовики', hash: 'sha256:truck' },
      { path: 'docs/balance.md', title: 'Баланс', hash: 'sha256:balance' },
    ],
    spaces: [
      { id: 'space-match', title: 'Матч' },
      { id: 'space-tyl', title: 'Тыл' },
    ],
    decks: [
      { id: 'deck-economy', spaceId: 'space-match', title: 'Экономика матча', kind: 'asset', description: 'Ресурсы', color: 'amber', icon: '💰' },
      { id: 'deck-network', spaceId: 'space-match', title: 'Сеть', kind: 'task', description: 'Соединение', color: 'sky', icon: '🌐' },
      { id: 'deck-inbox', spaceId: 'space-match', title: 'Входящие', kind: 'task', description: 'Идеи', color: 'slate', icon: '📥' },
      { id: 'deck-tyl', spaceId: 'space-tyl', title: 'Тыл', kind: 'mixed', description: 'Тыловые дела', color: 'green', icon: '🚚' },
      { id: 'deck-med', spaceId: 'space-tyl', title: 'Медицина', kind: 'knowledge', description: 'Раненые', color: 'red', icon: '✚' },
    ],
    tracks: [
      { id: 'track-a', title: 'Снабжение', description: 'Первая очередь' },
      { id: 'track-b', title: 'Сеть', description: 'Вторая очередь' },
    ],
    cards: [
      card({ id: 'match-1.1', path: 'features/match.md', version: '1.1', title: 'Условная цена, резерв и пополнение' },
        { state: 'discussing', owner: 'Павел', deckId: 'deck-economy', trackIds: ['track-a'],
          markdown: 'плащ показывает запас; РезеРвИстан — контрольное слово.', sourceHash: 'sha256:a1', range: { start: 12, end: 340 } }),
      card({ id: 'match-1.2', path: 'features/match.md', version: '1.2', title: 'Пополнение отряда' },
        { owner: 'GLM', deckId: 'deck-economy', trackIds: ['track-b', 'track-a'],
          markdown: 'очередь пополнения', sourceHash: 'sha256:a2', range: { start: 360, end: 480 } }),
      card({ id: 'match-2.1', path: 'features/match.md', version: '2.1', title: 'Эпик: снабжение' },
        { kind: 'hero', deckId: 'deck-economy', sourceHash: 'sha256:a3', range: { start: 500, end: 560 } }),
      card({ id: 'match-2.2', path: 'features/match.md', version: '2.2', title: 'Сеть боя' },
        { state: 'started', owner: 'Claude', deckId: 'deck-network', trackIds: ['track-b'],
          markdown: 'соединение и ходы', sourceHash: 'sha256:a4', range: { start: 600, end: 900 } }),
      card({ id: 'match-9.9', path: 'features/match.md', version: '9.9', title: 'Карантин идей' },
        { owner: 'Kimi', deckId: 'deck-inbox', markdown: 'идеи вне плана', sourceHash: 'sha256:a5', range: { start: 950, end: 1010 } }),
      card({ id: 'truck-1.1', path: 'features/vehicles/truck.md', version: '1.1', title: 'Бюджет на тик' },
        { state: 'started', owner: 'GLM', deckId: 'deck-tyl', trackIds: ['track-a', 'track-b'],
          markdown: 'расход топлива; событие NEAR(центр) обрабатывается', sourceHash: 'sha256:b1', range: { start: 8, end: 120 } }),
      card({ id: 'truck-1.2', path: 'features/vehicles/truck.md', version: '1.2', title: 'Медицинский грузовик' },
        { kind: 'doc', state: 'done', owner: 'Павел', deckId: 'deck-med',
          markdown: 'описание перевозки раненых', sourceHash: 'sha256:b2', range: { start: 130, end: 700 } }),
      card({ id: 'truck-1.3', path: 'features/vehicles/truck.md', version: '1.3', title: 'Ремонт брони' },
        { state: 'review', owner: 'Kimi', deckId: 'deck-tyl', trackIds: ['track-b'], parentId: 'truck-1.2',
          markdown: 'починка в полевых условиях', sourceHash: 'sha256:b3', range: { start: 720, end: 800 } }),
      card({ id: 'truck-1.4', path: 'features/vehicles/truck.md', version: '1.4', title: 'Литеральные операторы' },
        { deckId: 'deck-tyl', markdown: 'это OR или «Готово» 1=1', sourceHash: 'sha256:b4', range: { start: 810, end: 880 } }),
      card({ id: 'balance-1.1', path: 'docs/balance.md', version: '1.1', title: 'Экономика боя' },
        { owner: 'Павел', deckId: 'deck-inbox', trackIds: ['track-a'],
          markdown: 'кредиты и время', sourceHash: 'sha256:c1', range: { start: 0, end: 90 } }),
      card({ id: 'balance-1.2', path: 'docs/balance.md', version: '1.2', title: 'Вызов отряда' },
        { state: 'discussing', owner: 'Claude', deckId: 'deck-inbox', parentId: 'balance-1.1',
          markdown: 'длинный текст про цена вызова отряда из резерва командира', sourceHash: 'sha256:c2', range: { start: 100, end: 400 } }),
      card({ id: 'balance-1.3', path: 'docs/balance.md', version: null, title: 'Заметки по балансу' },
        { kind: 'doc', state: null, owner: null, range: null,
          trackIds: ['track-b'], markdown: 'свободные заметки', sourceHash: 'sha256:c3' }),
    ],
    warnings: [],
  };
}

function bulkCatalog(cardCount: number): ProjectCatalog {
  return {
    rootIdentity: 'bulk-root',
    documents: [{ path: 'features/bulk.md', title: 'Массовый каталог', hash: 'sha256:bulk' }],
    cards: Array.from({ length: cardCount }, (_, number) =>
      card({ id: `bulk-${number}`, path: 'features/bulk.md', version: `${number}.0`, title: `Карточка ${number}` },
        { markdown: `тело карточки ${number}` })),
    spaces: [], decks: [], tracks: [], warnings: [],
  };
}

const indices: ProjectIndex[] = [];
const directories: string[] = [];

function openedIndex(filename = ':memory:'): ProjectIndex {
  const index = new ProjectIndex(filename);
  indices.push(index);
  return index;
}

function indexSnapshot(filename: string) {
  const database = new DatabaseSync(filename, { readOnly: true });
  try {
    const tables = [
      ['cards', 'id'], ['cards_fts', 'card_id'], ['card_tracks', 'card_id, position'],
      ['documents', 'path'], ['spaces', 'id'], ['decks', 'id'], ['tracks', 'id'],
    ];
    const queries = ['цена', 'резервистан', 'OR', 'NEAR', 'freshinsert', 'oldtitle', 'oldbody', 'newtitle', 'newbody'];
    return {
      tables: Object.fromEntries(tables.map(([table, order]) => [table,
        database.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all(),
      ])),
      matches: Object.fromEntries(queries.map(query => [query, database.prepare(
        'SELECT card_id, bm25(cards_fts, 10.0, 1.0) AS relevance FROM cards_fts WHERE cards_fts MATCH ? ORDER BY relevance, card_id',
      ).all(`"${query.toLowerCase()}"`)])),
    };
  } finally { database.close(); }
}

afterEach(async () => {
  for (const index of indices.splice(0)) index.close();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe('ProjectIndex derived SQLite index', () => {
  it('does not prepare a per-card FTS deletion for rebuilds or newly added cards', () => {
    const prepare = vi.spyOn(DatabaseSync.prototype, 'prepare');
    try {
      const index = openedIndex();
      const catalog = projectCatalog();
      index.replace(catalog);
      catalog.cards.push(card({ id: 'fresh', path: 'cards/fresh.md', version: null, title: 'freshinsert' }));
      index.replace(catalog);
      expect(prepare.mock.calls.filter(([sql]) => sql === 'DELETE FROM cards_fts WHERE card_id = ?')).toHaveLength(0);
      expect(index.search({ text: 'freshinsert' }).map(card => card.id)).toEqual(['fresh']);
    } finally { prepare.mockRestore(); }
  });

  it('matches all seven rebuilt tables and MATCH results through add, update, delete, duplicate rejection and root switch', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'deckmate-project-index-'));
    directories.push(directory);
    const filename = path.join(directory, 'incremental.sqlite');
    let index = new ProjectIndex(filename);
    let revision = 0;
    const catalog = projectCatalog();
    const expectRebuilt = () => {
      const referenceFile = path.join(directory, `rebuild-${revision++}.sqlite`);
      const reference = new ProjectIndex(referenceFile);
      try {
        reference.replace(catalog);
        expect(indexSnapshot(filename)).toEqual(indexSnapshot(referenceFile));
        expect(index.search()).toEqual(reference.search());
      } finally { reference.close(); }
    };
    try {
      index.replace(catalog);
      expectRebuilt();

      catalog.cards.push(card({ id: 'fresh', path: 'cards/fresh.md', version: null, title: 'oldtitle freshinsert' },
        { markdown: 'oldbody', trackIds: ['track-b', 'track-a'], deckId: 'deck-inbox' }));
      catalog.documents.push({ path: 'cards/fresh.md', title: 'oldtitle', hash: 'sha256:fresh' });
      index.replace(catalog);
      expectRebuilt();
      expect(index.search({ text: 'freshinsert' }).map(card => card.id)).toEqual(['fresh']);

      Object.assign(catalog.cards.at(-1)!, { title: 'newtitle', markdown: 'newbody', sourceHash: 'sha256:updated', trackIds: ['track-a'] });
      catalog.documents.at(-1)!.hash = 'sha256:updated';
      index.replace(catalog);
      expectRebuilt();
      for (const text of ['freshinsert', 'oldtitle', 'oldbody']) expect(index.search({ text })).toEqual([]);
      for (const text of ['newtitle', 'newbody']) expect(index.search({ text }).map(card => card.id)).toEqual(['fresh']);

      catalog.cards.pop();
      catalog.documents.pop();
      index.replace(catalog);
      expectRebuilt();
      expect(index.search({ text: 'newbody' })).toEqual([]);

      const previous = indexSnapshot(filename);
      const summary = index.summary();
      expect(() => index.replace({ ...catalog, cards: [...catalog.cards, catalog.cards[0]] })).toThrow(/Duplicate card id/);
      expect(indexSnapshot(filename)).toEqual(previous);
      expect(index.summary()).toEqual(summary);
      expectRebuilt();

      catalog.rootIdentity = 'different-root';
      catalog.cards = [{ ...catalog.cards[0], title: 'newtitle', markdown: 'newbody' }];
      index.replace(catalog);
      expectRebuilt();
      expect(index.search({ text: 'резервистан' })).toEqual([]);

      index.close();
      index = new ProjectIndex(filename);
      catalog.cards[0].markdown = 'oldbody';
      index.replace(catalog);
      expectRebuilt();
      expect(index.search({ text: 'newbody' })).toEqual([]);
    } finally { index.close(); }
  });

  it.each([false, true])('rolls back real SQL failure including inserted FTS rows and permits retry (full rebuild: %s)', async fullRebuild => {
    const directory = await mkdtemp(path.join(tmpdir(), 'deckmate-project-index-'));
    directories.push(directory);
    const filename = path.join(directory, 'rollback.sqlite');
    const index = openedIndex(filename);
    const catalog = projectCatalog();
    index.replace(catalog);
    const previous = indexSnapshot(filename);
    const summary = index.summary();
    const changed = structuredClone(catalog);
    if (fullRebuild) changed.rootIdentity = 'different-root';
    changed.cards.shift();
    Object.assign(changed.cards[0], { title: 'newtitle', markdown: 'newbody' });
    changed.cards.push(card({ id: 'fresh', path: 'cards/fresh.md', version: null, title: 'freshinsert' }));
    changed.cards.push(card({ id: 'invalid', path: 'cards/invalid.md', version: null, title: 'oldtitle' },
      { trackIds: ['track-a', 'track-a'] }));

    // 2026-11-05: the last card fails inside SQL, after deletions, updates and a successful FTS insert.
    expect(() => index.replace(changed)).toThrow(/UNIQUE constraint failed: card_tracks/);
    expect(indexSnapshot(filename)).toEqual(previous);
    expect(index.summary()).toEqual(summary);
    expect(index.search({ text: 'freshinsert' })).toEqual([]);

    changed.cards.at(-1)!.trackIds = ['track-a'];
    index.replace(changed);
    const referenceFile = path.join(directory, 'rebuilt.sqlite');
    const reference = openedIndex(referenceFile);
    reference.replace(changed);
    expect(indexSnapshot(filename)).toEqual(indexSnapshot(referenceFile));
    expect(index.search({ text: 'freshinsert' }).map(card => card.id)).toEqual(['fresh']);
    expect(index.search({ text: 'резервистан' })).toEqual([]);
  });

  it('round-trips every card field: source hash, byte range, parent and track order survive SQL', () => {
    const catalog = projectCatalog();
    const index = openedIndex();
    index.replace(catalog);
    for (const expected of catalog.cards) {
      expect(index.get(expected.id)).toEqual(expected);
    }
    expect(index.get('no-such-card')).toBeNull();
  });

  it('searches Cyrillic case-insensitively and treats quotes, operators and SQL as literal words', () => {
    const index = openedIndex();
    index.replace(projectCatalog());
    const ids = (query: string) => index.search({ text: query }).map(card => card.id);
    expect(ids('резервистан')).toEqual(['match-1.1']);
    expect(ids('РЕЗЕРВИСТАН')).toEqual(['match-1.1']);
    expect(ids('«Готово»')).toEqual(['truck-1.4']);
    expect(ids('OR')).toEqual(['truck-1.4']);
    expect(ids('NEAR(центр)')).toEqual(['truck-1.1']);
    expect(ids('цена" OR 1=1 --')).toEqual([]);
    expect(ids("'; DROP TABLE cards; --")).toEqual([]);
    expect(index.search({ text: '' })).toHaveLength(12);
    expect(index.search({ text: ' \t\n ' })).toHaveLength(12);
    for (const text of ['«» * ()', '"""', '***']) expect(index.search({ text })).toEqual([]);
  });

  it('orders results deterministically: relevance, then path, version, id', () => {
    const index = openedIndex();
    index.replace(projectCatalog());
    expect(index.search({}).map(card => card.id)).toEqual(EXPECTED_ORDER);
    expect(index.search({ text: 'цена' }).map(card => card.id)).toEqual(['match-1.1', 'balance-1.2']);
    expect(index.search({ text: 'цена' })).toEqual(index.search({ text: 'цена' }));
  });

  it('intersects deck, track, kind, state and owner filters', () => {
    const index = openedIndex();
    index.replace(projectCatalog());
    expect(index.search({ deckId: 'deck-tyl', trackId: 'track-b', state: 'review' }).map(card => card.id)).toEqual(['truck-1.3']);
    expect(index.search({ deckId: 'deck-economy', trackId: 'track-a' }).map(card => card.id)).toEqual(['match-1.1', 'match-1.2']);
    expect(index.search({ owner: 'павел' }).map(card => card.id)).toEqual(['balance-1.1', 'match-1.1', 'truck-1.2']);
    expect(index.search({ kind: 'doc' }).map(card => card.id)).toEqual(['balance-1.3', 'truck-1.2']);
    expect(index.search({ state: 'done' }).map(card => card.id)).toEqual(['truck-1.2']);
    // A card with a null state never matches an exact state filter (2026-11-03).
    expect(index.search({ state: 'not-started' }).map(card => card.id)).toEqual(['balance-1.1', 'match-1.2', 'match-2.1', 'match-9.9', 'truck-1.4']);
    expect(index.search({ deckId: 'deck-tyl' })).toHaveLength(3);
  });

  it('replaces the whole snapshot transactionally: repeats, rejections and root changes', () => {
    const catalog = projectCatalog();
    const index = openedIndex();
    index.replace(catalog);
    index.replace(catalog);
    expect(index.search({})).toHaveLength(12);
    expect(index.summary()).toMatchObject({ rootIdentity: 'demo-main', documents: 3, cards: 12 });

    const duplicated = { ...catalog, cards: [...catalog.cards, { ...catalog.cards[0] }] };
    expect(() => index.replace(duplicated)).toThrow(/Duplicate card id in catalog: match-1\.1/);
    expect(index.search({}).map(card => card.id)).toEqual(EXPECTED_ORDER);

    const withoutLiteralCard = { ...catalog, cards: catalog.cards.filter(card => card.id !== 'truck-1.4') };
    index.replace(withoutLiteralCard);
    expect(index.search({ text: 'OR' })).toEqual([]);
    expect(index.search({ text: '«Готово»' })).toEqual([]);
    expect(index.get('truck-1.4')).toBeNull();
    expect(index.summary()).toMatchObject({ cards: 11, documents: 3 });

    const foreign = {
      rootIdentity: 'other-root',
      documents: [{ path: 'tasks/inbox.md', title: 'Входящие', hash: 'sha256:inbox' }],
      cards: [card({ id: 'inbox-1', path: 'tasks/inbox.md', version: '0.1', title: 'Идея про аванпост' }, { markdown: 'сверхъестественный аванпост' })],
      spaces: [], decks: [], tracks: [], warnings: [],
    };
    index.replace(foreign);
    expect(index.summary()).toMatchObject({ rootIdentity: 'other-root', documents: 1, cards: 1 });
    expect(index.search({ text: 'резервистан' })).toEqual([]);
    expect(index.search({ text: 'аванпост' }).map(card => card.id)).toEqual(['inbox-1']);
  });

  it('keeps the snapshot across close/open and full rebuild of the index file', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'deckmate-project-index-'));
    directories.push(directory);
    const filename = path.join(directory, 'index.sqlite');
    const catalog = projectCatalog();

    const first = new ProjectIndex(filename);
    first.replace(catalog);
    const summaryBefore = first.summary();
    first.close();
    expect(() => first.search({})).toThrow();

    const second = new ProjectIndex(filename);
    expect(second.summary()).toEqual(summaryBefore);
    expect(second.search({}).map(card => card.id)).toEqual(EXPECTED_ORDER);
    expect(second.get('match-1.2')).toEqual(catalog.cards.find(card => card.id === 'match-1.2'));
    second.close();

    await unlink(filename);
    const third = openedIndex(filename);
    third.replace(catalog);
    expect(third.search({}).map(card => card.id)).toEqual(EXPECTED_ORDER);
    expect(third.summary()).toMatchObject({ rootIdentity: 'demo-main', documents: 3, cards: 12 });
  });

  it('reuses an unchanged on-disk snapshot without rewriting cards, relations or FTS', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'deckmate-project-index-'));
    directories.push(directory);
    const filename = path.join(directory, 'reuse.sqlite');
    const catalog = projectCatalog();
    const first = new ProjectIndex(filename);
    first.replace(catalog);
    const summary = first.summary();
    first.close();
    const database = new DatabaseSync(filename);
    try {
      for (const table of ['cards', 'card_tracks', 'spaces', 'decks', 'tracks', 'documents']) {
        for (const action of ['INSERT', 'UPDATE', 'DELETE']) {
          database.exec(`CREATE TRIGGER reject_${table}_${action} BEFORE ${action} ON ${table}
            BEGIN SELECT RAISE(ABORT, 'Unchanged index was rewritten'); END`);
        }
      }
    } finally { database.close(); }
    const bytes = await readFile(filename);
    const reopened = openedIndex(filename);
    reopened.replace(catalog);
    expect(reopened.summary()).toEqual(summary);
    expect(reopened.search({ text: 'резервистан' }).map(card => card.id)).toEqual(['match-1.1']);
    expect(await readFile(filename)).toEqual(bytes);
  });

  it.each(['missing-fingerprint', 'missing-fts', 'old-fingerprint'])('rebuilds an obsolete snapshot: %s', async reason => {
    const directory = await mkdtemp(path.join(tmpdir(), 'deckmate-project-index-'));
    directories.push(directory);
    const filename = path.join(directory, 'obsolete.sqlite');
    const catalog = projectCatalog();
    const first = new ProjectIndex(filename);
    first.replace(catalog);
    first.close();
    const database = new DatabaseSync(filename);
    try {
      if (reason === 'missing-fts') database.exec('DROP TABLE cards_fts');
      else {
        database.exec("UPDATE cards SET title = 'Outdated title'");
        if (reason === 'missing-fingerprint') database.exec("DELETE FROM meta WHERE key = 'catalog_fingerprint'");
        else database.exec("UPDATE meta SET value = 'older-index-version' WHERE key = 'catalog_fingerprint'");
      }
    } finally { database.close(); }
    const reopened = openedIndex(filename);
    reopened.replace(catalog);
    for (const card of catalog.cards) expect(reopened.get(card.id)).toEqual(card);
    expect(reopened.search({ text: 'резервистан' }).map(card => card.id)).toEqual(['match-1.1']);
  });

  it('does not apply an in-memory delta over another connection\'s replacement', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'deckmate-project-index-'));
    directories.push(directory);
    const filename = path.join(directory, 'shared.sqlite');
    const first = openedIndex(filename);
    const second = openedIndex(filename);
    const catalog = projectCatalog();
    first.replace(catalog);
    const foreign = structuredClone(catalog);
    foreign.cards.shift();
    foreign.cards[0].markdown = 'foreign snapshot';
    second.replace(foreign);
    catalog.cards[0].markdown = 'latest snapshot';
    first.replace(catalog);
    for (const card of catalog.cards) expect(first.get(card.id)).toEqual(card);
    expect(first.search({ text: 'foreign' })).toEqual([]);
    expect(first.search({ text: 'latest' }).map(card => card.id)).toEqual(['match-1.1']);
  });

  it('validates limit: default 100, maximum 1000', () => {
    const index = openedIndex();
    index.replace(bulkCatalog(150));
    expect(index.search({})).toHaveLength(100);
    expect(index.search({ limit: 120 })).toHaveLength(120);
    expect(index.search({ limit: 150 })).toHaveLength(150);
    expect(index.search({ text: 'КАРТОЧКА', limit: 7 })).toHaveLength(7);

    index.replace(bulkCatalog(1200));
    expect(index.search({ limit: 1000 })).toHaveLength(1000);
    for (const limit of [0, -1, 2.5, Number.NaN, 1001]) {
      expect(() => index.search({ limit })).toThrow(RangeError);
    }
  });

  it('reports an empty summary for a fresh base', () => {
    expect(openedIndex().summary()).toEqual({ rootIdentity: '', documents: 0, cards: 0, indexedAt: '' });
  });

  it('fills indexedAt with a timestamp on replace', () => {
    const index = openedIndex();
    index.replace(projectCatalog());
    expect(index.summary().indexedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('preserves null task-only fields for documents and Hero cards', () => {
    const catalog = projectCatalog();
    catalog.cards = catalog.cards.map(card => card.kind === 'task' ? card : {
      ...card, version: card.kind === 'doc' ? null : card.version, state: null, owner: null, range: null,
    });
    const index = openedIndex();
    index.replace(catalog);
    for (const card of catalog.cards) expect(index.get(card.id)).toEqual(card);
    expect(index.search({ owner: '' }).every(card => card.owner === '')).toBe(true);
    expect(index.search({ state: '' })).toEqual([]);
  });

  it('rejects duplicate reference keys before replacing the snapshot', () => {
    const catalog = projectCatalog();
    const index = openedIndex();
    index.replace(catalog);
    const previousSummary = index.summary();
    const invalid = { ...catalog, rootIdentity: 'rejected-root', documents: [...catalog.documents, catalog.documents[0]] };
    expect(() => index.replace(invalid)).toThrow();
    expect(index.summary()).toEqual(previousSummary);
    expect(index.search({ text: 'резервистан' }).map(card => card.id)).toEqual(['match-1.1']);
    for (const card of catalog.cards) expect(index.get(card.id)).toEqual(card);
  });

  it('closes a failed constructor so a corrupt cache can be deleted and rebuilt', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'deckmate-project-index-'));
    directories.push(directory);
    const filename = path.join(directory, 'index.sqlite');
    await writeFile(filename, 'not sqlite');
    expect(() => new ProjectIndex(filename)).toThrow();
    await unlink(filename);
    const rebuilt = openedIndex(filename);
    rebuilt.replace(projectCatalog());
    expect(rebuilt.summary().cards).toBe(12);
  });

  it('keeps two root databases isolated', () => {
    const first = openedIndex();
    const second = openedIndex();
    first.replace(projectCatalog());
    second.replace(bulkCatalog(3));
    expect(first.summary().rootIdentity).toBe('demo-main');
    expect(second.summary().rootIdentity).toBe('bulk-root');
    expect(first.get('bulk-0')).toBeNull();
    expect(second.search({ text: 'резервистан' })).toEqual([]);
  });

  it('waits for another process to release a cache write lock', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'deckmate-project-index-'));
    directories.push(directory);
    const filename = path.join(directory, 'index.sqlite');
    const holder = new DatabaseSync(filename);
    // 2026-11-03: acquire the write lock before the worker can read the schema.
    // RESERVED permits a SHARED reader and can make this fixture's COMMIT fail
    // during lock promotion; EXCLUSIVE isolates the busy-timeout behavior.
    holder.exec('CREATE TABLE lock_probe (value INTEGER); BEGIN EXCLUSIVE; INSERT INTO lock_probe VALUES (1)');
    const worker = new Worker([
      "const { parentPort, workerData } = require('node:worker_threads');",
      "import(workerData.moduleUrl).then(({ ProjectIndex }) => {",
      "  parentPort.postMessage('ready');",
      "  const index = new ProjectIndex(workerData.filename);",
      "  index.close();",
      "  parentPort.postMessage('done');",
      "}).catch(error => parentPort.postMessage({ error: error.message }));",
    ].join('\n'), {
      eval: true,
      workerData: { filename, moduleUrl: new URL('../server/project-index.ts', import.meta.url).href },
    });
    let unlockTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        worker.on('message', message => {
          if (message === 'ready') {
            unlockTimer = setTimeout(() => {
              try { holder.exec('COMMIT'); } catch (error) { reject(error); }
            }, 100);
          } else if (message === 'done') resolve();
          else reject(new Error(message.error));
        });
        worker.on('error', reject);
        worker.on('exit', code => { if (code !== 0) reject(new Error('Worker exited with code ' + code)); });
      });
    } finally {
      if (unlockTimer) clearTimeout(unlockTimer);
      await worker.terminate();
      holder.close();
    }
  }, 10000);
});

it('keeps card options in the rebuildable index and hides archived/deleted from search', () => {
  const index = new ProjectIndex(':memory:');
  try {
    const catalog = projectCatalog();
    Object.assign(catalog.cards[0], { handMemberIds: ['glm'], bookmarked: true, tags: ['audio'], run: 'Sprint A', milestone: 'Alpha', dueDate: '2026-11-20' });
    catalog.cards[1].archived = true;
    catalog.cards[2].deleted = true;
    index.replace(catalog);
    expect(index.get(catalog.cards[0].id)).toMatchObject({ handMemberIds: ['glm'], bookmarked: true, tags: ['audio'], run: 'Sprint A', milestone: 'Alpha', dueDate: '2026-11-20' });
    expect(index.search()).toHaveLength(catalog.cards.length - 2);
    expect(index.search({ text: catalog.cards[1].title })).toEqual([]);
    expect(index.get(catalog.cards[1].id)?.archived).toBe(true);
    expect(index.get(catalog.cards[2].id)?.deleted).toBe(true);
  } finally { index.close(); }
});
