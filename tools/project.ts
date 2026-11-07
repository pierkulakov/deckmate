import { loadConfig } from '../server/config.ts';
import { resolveDataPath } from '../server/data-paths.ts';
import { CatalogService } from '../server/catalog-service.ts';
import { readProjectCatalog } from '../server/catalog.ts';
import type { CatalogQuery } from '../src/catalog-contracts.ts';
import type { DataSource } from '../src/workspace-contracts.ts';
import { Boards } from '../server/boards.ts';
import { resolveReference, shortReference } from '../src/references.ts';
import { summarizeCatalog } from '../server/catalog-summary.ts';
import { cardPlanningOptions, getCatalogHands, selectCatalogHand } from '../src/catalog-hand.ts';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommandModule } from './commands/types.ts';
import { buildBrief, estimateTokens, readFileLines } from '../server/agent-brief.ts';
import { readAgentChanges } from '../server/agent-changes.ts';
import { readStaleCards } from '../server/agent-queue.ts';
import { runAsScript } from '../server/cli-entry.ts';
import { adoptLegacyEnvironment, environmentValue } from '../server/environment.ts';
import { cardStates, cardStateWords, readCardState } from '../src/format-vocabulary.ts';

const switches = new Set(['brief', 'json', 'samples', 'dry', 'read-only']);
const allowed = ['source', 'text', 'deck', 'track', 'kind', 'state', 'owner', 'limit', 'fields', 'lines', 'budget',
  // Agent commands (brief/changes here, tools/commands/*.ts, 2026-11-05).
  'member', 'since', 'file', 'brief', 'json', 'stale-hours', 'to', 'samples', 'dry', 'reason',
  // Data folder and write access, as for the board (2026-11-05).
  'data', 'read-only'];
const contextOptions: Record<string, string[]> = { fields: ['find', 'summary', 'show'], lines: ['show'], budget: ['brief'], json: ['brief'], since: ['changes', 'inbox'], samples: ['init'], dry: ['init'], reason: ['state'] };
const builtInCommands = ['summary', 'show', 'find', 'map', 'track', 'brief', 'changes', 'hand', 'step', 'pipelines', 'pipeline', 'boards', 'board', 'rebuild'];
// 2026-11-05: command modules are .ts in the source tree and .js in the package (dist/tools/commands/).
const moduleExtension = path.extname(fileURLToPath(import.meta.url));
const commandsDirectory = new URL('./commands/', import.meta.url);

interface ProjectArguments { command: string; positionals: string[]; options: Map<string, string> }

/** 2026-11-05: options may stand before or after the command; the first positional argument names the command. */
function parseProjectArguments(args: readonly string[]): ProjectArguments {
  const options = new Map<string, string>();
  const words: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith('--')) { words.push(argument); continue; }
    const key = argument.slice(2);
    if (!allowed.includes(key)) throw new Error(`Unknown option ${argument}.`);
    // 2026-11-05: boolean command switches must not consume the next positional argument.
    if (switches.has(key)) { options.set(key, 'true'); continue; }
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`);
    options.set(key, value);
  }
  const [command = 'map', ...positionals] = words;
  for (const [key, commands] of Object.entries(contextOptions)) {
    if (options.has(key) && !commands.includes(command)) throw new Error(`--${key} is only available for ${commands.join(', ')}.`);
  }
  if (options.has('fields') && options.get('fields') !== 'brief') throw new Error('--fields accepts only brief.');
  const source = options.get('source') ?? 'sandbox';
  if (source !== 'live' && source !== 'sandbox') throw new Error('--source must be live or sandbox.');
  return { command, positionals, options };
}

function commandModuleUrl(command: string): URL | null {
  if (command === 'types' || !/^[a-z][a-z-]*$/u.test(command)) return null;
  const url = new URL(`./${command}${moduleExtension}`, commandsDirectory);
  return existsSync(url) ? url : null;
}

function knownCommands(): string[] {
  const modules = readdirSync(commandsDirectory).filter(name => name.endsWith(moduleExtension))
    .map(name => name.slice(0, -moduleExtension.length)).filter(name => commandModuleUrl(name) !== null);
  return [...builtInCommands, ...modules.filter(name => !builtInCommands.includes(name)).sort()];
}

/**
 * 2026-11-05: like the board — --data, then DECKMATE_DATA (or a legacy FREETION_DATA), then the current folder. The
 * environment changes only in the first and last case, so a legacy FREETION_DATA/FREETION_WRITE pair keeps its sandbox.
 */
function selectDataFolder(explicit: string | undefined): void {
  adoptLegacyEnvironment(explicit);
  if (explicit !== undefined) process.env.DECKMATE_DATA = path.resolve(explicit);
  else if (!environmentValue('DATA')) process.env.DECKMATE_DATA = process.cwd();
}

function printJson(value: object, countTokens = false, compact = false): void {
  const result = countTokens ? { ...value, tokens: estimateTokens(JSON.stringify(value)) } : value;
  console.log(JSON.stringify(result, null, compact ? undefined : 2));
}

/** `npm run project -- <command>` and `deckmate project <command>`. */
export async function projectCli(args = process.argv.slice(2)): Promise<void> {
  // 2026-11-06: --help and -h answer with usage instead of "Unknown option".
  if (args.some(argument => argument === '--help' || argument === '-h') || args[0] === 'help') {
    console.log(`Usage: deckmate project <command> [arguments] [--data <project>] [--source sandbox|live]\nCommands: ${knownCommands().join(', ')}.\nThe agent route is in skills/deckmate/workflows/work.md.`);
    return;
  }
  const { command, positionals, options } = parseProjectArguments(args);
  const commandFile = command === 'boards' || command === 'board' ? null : commandModuleUrl(command);
  if (!commandFile && !builtInCommands.includes(command)) {
    throw new Error(`Unknown command "${command}". Commands: ${knownCommands().join(', ')}.`);
  }
  const source = (options.get('source') ?? 'sandbox') as DataSource;
  const briefFields = options.get('fields') === 'brief';
  selectDataFolder(options.get('data'));
  const config = await loadConfig({ readOnly: options.has('read-only') });
  if (command === 'boards' || command === 'board') {
    const boards = new Boards(config);
    const summaries = await boards.list(source);
    const selected = resolveReference(summaries, 'v', positionals[0] ?? '');
    if (command === 'board' && !selected) throw new Error('Board not found. Pass a board ID or v-ref from boards.');
    const value = command === 'boards' ? summaries.map(board => ({ ...board, ref: shortReference('v', board.id) })) : await boards.read(source, selected!.id);
    // 2026-11-03: agents need links/elements; image binaries remain separate local assets.
    if ('scene' in value) value.scene.files = {};
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  // 2026-11-05: a command with its own module in tools/commands/ runs there, on a fresh read of the project files.
  if (commandFile) {
    const commandModule = await import(commandFile.href) as CommandModule;
    const commandRoot = source === 'sandbox' && config.writeRoot ? config.writeRoot : config.dataRoot;
    await commandModule.run({ config, source, root: commandRoot, catalog: await readProjectCatalog(commandRoot) }, positionals, options);
    return;
  }
  // 2026-11-03: ordinary reads need fresh files, not a disposable SQLite/FTS rebuild.
  const needsIndex = command === 'find' || command === 'track' || command === 'rebuild';
  const service = needsIndex ? new CatalogService(briefFields ? { ...config, editMode: 'read-only' } : config, ':memory:') : null;
  const root = source === 'sandbox' && config.writeRoot ? config.writeRoot : config.dataRoot;
  try {
    const catalog = service ? await service.get(source) : await readProjectCatalog(root);
    if (command === 'brief' || command === 'changes') {
      const card = resolveReference(catalog.cards, 'c', positionals[0] ?? '');
      if (!card) throw new Error('Card not found. Pass a card ID or c-ref.');
      if (command === 'brief') {
        const brief = await buildBrief(catalog, root, card, { budget: options.has('budget') ? Number(options.get('budget')) : undefined });
        if (options.has('json')) printJson(brief);
        else process.stdout.write(brief.markdown);
      } else {
        const since = options.get('since');
        if (!since) throw new Error('Specify --since <ISO timestamp> or the sourceHash of an earlier read.');
        printJson(await readAgentChanges(root, card, since));
      }
    } else if (command === 'summary') {
      const summary = summarizeCatalog(catalog, options.get('track') ?? (positionals.join(' ') || undefined), Number(options.get('limit') ?? 5),
        await readStaleCards(catalog, root, { staleHours: options.has('stale-hours') ? Number(options.get('stale-hours')) : undefined }));
      printJson({ source, indexedAt: catalog.indexedAt, ...summary,
        groups: Object.fromEntries(Object.entries(summary.groups).map(([name, group]) => [name, { ...group, cards: group.cards.map(({ id, ...card }) => ({ ...card, link: card.link + `?source=${source}`, dependencies: card.dependencies.map(id => shortReference('c', id)) })) }])),
        dependencies: { ...summary.dependencies, cards: summary.dependencies.cards.map(card => ({ ...card, link: card.link + `?source=${source}` })) },
      }, briefFields);
    } else if (command === 'hand') {
      const limit = Number(options.get('limit') ?? 5);
      if (!Number.isInteger(limit) || limit < 0 || limit > 100) throw new Error('--limit for hand must be an integer from 0 to 100.');
      const hands = getCatalogHands(catalog);
      const selectedHands = positionals.length ? [selectCatalogHand(hands, positionals.join(' '))] : hands;
      console.log(JSON.stringify({ source, indexedAt: catalog.indexedAt, limit, hands: selectedHands.map(({ member, cards }) => ({
        member: { id: member.id, label: member.label, kind: member.kind }, total: cards.length, truncated: cards.length > limit,
        cards: cards.slice(0, limit).map(card => ({ id: card.id, ref: shortReference('c', card.id), link: `/r/${shortReference('c', card.id)}?source=${source}`,
          title: card.title, kind: card.kind, state: card.state, owner: card.owner, deckId: card.deckId, parentId: card.parentId, ...cardPlanningOptions(card) })),
      })) }, null, 2));
    } else if (command === 'map') {
      console.log(JSON.stringify({ rootIdentity: catalog.rootIdentity, manifest: await resolveDataPath(root, 'tasks/deckmate.md'), spaces: catalog.spaces,
        decks: catalog.decks.map(deck => ({ ...deck, cards: catalog.cards.filter(card => card.deckId === deck.id).length })),
        tracks: catalog.tracks, documents: catalog.documents.length, tasks: catalog.cards.filter(card => card.kind === 'task').length,
        pipelines: (catalog.journeys ?? []).map(({ steps, ...journey }) => ({ ...journey, steps: steps.length })),
        boards: await new Boards(config).list(source), warnings: catalog.warnings, indexedAt: catalog.indexedAt }, null, 2));
    } else if (command === 'pipelines') {
      console.log(JSON.stringify((catalog.journeys ?? []).map(journey => ({ ref: shortReference('p', journey.id), title: journey.title, version: journey.version, path: journey.path,
        steps: journey.steps.map(step => ({ id: step.id, title: step.title, dependsOn: step.dependsOn, path: journey.path.replace(/index\.md$/u, `steps/${step.id}.md`) })) })), null, 2));
    } else if (command === 'pipeline' || command === 'step') {
      const journey = resolveReference(catalog.journeys ?? [], 'p', positionals[0] ?? '');
      if (!journey) throw new Error('Pipeline not found. Pass a pipeline ID or p-ref from pipelines.');
      if (command === 'step') {
        const step = journey.steps.find(candidate => candidate.id === positionals[1]);
        if (!step) throw new Error(`Step not found. Steps of ${shortReference('p', journey.id)}: ${journey.steps.map(candidate => candidate.id).join(', ')}.`);
        console.log(JSON.stringify({ pipeline: shortReference('p', journey.id), version: journey.version,
          path: journey.path.replace(/index\.md$/u, `steps/${step.id}.md`), ...step }, null, 2));
      } else console.log(JSON.stringify({ ...journey, steps: journey.steps.map(({ markdown, ...step }) => step) }, null, 2));
    } else if (command === 'show') {
      const card = resolveReference(catalog.cards, 'c', positionals[0] ?? '');
      if (!card) throw new Error('Card not found. Pass a card ID or c-ref from find.');
      if (options.has('lines')) {
        const range = /^([1-9]\d*)-([1-9]\d*)$/u.exec(options.get('lines')!);
        if (!range) throw new Error('--lines must be an inclusive range a-b, starting at 1.');
        printJson(await readFileLines(root, card.path, Number(range[1]), Number(range[2])));
        return;
      }
      const parent = catalog.cards.find(candidate => candidate.id === card.parentId);
      const deck = catalog.decks.find(candidate => candidate.id === card.deckId);
      printJson({ ref: shortReference('c', card.id), link: `/r/${shortReference('c', card.id)}?source=${source}`, ...card, context: {
        document: catalog.documents.find(document => document.path === card.path),
        deck: deck ?? null, space: catalog.spaces.find(space => space.id === deck?.spaceId) ?? null,
        tracks: catalog.tracks.filter(track => card.trackIds.includes(track.id)),
        parent: parent ? { id: parent.id, title: parent.title } : null,
        children: catalog.cards.filter(candidate => candidate.parentId === card.id).map(child => ({ id: child.id, title: child.title, state: child.state, path: child.path })),
      } }, briefFields);
    } else if (command === 'find' || command === 'track') {
      const kind = options.get('kind');
      if (kind && !['task', 'hero', 'doc'].includes(kind)) throw new Error('--kind must be task, hero or doc.');
      const limit = Number(options.get('limit') ?? 100);
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('--limit must be an integer from 1 to 1000.');
      const trackId = command === 'track' ? positionals[0] : options.get('track');
      if (command === 'track' && !catalog.tracks.some(track => track.id === trackId)) throw new Error('Track not found. Pass a track ID from map.');
      const state = options.get('state');
      if (state !== undefined && !readCardState(state)) throw new Error(`--state must be one of: ${cardStates.flatMap(cardStateWords).join(', ')}.`);
      const query: CatalogQuery = { text: options.get('text') ?? (command === 'find' ? positionals.join(' ') : undefined),
        deckId: options.get('deck'), trackId, kind: kind as CatalogQuery['kind'], state: state === undefined ? undefined : readCardState(state), owner: options.get('owner'), limit };
      const cards = await service!.search(source, query, { hits: briefFields });
      const listed = cards.map(({ markdown, ...card }) => ({ ref: shortReference('c', card.id), ...card }));
      if (briefFields) printJson({ cards: listed }, true, true);
      else printJson(listed);
    } else if (command === 'rebuild') {
      console.log(JSON.stringify({ rebuilt: true, storage: 'memory', cards: catalog.cards.length, indexedAt: catalog.indexedAt }, null, 2));
    }
  } finally { await service?.close(); }
}

runAsScript(import.meta.url, projectCli);
