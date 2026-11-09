import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseDocument, stringify } from 'yaml';
import { editProjectCatalog, readManifest, readProjectCatalog, type CatalogManifest } from '../server/catalog.ts';
import type { CatalogEdit } from '../src/catalog-contracts.ts';

vi.mock('node:crypto', async importOriginal => ({
  ...await importOriginal<typeof import('node:crypto')>(),
  randomUUID: () => '11111111-1111-4111-8111-111111111111',
}));
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const deck = { id: 'audio', title: 'Audio', spaceId: 'work', kind: 'task' as const, icon: 'box', color: '#123456', description: '', style: 'symbol' as const, cover: null, coverPosition: 50 };
const added = { ...deck, id: '11111111-1111-4111-8111-111111111111', title: 'New: deck # one', description: '- text\nnext' };
type WithoutManifestHash<T> = T extends CatalogEdit ? Omit<T, 'manifestHash'> : never;
type Edit = WithoutManifestHash<CatalogEdit>;
type Operation = { name: string; edit: Edit; change: (manifest: CatalogManifest) => void; repeat?: boolean };

async function fixture(yaml: string, newline = '\n', bom = true) {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-manifest-patch-'));
  roots.push(root);
  await mkdir(path.join(root, 'tasks'));
  const filename = path.join(root, 'tasks/deckmate.md');
  const original = (bom ? '\uFEFF' : '') + ['---', '# keep top', yaml, '---', 'Body: Кириллица.', ''].join('\n').replace(/\n/gu, newline);
  await writeFile(filename, original);
  return { root, filename, original, newline };
}

async function checkEdit(data: Awaited<ReturnType<typeof fixture>>, operation: Operation, exact?: string) {
  const { root, filename, original, newline } = data;
  const source = await readManifest(root);
  const desired = structuredClone(source.manifest);
  operation.change(desired);
  // 2026-11-07: prove each input also works with the previous whole-manifest serializer.
  expect(parseDocument(stringify(desired)).toJS()).toEqual(desired);
  const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
  const apply = async (manifestHash?: string) => editProjectCatalog(root, { ...operation.edit, manifestHash: manifestHash ?? hash(await readFile(filename)) } as CatalogEdit);
  await apply();
  const after = await readFile(filename);
  const parsed = await readManifest(root);
  expect(parsed.manifest).toEqual(desired);
  const text = after.toString('utf8');
  expect(after.subarray(0, parsed.yamlStart)).toEqual(source.bytes!.subarray(0, source.yamlStart));
  expect(after.subarray(parsed.yamlEnd)).toEqual(source.bytes!.subarray(source.yamlEnd));
  expect(text.match(/# keep[^\r\n]*/gu)).toEqual(original.match(/# keep[^\r\n]*/gu));
  for (const line of original.split(newline).filter(line => /^\s*# keep/u.test(line))) expect(text).toContain(newline + line + newline);
  for (const line of ['membership: [] # keep membership', 'tracks: [] # keep tracks', 'schema: 1 # keep schema']) {
    if (original.includes(newline + line + newline)) expect(text).toContain(newline + line + newline);
  }
  if (newline === '\r\n') expect(text).not.toMatch(/(?<!\r)\n/u);
  if (exact !== undefined) expect(after).toEqual(Buffer.from(exact));
  if (operation.repeat === false) {
    // 2026-11-07: create-space has no retry ID; deletes and creates retry safely with their original hash.
    await expect(apply(hash(original))).rejects.toThrow('CATALOG_CONFLICT');
  } else await apply();
  expect(await readFile(filename)).toEqual(after);
}

const operations: Operation[] = [
  ...['Next', 'A, B', 'a[b]', 'a{b}', 'A: B', 'A # B', '- leading', 'quote\' and "', 'line\nnext'].map(title => ({
    name: `rename ${JSON.stringify(title)}`, edit: { action: 'update-deck' as const, deckId: 'audio', ...deck, title },
    change: (m: CatalogManifest) => { Object.assign(m.decks[0], deck, { title }); },
  })),
  { name: 'description', edit: { action: 'update-deck', deckId: 'audio', ...deck, description: 'New: body # text\n- next', color: '#abcdef' }, change: m => { Object.assign(m.decks[0], { description: 'New: body # text\n- next', color: '#abcdef' }); } },
  { name: 'append deck', edit: { action: 'create-deck', deckId: added.id, ...added }, change: m => { const { cover: _cover, ...value } = added; m.decks.push(value); } },
  { name: 'append space', edit: { action: 'create-space', title: 'Next' }, change: m => { m.spaces.push({ id: added.id, title: 'Next', kind: 'custom', icon: '' }); }, repeat: false },
  { name: 'delete deck', edit: { action: 'delete-deck', deckId: 'audio' }, change: m => { m.decks.splice(0, 1); }, repeat: false },
  { name: 'pile', edit: { action: 'set-deck-pile', deckId: 'audio', piled: true }, change: m => { m.decks[0].piled = true; } },
];
const fields = Object.entries(deck).map(([key, value]) => `${key}: ${key === 'title' ? value : JSON.stringify(value)}`);
const layouts = [
  ['block', 'decks:\n  - ' + fields.join('\n    ')],
  ['flow', 'decks: [{' + fields.join(', ') + '}] # keep decks'],
  ['compact', 'decks:\n  - {' + fields.join(', ') + '} # keep decks'],
  ['block comments', 'decks:\n  - ' + fields.join('\n    # keep field\n    ') + ' # keep last'],
  ['block scalar', 'decks:\n  - ' + fields.join('\n    ').replace('description: ""', 'description: |- # keep header\n      old body')],
  ['flow trailing comma', 'decks: [{' + fields.join(', ') + '},] # keep decks'],
];
for (const [layout, decks] of layouts) for (const newline of ['\n', '\r\n']) for (const operation of operations) {
  if (['block scalar', 'block comments', 'flow trailing comma'].includes(layout) && operation.name.startsWith('rename')) continue;
  it(`${layout} ${JSON.stringify(newline)} ${operation.name}`, async () => {
    const data = await fixture(['membership: [] # keep membership', decks, 'tracks: [] # keep tracks', 'spaces: [{title: Work, id: work}]', 'schema: 1 # keep schema'].join('\n'), newline);
    await checkEdit(data, operation);
  });
}

const automation: Edit = { action: 'set-deck-automation', deckId: 'audio', autoTag: null, autoTagKeep: false, templateMarkdown: 'new', templateOwner: null, templateEffort: null, templatePriority: null };
const edgeCases: Array<{ name: string; yaml: string; edit: Edit; change: (m: CatalogManifest) => void }> = [
  ...['', 'null', '~'].map(value => ({ name: `null ${JSON.stringify(value)}`, yaml: `decks:\n  - ${fields.join('\n    ')}\n    templateMarkdown: ${value} # keep null`, edit: automation, change: (m: CatalogManifest) => { m.decks[0].templateMarkdown = 'new'; } })),
  { name: 'key-only flow null', yaml: `decks: [{${fields.join(', ')}, templateOwner, autoTag: old}]`, edit: automation, change: m => { delete m.decks[0].autoTag; delete m.decks[0].templateOwner; m.decks[0].templateMarkdown = 'new'; } },
  { name: 'replace key-only flow null', yaml: `decks: [{${fields.join(', ')}, templateMarkdown}]`, edit: automation, change: m => { m.decks[0].templateMarkdown = 'new'; } },
  ...['', ' # keep implicit'].map(comment => ({ name: `remove implicit null${comment}`, yaml: `decks:\n  - ${fields.join('\n    ')}\n    templateOwner:${comment}\n    autoTag: old`, edit: automation, change: (m: CatalogManifest) => { delete m.decks[0].autoTag; delete m.decks[0].templateOwner; m.decks[0].templateMarkdown = 'new'; } })),
  { name: 'remove first multiline field', yaml: `decks:\n  - templateMarkdown: |- # keep markdown\n      old\n    # keep next field\n    ${fields.join('\n    ')}`, edit: { ...automation, templateMarkdown: null }, change: m => { delete m.decks[0].templateMarkdown; } },
  ...[false, true].map(last => ({ name: `remove multiline collection ${last}`, yaml: `members: [{id: member, label: Member, kind: human, aliases: []}]\ndecks:\n  - ${last ? fields.join('\n    ') + '\n    ' : ''}watcherIds:\n      - member # keep watcher\n      # keep trailing watcher\n    ${last ? 'piled: true' : fields.join('\n    ')}`, edit: { action: 'set-deck-watchers' as const, deckId: 'audio', watcherIds: [] }, change: (m: CatalogManifest) => { delete m.decks[0].watcherIds; } })),
  { name: 'block sequence with inline key', yaml: `members: [{id: member, label: Member, kind: human, aliases: [alias]}]\ndecks:\n  - ${fields.join('\n    ')}\n    watcherIds:\n      - member # keep member`, edit: { action: 'set-deck-watchers', deckId: 'audio', watcherIds: [] }, change: m => { delete m.decks[0].watcherIds; } },
  ...[false, true].map(flow => ({ name: `delete first of two ${flow}`, yaml: flow ? `decks: [{${fields.join(', ')}}, # keep middle\n {${fields.join(', ').replace('id: "audio"', 'id: other')}}]` : `decks:\n  - ${fields.join('\n    ')}\n    # keep middle\n  - ${fields.join('\n    ').replace('id: "audio"', 'id: other')}`, edit: { action: 'delete-deck' as const, deckId: 'audio' }, change: (m: CatalogManifest) => { m.decks.shift(); } })),
  { name: 'numeric map key', yaml: `decks: [{${fields.join(', ').replace('id: "audio"', 'id: "123"')}}, {${fields.join(', ')}}]\ndeckOrder: {123: null, audio: null}`, edit: { action: 'delete-deck', deckId: '123' }, change: m => { m.decks.shift(); delete m.deckOrder!['123']; } },
  { name: 'sole map entry', yaml: `decks: [{${fields.join(', ')}}]\ndeckOrder:\n  audio: null # keep order`, edit: { action: 'delete-deck', deckId: 'audio' }, change: m => { m.decks = []; m.deckOrder = {}; } },
  { name: 'empty sequence comment', yaml: 'decks: [ # keep empty\n ]', edit: { action: 'create-deck', deckId: added.id, ...added }, change: m => { const { cover: _cover, ...value } = added; m.decks.push(value); } },
  { name: 'block scalar before following comment', yaml: `decks:\n  - ${fields.join('\n    ').replace('description: ""', 'description: |+ # keep header\n      old\n\n')}\n    # keep tail`, edit: { action: 'update-deck', deckId: 'audio', ...deck, description: 'new\n\n' }, change: m => { m.decks[0].description = 'new\n\n'; } },
];
for (const newline of ['\n', '\r\n']) it.each(edgeCases)(`$name (${JSON.stringify(newline)})`, async ({ name, yaml, edit, change }) => {
  const data = await fixture(`schema: 1 # keep schema\nspaces: [{id: work, title: Work}]\n${yaml}\ntracks: [] # keep tracks\nmembership: [] # keep membership`, newline);
  await checkEdit(data, { name, edit, change, repeat: edit.action !== 'delete-deck' });
});

const base = 'schema: 1 # keep schema\nspaces: [{title: Work, id: work}]\ntracks: [] # keep tracks\nmembership: [] # keep membership\n';
const flowDeck = '{' + fields.join(', ') + '}';
const blockDeck = '  - ' + fields.join('\n    ');

it.each(['\n', '\r\n'])('changes only an implicit null before its comment (%j)', async newline => {
  const data = await fixture(base + `decks:\n${blockDeck}\n    templateMarkdown: # keep null`, newline);
  await checkEdit(data, { name: 'implicit null', edit: automation, change: m => { m.decks[0].templateMarkdown = 'new'; } },
    data.original.replace('templateMarkdown: #', 'templateMarkdown: new #'));
});

it.each(['\n', '\r\n'])('changes only a commented block scalar and retains adjacent bytes (%j)', async newline => {
  const value = '|- # keep header\n      old: body # literal\n      - second';
  const data = await fixture(base + `decks:\n${blockDeck.replace('description: ""', 'description: ' + value)}\n# keep following`, newline);
  await checkEdit(data, { name: 'block scalar', edit: { action: 'update-deck', deckId: 'audio', ...deck, description: 'New: body\n- second' },
    change: m => { m.decks[0].description = 'New: body\n- second'; } },
  data.original.replace(value.replace(/\n/gu, newline), '"New: body\\n- second" # keep header'));
});

it.each(['\n', '\r\n'])('retains the next deck indentation after a trailing block-map comment (%j)', async newline => {
  const data = await fixture(base + `decks:\n${blockDeck}\n    # keep between\n${blockDeck.replace('id: "audio"', 'id: other')}`, newline);
  await checkEdit(data, { name: 'delete first', edit: { action: 'delete-deck', deckId: 'audio' }, change: m => { m.decks.shift(); }, repeat: false },
    data.original.replace(blockDeck.replace(/\n/gu, newline) + newline, ''));
});

it.each(['\n', '\r\n'])('appends before trailing comments without consuming an indented root key (%j)', async newline => {
  const yaml = `schema: 1 # keep schema\nspaces: [{title: Work, id: work}]\ndecks:\n${blockDeck}\n    # keep deck tail\ntracks: [] # keep tracks\nmembership: [] # keep membership`;
  const data = await fixture(yaml.split('\n').map(line => '  ' + line).join('\n'), newline);
  await checkEdit(data, operations.find(operation => operation.name === 'append deck')!);
  const after = await readFile(data.filename, 'utf8');
  const boundary = data.original.indexOf('      # keep deck tail');
  expect(after.startsWith(data.original.slice(0, boundary))).toBe(true);
  expect(after.endsWith(data.original.slice(boundary))).toBe(true);
});

it.each(['templateMarkdown', 'templateMarkdown: null'])('updates a flow null without touching its neighbors: %s', async field => {
  const data = await fixture(base + `decks: [${flowDeck.slice(0, -1)}, ${field}}]`);
  await checkEdit(data, { name: 'flow null', edit: automation, change: m => { m.decks[0].templateMarkdown = 'new'; } },
    data.original.replace(field, 'templateMarkdown: new'));
});

it.each([
  ['single', "'Audio'", "'It''s: # sound'", "It's: # sound"],
  ['double', '"Audio"', '"Line\\n\\"quoted\\""', 'Line\n"quoted"'],
])('retains %s scalar quoting and all other bytes', async (_name, before, after, title) => {
  const data = await fixture(base + `decks: [${flowDeck.replace('title: Audio', 'title: ' + before)}]`, '\r\n');
  await checkEdit(data, { name: 'quote', edit: { action: 'update-deck', deckId: 'audio', ...deck, title }, change: m => { m.decks[0].title = title; } },
    data.original.replace('title: ' + before, 'title: ' + after));
});

it.each(['true', 'false'])('changes only the piled field (%s)', async piled => {
  const data = await fixture(base + `decks:\n${blockDeck}\n    piled: ${piled} # keep pile\n# keep section`, '\r\n');
  const value = piled !== 'true';
  await checkEdit(data, { name: 'pile', edit: { action: 'set-deck-pile', deckId: 'audio', piled: value }, change: m => {
    if (value) m.decks[0].piled = true;
    else delete m.decks[0].piled;
  } }, data.original.replace(`piled: ${piled}`, value ? 'piled: true' : ''));
});

it.each(['|', '|-', '|+', '>', '>-', '>+'])('piles a deck ending in a %s scalar at the YAML boundary', async style => {
  const yaml = blockDeck.replace('    description: ""\n', '') + `\n    description: ${style} # keep final scalar\n      first\n      second`;
  const data = await fixture(base + 'decks:\n' + yaml, '\r\n');
  await checkEdit(data, operations.find(operation => operation.name === 'pile')!);
});

it.each([false, true])('appends into empty collections in a root flow map: %s', async empty => {
  const yaml = `{membership: [], decks: ${empty ? '[]' : '[' + flowDeck + ']'}, "extension: # []": {"- key": null},\n spaces: [ # keep spaces\n ], tracks: [], schema: 1}`;
  // 2026-11-07: an existing deck needs its Space even when other collections are empty.
  const initial = empty ? yaml : yaml.replace('spaces: [ # keep spaces\n ]', 'spaces: [{title: Work, id: work}] # keep spaces\n');
  const data = await fixture(initial, '\r\n', false);
  await checkEdit(data, operations.find(operation => operation.name === 'append space')!);
});

it.each(['[ ]', '[ # keep empty deck list\n ]'])('creates into an empty deck list: %s', async list => {
  const data = await fixture(base + 'decks: ' + list, '\r\n');
  await checkEdit(data, operations.find(operation => operation.name === 'append deck')!);
});

it('removes quoted extension keys and the last commented member without losing adjacent text', async () => {
  const data = await fixture(base + `decks: []\nmembers:\n  - id: member\n    label: 'Member'\n    kind: human\n    aliases: []\n    'extension: # []': null # keep extension\n# keep next section`, '\r\n');
  const member = { id: 'member', label: 'Member', kind: 'human' as const, aliases: [] };
  await checkEdit(data, { name: 'remove key', edit: { action: 'configure-members', members: [member] }, change: m => { m.members = [member]; } },
    data.original.replace("'extension: # []': null", ''));
  const original = await readFile(data.filename, 'utf8');
  await checkEdit({ ...data, original }, { name: 'remove only member', edit: { action: 'configure-members', members: [] }, change: m => { m.members = []; } });
});

const hero = 'hero:features/odd [x] # guide.md#1';
const children = ['task:features/odd [x] # guide.md#1.0', 'task:features/odd [x] # guide.md#1.1'];
const orderCases = [
  '',
  'subCardOrder: {} # keep empty order',
  `subCardOrder:\n  ${JSON.stringify(hero)}: [] # keep hero`,
  `subCardOrder:\n  ${JSON.stringify(hero)}:\n    - '${children[0]}' # keep first position\n    # keep middle\n    - '${children[1]}' # keep second position\n  'other: # []': [] # keep other`,
  `subCardOrder: {${JSON.stringify(hero)}: ['${children[0]}', # keep flow position\n '${children[1]}'], 'other: # []': []}`,
  `subCardOrder:\n  ${JSON.stringify(hero)}:\n    - '${children[0]}' # keep existing child\n  other: [] # keep following hero`,
];
for (const newline of ['\n', '\r\n']) it.each(orderCases)('reorders Sub Cards preserving comments and special keys (%s)', async order => {
  const data = await fixture(base + `decks: []\n${order}`, newline);
  await mkdir(path.join(data.root, 'features'));
  const filename = path.join(data.root, 'features/odd [x] # guide.md');
  const content = '\uFEFF# Guide\r\n## 1 — Hero\r\n### 1.0 First (план)\r\nFirst.\r\n### 1.1 Second (план)\r\nSecond.\r\n';
  await writeFile(filename, content);
  const catalog = await readProjectCatalog(data.root);
  const card = catalog.cards.find(card => card.id === hero)!;
  const cardIds = [...children].reverse();
  await checkEdit(data, { name: 'subcards', edit: { action: 'reorder-subcards', cardId: hero, sourceHash: card.sourceHash, cardIds },
    change: m => { m.subCardOrder = { ...m.subCardOrder, [hero]: cardIds }; } });
  expect(await readFile(filename)).toEqual(Buffer.from(content));
});

it('keeps CRLF when a multi-line value goes into a one-line flow manifest', async () => {
  const data = await fixture('', '\r\n');
  const yaml = `{schema: 1, spaces: [{id: work, title: Work}], decks: [${flowDeck}], tracks: [], membership: []}`;
  await writeFile(data.filename, `---\r\n${yaml}\r\n---\r\nBody.\r\n`);
  await checkEdit({ ...data, original: await readFile(data.filename, 'utf8') }, operations.find(operation => operation.name === 'append deck')!);
  expect(await readFile(data.filename, 'utf8')).not.toMatch(/(?<!\r)\n/u);
});

it.each(['\n', '\r\n'])('deletes the last deck when decks is the last key without leaving a blank line (%j)', async newline => {
  const other = blockDeck.replace('id: "audio"', 'id: other');
  const data = await fixture(`schema: 1 # keep schema
spaces: [{id: work, title: Work}]
tracks: [] # keep tracks
membership: [] # keep membership
decks:
${blockDeck}
${other}`, newline);
  const expected = data.original.replace(newline + other.replace(/\n/gu, newline), '');
  await checkEdit(data, { name: 'delete last', edit: { action: 'delete-deck', deckId: 'other' }, change: m => { m.decks.pop(); }, repeat: false }, expected);
  expect(await readFile(data.filename, 'utf8')).not.toMatch(/(\r?\n){2}---/u);
});
