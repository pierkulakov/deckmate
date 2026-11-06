import { afterEach, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stringify } from 'yaml';
import {
  createManagedMarkdown, editNativeCard, editNativeCardContent, editNativeCardProperties, listManagedMarkdown, readManagedMarkdown,
  readNativeCard, readNativeCards, validateNativeCardMetadata, type NativeCardMetadata,
} from '../server/native-cards.ts';

const roots: string[] = [];
async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), 'deckmate-native-'));
  roots.push(base);
  const root = path.join(base, 'project');
  const outside = path.join(base, 'outside');
  await mkdir(root);
  await mkdir(outside);
  return { base, root, outside };
}
function metadata(id = randomUUID(), overrides: Partial<NativeCardMetadata> = {}): NativeCardMetadata {
  return { deckmate: 'card', schema: 1, id, kind: 'task', title: 'Шаги разведчика',
    state: 'план', owner: '@glm', deckId: 'audio', trackIds: ['sound', 'animation'], parentId: null, ...overrides };
}
const relative = (id: string) => 'cards/' + id + '.md';
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const location = path.relative(tmpdir(), root);
    if (location.startsWith('..') || path.isAbsolute(location) || !path.basename(root).startsWith('deckmate-native-')) {
      throw new Error('Unexpected native fixture cleanup target');
    }
    await rm(root, { recursive: true, force: true });
  }
});

it('publishes one native task with full-file hash, UTF-8 body range and all relations', async () => {
  const { root } = await fixture();
  const cardMetadata = metadata('12345678-1234-8123-a123-123456789abc', {
    parentId: 'hero:features/soldier-life.md#10', iteration: 2, dependsOn: ['task:features/audio.md#1.2'],
    journey: { journeyId: randomUUID(), version: 3, stepId: 'audio', instanceId: randomUUID() },
  });
  const body = '# Звук\n\n- [ ] Шаг 👣\n';
  expect(await createManagedMarkdown(root, relative(cardMetadata.id), cardMetadata, body)).toBe(true);
  const result = await readNativeCard(root, 'card:' + cardMetadata.id);
  expect(result).not.toBeNull();
  expect(result!.metadata).toEqual(cardMetadata);
  expect(result!.markdown).toBe(body);
  expect(result!.bytes.subarray(result!.card.range!.start, result!.card.range!.end).toString('utf8')).toBe(body);
  expect(result!.fileHash).toBe(createHash('sha256').update(result!.bytes).digest('hex'));
  expect(result!.card).toMatchObject({ id: 'card:' + cardMetadata.id, version: null, sourceHash: result!.fileHash,
    parentId: cardMetadata.parentId, trackIds: cardMetadata.trackIds, iteration: 2, dependsOn: cardMetadata.dependsOn, journey: cardMetadata.journey });
  const catalog = await readNativeCards(root);
  expect(catalog.warnings).toEqual([]);
  expect(catalog.files).toHaveLength(1);
  expect(catalog.files[0].document).toEqual({ path: relative(cardMetadata.id), title: cardMetadata.title, hash: result!.fileHash });
});

it('reads Hero and documents as one card per file without task workflow or writable ranges', async () => {
  const { root } = await fixture();
  for (const kind of ['hero', 'doc'] as const) {
    const cardMetadata = metadata(randomUUID(), { kind, state: null, owner: null });
    await createManagedMarkdown(root, relative(cardMetadata.id), cardMetadata, 'Текст');
  }
  const catalog = await readNativeCards(root);
  expect(catalog.files).toHaveLength(2);
  expect(catalog.warnings).toEqual([]);
  for (const file of catalog.files) expect(file.card).toMatchObject({ range: null, state: null, owner: null, version: null });
});

it('changes only YAML while preserving BOM, delimiters, CRLF and body bytes', async () => {
  const { root } = await fixture();
  await mkdir(path.join(root, 'cards'));
  const cardMetadata = metadata();
  const body = '## Правило\r\nТочный текст 👣 «звук»\r\n\r\n';
  const bytes = Buffer.from('\uFEFF---\r\n' + stringify(cardMetadata).replace(/\n/g, '\r\n') + '---\r\n' + body);
  const filename = path.join(root, relative(cardMetadata.id));
  await writeFile(filename, bytes);
  const before = (await readNativeCard(root, 'card:' + cardMetadata.id))!;
  await editNativeCard(root, before.card.id, before.fileHash, { deckId: 'new-audio', trackIds: ['animation'] });
  const after = (await readNativeCard(root, before.card.id))!;
  expect(after.bytes.subarray(0, 8)).toEqual(bytes.subarray(0, 8));
  expect(after.bytes.subarray(after.bodyRange.start)).toEqual(before.bytes.subarray(before.bodyRange.start));
  expect(after.markdown).toBe(body);
  expect(after.bytes.toString('utf8').replace(/\r\n/g, '')).not.toContain('\n');
  expect(after.metadata).toEqual({ ...cardMetadata, deckId: 'new-audio', trackIds: ['animation'] });
});

it('rejects missing/stale hashes and unsupported edits without modifying the file', async () => {
  const { root } = await fixture();
  const cardMetadata = metadata();
  await createManagedMarkdown(root, relative(cardMetadata.id), cardMetadata, 'Не изменять');
  const before = (await readNativeCard(root, 'card:' + cardMetadata.id))!;
  await expect(editNativeCard(root, before.card.id, '', { deckId: null })).rejects.toThrow('current version');
  await expect(editNativeCard(root, before.card.id, 'stale', { deckId: null })).rejects.toThrow('CARD_CONFLICT');
  await expect(editNativeCard(root, before.card.id, before.fileHash, { title: 'Чужая правка' } as never)).rejects.toThrow('Invalid card edit fields');
  expect(await readFile(path.join(root, before.card.path))).toEqual(before.bytes);
});

it('does not overwrite an existing destination, including parallel publication', async () => {
  const { root } = await fixture();
  const cardMetadata = metadata();
  const results = await Promise.all([
    createManagedMarkdown(root, relative(cardMetadata.id), cardMetadata, 'Первая версия'),
    createManagedMarkdown(root, relative(cardMetadata.id), cardMetadata, 'Вторая версия'),
  ]);
  expect(results.sort()).toEqual([false, true]);
  const before = (await readNativeCard(root, 'card:' + cardMetadata.id))!;
  expect(['Первая версия', 'Вторая версия']).toContain(before.markdown);
  expect(await createManagedMarkdown(root, before.card.path, cardMetadata, 'Третья версия')).toBe(false);
  expect(await readFile(path.join(root, before.card.path))).toEqual(before.bytes);
  expect(await readdir(path.join(root, 'cards'))).toEqual([cardMetadata.id + '.md']);
});

// The preflight read and the publication recheck are separate file reads; a concurrent
// writer that lands between them must win, and no temporary file may survive.
it.each(['relations', 'properties', 'content'] as const)('rejects a %s edit whose file changes between read and publication', async entry => {
  const { root } = await fixture();
  const cardMetadata = metadata();
  await createManagedMarkdown(root, relative(cardMetadata.id), cardMetadata, 'Оригинальное тело.\n');
  const before = (await readNativeCard(root, 'card:' + cardMetadata.id))!;
  const foreign = Buffer.concat([before.bytes, Buffer.from('\r\nЧужая правка до переименования.\r\n')]);
  const intruder = async () => { await writeFile(path.join(root, before.card.path), foreign); };
  const failure = await (entry === 'relations'
    ? editNativeCard(root, before.card.id, before.fileHash, { deckId: 'tasks' }, intruder)
    : entry === 'properties'
      ? editNativeCardProperties(root, before.card.id, before.fileHash, { state: 'в работе' }, intruder)
      : editNativeCardContent(root, before.card.id, before.fileHash, { markdown: 'Новое тело.\n' }, intruder)
  ).catch(error => error);
  expect(failure).toBeInstanceOf(Error);
  expect(failure.message).toBe('CARD_CONFLICT');
  expect(failure.saved).not.toBe(true);
  expect(await readFile(path.join(root, before.card.path))).toEqual(foreign);
  expect(await readdir(path.join(root, 'cards'))).toEqual([cardMetadata.id + '.md']);
});

it('reports invalid filenames, malformed YAML and metadata identity mismatches', async () => {
  const { root } = await fixture();
  await mkdir(path.join(root, 'cards'));
  const valid = metadata();
  await createManagedMarkdown(root, relative(valid.id), valid, 'Сохранить');
  await writeFile(path.join(root, 'cards/not-a-uuid.md'), '---\nfoo: bar\n---\n');
  await writeFile(path.join(root, relative(randomUUID())), '---\ninvalid: [\n---\n');
  await writeFile(path.join(root, relative(randomUUID())), '---\n' + stringify(metadata()) + '---\n');
  const result = await readNativeCards(root);
  expect(result.files.map(file => file.card.id)).toEqual(['card:' + valid.id]);
  expect(result.warnings).toHaveLength(3);
});

it('keeps Journey files separate and returns absent paths without creating directories', async () => {
  const { root } = await fixture();
  const id = randomUUID();
  expect(await listManagedMarkdown(root, 'cards')).toEqual([]);
  expect(await readManagedMarkdown(root, relative(id))).toBeNull();
  expect(await readNativeCard(root, 'task:features/match.md#1.2')).toBeNull();
  expect(await readdir(root)).toEqual([]);
  const journey = { deckmate: 'journey', schema: 1, id, title: 'Техника', version: 1, steps: [] };
  expect(await createManagedMarkdown(root, 'tasks/journeys/' + id + '/index.md', journey, 'Описание')).toBe(true);
  expect((await readManagedMarkdown(root, 'tasks/journeys/' + id + '/index.md'))!.metadata).toEqual(journey);
  expect(await listManagedMarkdown(root, 'tasks/journeys')).toEqual(['tasks/journeys/' + id + '/index.md']);
  expect((await readNativeCards(root)).files).toEqual([]);
  const orphanId = randomUUID();
  const stepPath = 'tasks/journeys/' + orphanId + '/steps/register_vehicle-2.md';
  expect(await createManagedMarkdown(root, stepPath, { id: 'register_vehicle-2' }, 'Шаг')).toBe(true);
  expect((await readManagedMarkdown(root, stepPath))!.markdown).toBe('Шаг');
  expect(await listManagedMarkdown(root, 'tasks/journeys')).toEqual(['tasks/journeys/' + id + '/index.md']);
  await createManagedMarkdown(root, 'tasks/journeys/' + orphanId + '/index.md', { ...journey, id: orphanId }, 'Готово');
  expect(await listManagedMarkdown(root, 'tasks/journeys')).toHaveLength(2);
});

it('validates native metadata before creating files and forbids nested Hero cards', async () => {
  const { root } = await fixture();
  const valid = metadata();
  const invalid = [
    { ...valid, schema: 2 }, { ...valid, id: randomUUID() }, { ...valid, kind: ['task'] },
    { ...valid, trackIds: ['sound', 'sound'] }, { ...valid, iteration: -1 },
    { ...valid, journey: { journeyId: 'j', version: 0, stepId: 's', instanceId: 'i' } },
    { ...valid, kind: 'hero', state: null, owner: null, parentId: 'card:' + randomUUID() },
    { ...valid, kind: 'doc' },
  ];
  for (const value of invalid) {
    expect(() => validateNativeCardMetadata(value, valid.id)).toThrow();
    await expect(createManagedMarkdown(root, relative(valid.id), value, '')).rejects.toThrow();
  }
  expect(await readdir(root)).toEqual([]);
});

it('rejects traversal and files outside the two managed namespaces', async () => {
  const { root } = await fixture();
  for (const filename of ['../outside/a.md', 'cards/../a.md', 'features/' + randomUUID() + '.md', 'cards/name.md', 'cards/' + randomUUID() + '.md/child', 'tasks/journeys/' + randomUUID() + '.md', 'tasks/journeys/' + randomUUID() + '/steps/../index.md', 'tasks/journeys/' + randomUUID() + '/steps/не-ascii.md', 'tasks/journeys/' + randomUUID() + '/steps/' + 'a'.repeat(81) + '.md']) {
    await expect(createManagedMarkdown(root, filename, {}, '')).rejects.toThrow();
    await expect(readManagedMarkdown(root, filename)).rejects.toThrow();
  }
  for (const reserved of ['CON', 'prn', 'AUX', 'NUL', 'COM1', 'com9', 'LPT1', 'lpt9']) {
    const filename = 'tasks/journeys/' + randomUUID() + '/steps/' + reserved + '.md';
    await expect(createManagedMarkdown(root, filename, {}, '')).rejects.toThrow('Windows');
    await expect(readManagedMarkdown(root, filename)).rejects.toThrow('Windows');
    await expect(readManagedMarkdown(root, filename.replace(/\.md$/, '.MD'))).rejects.toThrow('Windows');
  }
  expect(await readdir(root)).toEqual([]);
});

it('rejects junctions at each managed directory and a replaced root before writing', async () => {
  for (const relativeDirectory of ['cards', 'tasks', 'tasks/journeys', 'root']) {
    const { root, outside } = await fixture();
    let pointer = relativeDirectory === 'root' ? root : path.join(root, relativeDirectory);
    if (relativeDirectory === 'tasks/journeys') await mkdir(path.join(root, 'tasks'));
    if (relativeDirectory === 'root') await rename(root, root + '-original');
    await symlink(outside, pointer, 'junction');
    const cardMetadata = metadata();
    const destination = relativeDirectory === 'cards' || relativeDirectory === 'root'
      ? relative(cardMetadata.id) : 'tasks/journeys/' + cardMetadata.id + '/index.md';
    await expect(createManagedMarkdown(root, destination, cardMetadata, 'Не писать снаружи')).rejects.toThrow();
    expect(await readdir(outside)).toEqual([]);
  }
});

it('does not follow a symlinked card and reports it instead of silently omitting it', async () => {
  const { root, outside } = await fixture();
  await mkdir(path.join(root, 'cards'));
  const id = randomUUID();
  const external = path.join(outside, 'sentinel.md');
  await writeFile(external, 'sentinel');
  // A directory junction at a .md path is rejected too, without requiring Windows symlink privileges.
  await symlink(outside, path.join(root, relative(id)), 'junction');
  await expect(readNativeCard(root, 'card:' + id)).rejects.toThrow();
  const result = await readNativeCards(root);
  expect(result.files).toHaveLength(0);
  expect(result.warnings).toHaveLength(1);
  expect(await readFile(external, 'utf8')).toBe('sentinel');
});
