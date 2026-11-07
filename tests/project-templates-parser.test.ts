import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseProjectTemplate } from '../src/project-templates.ts';

const fixture = await readFile(new URL('./fixtures/project-templates/fixture.md', import.meta.url), 'utf8');

describe('project template format', () => {
  it('reads a complete template and preserves its supplied hash', () => {
    const template = parseProjectTemplate(`\uFEFF${fixture.replaceAll('\n', '\r\n')}`, 'source-hash');
    expect(template).toMatchObject({ id: 'fixture', genre: 'rts', fileHash: 'source-hash', order: 1 });
    expect(template.spaces).toHaveLength(2);
    expect(template.decks[0]).toMatchObject({ id: 'units', kind: 'asset', journey: 'fixture-units', art: 'units' });
    expect(template.decks[1].roles).toEqual(['code']);
    expect(template.tags[0]).toMatchObject({ name: 'bug', emoji: '🐞' });
    expect(template.samples.map(sample => sample.title)).toEqual(['Footman', 'Archer']);
    expect(template.details).toBe('Create a small unit roster and its implementation work.');
  });

  it.each([
    ['schema', 'schema: 1', 'schema: 2'],
    ['id', 'id: fixture\n', 'id: ../fixture\n'],
    ['order', 'order: 1', 'order: 31'],
    ['genre', 'genre: rts', 'genre: unknown'],
    ['description', 'description: A small project template for catalog integration tests.', `description: ${'x'.repeat(121)}`],
    ['icon', 'icon: swords', 'icon: unknown'],
    ['color', "color: '#5e7bd6'", "color: '#bad'"],
    ['art', 'art: units', 'art: ../units'],
    ['journey', 'journey: fixture-units', 'journey: ../fixture-units'],
    ['space', 'space: gdd', 'space: missing'],
    ['roles', 'roles: [code]', 'roles: [unknown]'],
    ['roles', 'roles: [code]', 'roles: [code, code]'],
    ['samples', 'deck: units, title: Footman', 'deck: missing, title: Footman'],
    ['samples', 'deck: units, title: Footman', 'deck: coding, title: Footman'],
    ['decks.title', 'title: Coding', 'title: units'],
    ['spaces.title', 'title: Production', 'title: Game Design Documents (GDD)'],
    ['samples', 'title: Archer', 'title: Footman'],
  ])('rejects invalid %s', (_field, from, to) => {
    expect(() => parseProjectTemplate(fixture.replace(from, to))).toThrow();
  });

  it('defaults category to games and accepts only the known categories', () => {
    expect(parseProjectTemplate(fixture).category).toBe('games');
    expect(parseProjectTemplate(fixture.replace('genre: rts', 'genre: rts\ncategory: software')).category).toBe('software');
    expect(() => parseProjectTemplate(fixture.replace('genre: rts', 'genre: rts\ncategory: boardgames'))).toThrow('category');
  });

  it('rejects duplicate YAML keys and oversized details with localized explanations', () => {
    const duplicate = fixture.replace('schema: 1', 'schema: 1\nschema: 1');
    expect(() => parseProjectTemplate(duplicate)).toThrow('Invalid YAML');
    expect(() => parseProjectTemplate(duplicate, '', 'ru')).toThrow('Некорректный YAML');
    expect(() => parseProjectTemplate(`${fixture}${'x'.repeat(601)}`)).toThrow('details');
    expect(() => parseProjectTemplate('No frontmatter', '', 'ru')).toThrow('YAML-шапки');
  });

  it('requires unambiguous Production roles and Asset examples', () => {
    expect(() => parseProjectTemplate(fixture.replace('kind: tasks', 'kind: custom'))).toThrow('Production');
    expect(() => parseProjectTemplate(fixture.replace('roles: [code]', 'journey: fixture-units'))).toThrow('Asset Deck');
    expect(() => parseProjectTemplate(fixture.replace('kind: asset', 'kind: task'), '', 'ru')).toThrow('Asset-колоду');
  });
});
