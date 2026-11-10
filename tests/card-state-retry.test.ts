import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { editProjectCatalog, emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { createManagedMarkdown } from '../server/native-cards.ts';
import { prepareCardOptionsPatch, readCardOptions } from '../server/card-options.ts';
import type { CardState } from '../src/format-vocabulary.ts';

const fault = vi.hoisted(() => ({ stage: '' }));
vi.mock('../server/native-cards.ts', async importOriginal => {
  const original = await importOriginal<typeof import('../server/native-cards.ts')>();
  return {
    ...original,
    async editNativeCardProperties(...args: Parameters<typeof original.editNativeCardProperties>) {
      if (fault.stage === 'Owner' && Object.hasOwn(args[3], 'owner')) {
        fault.stage = '';
        throw new Error('Injected Owner failure');
      }
      return original.editNativeCardProperties(...args);
    },
    async replaceProjectMarkdown(...args: Parameters<typeof original.replaceProjectMarkdown>) {
      if (fault.stage === 'Owner' && args[1] === 'tasks/deckmate.md') {
        fault.stage = '';
        throw new Error('Injected Owner failure');
      }
      return original.replaceProjectMarkdown(...args);
    },
  };
});
vi.mock('../server/card-options.ts', async importOriginal => {
  const original = await importOriginal<typeof import('../server/card-options.ts')>();
  return {
    ...original,
    async prepareCardOptionsPatch(...args: Parameters<typeof original.prepareCardOptionsPatch>) {
      const plan = await original.prepareCardOptionsPatch(...args);
      const stage = Object.values(args[2]).some(patch => Object.hasOwn(patch, 'doneAt')) ? 'doneAt' : 'Hand';
      return { ...plan, async publish(...publishArgs: Parameters<typeof plan.publish>) {
        if (fault.stage === stage) {
          fault.stage = '';
          throw new Error(`Injected ${stage} failure`);
        }
        return plan.publish(...publishArgs);
      } };
    },
  };
});

const roots: string[] = [];
afterEach(async () => {
  fault.stage = '';
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(native: boolean, state: CardState) {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-state-retry-'));
  roots.push(root);
  await mkdir(path.join(root, 'tasks'));
  const manifest = emptyManifest();
  manifest.formatLanguage = 'en';
  manifest.members = [
    { id: 'alice', label: 'Alice', kind: 'human', aliases: [] },
    { id: 'bob', label: 'Bob', kind: 'agent', aliases: [] },
  ];
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  const uuid = randomUUID();
  let cardId = 'card:' + uuid;
  if (native) {
    await createManagedMarkdown(root, `cards/${uuid}.md`, {
      deckmate: 'card', schema: 1, id: uuid, kind: 'task', title: 'Retry', state,
      owner: null, deckId: null, trackIds: [], parentId: null,
    }, 'Keep this body.\n');
  } else {
    await mkdir(path.join(root, 'features'));
    await writeFile(path.join(root, 'features/retry.md'), `\uFEFF# Retry\r\n## 1 Hero\r\n### 1.0 Retry (${state})\r\nKeep this body.\r\n`);
    cardId = 'task:features/retry.md#1.0';
  }
  const options = await prepareCardOptionsPatch(root, '', {
    [cardId]: { handMemberIds: ['bob'], handOrder: { bob: 3 }, doneAt: state === 'done' ? '2026-11-01' : null },
  });
  await options.publish();
  return { root, cardId };
}

async function request(root: string, cardId: string, state: CardState) {
  const catalog = await readProjectCatalog(root);
  const card = catalog.cards.find(card => card.id === cardId)!;
  return {
    action: 'set-card-state' as const, cardId, state, manifestHash: catalog.manifestHash,
    sourceHash: card.sourceHash,
    ...(card.state === 'review' && state !== 'review' && state !== 'done' ? { returnReason: 'Revise the result.' } : {}),
  };
}

async function fileSnapshot(root: string): Promise<Record<string, { bytes: Buffer; mtime: bigint }>> {
  const result: Record<string, { bytes: Buffer; mtime: bigint }> = {};
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const filename = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const children = await fileSnapshot(filename);
      for (const [name, value] of Object.entries(children)) result[entry.name + '/' + name] = value;
    } else result[entry.name] = { bytes: await readFile(filename), mtime: (await stat(filename, { bigint: true })).mtimeNs };
  }
  return result;
}

async function expectNoop(root: string, cardId: string, state: CardState) {
  const initial = await fileSnapshot(root);
  for (const name of Object.keys(initial)) await utimes(path.join(root, name), new Date('2026-01-01'), new Date('2026-01-01'));
  const before = await fileSnapshot(root);
  expect(await editProjectCatalog(root, await request(root, cardId, state), 'alice')).toEqual([]);
  expect(await fileSnapshot(root)).toEqual(before);
}

for (const native of [true, false]) {
  it.each(['Owner', 'Hand', 'doneAt'])(`finishes a failed %s stage on retry (native=${native})`, async stage => {
    const target = stage === 'doneAt' ? 'done' : 'started';
    const { root, cardId } = await fixture(native, 'review');
    const first = await request(root, cardId, target);
    fault.stage = stage;
    await expect(editProjectCatalog(root, first, 'alice')).rejects.toMatchObject({ saved: true });
    expect(fault.stage).toBe('');
    const partial = (await readProjectCatalog(root)).cards.find(card => card.id === cardId)!;
    expect(partial.state).toBe(target);
    if (stage === 'Owner') expect(partial.owner).toBeNull();
    if (stage === 'Hand') {
      expect(partial.owner).toBe('Alice');
      expect(partial.handMemberIds).toEqual(['bob']);
    }
    if (stage === 'doneAt') expect(partial.doneAt ?? null).toBeNull();
    const beforeStale = await fileSnapshot(root);
    await expect(editProjectCatalog(root, first, 'alice')).rejects.toThrow(/CONFLICT/);
    expect(await fileSnapshot(root)).toEqual(beforeStale);
    expect(await editProjectCatalog(root, await request(root, cardId, target), 'alice')).not.toEqual([]);
    const complete = (await readProjectCatalog(root)).cards.find(card => card.id === cardId)!;
    if (target === 'started') {
      expect(complete).toMatchObject({ owner: 'Alice', handMemberIds: ['bob', 'alice'], handOrder: { bob: 3, alice: 0 } });
    } else {
      expect(complete.doneAt).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      const options = await readCardOptions(root);
      await (await prepareCardOptionsPatch(root, options.hash, { [cardId]: { doneAt: '2026-11-01' } })).publish();
    }
    await expectNoop(root, cardId, target);
  });

  it(`clears a leftover acceptance date after a failed exit from Done (native=${native})`, async () => {
    const { root, cardId } = await fixture(native, 'done');
    fault.stage = 'doneAt';
    await expect(editProjectCatalog(root, await request(root, cardId, 'review'))).rejects.toMatchObject({ saved: true });
    expect(fault.stage).toBe('');
    expect((await readProjectCatalog(root)).cards.find(card => card.id === cardId)).toMatchObject({ state: 'review', doneAt: '2026-11-01' });
    await editProjectCatalog(root, await request(root, cardId, 'review'));
    expect((await readProjectCatalog(root)).cards.find(card => card.id === cardId)!.doneAt ?? null).toBeNull();
    await expectNoop(root, cardId, 'review');
  });
}
