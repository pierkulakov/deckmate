import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { editProjectCatalog, emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { createManagedMarkdown } from '../server/native-cards.ts';

const race = vi.hoisted(() => ({ afterState: null as null | (() => Promise<void>) }));
vi.mock('../server/native-cards.ts', async importOriginal => {
  const original = await importOriginal<typeof import('../server/native-cards.ts')>();
  return { ...original, async editNativeCardProperties(...args: Parameters<typeof original.editNativeCardProperties>) {
    const changed = await original.editNativeCardProperties(...args);
    if (Object.hasOwn(args[3], 'state') && race.afterState) {
      const inject = race.afterState;
      race.afterState = null;
      await inject();
    }
    return changed;
  } };
});

const roots: string[] = [];
afterEach(async () => {
  race.afterState = null;
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it.each(['owner', 'body'])('does not adopt an external %s revision between the state and Owner stages', async field => {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-state-source-race-'));
  roots.push(root);
  await mkdir(path.join(root, 'tasks'));
  const manifest = emptyManifest();
  manifest.formatLanguage = 'en';
  manifest.members = [{ id: 'alice', label: 'Alice', kind: 'human', aliases: [] }];
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  const id = randomUUID();
  const relative = `cards/${id}.md`;
  const filename = path.join(root, relative);
  await createManagedMarkdown(root, relative, { deckmate: 'card', schema: 1, id, kind: 'task', title: 'Start safely',
    state: 'not-started', owner: null, parentId: null, deckId: null, trackIds: [] }, 'Keep this body.  \r\nLast line');
  const initial = '\uFEFF' + (await readFile(filename, 'utf8')).replace(/(?<!\r)\n/gu, '\r\n');
  await writeFile(filename, initial);
  const catalog = await readProjectCatalog(root);
  const card = catalog.cards.find(card => card.id === `card:${id}`)!;
  let foreign: Buffer | undefined;
  race.afterState = async () => {
    const saved = await readFile(filename, 'utf8');
    foreign = Buffer.from(field === 'owner' ? saved.replace('owner: null', 'owner: Bob # external assignment')
      : saved.replace('Keep this body.', 'External body.'));
    await writeFile(filename, foreign);
  };
  await expect(editProjectCatalog(root, { action: 'set-card-state', cardId: card.id, sourceHash: card.sourceHash,
    manifestHash: catalog.manifestHash, state: 'started' }, 'alice')).rejects.toMatchObject({ saved: true });
  expect(race.afterState).toBeNull();
  expect(await readFile(filename)).toEqual(foreign);
  expect(foreign).toEqual(Buffer.from(initial.replace('state: not-started', 'state: "started"')
    .replace(field === 'owner' ? 'owner: null' : 'Keep this body.',
      field === 'owner' ? 'owner: Bob # external assignment' : 'External body.')));
});
