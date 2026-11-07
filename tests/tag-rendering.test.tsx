import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ProjectTag } from '../src/project-tags.ts';
import { markdownParser } from '../src/markdown-model.ts';
import { CardTags, TagBadge, TagColorIndicator, TagTitlePrefix } from '../client/components/CardTags.tsx';
import { Markdown } from '../client/components/Markdown.tsx';
import { splitMarkdownTags } from '../client/markdown-tags.ts';
import { setLang } from '../client/i18n.ts';

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

const projectTags: ProjectTag[] = [
  { name: 'engine', color: '#123456' },
  { name: 'звук', color: '#abcdef', emoji: '🔈', cardId: 'card:sound' },
  { name: 'ui', color: '#3c8caa' },
  { name: 'plain', color: '#687e9c' },
];

function renderMarkdown(markdown: string): string {
  return renderToStaticMarkup(<Markdown tree={markdownParser.parse(markdown)} rawMarkdown={markdown}
    projectTags={projectTags} source="sandbox" path="cards/example.md" />);
}

describe('shared tag presentation', () => {
  it('uses registry membership to distinguish project tags from personal hashtags', () => {
    const html = renderToStaticMarkup(<CardTags tags={['engine', 'personal']} definitions={projectTags} />);
    expect(html).toContain('tag-badge is-project');
    expect(html).toContain('tag-badge is-personal');
    expect(html).toContain('>engine</span>');
    expect(html).toContain('>#personal</span>');
    expect(html).not.toContain('tag-badge-glyph');
    expect(html).not.toContain('card-tag-dot');
  });

  it('preserves the entire long name in its tooltip and shares the compact badge', () => {
    const name = 'Long project tag '.repeat(5).trim();
    const html = renderToStaticMarkup(<TagBadge name={name} definition={{ name, color: '#123456' }} compact />);
    expect(html).toContain(`title="${name}"`);
    expect(html).toContain('tag-badge is-project is-compact');
    expect(html).toContain(`>${name}</span>`);
  });

  it('keeps native emoji unchanged, including Windows flag rendering', () => {
    const html = renderToStaticMarkup(<TagBadge name="flag" definition={{ name: 'flag', color: '#123456', emoji: '🇩🇪' }} />);
    expect(html).toContain('tag-badge-glyph');
    expect(html).toContain('🇩🇪');
  });

  // 2026-11-05: colored tags get a dot; emoji tags show their glyph, and the default color adds no decoration.
  it('renders no dot for personal-only tags, one exact color for one project tag, and a project-only pie', () => {
    expect(renderToStaticMarkup(<TagColorIndicator tags={['personal']} definitions={projectTags} />)).toBe('');
    const single = renderToStaticMarkup(<TagColorIndicator tags={['engine', 'personal']} definitions={projectTags} />);
    expect(single).toContain('background:#123456');
    expect(single).not.toContain('conic-gradient');
    expect(single).not.toContain('personal');
    const multiple = renderToStaticMarkup(<TagColorIndicator tags={['engine', 'звук', 'ui', 'engine', 'plain', 'personal']} definitions={projectTags} />);
    expect(multiple).toContain('conic-gradient(#123456 0% 50%, #3c8caa 50% 100%)');
    expect(multiple).not.toContain('personal');
    expect(renderToStaticMarkup(<TagColorIndicator tags={['звук', 'plain']} definitions={projectTags} />)).toBe('');
  });

  it('does not add nested buttons or focus stops inside a card button', () => {
    const html = renderToStaticMarkup(<button type="button">
      <TagTitlePrefix tags={['engine', 'звук']} definitions={projectTags} />
      <CardTags tags={['engine', 'звук']} definitions={projectTags} compact />
      <TagColorIndicator tags={['engine', 'звук']} definitions={projectTags} />
    </button>);
    expect(html.match(/<button\b/gu)).toHaveLength(1);
    expect(html).not.toContain('tabindex');
  });

  it('translates the indicator accessible name without changing tag names', () => {
    setLang('ru');
    const html = renderToStaticMarkup(<TagColorIndicator tags={['engine', 'ui']} definitions={projectTags} />);
    expect(html).toContain('aria-label="Теги: engine, ui"');
  });
});

describe('Markdown hashtags', () => {
  it('highlights Unicode words while preserving surrounding text and punctuation', () => {
    expect(splitMarkdownTags('Текст (#звук), #личный-тег и #e\u0301')).toEqual([
      'Текст (', { name: 'звук' }, '), ', { name: 'личный-тег' }, ' и ', { name: 'e\u0301' },
    ]);
    const html = renderMarkdown('Текст #engine, #звук и #личный.');
    expect(html.match(/tag-badge is-project/gu)).toHaveLength(2);
    expect(html.match(/tag-badge is-personal/gu)).toHaveLength(1);
    expect(html).toContain('>#личный</span>');
    expect(html).toContain('</span>, ');
  });

  it('keeps hex colours in prose as text and word tags as tags', () => {
    expect(splitMarkdownTags('Фон #1a1a1a, рамка #CCCCCC (#3f79b3), тень #0003 и #f00; теги #бой, #bad, #cafe')).toEqual([
      'Фон #1a1a1a, рамка #CCCCCC (#3f79b3), тень #0003 и #f00; теги ', { name: 'бой' }, ', ', { name: 'bad' }, ', ', { name: 'cafe' },
    ]);
  });

  it('preserves escaped hashes beside real tags', () => {
    const html = renderMarkdown(String.raw`#engine \#engine #личный`);
    expect(html.match(/tag-badge is-project/gu)).toHaveLength(1);
    expect(html).toContain(' #engine ');
    expect(html).toContain('>#личный</span>');
  });

  it('does not turn code, link labels, link fragments or raw HTML blocks into tags', () => {
    const markdown = [
      '`#engine` [#engine](https://example.com/#engine)',
      '', '```text', '#engine', '```',
      '', '<div>#engine</div>',
    ].join('\n');
    const html = renderMarkdown(markdown);
    expect(html).not.toContain('tag-badge');
    expect(html).toContain('<code>#engine</code>');
    expect(html).toContain('href="https://example.com/#engine"');
    expect(html).toContain('>#engine</a>');
    expect(html).toContain('&lt;div&gt;#engine&lt;/div&gt;');
  });
});
