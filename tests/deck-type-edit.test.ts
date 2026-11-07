import { afterEach, expect, it, vi } from 'vitest';
import * as filesystem from 'node:fs/promises';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { emptyManifest, editProjectCatalog, readManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { createManagedMarkdown } from '../server/native-cards.ts';
import { editCatalogBulk } from '../server/catalog-bulk.ts';
import { createApp } from '../server/app.ts';
import type { CatalogEdit, DeckKind } from '../src/catalog-contracts.ts';
import type { FastifyInstance } from 'fastify';

vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});
const roots: string[] = [];
const apps: FastifyInstance[] = [];
const execute = promisify(execFile);
const cardId = 'card:11111111-1111-4111-8111-111111111111';
afterEach(async () => {
  vi.resetAllMocks(); vi.restoreAllMocks();
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(withCard = true) {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-deck-type-')); roots.push(root);
  for (const folder of ['tasks', 'features', 'Tools']) await mkdir(path.join(root, folder));
  await writeFile(path.join(root, 'Tools/board.py'), '# Test fixture\n');
  await writeFile(path.join(root, 'features/match.md'), '# Match\n## 1 — Core\n### 1.1 Task (план)\nSource text\n');
  await writeFile(path.join(root, 'tasks/iterations.md'), '## Итерация 1 — Test\n');
  const manifest = emptyManifest(); manifest.spaces.push({ id: 'work', title: 'Work' });
  for (const [id, kind] of [['target', 'task'], ['source', 'asset'], ['unrelated', 'knowledge']] as const) manifest.decks.push({ id, kind, title: id, spaceId: 'work', description: 'Keep description', icon: 'box', color: '#abcdef', style: 'minimal', coverPosition: 42 });
  await writeFile(path.join(root, 'tasks/deckmate.md'), '\uFEFF' + renderCatalogManifest(manifest).replaceAll('\n', '\r\n') + '\nPersonal text\n');
  if (withCard) await createManagedMarkdown(root, `cards/${cardId.slice(5)}.md`, { deckmate: 'card', schema: 1, id: cardId.slice(5), kind: 'task', title: 'Task', state: 'план', owner: null, deckId: 'target', trackIds: [], parentId: null }, 'Keep **body**.\n');
  return root;
}
async function request(root: string, deckId: string, kind: DeckKind): Promise<Extract<CatalogEdit, {action: 'set-deck-kind'}>> {
  return { action: 'set-deck-kind', manifestHash: (await readProjectCatalog(root)).manifestHash, deckId, kind };
}
it('changes only the semantic deck kind, preserves non-YAML bytes and leaves source cards untouched', async () => {
  const root = await fixture();
  const before = await readManifest(root);
  const cardBytes = await readFile(path.join(root, `cards/${cardId.slice(5)}.md`));
  await editProjectCatalog(root, await request(root, 'target', 'mixed'));
  const after = await readManifest(root);
  expect(after.manifest).toEqual({ ...before.manifest, decks: before.manifest.decks.map(deck => deck.id === 'target' ? { ...deck, kind: 'mixed' } : deck) });
  expect(after.bytes!.subarray(0, after.yamlStart)).toEqual(before.bytes!.subarray(0, before.yamlStart));
  expect(after.bytes!.subarray(after.yamlEnd)).toEqual(before.bytes!.subarray(before.yamlEnd));
  expect(await readFile(path.join(root, `cards/${cardId.slice(5)}.md`))).toEqual(cardBytes);
  vi.mocked(filesystem.writeFile).mockClear();
  await editProjectCatalog(root, await request(root, 'target', 'mixed'));
  expect(filesystem.writeFile).not.toHaveBeenCalled();
});
it.each(['archived', 'deleted'] as const)('rejects incompatible %s cards without changing the manifest', async key => {
  const root = await fixture(); const catalog = await readProjectCatalog(root);
  await editCatalogBulk(root, { action: 'bulk-edit-cards', manifestHash: catalog.manifestHash, optionsHash: catalog.optionsHash ?? '', cards: [{ cardId, sourceHash: catalog.cards.find(card => card.id === cardId)!.sourceHash }], change: { kind: 'options', patch: { [key]: true } } });
  const before = await readFile(path.join(root, 'tasks/deckmate.md'));
  await expect(editProjectCatalog(root, await request(root, 'target', 'knowledge'))).rejects.toThrow('does not accept');
  expect(await readFile(path.join(root, 'tasks/deckmate.md'))).toEqual(before);
});
it('protects empty Journey source/destination decks while allowing Mixed', async () => {
  const root = await fixture(false);
  await editProjectCatalog(root, { action: 'create-journey', manifestHash: (await readProjectCatalog(root)).manifestHash, deckId: 'source', title: 'Pipeline', steps: [{ id: 'step', title: 'Step', markdown: 'Instructions', deckId: 'target', owner: null, dependsOn: [] }] });
  const before = await readFile(path.join(root, 'tasks/deckmate.md'));
  await expect(editProjectCatalog(root, await request(root, 'source', 'knowledge'))).rejects.toThrow('Journey');
  await expect(editProjectCatalog(root, await request(root, 'target', 'asset'))).rejects.toThrow('Journey');
  expect(await readFile(path.join(root, 'tasks/deckmate.md'))).toEqual(before);
  await editProjectCatalog(root, await request(root, 'source', 'mixed'));
  await editProjectCatalog(root, await request(root, 'target', 'mixed'));
});
it('rejects stale manifest and an external card added between validation and publication', async () => {
  const root = await fixture();
  const before = await readFile(path.join(root, 'tasks/deckmate.md'));
  await expect(editProjectCatalog(root, { ...await request(root, 'target', 'mixed'), manifestHash: '0'.repeat(64) })).rejects.toThrow('CATALOG_CONFLICT');
  const actual = vi.mocked(filesystem.writeFile).getMockImplementation()!;
  let inserted = false;
  vi.mocked(filesystem.writeFile).mockImplementation(async (...args) => {
    const result = await actual(...args);
    if (!inserted && String(args[0]).includes('deckmate.md.') && String(args[0]).endsWith('.tmp')) {
      inserted = true;
      await createManagedMarkdown(root, 'cards/22222222-2222-4222-8222-222222222222.md', { deckmate: 'card', schema: 1, id: '22222222-2222-4222-8222-222222222222', kind: 'task', title: 'Concurrent', state: 'план', owner: null, deckId: 'target', trackIds: [], parentId: null }, 'External card\n');
    }
    return result;
  });
  await expect(editProjectCatalog(root, await request(root, 'target', 'mixed'))).rejects.toThrow('CATALOG_CONFLICT');
  expect(inserted).toBe(true);
  expect(await readFile(path.join(root, 'tasks/deckmate.md'))).toEqual(before);
});
it('validates the API enum and sandbox boundary, then returns updated type', async () => {
  const root = await fixture(); await execute('git', ['init', '-b', 'deckmate/sandbox', root], { windowsHide: true });
  const app = await createApp({ editMode: 'sandbox', dataRoot: root, writeRoot: root, projectName: 'Test', port: 44319, python: 'python' }); apps.push(app);
  const headers = { host: '127.0.0.1:44319' };
  const token = (await app.inject({ url: '/api/snapshot', headers })).json().token;
  const authorized = { ...headers, 'x-deckmate-token': token };
  const payload = { ...await request(root, 'target', 'mixed'), source: 'sandbox' };
  expect((await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: { ...payload, source: 'live' } })).statusCode).toBe(403);
  expect((await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: { ...payload, kind: 'gdd' } })).statusCode).toBe(400);
  const response = await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().decks.find((deck: {id: string}) => deck.id === 'target').kind).toBe('mixed');
});
