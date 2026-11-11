import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ProjectTag } from '../src/project-tags.ts';
import { markdownParser } from '../src/markdown-model.ts';
import { CardTags, TagBadge, CardTagSummary, TagTitlePrefix } from '../client/components/CardTags.tsx';
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

  it('uses badge plaques and makes every preview tag a button, including personal hashtags', () => {
    const html = renderToStaticMarkup(<CardTags tags={['engine', 'звук', 'plain', 'личный', 'engine']} definitions={projectTags}
      onOpenCard={() => {}} onEditTags={() => {}} />);
    expect(html.match(/<button\b/gu)).toHaveLength(4);
    expect(html.match(/tag-badge is-project/gu)).toHaveLength(3);
    expect(html).toContain('tag-badge is-personal');
    expect(html).toContain('tag-badge-glyph');
    expect(html).not.toContain('card-meta-tag');
    expect(html).not.toContain('card-tag-pie');
    expect(html).toContain('🔈');
    expect(html).toContain('>plain</span>');
    expect(html).toContain('>#личный</span>');
    expect(html).toContain('aria-label="Tags: engine, звук, plain, личный"');
  });

  it('keeps preview tag buttons mounted and disabled while navigation is locked', () => {
    const html = renderToStaticMarkup(<CardTags tags={['engine', 'звук', 'personal']} definitions={projectTags}
      onOpenCard={() => {}} onEditTags={() => {}} disabled />);
    expect(html.match(/<button\b/gu)).toHaveLength(3);
    expect(html.match(/disabled=""/gu)).toHaveLength(3);
  });

  it('summarizes all kinds of tags in one text line, deduplicating names and retaining hidden tags', () => {
    expect(renderToStaticMarkup(<CardTagSummary />)).toBe('');
    expect(renderToStaticMarkup(<CardTagSummary tags={['personal']} definitions={projectTags} />)).toContain('>#personal</span>');
    const single = renderToStaticMarkup(<CardTagSummary tags={['engine']} definitions={projectTags} />);
    expect(single).toContain('>engine</span>');
    expect(single).not.toContain('tag-overflow');
    const multiple = renderToStaticMarkup(<CardTagSummary tags={['engine', 'звук', 'ui', 'engine', 'plain', 'personal']} definitions={projectTags} />);
    expect(multiple).toContain('>+4</span>');
    expect(multiple).toContain('title="Tags: engine, звук, ui, plain, personal"');
    expect(multiple).not.toMatch(/conic-gradient|card-tag-(emoji|icon|pie)/);
  });

  it('does not add nested buttons or focus stops inside a card button', () => {
    const html = renderToStaticMarkup(<button type="button">
      <TagTitlePrefix tags={['engine', 'звук']} definitions={projectTags} />
      <CardTags tags={['engine', 'звук']} definitions={projectTags} compact />
      <CardTagSummary tags={['engine', 'звук']} definitions={projectTags} />
    </button>);
    expect(html.match(/<button\b/gu)).toHaveLength(1);
    expect(html).not.toContain('tabindex');
  });

  it('omits only tags known to be shared by the visible group before counting overflow', () => {
    const html = renderToStaticMarkup(<CardTagSummary tags={['engine', 'звук', 'ui', 'ui']} definitions={projectTags} sharedTags={['engine']} />);
    expect(html).toContain('>звук</span>');
    expect(html).toContain('>+1</span>');
    expect(html).not.toContain('engine');
    expect(renderToStaticMarkup(<CardTagSummary tags={['engine']} sharedTags={['engine']} />)).toBe('');
  });

  it('translates the indicator accessible name without changing tag names', () => {
    setLang('ru');
    const html = renderToStaticMarkup(<CardTagSummary tags={['engine', 'ui']} definitions={projectTags} />);
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
