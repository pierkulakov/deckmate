import { afterEach, expect, it, vi } from 'vitest';
import * as filesystem from 'node:fs/promises';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CatalogEdit } from '../src/catalog-contracts.ts';
import { editProjectCatalog, emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { createManagedMarkdown, type NativeCardMetadata } from '../server/native-cards.ts';
import { readCardState } from '../src/format-vocabulary.ts';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});
const roots: string[] = [];
const taskId = 'task:features/sound.md#1.0';
type PropertiesEdit = Extract<CatalogEdit, { action: 'set-card-properties' }>;
type StateEdit = Extract<CatalogEdit, { action: 'set-card-state' }>;
afterEach(async () => {
  const actual = await vi.importActual<typeof filesystem>('node:fs/promises');
  vi.mocked(filesystem.open).mockReset().mockImplementation(actual.open);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-card-properties-'));
  roots.push(root);
  for (const directory of ['features', 'tasks', 'docs']) await mkdir(path.join(root, directory));
  const mechanic = path.join(root, 'features/sound.md');
  await writeFile(mechanic, '\uFEFF# Звук\r\n\r\n## 1 — Оружие\r\nОписание.\n### ✅ 1.0 Выстрел (не делаем)\r\n**Кто:** Kim, после ревью\r\nТело не трогать.\n### 1.1 Хвост (принято 2026-10-30)\r\nЧужая задача.\n');
  await writeFile(path.join(root, 'docs/brief.md'), '# Brief\nОписание.\n');
  await writeFile(path.join(root, 'tasks/iterations.md'), '# Журнал\n## Итерация 4 — Раньше\n## Итерация 7 — Сейчас\n');
  const manifest = emptyManifest();
  manifest.spaces = [{ id: 'work', title: 'Work' }];
  manifest.decks = [{ id: 'mixed', spaceId: 'work', title: 'Mixed', kind: 'mixed', description: '', icon: 'box', color: '#123456' }];
  manifest.tracks = [{ id: 'audio', title: 'Audio', description: '' }];
  manifest.members = [{ id: 'kimi', label: 'Kimi', kind: 'agent', aliases: ['Kim'] }];
  const filename = path.join(root, 'tasks/deckmate.md');
  await writeFile(filename, '\uFEFF' + renderCatalogManifest(manifest)
    .replace('membership: []', `membership: [{card: '${taskId}', deck: mixed, tracks: [audio]}] # preserve comment`)
    .replace(/\n/gu, '\r\n') + '\nСохранить пользовательский текст.\n');
  return { root, filename, mechanic };
}

async function native(root: string, kind: NativeCardMetadata['kind'] = 'task') {
  const id = randomUUID();
  const relative = `cards/${id}.md`;
  const metadata: NativeCardMetadata = { deckmate: 'card', schema: 1, id, kind, title: 'Новая карточка', state: kind === 'task' ? 'план' : null,
    owner: null, deckId: 'mixed', trackIds: ['audio'], parentId: null, iteration: 4, effort: 3, priority: 'low',
    journey: { journeyId: 'pipeline-audio', version: 2, stepId: 'sfx', instanceId: 'instance-one' }, custom: 'value: keep' };
  await createManagedMarkdown(root, relative, metadata, 'Тело с CRLF.\r\nИ с LF.\n');
  const filename = path.join(root, relative);
  let text = await readFile(filename, 'utf8');
  const boundary = text.indexOf('\n---\n') + 5;
  text = '\uFEFF' + text.slice(0, boundary).replace(/\n/gu, '\r\n').replace('owner: null', 'owner: null # keep owner comment') + text.slice(boundary);
  await writeFile(filename, text);
  return { id: 'card:' + id, filename };
}

async function baseline(root: string, cardId: string) {
  const catalog = await readProjectCatalog(root);
  const card = catalog.cards.find(candidate => candidate.id === cardId)!;
  return { cardId, sourceHash: card.sourceHash, manifestHash: catalog.manifestHash };
}
async function properties(root: string, cardId: string, values: Partial<Pick<PropertiesEdit, 'owner' | 'effort' | 'priority'>> = {}): Promise<PropertiesEdit> {
  return { action: 'set-card-properties', ...await baseline(root, cardId), owner: 'Kim', effort: 2.5, priority: 'high', ...values };
}

it('sets native properties with only scalar replacements; body, Journey and every other byte survive', async () => {
  const { root, filename } = await fixture();
  const card = await native(root);
  const before = await readFile(card.filename);
  const manifest = await readFile(filename);
  await editProjectCatalog(root, await properties(root, card.id));
  const expected = before.toString('utf8').replace('owner: null', 'owner: "Kimi"').replace('effort: 3', 'effort: 2.5').replace('priority: low', 'priority: "high"');
  expect(await readFile(card.filename)).toEqual(Buffer.from(expected));
  expect(await readFile(filename)).toEqual(manifest);
  const projected = (await readProjectCatalog(root)).cards.find(candidate => candidate.id === card.id)!;
  expect(projected).toMatchObject({ owner: 'Kimi', effort: 2.5, priority: 'high', iteration: 4, journey: { version: 2 }, deckId: 'mixed', trackIds: ['audio'] });
  const identity = await stat(card.filename, { bigint: true });
  expect(await editProjectCatalog(root, await properties(root, card.id))).toEqual([]);
  const after = await stat(card.filename, { bigint: true });
  expect([after.ino, after.mtimeNs]).toEqual([identity.ino, identity.mtimeNs]);
});

it('inserts missing optional native scalars without reserializing the header or normalizing the body', async () => {
  const { root } = await fixture();
  const card = await native(root);
  const original = (await readFile(card.filename, 'utf8')).replace('effort: 3\r\n', '').replace('priority: low\r\n', '');
  await writeFile(card.filename, original);
  await editProjectCatalog(root, await properties(root, card.id, { owner: null }));
  const after = await readFile(card.filename, 'utf8');
  expect(after.replace('priority: "high"\r\n', '').replace('effort: 2.5\r\n', '')).toBe(original);
});

it.each(['hero', 'doc'] as const)('allows custom owner and nullable properties on native %s and legacy cards', async kind => {
  const { root } = await fixture();
  const card = await native(root, kind);
  const values = { owner: 'Sound designer', effort: 0, priority: null } as const;
  await editProjectCatalog(root, await properties(root, card.id, values));
  expect((await readProjectCatalog(root)).cards.find(candidate => candidate.id === card.id)).toMatchObject({ ...values, state: null });
  const legacyId = kind === 'hero' ? 'hero:features/sound.md#1' : 'doc:docs/brief.md';
  await editProjectCatalog(root, await properties(root, legacyId, values));
  expect((await readProjectCatalog(root)).cards.find(candidate => candidate.id === legacyId)).toMatchObject({ ...values, state: null });
});

it('keeps legacy imports until explicitly overridden; null clears without changing the mechanic', async () => {
  const { root, filename, mechanic } = await fixture();
  const before = await readFile(filename, 'utf8');
  const source = await readFile(mechanic);
  expect((await readProjectCatalog(root)).cards.find(card => card.id === taskId)?.owner).toBe('Kimi');
  await editProjectCatalog(root, await properties(root, taskId));
  expect(await readFile(filename, 'utf8')).toBe(before.replace(`{card: '${taskId}'`, `{priority: "high", effort: 2.5, owner: "Kimi", card: '${taskId}'`));
  await editProjectCatalog(root, await properties(root, taskId, { owner: null, effort: null, priority: null }));
  const cleared = (await readProjectCatalog(root)).cards.find(card => card.id === taskId)!;
  expect(cleared).toMatchObject({ owner: null, effort: null, priority: null, deckId: 'mixed', trackIds: ['audio'], parentId: 'hero:features/sound.md#1' });
  expect(await readFile(mechanic)).toEqual(source);
  const identity = await stat(filename, { bigint: true });
  expect(await editProjectCatalog(root, await properties(root, taskId, { owner: null, effort: null, priority: null }))).toEqual([]);
  const after = await stat(filename, { bigint: true });
  expect([after.ino, after.mtimeNs]).toEqual([identity.ino, identity.mtimeNs]);
});

it.each(['обсуждаем', 'итерация', 'в работе', 'приёмка', 'принято', 'план'] as const)('updates only the legacy heading for state %s', async state => {
  const { root, mechanic, filename } = await fixture();
  const before = await readFile(mechanic);
  const manifest = await readFile(filename);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date());
  const mark = state === 'план' ? '' : state === 'итерация' ? ' (итерация 7)' : state === 'принято' ? ` (принято ${date})` : ` (${state})`;
  const edit: StateEdit = { action: 'set-card-state', ...await baseline(root, taskId), state };
  await editProjectCatalog(root, edit);
  const expected = before.toString('utf8').replace('### ✅ 1.0 Выстрел (не делаем)', `### ${state === 'принято' ? '✅ ' : ''}1.0 Выстрел${mark}`);
  expect(await readFile(mechanic)).toEqual(Buffer.from(expected));
  expect(await readFile(filename)).toEqual(manifest);
  expect((await readProjectCatalog(root)).cards.find(card => card.id === taskId)?.state).toBe(readCardState(state));
  const identity = await stat(mechanic, { bigint: true });
  expect(await editProjectCatalog(root, { ...edit, ...await baseline(root, taskId) })).toEqual([]);
  const after = await stat(mechanic, { bigint: true });
  expect([after.ino, after.mtimeNs]).toEqual([identity.ino, identity.mtimeNs]);
});

it.each(['CR-only', 'mixed'] as const)('preserves body, neighbouring status and exact endings in a %s file', async endings => {
  const { root, mechanic } = await fixture();
  const oldHeading = '### ✅ 1.0 Выстрел (в работе)';
  const lines = ['\uFEFF# Звук', '## 1 — Оружие', oldHeading,
    'Текст (обсуждаем) сохраняется.', '### 1.1 Хвост (принято 2026-10-30)', 'Чужой текст (не делаем).'];
  const separators = endings === 'CR-only' ? ['\r', '\r', '\r', '\r', '\r', '\r'] : ['\r\n', '\n', '\r', '\r', '\r\n', '\n'];
  const original = lines.map((line, index) => line + separators[index]).join('');
  await writeFile(mechanic, original);
  await editProjectCatalog(root, { action: 'set-card-state', ...await baseline(root, taskId), state: 'план' });
  expect(await readFile(mechanic)).toEqual(Buffer.from(original.replace(oldHeading, '### 1.0 Выстрел')));
  const cards = (await readProjectCatalog(root)).cards;
  expect(cards.find(card => card.id === taskId)?.state).toBe('not-started');
  expect(cards.find(card => card.id === 'task:features/sound.md#1.1')?.state).toBe('done');
});

it('changes only native state and refuses state changes on a Doc or a Hero workflow state', async () => {
  const { root } = await fixture();
  const card = await native(root);
  const before = await readFile(card.filename, 'utf8');
  await editProjectCatalog(root, { action: 'set-card-state', ...await baseline(root, card.id), state: 'приёмка' });
  expect(await readFile(card.filename, 'utf8')).toBe(before.replace('state: план', 'state: "приёмка"'));
  for (const [kind, refusal] of [['hero', 'only be marked done'], ['doc', 'Only Task']] as const) {
    const nonTask = await native(root, kind);
    const source = await readFile(nonTask.filename);
    await expect(editProjectCatalog(root, { action: 'set-card-state', ...await baseline(root, nonTask.id), state: 'в работе' })).rejects.toThrow(refusal);
    expect(await readFile(nonTask.filename)).toEqual(source);
  }
});

// 2026-11-09: a Hero without counted Task Sub Cards is marked done by hand; with them, only its children finish it.
it('marks a native Hero without counted Task Sub Cards done and back, changing only its state line', async () => {
  const { root } = await fixture();
  const hero = await native(root, 'hero');
  const before = await readFile(hero.filename, 'utf8');
  await editProjectCatalog(root, { action: 'set-card-state', ...await baseline(root, hero.id), state: 'done' });
  expect(await readFile(hero.filename, 'utf8')).toBe(before.replace('state: null', 'state: "принято"'));
  expect((await readProjectCatalog(root)).cards.find(candidate => candidate.id === hero.id)).toMatchObject({ state: 'done', doneAt: expect.any(String) });
  await editProjectCatalog(root, { action: 'set-card-state', ...await baseline(root, hero.id), state: 'not-started' });
  expect(await readFile(hero.filename, 'utf8')).toBe(before);
  const unmarked = (await readProjectCatalog(root)).cards.find(candidate => candidate.id === hero.id)!;
  expect([unmarked.state, unmarked.doneAt ?? null]).toEqual([null, null]);
  expect(await editProjectCatalog(root, { action: 'set-card-state', ...await baseline(root, hero.id), state: 'not-started' })).toEqual([]);
});

it('refuses a manual done mark on a Hero with open Task Sub Cards and on a legacy Hero', async () => {
  const { root } = await fixture();
  const hero = await native(root, 'hero');
  const child = await native(root);
  await writeFile(child.filename, (await readFile(child.filename, 'utf8')).replace('parentId: null', `parentId: '${hero.id}'`));
  const source = await readFile(hero.filename);
  await expect(editProjectCatalog(root, { action: 'set-card-state', ...await baseline(root, hero.id), state: 'done' })).rejects.toThrow('0 of 1');
  expect(await readFile(hero.filename)).toEqual(source);
  await editProjectCatalog(root, { action: 'set-card-state', ...await baseline(root, child.id), state: 'не делаем' });
  await editProjectCatalog(root, { action: 'set-card-state', ...await baseline(root, hero.id), state: 'done' });
  expect((await readProjectCatalog(root)).cards.find(candidate => candidate.id === hero.id)?.state).toBe('done');
  // A Task back in work outweighs the mark: the catalog reads the Hero as not done while the file keeps its mark.
  await editProjectCatalog(root, { action: 'set-card-state', ...await baseline(root, child.id), state: 'план' });
  expect((await readProjectCatalog(root)).cards.find(candidate => candidate.id === hero.id)?.state).toBeNull();
  expect(await readFile(hero.filename, 'utf8')).toContain('state: "принято"');
  await expect(editProjectCatalog(root, { action: 'set-card-state', ...await baseline(root, 'hero:features/sound.md#1'), state: 'done' })).rejects.toThrow('mechanics document');
});

it('rejects malformed properties and stale hashes without writes', async () => {
  const { root, filename } = await fixture();
  const card = await native(root);
  for (const id of [card.id, taskId]) {
    const edit = await properties(root, id);
    for (const invalid of [{ owner: 'x'.repeat(121) }, { owner: 'Line\nBreak' }, { owner: ' ' }, { effort: -1 }, { effort: Infinity }, { effort: NaN }, { priority: 'urgent' as PropertiesEdit['priority'] }]) {
      await expect(editProjectCatalog(root, { ...edit, ...invalid })).rejects.toThrow();
    }
    for (const patch of [{ sourceHash: '0'.repeat(64) }, { manifestHash: '0'.repeat(64) }]) {
      const source = await readFile(card.filename);
      const manifest = await readFile(filename);
      await expect(editProjectCatalog(root, { ...edit, ...patch })).rejects.toThrow(/CONFLICT/u);
      await expect(editProjectCatalog(root, { action: 'set-card-state', ...await baseline(root, id), state: 'в работе', ...patch })).rejects.toThrow(/CONFLICT/u);
      expect(await readFile(card.filename)).toEqual(source);
      expect(await readFile(filename)).toEqual(manifest);
    }
  }
});

it.each(['native state / manifest', 'legacy properties / child', 'legacy iteration / journal'] as const)('rechecks sources before publication: %s', async scenario => {
  const { root, filename, mechanic } = await fixture();
  const card = await native(root);
  const edit: CatalogEdit = scenario === 'native state / manifest'
    ? { action: 'set-card-state', ...await baseline(root, card.id), state: 'в работе' }
    : scenario === 'legacy properties / child' ? await properties(root, taskId)
      : { action: 'set-card-state', ...await baseline(root, taskId), state: 'итерация' };
  const destination = scenario === 'native state / manifest' ? card.filename : scenario === 'legacy properties / child' ? filename : mechanic;
  const external = scenario === 'native state / manifest' ? filename : scenario === 'legacy properties / child' ? mechanic : path.join(root, 'tasks/iterations.md');
  const before = await readFile(destination);
  const actual = await vi.importActual<typeof filesystem>('node:fs/promises');
  let changed = false;
  vi.mocked(filesystem.open).mockImplementation(async (target, flags, mode) => {
    if (flags === 'wx' && !changed) {
      changed = true;
      await actual.writeFile(external, Buffer.concat([await actual.readFile(external), Buffer.from('\nExternal edit\n')]));
    }
    return actual.open(target, flags, mode);
  });
  await expect(editProjectCatalog(root, edit)).rejects.toThrow(/CONFLICT/u);
  expect(changed).toBe(true);
  expect(await readFile(destination)).toEqual(before);
});

it('creates Hero/Doc with canonical or custom owners under the same properties contract', async () => {
  const { root } = await fixture();
  for (const [kind, owner] of [['hero', 'Kim'], ['doc', 'Designer']] as const) {
    const catalog = await readProjectCatalog(root);
    const cardId = 'card:' + randomUUID();
    await editProjectCatalog(root, { action: 'create-card', manifestHash: catalog.manifestHash, cardId, kind, owner,
      title: kind, markdown: '', deckId: 'mixed', trackIds: [], parentId: null, effort: null, priority: null });
    expect((await readProjectCatalog(root)).cards.find(card => card.id === cardId)).toMatchObject({ state: null, owner: owner === 'Kim' ? 'Kimi' : owner });
  }
});
