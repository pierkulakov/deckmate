import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CatalogService } from '../server/catalog-service.ts';
import { emptyManifest, renderCatalogManifest } from '../server/catalog.ts';
import { readWholeActivity } from '../server/activity.ts';
import type { CatalogEdit } from '../src/catalog-contracts.ts';

const roots: string[] = [];
const services: CatalogService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const actions = ['set-deck-watchers', 'set-deck-guardians', 'set-deck-automation'] as const;
function settings(action: typeof actions[number], changed: boolean) {
  if (action === 'set-deck-watchers') return { action, watcherIds: changed ? ['alice'] : [] };
  if (action === 'set-deck-guardians') return { action, guardianIds: changed ? ['alice'] : [] };
  return { action, autoTag: changed ? 'release' : null, autoTagKeep: false, templateMarkdown: null,
    templateOwner: null, templateEffort: null, templatePriority: null };
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-settings-history-'));
  roots.push(root);
  await mkdir(path.join(root, 'tasks'));
  const manifest = emptyManifest();
  manifest.formatLanguage = 'en';
  manifest.spaces = [{ id: 'work', title: 'Work' }];
  manifest.decks = [{ id: 'work', spaceId: 'work', title: 'Work', kind: 'mixed', description: '', icon: 'box', color: '#123456' }];
  manifest.members = [{ id: 'alice', label: 'Alice', kind: 'human', aliases: [] }];
  const filename = path.join(root, 'tasks/deckmate.md');
  await writeFile(filename, renderCatalogManifest(manifest));
  const service = new CatalogService({ editMode: 'direct', dataRoot: root, writeRoot: root,
    projectName: 'Settings history', port: 4396, python: 'python' }, ':memory:');
  services.push(service);
  return { root, filename, service };
}

it.each(actions)('does not create an activity event for unchanged %s', async action => {
  const { root, filename, service } = await fixture();
  const catalog = await service.get('sandbox');
  const before = await readFile(filename);
  await service.edit({ ...settings(action, false), deckId: 'work', manifestHash: catalog.manifestHash } as CatalogEdit, 'sandbox', 'alice');
  expect(await readFile(filename)).toEqual(before);
  expect((await readWholeActivity(root)).events).toEqual([]);
});

it.each(actions)('records the actor once for a saved %s and ignores its retry', async action => {
  const { root, filename, service } = await fixture();
  const catalog = await service.get('sandbox');
  const edit = { ...settings(action, true), deckId: 'work', manifestHash: catalog.manifestHash } as CatalogEdit;
  const saved = await service.edit(edit, 'sandbox', 'alice');
  const events = (await readWholeActivity(root)).events;
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ action, actorMemberId: 'alice' });
  const before = await readFile(filename);
  await service.edit({ ...edit, manifestHash: saved.manifestHash }, 'sandbox', 'alice');
  expect(await readFile(filename)).toEqual(before);
  expect((await readWholeActivity(root)).events).toEqual(events);
});
