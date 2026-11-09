import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

type Section = { version: string; date: string; lines: string[] };
class Node {
  children: Node[] = [];
  textContent = '';
  className = '';
  href = '';
  dateTime = '';
  constructor(public tag: string) {}
  append(...nodes: Node[]) { this.children.push(...nodes); }
}
const documentShim = {
  createElement: (tag: string) => new Node(tag),
  createTextNode: (text: string) => { const node = new Node('#text'); node.textContent = text; return node; },
};
const context = { URL } as { URL: typeof URL; DeckmateWhatsNew?: { parseChangelog: (text: string) => Section[]; pickSections: (sections: Section[], from: string | null, to: string) => Section[]; renderSection: (section: Section, doc: typeof documentShim) => Node } };
runInNewContext(readFileSync('desktop/launcher/whats-new.js', 'utf8'), context);
const { parseChangelog, pickSections, renderSection } = context.DeckmateWhatsNew!;
const versions = (sections: Section[]) => Array.from(sections, section => section.version);

describe('What’s new changelog', () => {
  const markdown = '# Changelog\n## [Unreleased]\n- draft\n## [1.2.0] - 2026-11-09\n### Added\n- **Title.** Text\n## [1.10.0] - 2026-11-10\n### Fixed\n- Fix\n## [1.5.0-rc.1] - 2026-11-09\n- prerelease\n## [2.0.0] - 2026-11-11\n- future';
  const sections = parseChangelog(markdown);
  it('parses release headings, dates and body without merging sections', () => {
    expect(versions(sections)).toEqual(['Unreleased', '1.2.0', '1.10.0', '1.5.0-rc.1', '2.0.0']);
    expect(sections[1].date).toBe('2026-11-09');
    expect(Array.from(sections[1].lines)).toEqual(['### Added', '- **Title.** Text']);
  });
  it('selects stable SemVer releases in descending order and excludes bounds appropriately', () => {
    expect(versions(pickSections(sections, '1.0.0', '1.10.0'))).toEqual(['1.10.0', '1.2.0']);
    expect(versions(pickSections(sections, '1.2.0', '1.10.0'))).toEqual(['1.10.0']);
    expect(versions(pickSections(sections, null, '1.2.0'))).toEqual(['1.2.0']);
    expect(versions(pickSections(sections, null, '1.3.0'))).toEqual([]);
    expect(versions(pickSections(sections, 'unknown', '1.10.0'))).toEqual([]);
    expect(versions(pickSections(sections, null, '1.5.0-rc.1'))).toEqual([]);
  });
  it('renders HTML as text and rejects unsafe links', () => {
    const section = parseChangelog('## [1.0.0] - 2026-01-01\n### <img src=x>\n- **Hello** <script>alert(1)</script> [bad](javascript:alert) [good](https://example.com) `code`')[0];
    const node = renderSection(section, documentShim);
    const flatten = (n: Node): Node[] => [n, ...n.children.flatMap(flatten)];
    const nodes = flatten(node);
    expect(nodes.some(n => n.tag === 'img' || n.tag === 'script')).toBe(false);
    expect(nodes.map(n => n.textContent).join('')).toContain('<script>alert(1)</script>');
    expect(nodes.filter(n => n.tag === 'a').map(n => n.href)).toEqual(['https://example.com']);
    expect(nodes.some(n => n.tag === 'strong' && n.textContent === 'Hello')).toBe(true);
  });
});
