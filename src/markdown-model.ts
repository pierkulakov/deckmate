import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';

export const markdownParser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ['yaml']);

export function markdownModel(markdown: string): string {
  return JSON.stringify(markdownParser.parse(markdown), (key, value: unknown) => key === 'position' ? undefined : value);
}
