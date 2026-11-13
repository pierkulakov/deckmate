// 2026-11-12: read-only board-layout heuristics shared by MCP and `deckmate project organize`.
import type { AgentOrganizeInput, AgentOrganizeIssue, AgentOrganizeOutput, AgentOrganizePlacementOutput, AgentReadPointer } from '../src/agent-tools.ts';
import type { CatalogCard, CatalogDeck, CatalogView } from '../src/catalog-contracts.ts';
import { shortReference } from '../src/references.ts';
import { sourceLineRange } from './agent-brief.ts';
import { readProjectMarkdown } from './native-cards.ts';
import { resolveDataPath } from './data-paths.ts';
import type { AgentProject } from './agent-ops.ts';

type EntityArea = 'units' | 'weapons' | 'props' | 'mechanics' | 'tools';
type Discipline = 'animation' | 'art' | 'design' | 'engineering' | 'audio' | 'qa' | 'production';
type Area = EntityArea | Discipline;

const areaWords: Record<Area, RegExp> = {
  animation: /\b(?:animations?|animating|animate|rigs?|rigging|walk cycles?)\b|анимац|анимир|ригг/iu,
  art: /\b(?:art|models?|modelling|textures?|paint(?:ing)?|materials?)\b|модел|текстур|материал|худож|нарис|рисова/iu,
  design: /\b(?:designs?|designing|concepts?)\b|дизайн|концепт|проектир/iu,
  engineering: /\b(?:engineering|code|coding|implements?|implementing|scripts?|programming)\b|код|программ|реализ/iu,
  audio: /\b(?:audio|sound|music|recording|record)\b|звук|музык|озвуч/iu,
  qa: /\b(?:qa|tests?|testing|playtests?|validation)\b|тест|провер/iu,
  production: /\b(?:production|integration|integrate|polish|build)\b|продакш|интегр|полиров|подключ|собра/iu,
  units: /\b(?:units?|characters?|enemies|npcs?|monsters?|goblins?)\b|юнит|персонаж|враг|монстр|гоблин/iu,
  weapons: /\b(?:weapons?|swords?|bows?|guns?|axes?)\b|оруж|меч|лук|топор/iu,
  props: /\b(?:props?|trees?|fences?|walls?|rocks?|map objects?|world)\b|дерев|забор|стен|объект(?:ы|ов)? карты|реквизит/iu,
  mechanics: /\b(?:mechanics?|movement|jumping|systems?)\b|механик|передвиж|прыж/iu,
  tools: /\b(?:tools?|editors?|placement|validators?)\b|инструмент|редактор|расстанов/iu,
};
const disciplines = new Set<Area>(['animation', 'art', 'design', 'engineering', 'audio', 'qa', 'production']);
const areaOrder = Object.keys(areaWords) as Area[];
const entityAreas: EntityArea[] = ['tools', 'units', 'weapons', 'props', 'mechanics'];
const auditRowLimit = 40;

function areaOf(text: string): Area | null {
  return areaOrder.find(area => areaWords[area].test(text)) ?? null;
}

function isDiscipline(area: Area | null): area is Discipline {
  return area !== null && disciplines.has(area);
}

function entityArea(text: string): EntityArea | null {
  return entityAreas.find(area => areaWords[area].test(text)) ?? null;
}

function storesRules(markdown: string): boolean {
  let progressLevel: number | null = null;
  for (const line of markdown.split(/\r?\n/u)) {
    const heading = /^(#{2,6})\s+(.+)$/u.exec(line);
    if (!heading) continue;
    const level = heading[1].length;
    if (progressLevel !== null && level <= progressLevel) progressLevel = null;
    if (/^(?:already works|уже работает)(?=\s|:|$)/iu.test(heading[2])) progressLevel = level;
    if (progressLevel === null && /^(?:rules?|how it works|mechanics?|правила|как работает|механика)(?=\s|:|$)/iu.test(heading[2])) return true;
  }
  return false;
}

function heroTitle(catalog: CatalogView, card: CatalogCard): string {
  const hero = catalog.cards.find(candidate => candidate.id === card.parentId && candidate.kind === 'hero');
  return hero ? `${hero.title} (${shortReference('c', hero.id)})` : '—';
}

function issue(card: string, deck: string, hero: string, reason: string, at: AgentReadPointer): AgentOrganizeIssue {
  return { card, deck, hero, reason, at };
}

async function cardPointer(root: string, card: CatalogCard): Promise<AgentReadPointer> {
  const bytes = await readProjectMarkdown(root, card.path);
  const range = sourceLineRange(bytes, card.range ?? { start: 0, end: bytes.length });
  return `${card.path}:${range.from}-${range.to}`;
}

function manifestPointer(manifestPath: string, bytes: Buffer, deck: CatalogDeck): AgentReadPointer {
  const lines = bytes.toString('utf8').split(/\r?\n/u);
  const id = deck.id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const pattern = new RegExp(`^\\s*(?:-\\s*)?id:\\s*(?:${id}|"${id}"|'${id}')\\s*(?:#.*)?$`, 'u');
  const found = lines.findIndex(line => pattern.test(line));
  const line = found < 0 ? 1 : found + 1;
  return `${manifestPath}:${line}-${line}`;
}

interface Finding { card: CatalogCard | null; deck: CatalogDeck; reason: string }

function findings(catalog: CatalogView): Finding[] {
  const found: Finding[] = [];
  // 2026-11-12: equal titles in different spaces are not duplicates; the name check is scoped to one space.
  const names = new Map<string, CatalogDeck[]>();
  for (const deck of catalog.decks) {
    const key = JSON.stringify([deck.spaceId, deck.title.trim().toLocaleLowerCase('ru-RU')]);
    names.set(key, [...names.get(key) ?? [], deck]);
  }
  for (const decks of names.values()) {
    for (const deck of decks.slice(1)) {
      found.push({ card: null, deck, reason: 'Duplicate deck name in one space; check the same name and reuse one deck before creating another.' });
    }
  }
  for (const card of catalog.cards) {
    const deck = catalog.decks.find(candidate => candidate.id === card.deckId);
    if (!deck) continue;
    const deckArea = entityArea(deck.title);
    if (card.kind === 'hero') {
      const cardArea = entityArea(card.title);
      if (deckArea && cardArea && deckArea !== cardArea) {
        const reason = deckArea === 'tools'
          ? 'Game content is not part of the tool that places it; move the Hero to its entity-area deck.'
          : `The Hero belongs to ${cardArea}, not this ${deckArea} entity-area deck.`;
        found.push({ card, deck, reason });
      }
      if (storesRules(card.markdown)) {
        found.push({ card, deck, reason: 'Rules are stored in the Hero; move them to a rule Doc beside the entity and link it from the Hero.' });
      }
    }
    const disciplineDeck = !deckArea && (deck.kind === 'task' || isDiscipline(areaOf(deck.title)));
    if (card.kind === 'task' && !disciplineDeck) {
      found.push({ card, deck, reason: 'Hero work is a Sub Card in a discipline deck; the Hero, not an entity deck, links the work.' });
    }
  }
  return found;
}

async function audit(project: AgentProject, catalog: CatalogView): Promise<AgentOrganizeOutput> {
  const all = findings(catalog);
  const manifestPath = await resolveDataPath(project.root, 'tasks/deckmate.md');
  const manifestBytes = await readProjectMarkdown(project.root, manifestPath);
  const table: AgentOrganizeIssue[] = [];
  for (const finding of all.slice(0, auditRowLimit)) {
    const card = finding.card;
    table.push(issue(card?.title ?? `Deck: ${finding.deck.title}`, finding.deck.title,
      card ? heroTitle(catalog, card) : '—', finding.reason,
      card ? await cardPointer(project.root, card) : manifestPointer(manifestPath, manifestBytes, finding.deck)));
  }
  return { mode: 'audit', table,
    ...(all.length > auditRowLimit ? { warnings: [`Audit shows the first ${auditRowLimit} of ${all.length} findings; rerun after addressing them.`] } : {}) };
}

const stopWords = new Set(['a', 'an', 'the', 'new', 'for', 'of', 'to', 'and', 'with', 'create', 'make', 'add',
  'animate', 'animation', 'implement', 'design', 'model', 'record', 'test', 'polish', 'work', 'on',
  'rule', 'rules', 'mechanic', 'mechanics', 'unit', 'units', 'weapon', 'weapons', 'tool', 'tools',
  'system', 'systems', 'entity', 'entities', 'object', 'objects', '2d', '3d',
  'one', 'two', 'three', 'sample', 'samples', 'и', 'в', 'на', 'для', 'из', 'с', 'по', 'создать', 'сделать', 'добавить',
  'один', 'одна', 'два', 'две', 'три', 'новый', 'новая', 'образец', 'образца', 'образцы']);

function topicWord(word: string): string {
  if (word.length < 4) return word;
  return word.replace(/(?:ами|ями|ого|ему|ому|ыми|ими|ая|яя|ое|ее|ые|ие|ий|ый|ой|ов|ев|ам|ям|ах|ях|ом|ем|ы|и|а|я|у|ю|е)$/u, '');
}

function words(text: string): string[] {
  return text.toLocaleLowerCase('ru-RU').split(/[^\p{L}\p{N}]+/u)
    .filter(word => word.length > 1 && !stopWords.has(word) && !isDiscipline(areaOf(word))
      && !/^(?:механик|правил|оруж|юнит|инструмент|систем|сущност|объект)/u.test(word))
    .map(topicWord);
}

function matchingHero(catalog: CatalogView, about: string): CatalogCard | null {
  const wanted = new Set(words(about));
  let best: { card: CatalogCard; score: number } | null = null;
  for (const card of catalog.cards.filter(candidate => candidate.kind === 'hero')) {
    const score = words(card.title).filter(word => wanted.has(word)).length;
    if (score && (!best || score > best.score || (score === best.score && card.title.localeCompare(best.card.title) < 0))) {
      best = { card, score };
    }
  }
  return best?.card ?? null;
}

function matchingDeck(catalog: CatalogView, area: Area, kinds: CatalogDeck['kind'][]): CatalogDeck | null {
  return catalog.decks.find(deck => kinds.includes(deck.kind)
    && (isDiscipline(area) ? areaOf(deck.title) : entityArea(deck.title)) === area) ?? null;
}

function disciplineFor(catalog: CatalogView, about: string, hero: CatalogCard | null): { deck: CatalogDeck | null; area: Discipline } {
  const named = areaOf(about);
  const area: Discipline = isDiscipline(named) ? named : 'production';
  const exact = matchingDeck(catalog, area, ['task', 'mixed']);
  if (exact) return { deck: exact, area };
  if (hero) {
    const childDeck = catalog.cards.find(card => card.parentId === hero.id && card.kind === 'task'
      && catalog.decks.some(deck => deck.id === card.deckId && deck.kind === 'task'));
    const deck = catalog.decks.find(candidate => candidate.id === childDeck?.deckId);
    if (deck) return { deck, area };
  }
  return { deck: matchingDeck(catalog, 'production', ['task', 'mixed'])
    ?? catalog.decks.find(deck => deck.kind === 'task') ?? null, area };
}

function newDeckTitle(area: Area): string {
  return ({ units: 'Units', weapons: 'Weapons', props: 'Map objects', mechanics: 'Mechanics', tools: 'Tools',
    animation: 'Animation', art: 'Art', design: 'Design', engineering: 'Engineering', audio: 'Sound & music', qa: 'QA',
    production: 'Production' } as Record<Area, string>)[area];
}

async function placement(project: AgentProject, catalog: CatalogView, about: string): Promise<AgentOrganizePlacementOutput> {
  const hero = matchingHero(catalog, about);
  const namedArea = areaOf(about);
  const isRule = /\b(?:rules?|how .+ works)\b|правил|как .+ работает/iu.test(about);
  const isWork = !isRule && isDiscipline(namedArea);
  const existingRule = hero ? catalog.cards.find(candidate => candidate.kind === 'doc' && candidate.parentId === hero.id) : undefined;
  let card: 'hero' | 'subcard' | 'doc' = 'hero';
  if (isWork) card = 'subcard';
  else if (isRule) card = 'doc';
  let deck: CatalogDeck | null;
  let proposedDeck: string;
  if (isWork) {
    const discipline = disciplineFor(catalog, about, hero);
    deck = discipline.deck;
    proposedDeck = newDeckTitle(discipline.area);
  } else if (isRule) {
    deck = catalog.decks.find(candidate => candidate.id === existingRule?.deckId) ?? null;
    if (!deck && hero) {
      deck = catalog.decks.find(candidate => candidate.kind === 'knowledge')
        ?? catalog.decks.find(candidate => candidate.kind === 'mixed') ?? null;
    }
    if (!deck && !hero) deck = matchingDeck(catalog, 'mechanics', ['knowledge', 'mixed']);
    proposedDeck = hero ? 'Entity rules' : 'Mechanics';
  } else {
    const area = entityArea(about) ?? 'props';
    deck = matchingDeck(catalog, area, ['asset', 'mixed']);
    proposedDeck = newDeckTitle(area);
  }
  const deckName = deck?.title ?? proposedDeck;
  let ruleDoc: 'create' | 'reuse' | 'none' = isWork ? 'none' : 'create';
  if (existingRule) ruleDoc = 'reuse';
  const manifestPath = await resolveDataPath(project.root, 'tasks/deckmate.md');
  const manifestBytes = await readProjectMarkdown(project.root, manifestPath);
  const readNext: AgentReadPointer[] = [];
  if (deck) readNext.push(manifestPointer(manifestPath, manifestBytes, deck));
  if (hero) readNext.push(await cardPointer(project.root, hero));
  if (existingRule) readNext.push(await cardPointer(project.root, existingRule));
  let reason: string;
  if (isWork) {
    const rule = existingRule ? 'reuse its linked rule Doc' : 'do not store rules in the Task';
    reason = `Attach the work to the Hero it builds in a discipline deck; ${rule}.`;
  } else if (isRule) {
    const placement = deck ? `Reuse ${deckName} for the rule Doc`
      : `Create ${deckName} only after checking that no deck has the same name`;
    const scope = hero ? 'entity-specific behavior stays linked to its Hero' : 'shared behavior is a mechanic with its rule';
    reason = `${placement}; ${scope}.`;
  } else {
    const placement = deck ? `Reuse the ${deckName} entity-area deck`
      : `Create ${deckName} only after checking that no deck has the same name`;
    reason = `${placement}; keep game content separate from tools and put behavior in a linked rule Doc.`;
  }
  let heroName = hero?.title ?? about;
  if (isWork && !hero) heroName = 'Choose the Hero this work builds';
  if (isRule && !hero) heroName = '—';
  return { mode: 'placement', about, card, deck: deckName, deckId: deck?.id ?? null,
    hero: heroName, heroRef: hero ? shortReference('c', hero.id) : null, ruleDoc, reason, readNext };
}

export async function organizeAgentCards(project: AgentProject, catalog: CatalogView,
  input: AgentOrganizeInput): Promise<AgentOrganizeOutput> {
  if (input.about === undefined) return audit(project, catalog);
  const parts = input.about.replace(/(?:^|\s)\d+[.)]\s+/gu, '\n')
    .split(/\s+(?:и|and)\s+|[,;\n]+/iu)
    .map(part => part.replace(/^\s*[-*•]\s+/u, '').trim()).filter(Boolean);
  if (parts.length < 2) return placement(project, catalog, parts[0] ?? input.about);
  const placements: AgentOrganizePlacementOutput[] = [];
  for (const part of parts) placements.push(await placement(project, catalog, part));
  return { mode: 'placements', about: input.about, placements };
}
