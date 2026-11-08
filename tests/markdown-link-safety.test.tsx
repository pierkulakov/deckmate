import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { markdownParser } from '../src/markdown-model.ts';
import { Markdown } from '../client/components/Markdown.tsx';
import { attachmentMarkdown } from '../client/attachment-markdown.ts';
import { setLang } from '../client/i18n.ts';

// 2026-11-06: the card Markdown renderer must not activate unsafe URL schemes, raw HTML or injected
// attributes; project-relative links keep resolving through /api/file.

vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
});

beforeEach(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { origin: 'http://localhost' } }));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  setLang('en');
});
afterEach(() => vi.unstubAllGlobals());

function renderMarkdown(markdown: string): string {
  return renderToStaticMarkup(<Markdown tree={markdownParser.parse(markdown)} source="sandbox" path="cards/example.md" />);
}

it('renders unsafe URL schemes as plain text without anchors', () => {
  const html = renderMarkdown([
    '[one](javascript:alert(1))',
    '[two](JAVASCRIPT:alert(1))',
    '[three](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    '[four](vbscript:msgbox)',
    '[five](file:///etc/passwd)',
    '[six](//evil.example/click)',
    '![image](javascript:alert(1))',
  ].join('\n\n'));
  expect(html).not.toContain('<a ');
  expect(html).not.toContain('<img');
  expect(html.toLowerCase()).not.toContain('javascript:');
  expect(html).not.toContain('data:text/html');
  expect(html).not.toContain('vbscript:');
  expect(html).not.toContain('file:');
  expect(html).not.toContain('//evil.example');
  for (const label of ['one', 'two', 'three', 'four', 'five', 'six']) expect(html).toContain(`>${label}<`);
});

it('renders raw HTML blocks and inline HTML as escaped text', () => {
  const html = renderMarkdown([
    '<script>alert(1)</script>',
    '',
    '<img src=x onerror=alert(1)>',
    '',
    '<a href="javascript:alert(1)">label</a>',
    '',
    '<iframe src="https://evil.example"></iframe>',
  ].join('\n'));
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('&lt;img');
  expect(html).toContain('&lt;iframe');
  // Everything stays text inside <code>: no tag is ever created, so no attribute can be injected.
  expect(html).not.toContain('<script');
  expect(html).not.toContain('<img');
  expect(html).not.toContain('<iframe');
  expect(html).not.toContain('<a ');
  expect(html).not.toContain('<iframe src');
});

it('cannot inject attributes through crafted link targets', () => {
  const html = renderMarkdown([
    '[x](https://example.com/"onmouseover="alert(1))',
    '[y](https://example.com/?q=1\'onload=\'alert(2))',
    '![z](features/a.png"onerror="alert(3))',
  ].join('\n\n'));
  // Quotes and crafted payloads stay inside the quoted attribute value, percent-encoded by the URL parser.
  expect(html).not.toMatch(/\son[a-z]+\s*=/iu);
  expect(html).toContain('href="https://example.com/%22onmouseover=%22alert(1)"');
  expect(html).toContain('src="/api/file?source=sandbox&amp;path=cards%2Ffeatures%2Fa.png%22onerror%3D%22alert(3)"');
});

it('keeps unsafe targets from link definitions inactive', () => {
  const html = renderMarkdown('[click][ref]\n\n[ref]: javascript:alert(1)\n\n![pic][img]\n\n[img]: data:text/html,<script>');
  expect(html).not.toContain('<a ');
  expect(html).not.toContain('<img');
  expect(html).toContain('>click<');
});

it('keeps honest links, project images and local anchors working', () => {
  const html = renderMarkdown([
    '[site](https://example.com/a?b=1)',
    '[doc](../docs/intro.md)',
    '![pic](../features/pic.png)',
    '[head](#section)',
    '[card](http://localhost/r/c-abcdefghij?source=sandbox)',
  ].join('\n\n'));
  expect(html).toContain('href="https://example.com/a?b=1"');
  // Relative links resolve against the card's own directory (cards/example.md) before reaching /api/file.
  expect(html).toContain('href="/api/file?source=sandbox&amp;path=docs%2Fintro.md"');
  expect(html).toContain('src="/api/file?source=sandbox&amp;path=features%2Fpic.png"');
  expect(html).toContain('href="#section"');
  expect(html).toContain('href="/r/c-abcdefghij?source=sandbox"');
  for (const anchor of html.match(/<a [^>]*>/gu) ?? []) expect(anchor).toContain('rel="noreferrer"');
});

it('resolves relative traversal links back into the project file endpoint', () => {
  const html = renderMarkdown('[escape](../../../etc/passwd)');
  expect(html).toContain('href="/api/file?source=sandbox&amp;path=etc%2Fpasswd"');
  expect(html).not.toContain('..');
});

it.each(['sandbox', 'live'] as const)('renders inserted image and PDF attachments relative to a nested card in %s', source => {
  const path = 'tasks/features/ferry.md';
  const directory = 'tasks/deckmate-assets/cards/a b/';
  const image = attachmentMarkdown(path, { file: directory + 'рисунок #1.png', name: 'Sketch [v2].png', kind: 'image' });
  const pdf = attachmentMarkdown(path, { file: directory + 'brief.pdf', name: 'Brief.pdf', kind: 'pdf' });
  const html = renderToStaticMarkup(<Markdown tree={markdownParser.parse(image + '\n\n' + pdf)} source={source} path={path} />);
  expect(html).toContain(`<img src="/api/file?source=${source}&amp;path=${encodeURIComponent(directory + 'рисунок #1.png')}" alt="Sketch [v2].png"`);
  expect(html).toContain(`<a href="/api/file?source=${source}&amp;path=${encodeURIComponent(directory + 'brief.pdf')}" target="_blank" rel="noreferrer">Brief.pdf</a>`);
});
