import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ProjectTag } from '../src/project-tags.ts';
import { markdownParser } from '../src/markdown-model.ts';
import { CardTags, TagBadge, TagTitlePrefix, TagColorIndicator } from '../client/components/CardTags.tsx';
import { findTagEmojis, tagEmojis } from '../client/tag-emoji.ts';
import { TagSelectionList } from '../client/components/TagPicker.tsx';
import { Markdown } from '../client/components/Markdown.tsx';
import { splitMarkdownTags } from '../client/markdown-tags.ts';
import { setLang } from '../client/i18n.ts';
import { getEditorOptions, insertEditorCommand } from '../client/editor-commands.ts';
import type { CatalogView } from '../src/catalog-contracts.ts';

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
  it('keeps a color marker legible and lets a glyph replace it', () => {
    const render = (color: string, emoji?: string) => renderToStaticMarkup(<TagBadge name="test" definition={{ name: 'test', color, emoji }} />);
    expect(render('#123456')).toContain('--tag-glyph-background:#123456');
    expect(render('#123456')).toContain('--tag-color-ink:var(--tag-foreground)');
    expect(render('#ffffff')).toContain('--tag-color-ink:var(--tag-color-dark-ink)');
    expect(render('#123456', '🐞')).not.toContain('is-color');
    expect(render('#687e9c')).not.toContain('tag-badge-glyph');
  });

  it('offers a keyboard and touch trigger for the remaining tag links', () => {
    const html = renderToStaticMarkup(<CardTags tags={['engine', 'звук', 'ui', 'engine']} definitions={projectTags} maxVisible={2} />);
    expect(html).toMatch(/<button[^>]*class="tag-overflow"[^>]*>/u);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('>+1</button>');
  });

  it('groups choices by registry membership and puts selected names first', () => {
    const tags = [...projectTags, { name: 'later', color: '#687e9c' }];
    const html = renderToStaticMarkup(<TagSelectionList tags={tags} definitions={projectTags} selected={['ui', 'later']}
      query="" onQueryChange={() => {}} onToggle={() => {}} />);
    expect(html).toContain('aria-label="Project tags"');
    expect(html).toContain('aria-label="Outside registry"');
    expect(html.indexOf('>ui</span>')).toBeLessThan(html.indexOf('>engine</span>'));
    expect(html).toContain('>#later</span>');
  });

  it('shows coverage separately from the explicitly selected bulk action', () => {
    const html = renderToStaticMarkup(<TagSelectionList tags={projectTags} definitions={projectTags} selected={[]}
      assignedCards={[{ tags: ['engine', 'engine'] }, { tags: ['engine'] }, {}, {}]} query="engine" onQueryChange={() => {}} onToggle={() => {}} />);
    expect(html).toContain('On 2 of 4 cards');
    expect(html).toContain('aria-checked="false"');
    expect(html).not.toContain('aria-checked="mixed"');
  });

  it('offers configuration without assignment checkboxes', () => {
    const html = renderToStaticMarkup(<TagSelectionList tags={projectTags} definitions={projectTags} selected={[]}
      query="engine" onQueryChange={() => {}} onToggle={() => {}} onConfigure={() => {}} />);
    expect(html).toContain('aria-label="Configure tag: engine"');
    expect(html).not.toContain('role="checkbox"');
  });

  it.each(['🐞', '💀'])('finds the pasted emoji %s without a keyword', emoji => {
    expect(findTagEmojis(' ' + emoji + ' ').map(item => item.emoji)).toContain(emoji);
  });

  it('finds emoji using either language and has an honest empty result', () => {
    for (const query of ['ladybug', 'БАГ']) expect(findTagEmojis(query).some(item => item.emoji === '🐞')).toBe(true);
    for (const query of ['skull', 'ЧЕРЕП']) expect(findTagEmojis(query).some(item => item.emoji === '💀')).toBe(true);
    expect(findTagEmojis('no-such-emoji')).toEqual([]);
  });

  it('names text insertion separately from assignments and identifies unregistered names', () => {
    setLang('ru');
    const catalog = { cards: [{ tags: ['later'] }], projectTags, decks: [] } as unknown as CatalogView;
    const trigger = { kind: 'command' as const, start: 0, end: 4, query: 'тег' };
    const command = getEditorOptions(trigger, catalog).find(option => option.id === 'tag')!;
    expect(command.label).toBe('Вставить # в текст');
    expect(insertEditorCommand('/тег', trigger, command).value).toBe('#');
    const options = getEditorOptions({ ...trigger, kind: 'tag', query: '' }, catalog);
    expect(options.find(option => option.id === 'later')?.detail).toBe('Вне реестра');
    expect(options.find(option => option.id === 'engine')?.detail).toBe('Тег проекта');
  });

  it('uses registry membership to distinguish project tags from personal hashtags', () => {
    const html = renderToStaticMarkup(<CardTags tags={['engine', 'personal']} definitions={projectTags} />);
    expect(html).toContain('tag-badge is-project');
    expect(html).toContain('tag-badge is-personal');
    expect(html).toContain('>engine</span>');
    expect(html).toContain('>#personal</span>');
    expect(html).toContain('tag-badge-glyph is-color');
    expect(html).toContain('>#</span>');
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

  it('shows every registered emoji in card order without duplicating names or personal hashtags', () => {
    const emoji = ['🐞', '💀', '🎮', '🌊', '✨'];
    const definitions = emoji.map((emoji, index) => ({ name: String(index), emoji, color: '#687e9c' }));
    const html = renderToStaticMarkup(<TagTitlePrefix tags={['4', '2', '0', '3', '1', '2', 'personal']} definitions={definitions} />);
    expect([...html.matchAll(/class="card-tag-emoji"[^>]*>(.*?)<\/span>/gu)].map(match => match[1])).toEqual(['✨', '🎮', '🐞', '🌊', '💀']);
    expect(html).not.toContain('personal');
    for (const glyph of ['🐞', '💀']) expect(tagEmojis.some(item => item.emoji === glyph)).toBe(true);
  });

  it('combines only color decorations into one dot and names all project tags for its focus tooltip', () => {
    const html = renderToStaticMarkup(<TagColorIndicator tags={['ui', 'звук', 'engine', 'ui', 'plain', 'personal']} definitions={projectTags} />);
    expect(html).toContain('conic-gradient(#3c8caa 0% 50%, #123456 50% 100%)');
    expect(html).toContain('aria-label="Tags: ui, звук, engine, plain"');
    expect(html).toContain('tabindex="0"');
    expect(html).not.toContain('personal');
    expect(renderToStaticMarkup(<TagColorIndicator tags={['звук', 'plain', 'personal']} definitions={projectTags} />)).toBe('');
    expect(renderToStaticMarkup(<TagColorIndicator tags={['engine']} definitions={projectTags} disabled />)).toContain('tabindex="-1"');
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

  it('does not add nested buttons or focus stops inside a card button', () => {
    const html = renderToStaticMarkup(<button type="button">
      <TagTitlePrefix tags={['engine', 'звук']} definitions={projectTags} />
      <CardTags tags={['engine', 'звук']} definitions={projectTags} compact />
    </button>);
    expect(html.match(/<button\b/gu)).toHaveLength(1);
    expect(html).not.toContain('tabindex');
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
