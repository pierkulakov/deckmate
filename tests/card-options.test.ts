import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cardOptionsPath, prepareCardOptionsPatch, readCardOptions, type CardOptionsPatch } from '../server/card-options.ts';

const roots: string[] = [];
const nativeId = 'card:12345678-1234-8123-a123-123456789abc';
const legacyId = 'task:features/audio.md#1.2';
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

async function fixture(text?: string) {
  const base = await mkdtemp(path.join(tmpdir(), 'deckmate-options-'));
  roots.push(base);
  const root = path.join(base, 'project');
  const outside = path.join(base, 'outside');
  await mkdir(root);
  await mkdir(outside);
  const filename = path.join(root, cardOptionsPath);
  if (text !== undefined) { await mkdir(path.join(root, 'tasks')); await writeFile(filename, text); }
  return { base, root, outside, filename };
}

const document = (cards: string, newline = '\n') => `---\nschema: 1\ncards: ${cards}\n---\n# Notes\nKeep the exact body.\n`.replace(/\n/gu, newline);
async function patch(root: string, changes: Record<string, CardOptionsPatch>) {
  const before = await readCardOptions(root);
  const prepared = await prepareCardOptionsPatch(root, before.hash, changes);
  await prepared.publish();
  return prepared;
}

afterEach(async () => {
  for (const base of roots.splice(0)) {
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(base));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(base).startsWith('deckmate-options-')) {
      throw new Error('Unexpected card-options cleanup target');
    }
    await rm(base, { recursive: true, force: true });
  }
});

it('reads absent options without creating a directory', async () => {
  const { root } = await fixture();
  expect(await readCardOptions(root)).toEqual({ hash: '', options: {} });
  expect(await readdir(root)).toEqual([]);
});

it('prepares without writing, then publishes canonical native and legacy options with an agent brief', async () => {
  const { root, filename } = await fixture();
  const changes = {
    [nativeId]: { handMemberIds: ['kimi', 'human-paul'], bookmarked: true, tags: ['audio', 'UI'], run: 'Run 1', milestone: 'Demo', dueDate: '2028-02-29', archived: true, deleted: true },
    [legacyId]: { kindOverride: 'doc' as const },
  };
  const prepared = await prepareCardOptionsPatch(root, '', changes);
  expect(prepared.changed).toBe(true);
  expect(await readdir(root)).toEqual([]);
  await prepared.publish();
  const bytes = await readFile(filename);
  expect(await readCardOptions(root)).toEqual({ hash: hash(bytes), options: changes });
  expect(prepared.nextHash).toBe(hash(bytes));
  expect(bytes.toString('utf8')).toContain('Agents: read the selected card entry');
});

it('clearing absent values is a no-op and does not create a sidecar', async () => {
  const { root } = await fixture();
  const prepared = await prepareCardOptionsPatch(root, '', { [legacyId]: { bookmarked: false, tags: [], run: null, kindOverride: null } });
  expect(prepared).toMatchObject({ changed: false, nextHash: '' });
  let guarded = false;
  await prepared.publish(async () => { guarded = true; });
  expect(guarded).toBe(true);
  expect(await readdir(root)).toEqual([]);
});

it('merges partial patches and normalizes false, null and empty lists as cleared options', async () => {
  const { root, filename } = await fixture();
  await patch(root, { [legacyId]: { bookmarked: true, archived: true, deleted: true, tags: ['sound'], handMemberIds: ['kimi'], run: 'One', milestone: 'Demo', dueDate: '2026-11-03', kindOverride: 'doc' } });
  await patch(root, { [legacyId]: { bookmarked: false, tags: [], handMemberIds: null, run: null, dueDate: null, kindOverride: null } });
  expect((await readCardOptions(root)).options[legacyId]).toEqual({ archived: true, deleted: true, milestone: 'Demo' });
  const current = await readFile(filename, 'utf8');
  expect(current).toContain('bookmarked: false');
  expect(current).toMatch(/tags:\s*\[\]/u);
  expect(current).toContain('run: null');
});

it('does not rewrite semantic no-ops or change their hash', async () => {
  const original = document(`{'${legacyId}': {bookmarked: true, tags: ['audio']}} # exact quotes`);
  const { root, filename } = await fixture(original);
  const prepared = await patch(root, { [legacyId]: { bookmarked: true, tags: ['audio'], archived: false } });
  expect(prepared).toMatchObject({ changed: false, nextHash: hash(original) });
  expect(await readFile(filename)).toEqual(Buffer.from(original));
});

it('rejects stale and malformed revision hashes before preparing any writes', async () => {
  const original = document('{}');
  const { root, filename } = await fixture(original);
  for (const revision of ['', '0'.repeat(64)]) await expect(prepareCardOptionsPatch(root, revision, { [legacyId]: { bookmarked: true } })).rejects.toThrow('CARD_OPTIONS_CONFLICT');
  await expect(prepareCardOptionsPatch(root, 'old', {})).rejects.toThrow('current version');
  expect(await readFile(filename)).toEqual(Buffer.from(original));
});

it('rejects an external edit between prepare and publish, including no-op plans', async () => {
  const { root, filename } = await fixture(document('{}'));
  const revision = (await readCardOptions(root)).hash;
  const changed = await prepareCardOptionsPatch(root, revision, { [legacyId]: { bookmarked: true } });
  const noop = await prepareCardOptionsPatch(root, revision, {});
  const external = document('{}') + 'External update\n';
  await writeFile(filename, external);
  await expect(changed.publish()).rejects.toThrow('CARD_OPTIONS_CONFLICT');
  await expect(noop.publish()).rejects.toThrow('CARD_OPTIONS_CONFLICT');
  expect(await readFile(filename, 'utf8')).toBe(external);
});

it('guards a missing destination and never overwrites a concurrent creation', async () => {
  const { root, filename } = await fixture();
  const prepared = await prepareCardOptionsPatch(root, '', { [legacyId]: { bookmarked: true } });
  await mkdir(path.join(root, 'tasks'));
  const external = document(`{'${legacyId}': {tags: [external]}}`);
  await writeFile(filename, external);
  await expect(prepared.publish()).rejects.toThrow('CARD_OPTIONS_CONFLICT');
  expect(await readFile(filename, 'utf8')).toBe(external);
});

it('honors the caller guard and rechecks options after the guard', async () => {
  const original = document('{}');
  const { root, filename } = await fixture(original);
  const prepared = await prepareCardOptionsPatch(root, hash(original), { [legacyId]: { bookmarked: true } });
  await expect(prepared.publish(async () => { throw new Error('CARD_CONFLICT'); })).rejects.toThrow('CARD_CONFLICT');
  expect(await readFile(filename, 'utf8')).toBe(original);
  const external = original + 'Writer changed body\n';
  await expect(prepared.publish(async () => { await writeFile(filename, external); })).rejects.toThrow('CARD_OPTIONS_CONFLICT');
  expect(await readFile(filename, 'utf8')).toBe(external);
  expect(await readdir(path.dirname(filename))).toEqual(['deckmate-card-options.md']);
});

it('preserves BOM, CRLF, comments, extensions and exact body while changing only a scalar', async () => {
  const original = '\uFEFF---\r\n# header\r\nschema: 1 # schema\r\ncustom: {note: "Я: оставлен"} # untouched\r\ncards:\r\n'
    + `  '${legacyId}': # card comment\r\n    run: 'Before' # run comment\r\n    tags: [audio] # unchanged\r\n`
    + `  '${nativeId}': {bookmarked: true} # second card\r\n---  \r\n# Тело 👣\nMixed endings\r\n`;
  const { root, filename } = await fixture(original);
  await patch(root, { [legacyId]: { run: 'After' } });
  expect(await readFile(filename)).toEqual(Buffer.from(original.replace("'Before'", '"After"')));
});

it('inserts fields and cards into flow maps without reserializing other bytes', async () => {
  const original = document(`{'${legacyId}': {run: 'One'}, '${nativeId}': {}} # keep map`);
  const { root, filename } = await fixture(original);
  await patch(root, { [legacyId]: { bookmarked: true }, [nativeId]: { tags: ['sound'] } });
  expect(await readFile(filename, 'utf8')).toBe(original.replace("{run: 'One'}", '{"bookmarked": true, run: \'One\'}').replace(`'${nativeId}': {}`, `'${nativeId}': {"tags": ["sound"]}`));
  const before = await readFile(filename, 'utf8');
  const third = 'doc:docs/audio.md';
  await patch(root, { [third]: { milestone: 'Launch' } });
  expect(await readFile(filename, 'utf8')).toBe(before.replace('cards: {', `cards: {"${third}": {"milestone":"Launch"}, `));
});

it('inserts block-map keys and replaces empty scalars without swallowing comments', async () => {
  const original = document(`\n  '${legacyId}':\n    run: # empty note\n    bookmarked: true # stay\n`);
  const { root, filename } = await fixture(original);
  await patch(root, { [legacyId]: { run: 'One', milestone: 'Demo' } });
  const next = await readFile(filename, 'utf8');
  expect(next).toContain('# empty note');
  expect(next).toContain('    bookmarked: true # stay');
  expect((await readCardOptions(root)).options[legacyId]).toEqual({ run: 'One', milestone: 'Demo', bookmarked: true });
});

it('retains every list comment and unchanged scalar byte for same-length sequence edits', async () => {
  const original = document(`\n  '${legacyId}':\n    tags:\n      - audio # first\n      # before second\n      - 'UI' # second\n    run: 'same' # stay\n`, '\r\n');
  const { root, filename } = await fixture(original);
  await patch(root, { [legacyId]: { tags: ['sound', 'UI'] } });
  expect(await readFile(filename, 'utf8')).toBe(original.replace('audio # first', '"sound" # first'));
});

it('preserves list comments when changing length or clearing a block sequence', async () => {
  const original = document(`\n  '${legacyId}':\n    tags:\n      - audio # first\n      # before second\n      - UI # second\n    run: 'same' # stay\n`);
  const { root, filename } = await fixture(original);
  await patch(root, { [legacyId]: { tags: ['sound'] } });
  let next = await readFile(filename, 'utf8');
  for (const comment of ['# first', '# before second', '# second', "run: 'same' # stay"]) expect(next).toContain(comment);
  expect((await readCardOptions(root)).options[legacyId]).toEqual({ tags: ['sound'], run: 'same' });
  await patch(root, { [legacyId]: { tags: [] } });
  next = await readFile(filename, 'utf8');
  for (const comment of ['# first', '# before second', '# second']) expect(next).toContain(comment);
  expect((await readCardOptions(root)).options[legacyId]).toEqual({ run: 'same' });
});

it('retains comments embedded in a flow list when its length changes', async () => {
  const original = document(`{'${legacyId}': {tags: [audio, # inline\n UI], run: "same"}} # end`);
  const { root, filename } = await fixture(original);
  await patch(root, { [legacyId]: { tags: ['sound'] } });
  const next = await readFile(filename, 'utf8');
  expect(next).toContain('# inline');
  expect(next).toContain('run: "same"}} # end');
  expect((await readCardOptions(root)).options[legacyId]).toEqual({ tags: ['sound'], run: 'same' });
});

it('rejects unsupported fields, types, duplicate lists, oversized input and native kind overrides without writes', async () => {
  const { root } = await fixture();
  const invalid = [{ priority: 'high' }, { deleted: 'true' }, { bookmarked: 1 }, { archived: undefined }, { run: '' }, { run: ' padded ' }, { milestone: 'x'.repeat(201) },
    { tags: ['audio', 'audio'] }, { tags: ['a\nb'] }, { tags: ['x'.repeat(81)] }, { tags: Array.from({ length: 101 }, (_, index) => String(index)) }, { handMemberIds: [1] }, { kindOverride: 'unknown' }];
  for (const patchValue of invalid) await expect(prepareCardOptionsPatch(root, '', { [legacyId]: patchValue } as never)).rejects.toThrow();
  await expect(prepareCardOptionsPatch(root, '', { [nativeId]: { kindOverride: 'doc' } })).rejects.toThrow('legacy');
  for (const id of ['__proto__', 'card:bad', 'task:x\n', 'task:' + 'x'.repeat(1000)]) await expect(prepareCardOptionsPatch(root, '', { [id]: { bookmarked: true } })).rejects.toThrow();
  await expect(prepareCardOptionsPatch(root, '', Object.fromEntries(Array.from({ length: 1001 }, (_, index) => ['task:file#' + index, { bookmarked: true }])))).rejects.toThrow('1000');
  expect(await readdir(root)).toEqual([]);
});

it('validates real calendar dates, including century leap years', async () => {
  const { root } = await fixture();
  for (const dueDate of ['2026-02-29', '1900-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '0000-01-01', '2026-1-03', '2026-11-03T00:00:00Z']) {
    await expect(prepareCardOptionsPatch(root, '', { [legacyId]: { dueDate } })).rejects.toThrow('YYYY-MM-DD');
  }
  for (const dueDate of ['2000-02-29', '2028-02-29', '2026-11-03']) expect((await prepareCardOptionsPatch(root, '', { [legacyId]: { dueDate } })).changed).toBe(true);
  expect(await readdir(root)).toEqual([]);
});

it('rejects malformed headers, duplicate keys and aliases rather than silently repairing them', async () => {
  const { root, filename } = await fixture(document('{}'));
  const invalid = ['No frontmatter', '---\nschema: 2\ncards: {}\n---\n', '---\nschema: 1\ncards: {}\ncards: {}\n---\n', document(`{'${legacyId}': {deleted: yes}}`),
    `---\nschema: 1\nanchor: &shared {run: One}\ncards: {'${legacyId}': *shared}\n---\n`];
  for (const text of invalid) {
    await writeFile(filename, text);
    await expect(readCardOptions(root)).rejects.toThrow();
    await expect(prepareCardOptionsPatch(root, hash(text), { [legacyId]: { bookmarked: true } })).rejects.toThrow();
    expect(await readFile(filename, 'utf8')).toBe(text);
  }
});

it('isolates prepared data from later caller mutations', async () => {
  const { root } = await fixture();
  const tags = ['audio'];
  const changes = { [legacyId]: { tags, run: 'One' } };
  const prepared = await prepareCardOptionsPatch(root, '', changes);
  tags.push('changed');
  changes[legacyId].run = 'Changed';
  await prepared.publish();
  expect((await readCardOptions(root)).options[legacyId]).toEqual({ tags: ['audio'], run: 'One' });
});

it('rejects a symlinked tasks directory and a junction disguised as the sidecar', async () => {
  const { root, outside, filename } = await fixture();
  const outsideFile = path.join(outside, 'deckmate-card-options.md');
  await writeFile(outsideFile, document('{}'));
  const tasks = path.join(root, 'tasks');
  await symlink(outside, tasks, 'junction');
  await expect(readCardOptions(root)).rejects.toThrow();
  await expect(prepareCardOptionsPatch(root, '', { [legacyId]: { bookmarked: true } })).rejects.toThrow();
  await rm(tasks);
  await mkdir(tasks);
  await symlink(outside, filename, 'junction');
  await expect(readCardOptions(root)).rejects.toThrow();
  expect(await readFile(outsideFile, 'utf8')).toBe(document('{}'));
});

it('rejects a directory substitution during the publication guard without writing outside the project', async () => {
  const { root, outside, filename } = await fixture(document('{}'));
  const outsideFile = path.join(outside, 'deckmate-card-options.md');
  await writeFile(outsideFile, document('{}'));
  const prepared = await prepareCardOptionsPatch(root, (await readCardOptions(root)).hash, { [legacyId]: { bookmarked: true } });
  await expect(prepared.publish(async () => {
    await rename(path.dirname(filename), path.join(root, 'original-tasks'));
    await symlink(outside, path.dirname(filename), 'junction');
  })).rejects.toThrow();
  expect(await readFile(outsideFile, 'utf8')).toBe(document('{}'));
  expect(await readFile(path.join(root, 'original-tasks/deckmate-card-options.md'), 'utf8')).toBe(document('{}'));
});
