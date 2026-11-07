import { describe, expect, it } from 'vitest';
import type { CatalogCard, CatalogView } from '../src/catalog-contracts.ts';
import { exportCardsCsv } from '../src/card-export.ts';
import { shortReference } from '../src/references.ts';

function card(patch: Partial<CatalogCard> = {}): CatalogCard {
  return { id: 'card:one', kind: 'task', path: 'cards/one.md', version: null, title: 'Звук', state: 'not-started', owner: null,
    markdown: 'truncated excerpt', sourceHash: 'hash', range: null, deckId: null, trackIds: [], parentId: null, ...patch };
}

describe('CSV card export', () => {
  it('writes UTF-8 BOM, semicolon columns and CRLF; quotes delimiters, quotes and multiline Cyrillic', () => {
    const result = exportCardsCsv([card({ title: 'Звук; "выстрел"\nэхо' })], ['title', 'owner', 'effort']);
    expect(result).toBe('\ufeff"Title";"Owner";"Effort"\r\n"Звук; ""выстрел""\r\nэхо";"";""\r\n');
    expect(Buffer.from(result).subarray(0, 3).toString('hex')).toBe('efbbbf');
    expect(result.replace(/\r\n/gu, '')).not.toMatch(/[\r\n]/u);
  });

  it.each(['=HYPERLINK("https://example.invalid")', '+cmd', '-2+3', '@SUM(1)', '  =1+1', '\t=1+1', '\r@SUM(1)', '\ufeff=1', '\u0000=1'])('neutralizes a spreadsheet formula prefix %j', title => {
    const result = exportCardsCsv([card({ title })], ['title']);
    expect(result.split('\r\n')[1]?.startsWith('"\'')).toBe(true);
  });

  it('does not change ordinary punctuation, quoted prose or numbers inside text', () => {
    expect(exportCardsCsv([card({ title: 'SFX — звук = атака + эхо', effort: 0 })], ['title', 'effort']))
      .toContain('"SFX — звук = атака + эхо";"0"\r\n');
  });

  it('respects custom column order, resolves names and deduplicates selected IDs', () => {
    const selected = card({ deckId: 'audio', parentId: 'hero', trackIds: ['sound', 'missing'], handMemberIds: ['kimi'], tags: ['sfx', 'hero'], bookmarked: true });
    const catalog = { decks: [{ id: 'audio', title: 'Audio' }], cards: [{ id: 'hero', title: 'Warrior' }], tracks: [{ id: 'sound', title: 'Звук' }], members: [{ id: 'kimi', label: 'Kimi' }] } as CatalogView;
    expect(exportCardsCsv([selected, selected], ['parent', 'deck', 'tracks', 'hand', 'tags', 'bookmarked'], { catalog }))
      .toBe('\ufeff"Hero";"Deck";"Tracks";"Hand";"Tags";"Bookmarked"\r\n"Warrior";"Audio";"Звук, missing";"Kimi";"sfx, hero";"true"\r\n');
  });

  it('exports a source-specific short link and never substitutes truncated catalog Markdown', () => {
    const selected = card();
    expect(() => exportCardsCsv([selected], ['content'])).toThrow('Full Markdown is not loaded');
    expect(exportCardsCsv([selected], ['reference', 'content'], { origin: 'http://127.0.0.1:4317/', source: 'live', contentById: new Map([[selected.id, '**Full**\n- [ ] task']]) }))
      .toContain(`"http://127.0.0.1:4317/r/${shortReference('c', selected.id)}?source=live";"**Full**\r\n- [ ] task"`);
  });

  it('supports empty full Markdown and an empty card selection, but rejects an empty column list', () => {
    const selected = card();
    expect(exportCardsCsv([selected], ['content'], { contentById: new Map([[selected.id, '']]) })).toBe('\ufeff"Markdown"\r\n""\r\n');
    expect(exportCardsCsv([], ['title'])).toBe('\ufeff"Title"\r\n');
    expect(() => exportCardsCsv([selected], [])).toThrow('Choose at least one CSV column');
  });
});
