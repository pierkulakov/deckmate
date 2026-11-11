import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../client/components/Markdown.tsx';
import { markdownParser } from '../src/markdown-model.ts';

vi.hoisted(() => { vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' }); });

it('exposes real column headers and preserves GFM column alignment', () => {
  const markdown = '| Name | Estimate |\n| :--- | ---: |\n| Ferry | 0 |';
  const html = renderToStaticMarkup(<Markdown tree={markdownParser.parse(markdown)} source="sandbox" />);
  expect(html).toContain('<thead>');
  expect(html).toContain('<th scope="col" style="text-align:left">Name</th>');
  expect(html).toContain('<th scope="col" style="text-align:right">Estimate</th>');
  expect(html).toContain('<td style="text-align:right">0</td>');
  expect(html).toContain('tabindex="0"');
});
