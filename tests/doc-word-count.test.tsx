import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CatalogCard } from '../src/catalog-contracts.ts';
import { CardMetrics, DocWordCount, docWordsLabel, docWordsShortLabel } from '../client/components/CardMetrics.tsx';
import { buildCatalogLookups } from '../client/catalog-lookups.ts';
import { setLang } from '../client/i18n.ts';

vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
});
beforeEach(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false }) }));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  setLang('en');
});
afterEach(() => vi.unstubAllGlobals());

// A fresh id and hash per document: word counts are cached by card revision.
let revision = 0;
function docCard(markdown: string): CatalogCard {
  revision += 1;
  return { id: `doc:display-${revision}`, kind: 'doc', title: 'Notes', path: 'docs/notes.md', version: null,
    state: null, owner: null, markdown, sourceHash: `revision-${revision}`, range: null, deckId: null, trackIds: [], parentId: null };
}

it('keeps the exact count for tooltips and menus in both languages', () => {
  expect(docWordsLabel(1, 'en')).toBe('1 word');
  expect(docWordsLabel(2, 'en')).toBe('2 words');
  expect(docWordsLabel(1234, 'en')).toBe(`${new Intl.NumberFormat('en-US').format(1234)} words`);
  expect(docWordsLabel(1, 'ru')).toBe('1 слово');
  expect(docWordsLabel(2, 'ru')).toBe('2 слова');
  expect(docWordsLabel(5, 'ru')).toBe('5 слов');
  expect(docWordsLabel(1234, 'ru')).toBe(`${new Intl.NumberFormat('ru-RU').format(1234)} слова`);
});

it('shortens the band volume to the interface language, exactly below a thousand', () => {
  expect(docWordsShortLabel(1, 'en')).toBe('1w');
  expect(docWordsShortLabel(999, 'en')).toBe('999w');
  expect(docWordsShortLabel(1000, 'en')).toBe('1kw');
  expect(docWordsShortLabel(1234, 'en')).toBe('1.2kw');
  expect(docWordsShortLabel(25_500, 'en')).toBe('25.5kw');
  expect(docWordsShortLabel(999, 'ru')).toBe('999 сл.');
  expect(docWordsShortLabel(1000, 'ru')).toBe('1 тыс. сл.');
  expect(docWordsShortLabel(1234, 'ru')).toBe('1,2 тыс. сл.');
  expect(docWordsShortLabel(25_500, 'ru')).toBe('25,5 тыс. сл.');
});

it('shows the short volume with the exact count as its tooltip and accessible name', () => {
  expect(renderToStaticMarkup(<DocWordCount card={docCard('Readable body with four words')} />))
    .toBe('<span class="doc-word-count" role="img" aria-label="5 words" title="5 words"><span aria-hidden="true">5w</span></span>');
  setLang('ru');
  expect(renderToStaticMarkup(<DocWordCount card={docCard('Четыре коротких слова')} />))
    .toBe('<span class="doc-word-count" role="img" aria-label="3 слова" title="3 слова"><span aria-hidden="true">3 сл.</span></span>');
});

it('rounds a long document to thousands on the band while the tooltip keeps the count', () => {
  setLang('ru');
  const markdown = Array.from({ length: 1234 }, () => 'слово').join(' ');
  const html = renderToStaticMarkup(<DocWordCount card={docCard(markdown)} />);
  expect(html).toContain(`title="${new Intl.NumberFormat('ru-RU').format(1234)} слова"`);
  expect(html).toContain('>1,2 тыс. сл.</span>');
});

it('renders nothing for an empty document', () => {
  expect(renderToStaticMarkup(<DocWordCount card={docCard('')} />)).toBe('');
  expect(renderToStaticMarkup(<DocWordCount card={docCard('# Only a title')} />)).toBe('');
  expect(renderToStaticMarkup(<DocWordCount card={docCard('```js\nconst hidden = true;\n```')} />)).toBe('');
});

it('carries the same element from the common metrics row of a Doc', () => {
  const card = docCard('Four short words');
  const html = renderToStaticMarkup(<CardMetrics card={card} lookups={buildCatalogLookups([card])} />);
  expect(html).toContain('<span class="doc-word-count" role="img" aria-label="3 words" title="3 words"><span aria-hidden="true">3w</span></span>');
  expect(html).not.toContain('effort');
  expect(html).not.toContain('priority');
});
