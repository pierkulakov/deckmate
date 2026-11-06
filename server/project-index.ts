import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { defineText, serverText } from './i18n.ts';
import type { SearchSnippets } from './search-hits.ts';
import type {
  CatalogCard,
  CatalogIndexSummary,
  CatalogQuery,
  ProjectCatalog,
} from '../src/catalog-contracts.ts';
import { readCardState } from '../src/format-vocabulary.ts';

const messages = defineText({
  invalidLimit: (maximum: number, value: number) => `limit must be an integer from 1 to ${maximum}, received ${value}`,
  duplicateCard: (id: string) => `Duplicate card id in catalog: ${id}`,
  duplicateKey: (table: string, key: string) => `Duplicate ${table} key in catalog: ${key}`,
}, {
  invalidLimit: (maximum: number, value: number) => `limit должен быть целым числом от 1 до ${maximum}, получено ${value}`,
  duplicateCard: (id: string) => `Повторяющийся ID карты в каталоге: ${id}`,
  duplicateKey: (table: string, key: string) => `Повторяющийся ключ ${table} в каталоге: ${key}`,
});


const DEFAULT_SEARCH_LIMIT = 100;
const MAXIMUM_SEARCH_LIMIT = 1000;

// 2026-11-03: the base is a derived index, never a source of truth — files keep
// cards and relations, replace() rebuilds every row from a fresh ProjectCatalog.
// Card markdown is stored as inert text for search and navigation only; it is
// never parsed here and never interpreted as commands.
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS spaces (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS decks (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,
    description TEXT NOT NULL,
    color TEXT NOT NULL,
    icon TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS documents (
    path TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    hash TEXT NOT NULL
  );
  -- version/state/owner/range are nullable, mirroring CatalogCard (2026-11-03):
  -- documents and Hero cards do not acquire task workflow or writable ranges.
  CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    path TEXT NOT NULL,
    version TEXT,
    title TEXT NOT NULL,
    state TEXT,
    owner TEXT,
    owner_folded TEXT,
    markdown TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    range_start INTEGER,
    range_end INTEGER,
    deck_id TEXT,
    parent_id TEXT
  );
  CREATE TABLE IF NOT EXISTS card_tracks (
    card_id TEXT NOT NULL,
    track_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (card_id, track_id)
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(title, markdown, card_id UNINDEXED);
`;

interface CardRow {
  id: string;
  kind: string;
  path: string;
  version: string | null;
  title: string;
  state: string | null;
  owner: string | null;
  owner_folded: string | null;
  markdown: string;
  source_hash: string;
  range_start: number | null;
  range_end: number | null;
  deck_id: string | null;
  parent_id: string | null;
  attributes_json: string;
}

interface TrackRow {
  card_id: string;
  track_id: string;
}

interface SummaryRow {
  root_identity: string;
  indexed_at: string;
  documents: number;
  cards: number;
}

// 2026-11-03: SQLite NOCASE only folds ASCII. Normalize the exact owner
// filter in JavaScript so Cyrillic labels match case-insensitively too.
function folded(text: string): string {
  return text.toLowerCase();
}

// 2026-11-03: user text is data, never an FTS5 or SQL program — only letter and
// digit runs survive, each is quoted as a phrase, so quotes, operators like
// OR/NEAR and injection attempts match literal words instead of executing.
// Null means blank text; an empty expression means nonblank text without words.
function literalMatchQuery(text: string): string | null {
  if (text.trim() === '') return null;
  const words = text.match(/[\p{L}\p{N}]+/gu);
  if (words === null) return '';
  return words.map(word => `"${folded(word)}"`).join(' ');
}

function searchLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_SEARCH_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAXIMUM_SEARCH_LIMIT) {
    throw new RangeError(serverText(messages).invalidLimit(MAXIMUM_SEARCH_LIMIT, limit));
  }
  return limit;
}

function assertUniqueCardIds(cards: CatalogCard[]): void {
  const seen = new Set<string>();
  for (const card of cards) {
    if (seen.has(card.id)) throw new Error(serverText(messages).duplicateCard(card.id));
    seen.add(card.id);
  }
}

function toCard(row: CardRow, trackIds: string[]): CatalogCard {
  return {
    ...JSON.parse(row.attributes_json),
    id: row.id,
    kind: row.kind as CatalogCard['kind'],
    path: row.path,
    version: row.version,
    title: row.title,
    state: row.state,
    owner: row.owner,
    markdown: row.markdown,
    sourceHash: row.source_hash,
    range: row.range_start === null || row.range_end === null ? null : { start: row.range_start, end: row.range_end },
    deckId: row.deck_id,
    trackIds,
    parentId: row.parent_id,
  };
}

function whereClause(conditions: string[]): string {
  return conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
}

function andClause(conditions: string[]): string {
  return conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '';
}

// 2026-11-04: compare each card with its previous indexed row. The key covers every stored
// column and track, so matching keys mean a full rebuild would produce the same row.
function cardAttributes(card: CatalogCard): string {
  return JSON.stringify({ iteration: card.iteration, dependsOn: card.dependsOn, journey: card.journey, ownerNote: card.ownerNote, effort: card.effort, priority: card.priority, handMemberIds: card.handMemberIds, bookmarked: card.bookmarked, tags: card.tags, run: card.run, milestone: card.milestone, dueDate: card.dueDate, archived: card.archived, deleted: card.deleted });
}

interface PreparedCard { card: CatalogCard; attributes: string; key: string }

function preparedCard(card: CatalogCard): PreparedCard {
  const attributes = cardAttributes(card);
  return {
    card,
    attributes,
    key: JSON.stringify([card.id, card.kind, card.path, card.version, card.title, card.state, card.owner, card.markdown,
      card.sourceHash, card.range?.start ?? null, card.range?.end ?? null, card.deckId, card.parentId, card.trackIds, attributes]),
  };
}

const referenceColumns = {
  spaces: ['id', 'title'],
  decks: ['id', 'space_id', 'title', 'kind', 'description', 'color', 'icon'],
  tracks: ['id', 'title', 'description'],
  documents: ['path', 'title', 'hash'],
} as const;
type ReferenceTable = keyof typeof referenceColumns;
interface PreparedReferenceRow { values: string[]; key: string }
interface PreparedReferenceTable { table: ReferenceTable; rows: Map<string, PreparedReferenceRow> }

function referenceRows(table: ReferenceTable, values: string[][]): PreparedReferenceTable {
  const rows = new Map<string, PreparedReferenceRow>();
  for (const row of values) {
    if (rows.has(row[0])) throw new Error(serverText(messages).duplicateKey(table, row[0]));
    rows.set(row[0], { values: row, key: JSON.stringify(row) });
  }
  return { table, rows };
}

function prepareReferenceTables(catalog: ProjectCatalog): PreparedReferenceTable[] {
  return [
    referenceRows('spaces', catalog.spaces.map(space => [space.id, space.title])),
    referenceRows('decks', catalog.decks.map(deck => [deck.id, deck.spaceId, deck.title, deck.kind, deck.description, deck.color, deck.icon])),
    referenceRows('tracks', catalog.tracks.map(track => [track.id, track.title, track.description])),
    referenceRows('documents', catalog.documents.map(document => [document.path, document.title, document.hash])),
  ];
}

export class ProjectIndex {
  private readonly database: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();
  // 2026-11-05: shadows advance only after COMMIT; an empty card collection is still a valid initialized snapshot.
  private shadowCards = new Map<string, string>();
  private shadowReferences = new Map<ReferenceTable, Map<string, string>>();
  private shadowRoot: string | null = null;

  constructor(filename: string) {
    // 2026-11-03: the CLI and server may rebuild the same disposable cache.
    this.database = new DatabaseSync(filename, { timeout: 5000 });
    try {
      this.database.exec(SCHEMA_SQL);
      // 2026-11-03: upgrade disposable indexes without losing readers' current snapshot.
      this.database.exec('BEGIN IMMEDIATE');
      try {
        const columns = this.database.prepare('PRAGMA table_info(cards)').all();
        if (!columns.some(column => column.name === 'attributes_json')) this.database.exec("ALTER TABLE cards ADD COLUMN attributes_json TEXT NOT NULL DEFAULT '{}'");
        this.database.exec('COMMIT');
      } catch (error) { this.database.exec('ROLLBACK'); throw error; }
      this.database.exec("INSERT OR IGNORE INTO meta (key, value) VALUES ('root_identity', ''), ('indexed_at', '')");
    } catch (error) {
      // A failed constructor leaves no instance for the caller to close.
      this.database.close();
      throw error;
    }
  }

  private statement(sql: string): StatementSync {
    const cached = this.statements.get(sql);
    if (cached !== undefined) return cached;
    const prepared = this.database.prepare(sql);
    this.statements.set(sql, prepared);
    return prepared;
  }

  private insertCardRow(prepared: PreparedCard): void {
    const card = prepared.card;
    this.statement(`INSERT INTO cards (id, kind, path, version, title, state, owner, owner_folded, markdown,
      source_hash, range_start, range_end, deck_id, parent_id, attributes_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(card.id, card.kind, card.path, card.version, card.title, card.state, card.owner,
        card.owner === null ? null : folded(card.owner), card.markdown, card.sourceHash,
        card.range === null ? null : card.range.start, card.range === null ? null : card.range.end,
        card.deckId, card.parentId, prepared.attributes);
    this.replaceCardTracks(card);
    this.insertCardSearch(card);
  }

  private replaceCardTracks(card: CatalogCard): void {
    this.statement('DELETE FROM card_tracks WHERE card_id = ?').run(card.id);
    for (const [position, trackId] of card.trackIds.entries()) {
      this.statement('INSERT INTO card_tracks (card_id, track_id, position) VALUES (?, ?, ?)').run(card.id, trackId, position);
    }
  }

  private replaceCardSearch(card: CatalogCard): void {
    this.statement('DELETE FROM cards_fts WHERE card_id = ?').run(card.id);
    this.insertCardSearch(card);
  }

  // 2026-11-05: fresh rows have no FTS entry; deleting by UNINDEXED card_id would scan every existing row.
  private insertCardSearch(card: CatalogCard): void {
    this.statement('INSERT INTO cards_fts (title, markdown, card_id) VALUES (?, ?, ?)')
      .run(folded(card.title), folded(card.markdown), card.id);
  }

  private replaceReferenceTables(tables: PreparedReferenceTable[], fullRebuild: boolean): void {
    for (const { table, rows } of tables) {
      const previous = fullRebuild ? undefined : this.shadowReferences.get(table);
      const columns = referenceColumns[table];
      const primaryKey = columns[0];
      for (const identity of previous?.keys() ?? []) {
        if (!rows.has(identity)) this.statement(`DELETE FROM ${table} WHERE ${primaryKey} = ?`).run(identity);
      }
      // 2026-11-05: identifiers come exclusively from referenceColumns; all project values remain bound parameters.
      const assignments = columns.slice(1).map(column => `${column} = excluded.${column}`).join(', ');
      const upsert = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})
        ON CONFLICT(${primaryKey}) DO UPDATE SET ${assignments}`;
      for (const [identity, row] of rows) {
        if (previous?.get(identity) === row.key) continue;
        this.statement(upsert).run(...row.values);
      }
    }
  }

  replace(catalog: ProjectCatalog): void {
    // Checked before the transaction opens, so any rejection leaves the
    // previous full snapshot in place (2026-11-03).
    assertUniqueCardIds(catalog.cards);
    // 2026-11-05: cards and reference rows compare against the last committed snapshot; root changes rebuild everything.
    const rows = new Map(catalog.cards.map(card => [card.id, preparedCard(card)]));
    const referenceTables = prepareReferenceTables(catalog);
    const fullRebuild = this.shadowRoot !== catalog.rootIdentity;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      if (fullRebuild) {
        for (const sql of [
          'DELETE FROM card_tracks', 'DELETE FROM cards_fts', 'DELETE FROM cards',
          'DELETE FROM documents', 'DELETE FROM spaces', 'DELETE FROM decks', 'DELETE FROM tracks',
        ]) this.statement(sql).run();
        for (const prepared of rows.values()) this.insertCardRow(prepared);
      } else {
        for (const id of this.shadowCards.keys()) {
          if (rows.has(id)) continue;
          this.statement('DELETE FROM cards_fts WHERE card_id = ?').run(id);
          this.statement('DELETE FROM card_tracks WHERE card_id = ?').run(id);
          this.statement('DELETE FROM cards WHERE id = ?').run(id);
        }
        for (const prepared of rows.values()) {
          if (this.shadowCards.get(prepared.card.id) === prepared.key) continue;
          if (this.shadowCards.has(prepared.card.id)) {
            this.statement(`UPDATE cards SET kind = ?, path = ?, version = ?, title = ?, state = ?, owner = ?, owner_folded = ?,
              markdown = ?, source_hash = ?, range_start = ?, range_end = ?, deck_id = ?, parent_id = ?, attributes_json = ? WHERE id = ?`)
              .run(prepared.card.kind, prepared.card.path, prepared.card.version, prepared.card.title, prepared.card.state, prepared.card.owner,
                prepared.card.owner === null ? null : folded(prepared.card.owner), prepared.card.markdown, prepared.card.sourceHash,
                prepared.card.range === null ? null : prepared.card.range.start, prepared.card.range === null ? null : prepared.card.range.end,
                prepared.card.deckId, prepared.card.parentId, prepared.attributes, prepared.card.id);
            this.replaceCardTracks(prepared.card);
            this.replaceCardSearch(prepared.card);
          } else this.insertCardRow(prepared);
        }
      }
      this.replaceReferenceTables(referenceTables, fullRebuild);
      this.statement('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run('root_identity', catalog.rootIdentity);
      this.statement('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run('indexed_at', new Date().toISOString());
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    this.shadowCards = new Map([...rows].map(([id, prepared]) => [id, prepared.key]));
    this.shadowReferences = new Map(referenceTables.map(({ table, rows: references }) => [table,
      new Map([...references].map(([identity, prepared]) => [identity, prepared.key])),
    ]));
    this.shadowRoot = catalog.rootIdentity;
  }

  search(query: CatalogQuery = {}): CatalogCard[] {
    const limit = searchLimit(query.limit);
    const { conditions, parameters } = this.filterConditions(query);
    const match = query.text === undefined ? null : literalMatchQuery(query.text);
    if (match === '') return [];
    let rows: CardRow[];
    // A card without a version (a loose document) sorts after numbered ones,
    // so the tie-break path/version/id stays intuitive (2026-11-03).
    if (match === null) {
      const sql = `SELECT cards.* FROM cards${whereClause(conditions)}
        ORDER BY cards.path, cards.version ASC NULLS LAST, cards.id LIMIT ?`;
      rows = this.statement(sql).all(...parameters, limit) as unknown as CardRow[];
    } else {
      // 2026-11-03: title tokens carry more weight than body tokens; bm25
      // still accounts for document length and term frequency.
      const sql = `SELECT cards.*, bm25(cards_fts, 10.0, 1.0) AS relevance FROM cards_fts
        JOIN cards ON cards.id = cards_fts.card_id WHERE cards_fts MATCH ?${andClause(conditions)}
        ORDER BY relevance, cards.path, cards.version ASC NULLS LAST, cards.id LIMIT ?`;
      rows = this.statement(sql).all(match, ...parameters, limit) as unknown as CardRow[];
    }
    return this.cardsWithTracks(rows);
  }

  /** 2026-11-05: optional excerpts leave the existing search query, ordering and response untouched. */
  searchSnippets(query: CatalogQuery, cardIds: string[]): Map<string, SearchSnippets> {
    const match = query.text === undefined ? null : literalMatchQuery(query.text);
    if (!match || !cardIds.length) return new Map();
    const placeholders = cardIds.map(() => '?').join(', ');
    const rows = this.statement(`SELECT card_id,
      snippet(cards_fts, 0, char(1), char(2), '…', 32) AS title,
      snippet(cards_fts, 1, char(1), char(2), '…', 32) AS markdown
      FROM cards_fts WHERE cards_fts MATCH ? AND card_id IN (${placeholders})`)
      .all(match, ...cardIds) as unknown as (SearchSnippets & { card_id: string })[];
    return new Map(rows.map(row => [row.card_id, { title: row.title, markdown: row.markdown }]));
  }

  get(id: string): CatalogCard | null {
    const row = this.statement('SELECT cards.* FROM cards WHERE cards.id = ?').get(id) as unknown as CardRow | undefined;
    if (row === undefined) return null;
    const trackRows = this.statement('SELECT card_id, track_id FROM card_tracks WHERE card_id = ? ORDER BY position')
      .all(id) as unknown as TrackRow[];
    return toCard(row, trackRows.map(trackRow => trackRow.track_id));
  }

  summary(): CatalogIndexSummary {
    const row = this.statement(`SELECT
      (SELECT value FROM meta WHERE key = 'root_identity') AS root_identity,
      (SELECT value FROM meta WHERE key = 'indexed_at') AS indexed_at,
      (SELECT COUNT(*) FROM documents) AS documents,
      (SELECT COUNT(*) FROM cards) AS cards`).get() as unknown as SummaryRow;
    return { rootIdentity: row.root_identity, documents: row.documents, cards: row.cards, indexedAt: row.indexed_at };
  }

  close(): void {
    this.database.close();
  }

  private filterConditions(query: CatalogQuery): { conditions: string[]; parameters: (string | number)[] } {
    const conditions: string[] = ["COALESCE(json_extract(cards.attributes_json, '$.archived'), 0) = 0", "COALESCE(json_extract(cards.attributes_json, '$.deleted'), 0) = 0"];
    const parameters: (string | number)[] = [];
    if (query.deckId !== undefined) {
      conditions.push('cards.deck_id = ?');
      parameters.push(query.deckId);
    }
    if (query.trackId !== undefined) {
      conditions.push('EXISTS (SELECT 1 FROM card_tracks WHERE card_tracks.card_id = cards.id AND card_tracks.track_id = ?)');
      parameters.push(query.trackId);
    }
    if (query.kind !== undefined) {
      conditions.push('cards.kind = ?');
      parameters.push(query.kind);
    }
    if (query.state !== undefined) {
      conditions.push('cards.state = ?');
      parameters.push(readCardState(query.state) ?? query.state);
    }
    if (query.owner !== undefined) {
      conditions.push('cards.owner_folded = ?');
      parameters.push(folded(query.owner));
    }
    return { conditions, parameters };
  }

  private cardsWithTracks(rows: CardRow[]): CatalogCard[] {
    const tracksByCardId = new Map<string, string[]>();
    if (rows.length > 0) {
      const placeholders = rows.map(() => '?').join(', ');
      const trackRows = this.statement(
        `SELECT card_id, track_id FROM card_tracks WHERE card_id IN (${placeholders}) ORDER BY card_id, position`,
      ).all(...rows.map(row => row.id)) as unknown as TrackRow[];
      for (const trackRow of trackRows) {
        const current = tracksByCardId.get(trackRow.card_id);
        if (current === undefined) tracksByCardId.set(trackRow.card_id, [trackRow.track_id]);
        else current.push(trackRow.track_id);
      }
    }
    return rows.map(row => toCard(row, tracksByCardId.get(row.id) ?? []));
  }
}
