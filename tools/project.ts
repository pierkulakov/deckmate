import { loadConfig } from '../server/config.ts';
import { resolveDataPath } from '../server/data-paths.ts';
import { CatalogService } from '../server/catalog-service.ts';
import { readProjectCatalog } from '../server/catalog.ts';
import type { CardKind, CatalogJourney, CatalogQuery, CatalogView } from '../src/catalog-contracts.ts';
import type { DataSource } from '../src/workspace-contracts.ts';
import { Boards } from '../server/boards.ts';
import { cardLink, resolveReference, shortReference } from '../src/references.ts';
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
import { defineText, serverText } from '../server/i18n.ts';

const switches = new Set(['brief', 'json', 'samples', 'dry', 'read-only']);
const allowed = ['source', 'text', 'deck', 'track', 'kind', 'state', 'owner', 'limit', 'fields', 'lines', 'budget',
  // Agent commands (brief/changes here, tools/commands/*.ts, 2026-11-05).
  'member', 'since', 'file', 'brief', 'json', 'stale-hours', 'to', 'target', 'as', 'note', 'samples', 'dry', 'reason',
  'priority', 'effort', 'parent', 'key', 'body-file', 'tracks', 'rev', 'about',
  // Data folder and write access, as for the board (2026-11-05).
  'data', 'read-only'];
/** 2026-11-09: options every command accepts; a command's own options come from its spec below. */
const commonOptions = ['data', 'source', 'read-only'];
const builtInCommands = ['summary', 'show', 'find', 'map', 'track', 'brief', 'changes', 'hand', 'step', 'pipelines', 'pipeline', 'boards', 'board', 'rebuild'];

/** 2026-11-09: one spec per command drives both option validation and `deckmate project <command> --help`. */
interface CommandSpec { args: string; options: readonly string[]; example: string }

const commandSpecs: Record<string, CommandSpec> = {
  map: { args: '', options: [], example: 'deckmate project map --data <project>' },
  summary: { args: '[track]', options: ['track', 'limit', 'stale-hours', 'fields'], example: 'deckmate project summary --track sound --data <project>' },
  show: { args: '<c-ref>', options: ['fields', 'lines'], example: 'deckmate project show c-1a2b3c4d5e --lines 12-40' },
  find: { args: '[text]', options: ['text', 'deck', 'track', 'kind', 'state', 'owner', 'limit', 'fields'], example: 'deckmate project find "audio" --kind task --owner agent --fields brief' },
  track: { args: '<track>', options: ['text', 'deck', 'kind', 'state', 'owner', 'limit', 'fields'], example: 'deckmate project track sound --kind task' },
  brief: { args: '<c-ref>', options: ['budget', 'json'], example: 'deckmate project brief c-1a2b3c4d5e --budget 1500 --json' },
  changes: { args: '<c-ref>', options: ['since'], example: 'deckmate project changes c-1a2b3c4d5e --since 2026-11-09T00:00:00Z' },
  hand: { args: '[member]', options: ['limit'], example: 'deckmate project hand --limit 10 --data <project>' },
  step: { args: '<p-ref> <step-id>', options: [], example: 'deckmate project step p-1a2b3c4d5e step-01' },
  pipelines: { args: '', options: [], example: 'deckmate project pipelines --data <project>' },
  pipeline: { args: '<p-ref>', options: [], example: 'deckmate project pipeline p-1a2b3c4d5e' },
  boards: { args: '', options: [], example: 'deckmate project boards --data <project>' },
  board: { args: '<v-ref>', options: [], example: 'deckmate project board v-1a2b3c4d5e' },
  rebuild: { args: '', options: [], example: 'deckmate project rebuild --data <project>' },
  init: { args: '[template]', options: ['samples', 'dry', 'member'], example: 'deckmate project init action --dry --samples' },
  next: { args: '[member]', options: ['member', 'stale-hours', 'brief'], example: 'deckmate project next agent --data <project>' },
  ask: { args: '<c-ref> "<question>"', options: ['member', 'to', 'target'], example: 'deckmate project ask c-1a2b3c4d5e "FPS?" --member agent --target c-1a2b3c4d5e#Rules' },
  question: { args: '<c-ref#N>', options: [], example: 'deckmate project question c-1a2b3c4d5e#1' },
  answer: { args: '<c-ref#N> "<answer>"', options: ['as', 'member', 'rev'], example: 'deckmate project answer c-1a2b3c4d5e#1 "60 FPS" --as human --member agent --rev 0123456789ab' },
  apply: { args: '<c-ref> <index>', options: ['note', 'rev'], example: 'deckmate project apply c-1a2b3c4d5e 0 --rev 0123456789ab --note "Rules updated"' },
  report: { args: '<c-ref>', options: ['file', 'member', 'state'], example: 'deckmate project report c-1a2b3c4d5e --file report.md --member agent --state review' },
  state: { args: '<c-ref> <state>', options: ['member', 'reason'], example: 'deckmate project state c-1a2b3c4d5e done --member reviewer' },
  create: { args: '[title]', options: ['file', 'deck', 'kind', 'owner', 'priority', 'effort', 'parent', 'key', 'body-file', 'member'], example: 'deckmate project create "Check audio" --deck inbox --member agent' },
  update: { args: '<c-ref>', options: ['state', 'reason', 'owner', 'priority', 'effort', 'deck', 'tracks', 'parent', 'rev', 'member'], example: 'deckmate project update c-1a2b3c4d5e --owner agent --state started --rev 0123456789ab' },
  inbox: { args: '[member]', options: ['member', 'since', 'limit'], example: 'deckmate project inbox agent --since 2026-11-09T00:00:00Z' },
  organize: { args: '', options: ['about'], example: 'deckmate project organize --about "new unit" --data <project>' },
};

/** Placeholders shown in help; a missing hint means the option is a valueless switch. */
const optionHints: Record<string, string> = {
  source: '<sandbox|live>', data: '<project>', text: '<text>', deck: '<id>', track: '<id>', kind: '<task|hero|doc>',
  state: '<state>', owner: '<id>', limit: '<n>', fields: '<brief>', lines: '<a-b>', budget: '<tokens>',
  member: '<id>', since: '<timestamp|sourceHash>', 'stale-hours': '<hours>', to: '<id>', target: '<c-ref[#section]>',
  as: '<human-id>', note: '<text>', file: '<path>', reason: '<text>',
  priority: '<high|medium|low>', effort: '<n>', parent: '<c-ref>', key: '<key>', 'body-file': '<path>', tracks: '<a,b>', rev: '<rev>',
  about: '<new thing>',
};

const messages = defineText({
  overviewHelp: (commands: string) => `Usage: deckmate project <command> [arguments] [--data <project>] [--source <sandbox|live>] [--read-only]\nCommands: ${commands}.\nRun deckmate project <command> --help for the command's arguments, options and an example.\nThe agent route is in skills/deckmate/workflows/work.md.`,
  commandHelp: (command: string, args: string, options: readonly string[], example: string) =>
    `Usage: deckmate project ${command}${args ? ' ' + args : ''} ${options.map(optionSyntax).join(' ')}\nExample: ${example}`,
  anyArguments: '[arguments]',
  unknownOption: (option: string) => `Unknown option ${option}. Run deckmate project --help to list the commands and their options.`,
  optionNotAvailable: (option: string, command: string, options: readonly string[]) =>
    `--${option} is not available for ${command}. Options for ${command}: ${options.map(name => '--' + name).join(', ')}. Run deckmate project ${command} --help for an example.`,
  unknownCommand: (command: string, commands: string) => `Unknown command "${command}". Commands: ${commands}.`,
  missingValue: (option: string) => `Missing value for ${option}.`,
  fieldsValue: '--fields accepts only brief.',
  sourceValue: '--source must be live or sandbox.',
  journeyOperation: (state: string, file: string) => `Unfinished Journey operation (${state}): ${file}. Pending reads use the coherent original snapshot; conflict/invalid reads use working files. Reading does not recover the operation.`,
}, {
  overviewHelp: (commands: string) => `Использование: deckmate project <команда> [аргументы] [--data <проект>] [--source <sandbox|live>] [--read-only]\nКоманды: ${commands}.\nЗапустите deckmate project <команда> --help, чтобы увидеть аргументы, опции и пример команды.\nМаршрут агента — в skills/deckmate/workflows/work.md.`,
  commandHelp: (command: string, args: string, options: readonly string[], example: string) =>
    `Использование: deckmate project ${command}${args ? ' ' + args : ''} ${options.map(optionSyntax).join(' ')}\nПример: ${example}`,
  anyArguments: '[аргументы]',
  unknownOption: (option: string) => `Неизвестная опция ${option}. Запустите deckmate project --help, чтобы увидеть команды и их опции.`,
  optionNotAvailable: (option: string, command: string, options: readonly string[]) =>
    `--${option} не применима к команде ${command}. Опции команды ${command}: ${options.map(name => '--' + name).join(', ')}. Запустите deckmate project ${command} --help для примера.`,
  unknownCommand: (command: string, commands: string) => `Неизвестная команда "${command}". Команды: ${commands}.`,
  missingValue: (option: string) => `Не указано значение для ${option}.`,
  fieldsValue: '--fields допускает только brief.',
  sourceValue: '--source должен быть live или sandbox.',
  journeyOperation: (state: string, file: string) => `Незавершённая операция Journey (${state}): ${file}. При pending читается согласованный исходный снимок; при conflict/invalid — рабочие файлы. Чтение не завершает операцию.`,
});

function journeyReadStatus(journey: CatalogJourney, catalog: CatalogView) {
  const pending = journey.pendingOperation;
  if (!pending) return {};
  const journalPath = journey.path.replace(/index\.md$/u, '.deckmate-operation.json');
  return { pendingOperation: { ...pending, journalPath }, warnings: [
    ...catalog.warnings.filter(warning => warning.startsWith(journey.path + ':')),
    serverText(messages).journeyOperation(pending.state, journalPath),
  ] };
}

function optionSyntax(name: string): string {
  const hint = optionHints[name];
  return hint ? `[--${name} ${hint}]` : `[--${name}]`;
}

function isCardKind(value: string): value is CardKind {
  return value === 'task' || value === 'hero' || value === 'doc';
}

function commandHelp(command: string): string {
  const text = serverText(messages);
  const spec = commandSpecs[command];
  // 2026-11-09: a command module added by a package has no spec here, so help shows only the shared options.
  const args = spec ? spec.args : text.anyArguments;
  const options = spec ? [...spec.options, ...commonOptions] : commonOptions;
  const example = spec ? spec.example : `deckmate project ${command} --data <project>`;
  return text.commandHelp(command, args, options, example);
}

function isProjectCommand(command: string): boolean {
  return builtInCommands.includes(command) || commandModuleUrl(command) !== null;
}
// 2026-11-05: command modules are .ts in the source tree and .js in the package (dist/tools/commands/).
const moduleExtension = path.extname(fileURLToPath(import.meta.url));
const commandsDirectory = new URL('./commands/', import.meta.url);

interface ProjectArguments { command: string; positionals: string[]; options: Map<string, string>; help: boolean; namedCommand: boolean }

/** 2026-11-05: options may stand before or after the command; the first positional argument names the command. */
function parseProjectArguments(args: readonly string[]): ProjectArguments {
  const text = serverText(messages);
  const options = new Map<string, string>();
  const words: string[] = [];
  let help = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    // 2026-11-09: --help and -h are accepted at any position and answered before any validation.
    if (argument === '--help' || argument === '-h') { help = true; continue; }
    if (!argument.startsWith('--')) {
      // 2026-11-09: a lone -x used to reach the command lookup and failed with a misleading "Unknown command".
      if (argument.length > 1 && argument.startsWith('-')) throw new Error(text.unknownOption(argument));
      words.push(argument);
      continue;
    }
    const key = argument.slice(2);
    if (!allowed.includes(key)) throw new Error(text.unknownOption(argument));
    // 2026-11-05: boolean command switches must not consume the next positional argument.
    if (switches.has(key)) { options.set(key, 'true'); continue; }
    const value = args[++index];
    if (value === undefined || value.startsWith('--')) throw new Error(text.missingValue(argument));
    options.set(key, value);
  }
  const [command = 'map', ...positionals] = words;
  return { command, positionals, options, help, namedCommand: words.length > 0 };
}

/** Every option the command accepts, for validation and error hints. */
function commandOptions(command: string): readonly string[] | null {
  const spec = commandSpecs[command];
  return spec ? [...spec.options, ...commonOptions] : null;
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
  const text = serverText(messages);
  let { command, positionals, options, help, namedCommand } = parseProjectArguments(args);
  // 2026-11-09: `help [command]` is the word form of --help, as before, but now it can also name a command.
  if (namedCommand && command === 'help') {
    const [requested = '', ...rest] = positionals;
    command = requested;
    positionals = rest;
    namedCommand = requested !== '';
    // 2026-11-10: the word form must only print usage; without this, `help state <card> started` ran the write.
    help = true;
  }
  // 2026-11-06: --help and -h answer with usage instead of "Unknown option".
  if (help) {
    if (namedCommand && !isProjectCommand(command)) {
      throw new Error(text.unknownCommand(command, knownCommands().join(', ')));
    }
    console.log(namedCommand ? commandHelp(command) : text.overviewHelp(knownCommands().join(', ')));
    return;
  }
  const commandFile = command === 'boards' || command === 'board' ? null : commandModuleUrl(command);
  if (!commandFile && !builtInCommands.includes(command)) {
    throw new Error(text.unknownCommand(command, knownCommands().join(', ')));
  }
  // 2026-11-09: a shipped command rejects options meant for another command instead of silently ignoring them;
  // a command module from a package declares no spec here, so its own options stay accepted as before.
  const accepted = commandOptions(command);
  if (accepted) {
    for (const key of options.keys()) {
      if (!accepted.includes(key)) throw new Error(text.optionNotAvailable(key, command, accepted));
    }
  }
  if (options.has('fields') && options.get('fields') !== 'brief') throw new Error(text.fieldsValue);
  const requestedSource = options.get('source') ?? 'sandbox';
  if (requestedSource !== 'live' && requestedSource !== 'sandbox') throw new Error(text.sourceValue);
  const source: DataSource = requestedSource;
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
  const root = source === 'sandbox' && config.writeRoot ? config.writeRoot : config.dataRoot;
  if (commandFile) {
    const commandModule = await import(commandFile.href) as CommandModule;
    await commandModule.run({ config, source, root, catalog: await readProjectCatalog(root) }, positionals, options);
    return;
  }
  // 2026-11-03: ordinary reads need fresh files, not a disposable SQLite/FTS rebuild.
  const needsIndex = command === 'find' || command === 'track' || command === 'rebuild';
  const service = needsIndex ? new CatalogService(briefFields ? { ...config, editMode: 'read-only' } : config, ':memory:') : null;
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
        cards: cards.slice(0, limit).map(card => ({ id: card.id, ref: shortReference('c', card.id), link: cardLink(shortReference('c', card.id), source),
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
        ...journeyReadStatus(journey, catalog),
        steps: journey.steps.map(step => ({ id: step.id, title: step.title, dependsOn: step.dependsOn, path: journey.path.replace(/index\.md$/u, `steps/${step.id}.md`) })) })), null, 2));
    } else if (command === 'pipeline' || command === 'step') {
      const journey = resolveReference(catalog.journeys ?? [], 'p', positionals[0] ?? '');
      if (!journey) throw new Error('Pipeline not found. Pass a pipeline ID or p-ref from pipelines.');
      if (command === 'step') {
        const step = journey.steps.find(candidate => candidate.id === positionals[1]);
        if (!step) throw new Error(`Step not found. Steps of ${shortReference('p', journey.id)}: ${journey.steps.map(candidate => candidate.id).join(', ')}.`);
        console.log(JSON.stringify({ pipeline: shortReference('p', journey.id), version: journey.version,
          path: journey.path.replace(/index\.md$/u, `steps/${step.id}.md`), ...step, ...journeyReadStatus(journey, catalog) }, null, 2));
      } else console.log(JSON.stringify({ ...journey, steps: journey.steps.map(({ markdown, ...step }) => step), ...journeyReadStatus(journey, catalog) }, null, 2));
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
      printJson({ ref: shortReference('c', card.id), link: cardLink(shortReference('c', card.id), source), ...card, context: {
        document: catalog.documents.find(document => document.path === card.path),
        deck: deck ?? null, space: catalog.spaces.find(space => space.id === deck?.spaceId) ?? null,
        tracks: catalog.tracks.filter(track => card.trackIds.includes(track.id)),
        parent: parent ? { id: parent.id, title: parent.title } : null,
        children: catalog.cards.filter(candidate => candidate.parentId === card.id).map(child => ({ id: child.id, title: child.title, state: child.state, path: child.path })),
      } }, briefFields);
    } else if (command === 'find' || command === 'track') {
      const kind = options.get('kind');
      if (kind !== undefined && !isCardKind(kind)) throw new Error('--kind must be task, hero or doc.');
      const limit = Number(options.get('limit') ?? 100);
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('--limit must be an integer from 1 to 1000.');
      const trackId = command === 'track' ? positionals[0] : options.get('track');
      if (command === 'track' && !catalog.tracks.some(track => track.id === trackId)) throw new Error('Track not found. Pass a track ID from map.');
      const state = options.get('state');
      if (state !== undefined && !readCardState(state)) throw new Error(`--state must be one of: ${cardStates.flatMap(cardStateWords).join(', ')}.`);
      const query: CatalogQuery = { text: options.get('text') ?? (command === 'find' ? positionals.join(' ') : undefined),
        deckId: options.get('deck'), trackId, kind, state: state === undefined ? undefined : readCardState(state), owner: options.get('owner'), limit };
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
