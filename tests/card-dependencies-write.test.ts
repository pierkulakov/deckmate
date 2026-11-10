import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { emptyManifest, readProjectCatalog, refreshProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { withCatalogSnapshot } from '../server/catalog-snapshot.ts';
import { setCardDependencies } from '../server/card-dependencies.ts';
import { createManagedMarkdown, patchNativeCardFields, readNativeCard } from '../server/native-cards.ts';
import { prepareCardOptionsPatch } from '../server/card-options.ts';
import type { SetCardDependenciesEdit } from '../src/dependency-contracts.ts';

const race = vi.hoisted(() => ({ beforePublish: undefined as (() => Promise<void>) | undefined, injected: false }));
vi.mock('../server/native-cards.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../server/native-cards.ts')>();
  return { ...actual, replaceProjectMarkdown: async (...args: Parameters<typeof actual.replaceProjectMarkdown>) => {
    const [root, relative, hash, bytes, guard] = args;
    return actual.replaceProjectMarkdown(root, relative, hash, bytes, async () => {
      if (race.beforePublish) { race.injected = true; await race.beforePublish(); }
      await guard?.();
    });
  } };
});

const roots: string[] = [];
afterEach(async () => {
  const armed = Boolean(race.beforePublish);
  const injected = race.injected;
  race.beforePublish = undefined;
  race.injected = false;
  for (const root of roots.splice(0)) {
    expect(path.dirname(root)).toBe(path.resolve(tmpdir()));
    expect(path.basename(root)).toMatch(/^deckmate-dependency-write-/u);
    await rm(root, { recursive: true, force: true });
  }
  if (armed) expect(injected, 'The dependency publication race must fire').toBe(true);
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-dependency-write-'));
  roots.push(root);
  await mkdir(path.join(root, 'tasks'));
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(emptyManifest()));
  const ids = [randomUUID(), randomUUID()];
  for (const id of ids) {
    await createManagedMarkdown(root, `cards/${id}.md`, { deckmate: 'card', schema: 1, id, kind: 'task',
      title: id, state: 'not-started', owner: null, deckId: null, trackIds: [], parentId: null, dependsOn: [] }, 'Keep body.\n');
  }
  const [a, b] = ids.map(id => `card:${id}`);
  const filename = path.join(root, `cards/${ids[0]}.md`);
  const original = '\uFEFF' + (await readFile(filename, 'utf8')).replace(/\n/gu, '\r\n');
  await writeFile(filename, original);
  const catalog = await readProjectCatalog(root);
  const edit: SetCardDependenciesEdit = { action: 'set-card-dependencies', manifestHash: catalog.manifestHash,
    cardId: a, sourceHash: catalog.cards.find(card => card.id === a)!.sourceHash, dependsOn: [b] };
  return { root, a, b, filename, original: Buffer.from(original), edit };
}

async function externalDependencies(root: string, cardId: string, dependsOn: string[]) {
  const card = await readNativeCard(root, cardId);
  await writeFile(path.join(root, card!.card.path), patchNativeCardFields(card!, { dependsOn }));
}

it('writes only dependencies, preserving BOM, CRLF and body, and repeats without writing', async () => {
  const { root, b, filename, original, edit } = await fixture();
  expect(await setCardDependencies(root, edit)).toEqual([path.relative(root, filename).replace(/\\/gu, '/')]);
  const saved = await readFile(filename);
  expect(saved).toEqual(Buffer.from(original.toString('utf8').replace('dependsOn: []', `dependsOn: ["${b}"]`)));
  const current = await readNativeCard(root, edit.cardId);
  expect(await setCardDependencies(root, { ...edit, sourceHash: current!.fileHash })).toEqual([]);
  expect(await readFile(filename)).toEqual(saved);
});

it('refuses a cycle without changing the target file', async () => {
  const { root, a, b, filename, original, edit } = await fixture();
  await externalDependencies(root, b, [a]);
  await expect(setCardDependencies(root, edit)).rejects.toThrow(/cycle/u);
  expect(await readFile(filename)).toEqual(original);
});

it('rereads the uncached graph inside the publication guard and refuses a concurrent cycle', async () => {
  const { root, a, b, filename, original, edit } = await fixture();
  const snapshot = await readProjectCatalog(root);
  race.beforePublish = () => externalDependencies(root, b, [a]);
  await expect(withCatalogSnapshot(root, snapshot, refreshProjectCatalog, () => setCardDependencies(root, edit))).rejects.toThrow(/cycle/u);
  expect(await readFile(filename)).toEqual(original);
});

it('discovers a concurrently added card that closes a previously incomplete dependency path', async () => {
  const { root, a, b, filename, original } = await fixture();
  const id = randomUUID();
  await externalDependencies(root, b, [`card:${id}`]);
  const snapshot = await readProjectCatalog(root);
  const edit: SetCardDependenciesEdit = { action: 'set-card-dependencies', cardId: a,
    sourceHash: snapshot.cards.find(card => card.id === a)!.sourceHash, manifestHash: snapshot.manifestHash, dependsOn: [b] };
  race.beforePublish = async () => {
    await writeFile(path.join(root, `cards/${id}.md`), '---\n' + JSON.stringify({ deckmate: 'card', schema: 1, id, kind: 'task',
      title: 'External card', state: 'not-started', owner: null, deckId: null, trackIds: [], parentId: null, dependsOn: [a] }) + '\n---\n');
  };
  await expect(withCatalogSnapshot(root, snapshot, refreshProjectCatalog, () => setCardDependencies(root, edit))).rejects.toThrow(/cycle/u);
  expect(await readFile(filename)).toEqual(original);
});

it.each(['source', 'manifest'] as const)('rejects a stale %s hash, including no-op requests', async kind => {
  const { root, filename, original, edit } = await fixture();
  const stale = { ...edit, dependsOn: [], [kind === 'source' ? 'sourceHash' : 'manifestHash']: '0'.repeat(64) };
  await expect(setCardDependencies(root, stale)).rejects.toThrow(kind === 'source' ? 'CARD_CONFLICT' : 'CATALOG_CONFLICT');
  expect(await readFile(filename)).toEqual(original);
});

it.each(['source', 'manifest', 'options'] as const)('guards the graph decision against a concurrent %s revision', async kind => {
  const { root, b, filename, original, edit } = await fixture();
  if (kind === 'options') {
    const plan = await prepareCardOptionsPatch(root, '', { [b]: { bookmarked: true } });
    race.beforePublish = () => plan.publish();
  } else if (kind === 'manifest') {
    race.beforePublish = async () => { await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(emptyManifest()) + '\nExternal.\n'); };
  } else {
    race.beforePublish = async () => {
      const card = await readNativeCard(root, b);
      await writeFile(path.join(root, card!.card.path), Buffer.concat([card!.bytes, Buffer.from('External.\n')]));
    };
  }
  const expected = kind === 'options' ? 'CARD_OPTIONS_CONFLICT' : 'CATALOG_CONFLICT';
  await expect(setCardDependencies(root, edit)).rejects.toThrow(expected);
  expect(await readFile(filename)).toEqual(original);
});
