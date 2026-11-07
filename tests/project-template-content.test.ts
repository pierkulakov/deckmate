import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProjectTemplate } from '../src/project-templates.ts';
import { listProjectTemplates } from '../server/project-templates.ts';
import type { CatalogJourneyTemplate, ProjectTemplate } from '../src/catalog-contracts.ts';
import { readJourneyTemplates } from '../server/journey-templates.ts';

const repository = fileURLToPath(new URL('../', import.meta.url));
const projectDirectory = path.join(repository, 'assets/project-templates');
const journeyDirectory = path.join(repository, 'assets/journey-templates');
const genres = ['Action', 'Adventure', 'Platformer', 'Puzzle', 'Roguelike', 'RPG', 'Simulation', 'Sports', 'Strategy', 'Survival'];
const genreIds = genres.map(title => title.toLowerCase());
// 2026-11-05: the software shelf of the template picker; games stay 1–10, software 11–18.
const softwareTemplates = [
  ['pet-project', 'Pet Project'], ['web-app', 'Web App'], ['mobile-app', 'Mobile App'], ['open-source-library', 'Open-Source Library'],
  ['cli-tool', 'CLI Tool'], ['internal-tool', 'Internal Tool'], ['backend-service', 'Backend Service'], ['data-ml', 'Data / ML'],
] as const;
const softwareIds = softwareTemplates.map(([id]) => id);
const icons = ['layers', 'code', 'palette', 'gamepad', 'audio', 'bug', 'book', 'image', 'tasks', 'users', 'box', 'activity', 'swords', 'flag'];
const roles = ['design', 'art', 'animation', 'audio', 'code', 'qa', 'ui'];
const profiles = [null, 'rts', 'tactics', 'shooter', '4x', 'rpg', 'platformer', 'action', 'adventure', 'puzzle', 'roguelike', 'simulation', 'sports', 'survival', 'strategy'];
const identifier = /^[a-z0-9-]{1,40}$/u;
const color = /^#[0-9a-f]{6}$/u;
const productionDecks = ['Coding', 'Art', 'Game Design', 'Audio', 'Bugs & QA'];

function unique(values: string[], context: string): void {
  expect(new Set(values).size, context).toBe(values.length);
}

function textValue(value: unknown, context: string, maximum?: number): void {
  expect(value, context).toBeTypeOf('string');
  const text = value as string;
  expect(text.trim().length, context).toBeGreaterThan(0);
  expect(text, `${context}: English content`).not.toMatch(/\p{Script=Cyrillic}/u);
  if (maximum !== undefined) expect(text.length, context).toBeLessThanOrEqual(maximum);
}

function hasGenrePrefix(value: string): boolean {
  return genreIds.some(genre => value.startsWith(`${genre}-`));
}

let templates: ProjectTemplate[];
let journeys: Map<string, CatalogJourneyTemplate>;
let journeyWarnings: string[];

beforeAll(async () => {
  templates = await listProjectTemplates({ templatesRoot: projectDirectory, journeysRoot: journeyDirectory });
  const catalog = await readJourneyTemplates(journeyDirectory, repository);
  journeys = new Map(catalog.templates.filter(template => template.source === 'bundled').map(template => [template.id, template]));
  journeyWarnings = catalog.warnings.filter(warning => genreIds.some(genre => warning.startsWith(`assets/journey-templates/${genre}-`)));
});

it('ships ten game and eight software files in picker order and publishes every referenced Journey', async () => {
  expect((await readdir(projectDirectory)).sort()).toEqual([...genreIds, ...softwareIds].map(id => `${id}.md`).sort());
  expect(templates.map(template => template.id)).toEqual([...genreIds, ...softwareIds]);
  expect(templates.map(template => template.title)).toEqual([...genres, ...softwareTemplates.map(([, title]) => title)]);
  expect(templates.map(template => template.order)).toEqual([...genreIds, ...softwareIds].map((_, index) => index + 1));
  expect(templates.map(template => template.category))
    .toEqual([...genreIds.map(() => 'games' as const), ...softwareIds.map(() => 'software' as const)]);
  expect(journeyWarnings).toEqual([]);
  const referenced = templates.flatMap(template => template.decks.flatMap(deck => deck.journey ? [deck.journey] : []));
  // Shared Journeys (bug-fix, ui-screen) may serve several templates; within one template each is used once.
  for (const template of templates) {
    unique(template.decks.flatMap(deck => deck.journey ? [deck.journey] : []), `${template.id}: one Journey per asset deck`);
  }
  const published = (await readdir(journeyDirectory, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && hasGenrePrefix(entry.name)).map(entry => entry.name);
  expect(published.sort()).toEqual(referenced.filter(hasGenrePrefix).sort());
  for (const journeyId of referenced) expect(journeys.has(journeyId), journeyId).toBe(true);
});

describe.each(genreIds)('%s project content', genreId => {
  it('has valid metadata, spaces, decks, role destinations, artwork, tags and examples', async () => {
    const template = templates.find(candidate => candidate.id === genreId)!;
    const bytes = await readFile(path.join(projectDirectory, `${genreId}.md`));
    const parsed = parseProjectTemplate(new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      createHash('sha256').update(bytes).digest('hex'));
    expect(parsed).toEqual(template);
    expect(template.id).toMatch(identifier);
    expect(profiles).toContain(template.genre);
    if (template.genre !== null) expect((await stat(path.join(repository, 'skills/deckmate/genres', `${template.genre}.md`))).isFile()).toBe(true);
    textValue(template.description, `${genreId} description`, 120);
    expect(template.description).not.toMatch(/[\r\n]/u);
    textValue(template.details, `${genreId} picker body`, 600);

    expect(template.spaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'gdd', title: 'Game Design Documents (GDD)', kind: 'gdd' }),
      expect.objectContaining({ id: 'production', title: 'Production', kind: 'tasks' }),
    ]));
    unique(template.spaces.map(space => space.id), `${genreId} space IDs`);
    unique(template.spaces.map(space => space.title.toLowerCase()), `${genreId} space titles`);
    for (const space of template.spaces) {
      expect(space.id).toMatch(identifier);
      textValue(space.title, `${genreId} space title`);
      expect(['gdd', 'tasks', 'knowledge', 'qa', 'custom']).toContain(space.kind);
      if (space.icon !== undefined) expect(icons).toContain(space.icon);
    }

    unique(template.decks.map(deck => deck.id), `${genreId} deck IDs`);
    unique(template.decks.map(deck => deck.title.toLowerCase()), `${genreId} deck titles`);
    const assignedRoles = template.decks.flatMap(deck => deck.roles ?? []);
    unique(assignedRoles, `${genreId} unambiguous Production roles`);
    for (const deck of template.decks) {
      expect(deck.id).toMatch(identifier);
      expect(template.spaces.some(space => space.id === deck.space), `${deck.id} space`).toBe(true);
      textValue(deck.title, `${deck.id} title`);
      textValue(deck.description, `${deck.id} description`);
      expect(['asset', 'task', 'knowledge']).toContain(deck.kind);
      expect(icons, `${deck.id} icon`).toContain(deck.icon);
      expect(deck.color, `${deck.id} color`).toMatch(color);
      if (deck.art !== undefined) {
        expect(deck.art).toMatch(identifier);
        expect((await stat(path.join(repository, 'assets/deck-art', `${deck.art}.webp`))).isFile(), `${deck.id} art`).toBe(true);
      }
      if (deck.space === 'production') expect(deck.kind).toBe('task');
      if (deck.kind === 'asset') expect(deck.space).toBe('gdd');
      if (deck.title === 'Design Notes') expect(deck.kind).toBe('knowledge');
      for (const role of deck.roles ?? []) {
        expect(roles).toContain(role);
        expect(deck.space).toBe('production');
        expect(deck.kind).toBe('task');
      }
      if (deck.journey !== undefined) {
        expect(deck.kind).toBe('asset');
        expect(deck.journey).toMatch(identifier);
        expect(deck.journey.startsWith(`${genreId}-`)).toBe(true);
        const journey = journeys.get(deck.journey);
        expect(journey, `${deck.id} Journey`).toBeDefined();
        for (const role of journey!.roles) {
          expect(roles).toContain(role.id);
          expect(template.decks.filter(destination => destination.roles?.includes(role.id)), `${deck.journey}: ${role.id}`).toHaveLength(1);
        }
      }
    }
    const production = template.decks.filter(deck => deck.space === 'production').map(deck => deck.title);
    expect(production).toEqual(expect.arrayContaining(productionDecks));
    expect(production.every(title => [...productionDecks, 'Animation', 'UI'].includes(title))).toBe(true);
    expect(template.tags.some(tag => tag.name === 'bug')).toBe(true);
    unique(template.tags.map(tag => tag.name.toLowerCase()), `${genreId} tag names`);
    for (const tag of template.tags) {
      textValue(tag.name, `${genreId} tag`);
      expect(tag.color).toMatch(color);
      if (tag.emoji !== undefined) textValue(tag.emoji, `${genreId} tag emoji`);
    }
    expect(template.samples.length).toBeGreaterThanOrEqual(2);
    expect(template.samples.length).toBeLessThanOrEqual(3);
    unique(template.samples.map(sample => sample.title.toLowerCase()), `${genreId} sample titles`);
    for (const sample of template.samples) {
      expect(template.decks.find(deck => deck.id === sample.deck)?.kind, `${sample.title} deck`).toBe('asset');
      textValue(sample.title, `${genreId} sample title`);
      textValue(sample.markdown, `${genreId} sample body`);
    }
  });

  it('loads complete Journey instructions with valid dependencies, Effort and checklists', async () => {
    const template = templates.find(candidate => candidate.id === genreId)!;
    const journeyDecks = template.decks.filter(deck => deck.journey !== undefined);
    if (!['strategy', 'roguelike'].includes(genreId)) {
      const assets = template.decks.filter(deck => deck.kind === 'asset');
      expect(assets.length).toBeGreaterThanOrEqual(4);
      expect(assets.length).toBeLessThanOrEqual(6);
      expect(journeyDecks.length).toBeGreaterThanOrEqual(2);
      expect(journeyDecks.length).toBeLessThanOrEqual(4);
    }
    for (const deck of journeyDecks) {
      const journey = journeys.get(deck.journey!)!;
      const directory = path.join(journeyDirectory, journey.id);
      expect(journey.steps.map(step => `${step.id}.md`).sort())
        .toEqual((await readdir(path.join(directory, 'steps'))).sort());
      expect(journey.steps.length).toBeGreaterThanOrEqual(3);
      expect(journey.steps.length).toBeLessThanOrEqual(6);
      unique(journey.steps.map(step => step.id), `${journey.id} step IDs`);
      unique(journey.roles.map(role => role.id), `${journey.id} role IDs`);
      textValue(journey.title, `${journey.id} title`);
      expect(journey.title).toBe(`${template.title}: ${deck.title}`);
      textValue(journey.description, `${journey.id} description`);
      expect(journey.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      for (const role of journey.roles) textValue(role.title, `${journey.id} role title`);
      for (const zone of journey.zones) textValue(zone.title, `${journey.id} zone title`);
      for (const step of journey.steps) {
        expect(step.id).toMatch(identifier);
        textValue(step.title, `${journey.id}/${step.id} title`);
        if (['action', 'adventure', 'platformer', 'puzzle'].includes(genreId)) expect(step.title).toMatch(/: %PARENT_TITLE%$/u);
        textValue(step.markdown, `${journey.id}/${step.id} body`);
        expect([1, 2, 3, 5, 8], `${journey.id}/${step.id} Effort`).toContain(step.effort);
        expect(journey.roles.map(role => role.id)).toContain(step.roleId);
        unique(step.dependsOn, `${journey.id}/${step.id} dependencies`);
        expect(step.dependsOn).not.toContain(step.id);
        for (const dependency of step.dependsOn) expect(journey.steps.some(candidate => candidate.id === dependency)).toBe(true);
        const checklist = step.markdown.match(/^- \[ \] .+$/gmu) ?? [];
        expect(checklist.length, `${journey.id}/${step.id} checklist`).toBeGreaterThanOrEqual(2);
        expect(checklist.length, `${journey.id}/${step.id} checklist`).toBeLessThanOrEqual(4);
        expect(step.markdown.trim().split(/\r?\n/u)[0]).not.toMatch(/^- \[/u);
      }
      // The production loader also rejects dependency cycles and unknown step zones.
      expect(journeyWarnings.filter(warning => warning.includes(`/${journey.id}/`))).toEqual([]);
    }
  });
});

describe.each(softwareIds)('%s software template content', softwareId => {
  it('has valid metadata, spaces, decks, role destinations, artwork, tags and examples', async () => {
    const template = templates.find(candidate => candidate.id === softwareId)!;
    const bytes = await readFile(path.join(projectDirectory, `${softwareId}.md`));
    const parsed = parseProjectTemplate(new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      createHash('sha256').update(bytes).digest('hex'));
    expect(parsed).toEqual(template);
    expect(template.id).toMatch(identifier);
    expect(template.category).toBe('software');
    expect(template.genre).toBeNull();
    textValue(template.description, `${softwareId} description`, 120);
    expect(template.description).not.toMatch(/[\r\n]/u);
    textValue(template.details, `${softwareId} picker body`, 600);

    expect(template.spaces.length).toBeGreaterThanOrEqual(2);
    expect(template.spaces.length).toBeLessThanOrEqual(3);
    expect(['gdd', 'knowledge']).toContain(template.spaces[0].kind);
    const production = template.spaces.find(space => space.kind === 'tasks');
    expect(production, `${softwareId} tasks space`).toBeDefined();
    unique(template.spaces.map(space => space.id), `${softwareId} space IDs`);
    unique(template.spaces.map(space => space.title.toLowerCase()), `${softwareId} space titles`);
    for (const space of template.spaces) {
      expect(space.id).toMatch(identifier);
      textValue(space.title, `${softwareId} space title`);
      if (space.icon !== undefined) expect(icons).toContain(space.icon);
    }

    expect(template.decks.length).toBeGreaterThanOrEqual(3);
    expect(template.decks.length).toBeLessThanOrEqual(6);
    expect(template.decks.filter(deck => deck.kind === 'asset').length).toBeGreaterThanOrEqual(2);
    unique(template.decks.map(deck => deck.id), `${softwareId} deck IDs`);
    unique(template.decks.map(deck => deck.title.toLowerCase()), `${softwareId} deck titles`);
    unique(template.decks.flatMap(deck => deck.roles ?? []), `${softwareId} unambiguous Production roles`);
    for (const deck of template.decks) {
      expect(deck.id).toMatch(identifier);
      expect(template.spaces.some(space => space.id === deck.space), `${deck.id} space`).toBe(true);
      textValue(deck.title, `${deck.id} title`);
      textValue(deck.description, `${deck.id} description`);
      expect(['asset', 'task', 'knowledge']).toContain(deck.kind);
      expect(icons, `${deck.id} icon`).toContain(deck.icon);
      expect(deck.color, `${deck.id} color`).toMatch(color);
      expect(deck.art, `${deck.id} artwork`).toMatch(identifier);
      expect((await stat(path.join(repository, 'assets/deck-art', `${deck.art}.webp`))).isFile(), `${deck.id} art`).toBe(true);
      if (deck.space === production!.id) expect(deck.kind).toBe('task');
      for (const role of deck.roles ?? []) {
        expect(roles).toContain(role);
        expect(deck.space).toBe(production!.id);
        expect(deck.kind).toBe('task');
      }
      if (deck.journey !== undefined) {
        expect(deck.kind).toBe('asset');
        expect(deck.journey).toMatch(identifier);
        const journey = journeys.get(deck.journey);
        expect(journey, `${deck.id} Journey`).toBeDefined();
        for (const role of journey!.roles) {
          expect(roles).toContain(role.id);
          expect(template.decks.filter(destination => destination.roles?.includes(role.id)), `${deck.journey}: ${role.id}`).toHaveLength(1);
        }
      }
    }

    expect(template.tags.length).toBeGreaterThanOrEqual(3);
    expect(template.tags.length).toBeLessThanOrEqual(6);
    unique(template.tags.map(tag => tag.name.toLowerCase()), `${softwareId} tag names`);
    for (const tag of template.tags) {
      textValue(tag.name, `${softwareId} tag`);
      expect(tag.color).toMatch(color);
      if (tag.emoji !== undefined) textValue(tag.emoji, `${softwareId} tag emoji`);
    }

    expect(template.samples.length).toBeGreaterThanOrEqual(2);
    expect(template.samples.length).toBeLessThanOrEqual(3);
    unique(template.samples.map(sample => sample.title.toLowerCase()), `${softwareId} sample titles`);
    for (const sample of template.samples) {
      expect(template.decks.find(deck => deck.id === sample.deck)?.kind, `${sample.title} deck`).toBe('asset');
      textValue(sample.title, `${softwareId} sample title`);
      textValue(sample.markdown, `${softwareId} sample body`);
    }
  });
});

const observedDecks = {
  strategy: { gdd: ['Units', 'Buildings', 'Technologies', 'Maps', 'Design Notes'], production: ['Coding', 'Bugs & QA', 'Art', 'Audio', 'Game Design'] },
  roguelike: { gdd: ['Characters', 'Items & Power-ups', 'Enemies', 'Room Types', 'Meta-Progression', 'Design Notes'], production: ['Coding', 'Art', 'Game Design', 'Audio', 'Bugs & QA'] },
};

it.each(['strategy', 'roguelike'] as const)('%s preserves the observed deck structure without personal additions', genreId => {
  const template = templates.find(candidate => candidate.id === genreId)!;
  expect(template.spaces.map(space => space.id)).toEqual(['gdd', 'production']);
  for (const space of ['gdd', 'production'] as const) {
    expect(template.decks.filter(deck => deck.space === space).map(deck => deck.title)).toEqual(observedDecks[genreId][space]);
  }
  expect(template.decks.filter(deck => deck.journey !== undefined)).toHaveLength(3);
  for (const title of ['Characters', 'Meta-Progression', 'Maps', 'Design Notes']) {
    expect(template.decks.find(deck => deck.title === title)?.journey).toBeUndefined();
  }
  if (genreId === 'strategy') expect(template.genre).toBe('rts');
});

const observedJourneys: Array<{ genre: string; deck: string; steps: Array<[string, number]> }> = [
  { genre: 'strategy', deck: 'Units', steps: [['Create Unit 3D Model', 5], ['Animate Unit', 5], ['Implement Unit Logic', 8], ['Design Unit SFX', 2], ['Balance Unit Stats', 3]] },
  { genre: 'strategy', deck: 'Buildings', steps: [['Create Building 3D Model', 8], ['Implement Building Logic', 8], ['Design Building SFX', 2], ['Balance Building Cost & Output', 3]] },
  { genre: 'strategy', deck: 'Technologies', steps: [['Create Tech Icon', 1], ['Implement Tech Effect', 3], ['Balance Tech Cost & Effect', 2]] },
  { genre: 'roguelike', deck: 'Enemies', steps: [['Balance Enemy Stats', 3], ['Create Enemy Sprite/Model', 5], ['Implement Enemy AI', 8], ['Design Enemy SFX', 2]] },
  { genre: 'roguelike', deck: 'Items & Power-ups', steps: [['Create Item VFX', 3], ['Design Item SFX', 2], ['Design', 2], ['Implement Item Effect Logic', 5], ['Balance Item Power Level', 2]] },
  { genre: 'roguelike', deck: 'Room Types', steps: [['Design Room Layout', 3], ['Build Room Template', 5], ['Create Room Art Assets', 5], ['Add Room Ambiance', 2]] },
];

it.each(observedJourneys)('$genre / $deck preserves every observed step title and Effort in order', observed => {
  const template = templates.find(candidate => candidate.id === observed.genre)!;
  const deck = template.decks.find(candidate => candidate.title === observed.deck)!;
  const journey = journeys.get(deck.journey!)!;
  expect(journey.steps.map(step => [step.title, step.effort])).toEqual(observed.steps);
});

it('uses canonical Production decks and American spelling throughout the bundled templates', () => {
  const canonical = new Map<string, ProjectTemplate['decks'][number]>();
  for (const template of templates) {
    expect(JSON.stringify(template)).not.toMatch(/behaviour|neighbour|cancelled|\btradeoffs?\b/u);
    for (const deck of template.decks.filter(candidate => candidate.space === 'production')) {
      if (!canonical.has(deck.id)) canonical.set(deck.id, deck);
      expect(deck, `${template.id}: ${deck.id}`).toEqual(canonical.get(deck.id));
    }
    const notes = template.decks.find(deck => deck.title === 'Design Notes');
    if (notes) expect(template.decks.find(deck => deck.title === 'Bugs & QA')!.color).not.toBe(notes.color);
    for (const deck of template.decks.filter(candidate => candidate.journey)) {
      expect(JSON.stringify(journeys.get(deck.journey!))).not.toMatch(/behaviour|neighbour|cancelled|\btradeoffs?\b/u);
    }
  }
  // Seven game decks plus the four shared software decks: engineering, design, interface, quality.
  expect(canonical.size).toBe(11);
  const items = journeys.get('roguelike-items-power-ups')!;
  items.steps.forEach((step, index) => {
    for (const dependency of step.dependsOn) expect(items.steps.findIndex(candidate => candidate.id === dependency)).toBeLessThan(index);
  });
});
