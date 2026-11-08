import { parse } from 'yaml';
import type { ProjectTemplate, ProjectTemplateCategory, ProjectTemplateDeck, ProjectTemplateSample, ProjectTemplateSpace, SpaceKind } from './catalog-contracts.ts';
import { defaultLang, defineText, type Lang } from './i18n.ts';
import { validateProjectTag } from './project-tags.ts';

export const projectTemplateIcons = ['layers', 'code', 'palette', 'gamepad', 'audio', 'bug', 'book', 'image', 'tasks', 'users', 'box', 'activity', 'swords', 'flag'] as const;
export const projectTemplateRoles = ['design', 'art', 'animation', 'audio', 'code', 'qa', 'ui'] as const;
// 2026-11-07: the keys of skills/deckmate/genres/*.md; the starter templates reference them, and tests check that every file exists.
export const projectTemplateGenres = ['rts', 'tactics', 'shooter', '4x', 'rpg', 'platformer', 'action', 'adventure', 'puzzle', 'roguelike', 'simulation', 'sports', 'strategy', 'survival'] as const;
export const projectTemplateCategories = ['games', 'software'] as const satisfies readonly ProjectTemplateCategory[];
const spaceKinds: readonly SpaceKind[] = ['gdd', 'tasks', 'knowledge', 'qa', 'custom'];
const identifierPattern = /^[a-z0-9-]{1,40}$/u;
const colorPattern = /^#[0-9a-f]{6}$/iu;

const messages = defineText({
  header: 'A project template must start with YAML frontmatter between --- lines.',
  yaml: 'Invalid YAML in the project template. Check its indentation, values and duplicate keys.',
  object: (field: string) => `${field}: expected an object.`,
  schema: 'A project template requires deckmate: project-template and schema: 1.',
  text: (field: string, minimum: number, maximum: number) => `${field}: expected text of ${minimum}–${maximum} characters.`,
  identifier: (field: string) => `${field}: use 1–40 lowercase letters, digits or hyphens.`,
  choice: (field: string, choices: string) => `${field}: choose one of ${choices}.`,
  list: (field: string, minimum: number, maximum: number) => `${field}: expected a list of ${minimum}–${maximum} items.`,
  duplicate: (field: string, value: string) => `${field}: duplicate value “${value}”.`,
  reference: (field: string, value: string) => `${field}: unknown reference “${value}”.`,
  order: 'order: use an integer from 1 to 30.',
  color: (field: string) => `${field}: use a color in #RRGGBB format.`,
  roleDeck: (field: string) => `${field}: Journey roles belong to Task Decks in a Production (tasks) Space.`,
  assetDeck: (field: string) => `${field}: Journeys and example Cards require an Asset Deck.`,
  deckKind: (field: string) => `${field}: Production Decks must have the task kind.`,
}, {
  header: 'Шаблон проекта должен начинаться с YAML-шапки между строками ---.',
  yaml: 'Некорректный YAML в шаблоне проекта. Проверьте отступы, значения и повторяющиеся ключи.',
  object: (field: string) => `${field}: ожидается объект.`,
  schema: 'Шаблон проекта требует deckmate: project-template и schema: 1.',
  text: (field: string, minimum: number, maximum: number) => `${field}: ожидается текст длиной ${minimum}–${maximum} символов.`,
  identifier: (field: string) => `${field}: допустимы 1–40 строчных латинских букв, цифр или дефисов.`,
  choice: (field: string, choices: string) => `${field}: выберите одно из значений ${choices}.`,
  list: (field: string, minimum: number, maximum: number) => `${field}: ожидается список из ${minimum}–${maximum} элементов.`,
  duplicate: (field: string, value: string) => `${field}: повторяющееся значение «${value}».`,
  reference: (field: string, value: string) => `${field}: неизвестная ссылка «${value}».`,
  order: 'order: требуется целое число от 1 до 30.',
  color: (field: string) => `${field}: требуется цвет в формате #RRGGBB.`,
  roleDeck: (field: string) => `${field}: роли Journey принадлежат Task-колодам в пространстве Production (tasks).`,
  assetDeck: (field: string) => `${field}: Journey и примеры карточек требуют Asset-колоду.`,
  deckKind: (field: string) => `${field}: колоды Production должны иметь тип task.`,
});

class TemplateReader {
  private readonly text: typeof messages.en;

  constructor(lang: Lang) { this.text = messages[lang]; }

  object(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(this.text.object(field));
    return value as Record<string, unknown>;
  }

  string(value: unknown, field: string, maximum: number, minimum = 1, multiline = false): string {
    if (typeof value !== 'string' || value.trim().length < minimum || value.length > maximum
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
      || (!multiline && /[\r\n]/u.test(value))) throw new Error(this.text.text(field, minimum, maximum));
    return value.trim();
  }

  identifier(value: unknown, field: string): string {
    if (typeof value !== 'string' || !identifierPattern.test(value)) throw new Error(this.text.identifier(field));
    return value;
  }

  choice<T extends string>(value: unknown, field: string, choices: readonly T[]): T {
    if (typeof value !== 'string' || !choices.includes(value as T)) throw new Error(this.text.choice(field, choices.join(', ')));
    return value as T;
  }

  list(value: unknown, field: string, minimum = 0, maximum = 100): unknown[] {
    if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw new Error(this.text.list(field, minimum, maximum));
    return value;
  }

  unique(values: string[], field: string): void {
    const seen = new Set<string>();
    for (const value of values) {
      const normalized = value.toLowerCase();
      if (seen.has(normalized)) throw new Error(this.text.duplicate(field, value));
      seen.add(normalized);
    }
  }

  space(value: unknown, index: number): ProjectTemplateSpace {
    const field = `spaces[${index}]`;
    const space = this.object(value, field);
    return {
      id: this.identifier(space.id, `${field}.id`),
      title: this.string(space.title, `${field}.title`, 120),
      kind: this.choice(space.kind, `${field}.kind`, spaceKinds),
      ...(space.icon === undefined ? {} : { icon: this.choice(space.icon, `${field}.icon`, projectTemplateIcons) }),
    };
  }

  deck(value: unknown, index: number, spaces: ProjectTemplateSpace[]): ProjectTemplateDeck {
    const field = `decks[${index}]`;
    const metadata = this.object(value, field);
    const deck: ProjectTemplateDeck = {
      id: this.identifier(metadata.id, `${field}.id`),
      space: this.identifier(metadata.space, `${field}.space`),
      title: this.string(metadata.title, `${field}.title`, 120),
      kind: this.choice(metadata.kind, `${field}.kind`, ['asset', 'task', 'knowledge']),
      icon: this.choice(metadata.icon, `${field}.icon`, projectTemplateIcons),
      color: this.string(metadata.color, `${field}.color`, 7),
      description: this.string(metadata.description, `${field}.description`, 2000, 0),
    };
    if (!colorPattern.test(deck.color)) throw new Error(this.text.color(`${field}.color`));
    const space = spaces.find(candidate => candidate.id === deck.space);
    if (!space) throw new Error(this.text.reference(`${field}.space`, deck.space));
    if (space.kind === 'tasks' && deck.kind !== 'task') throw new Error(this.text.deckKind(`${field}.kind`));
    if (metadata.art !== undefined) deck.art = this.identifier(metadata.art, `${field}.art`);
    if (metadata.journey !== undefined) {
      if (deck.kind !== 'asset') throw new Error(this.text.assetDeck(`${field}.journey`));
      deck.journey = this.identifier(metadata.journey, `${field}.journey`);
    }
    if (metadata.roles !== undefined) {
      if (deck.kind !== 'task' || space.kind !== 'tasks') throw new Error(this.text.roleDeck(`${field}.roles`));
      deck.roles = this.list(metadata.roles, `${field}.roles`, 1, projectTemplateRoles.length)
        .map(role => this.choice(role, `${field}.roles`, projectTemplateRoles));
    }
    return deck;
  }

  sample(value: unknown, index: number, decks: ProjectTemplateDeck[]): ProjectTemplateSample {
    const field = `samples[${index}]`;
    const metadata = this.object(value, field);
    const sample = {
      deck: this.identifier(metadata.deck, `${field}.deck`),
      title: this.string(metadata.title, `${field}.title`, 300),
      markdown: this.string(metadata.markdown, `${field}.markdown`, 200000, 0, true),
    };
    const deck = decks.find(candidate => candidate.id === sample.deck);
    if (!deck) throw new Error(this.text.reference(`${field}.deck`, sample.deck));
    if (deck.kind !== 'asset') throw new Error(this.text.assetDeck(`${field}.deck`));
    return sample;
  }
}

/** 2026-11-05: disk references and their hashes are checked by the server; this parser only validates the file itself. */
export function parseProjectTemplate(markdown: string, fileHash = '', lang: Lang = defaultLang): ProjectTemplate {
  const text = messages[lang];
  const source = markdown.replace(/^\uFEFF/u, '');
  const frontmatter = /^---\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/mu.exec(source);
  if (!frontmatter || frontmatter.index !== 0) throw new Error(text.header);
  let parsed: unknown;
  try { parsed = parse(frontmatter[1]); } catch { throw new Error(text.yaml); }
  const reader = new TemplateReader(lang);
  const metadata = reader.object(parsed, 'frontmatter');
  if (metadata.deckmate !== 'project-template' || metadata.schema !== 1) throw new Error(text.schema);
  if (typeof metadata.order !== 'number' || !Number.isInteger(metadata.order) || metadata.order < 1 || metadata.order > 30) throw new Error(text.order);
  const spaces = reader.list(metadata.spaces, 'spaces', 1).map((space, index) => reader.space(space, index));
  reader.unique(spaces.map(space => space.id), 'spaces.id');
  reader.unique(spaces.map(space => space.title), 'spaces.title');
  const decks = reader.list(metadata.decks, 'decks', 1).map((deck, index) => reader.deck(deck, index, spaces));
  reader.unique(decks.map(deck => deck.id), 'decks.id');
  reader.unique(decks.map(deck => deck.title), 'decks.title');
  reader.unique(decks.flatMap(deck => deck.roles ?? []), 'decks.roles');
  const tags = reader.list(metadata.tags, 'tags').map(tag => validateProjectTag(tag, lang));
  reader.unique(tags.map(tag => tag.name), 'tags.name');
  const samples = reader.list(metadata.samples, 'samples', 2, 3).map((sample, index) => reader.sample(sample, index, decks));
  reader.unique(samples.map(sample => `${sample.deck}/${sample.title}`), 'samples');
  return {
    id: reader.identifier(metadata.id, 'id'),
    title: reader.string(metadata.title, 'title', 120),
    description: reader.string(metadata.description, 'description', 120),
    category: metadata.category === undefined ? 'games' : reader.choice(metadata.category, 'category', projectTemplateCategories),
    genre: metadata.genre === null ? null : reader.choice(metadata.genre, 'genre', projectTemplateGenres),
    order: metadata.order, spaces, decks, tags, samples,
    details: reader.string(source.slice(frontmatter[0].length).trim(), 'details', 600, 0, true),
    fileHash,
  };
}
