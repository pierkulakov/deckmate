import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../client/components/Markdown.tsx';
import { markdownParser } from '../src/markdown-model.ts';

vi.hoisted(() => { vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' }); });

function render(markdown: string) {
  return renderToStaticMarkup(<Markdown tree={markdownParser.parse(markdown)} rawMarkdown={markdown} source="sandbox" />);
}

it('preserves soft breaks inside paragraphs and separates blank-line paragraphs', () => {
  expect(render('First\nSecond')).toContain('<p>First\nSecond</p>');
  expect(render('First\n\nSecond')).toContain('<p>First</p><p>Second</p>');
  expect(render('Single line')).toContain('<p>Single line</p>');
  expect(render('First  \nSecond')).toContain('<p>First<br/>Second</p>');
});

it('keeps lists, code and tables structurally unchanged', () => {
  const html = render('Кол-во бойцов: 6\nУлучшения:\n- ППШ\n\n```\none\ntwo\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |');
  expect(html).toContain('<p>Кол-во бойцов: 6\nУлучшения:</p><ul><li><p>ППШ</p></li></ul>');
  expect(html).toContain('<pre><code>one\ntwo</code></pre>');
  expect(html).toContain('<th scope="col">A</th>');
  expect(html).toContain('<td>2</td>');
});
