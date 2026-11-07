import { afterEach, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Boards } from '../server/boards.ts';
import type { BoardScene } from '../src/board-contracts.ts';

const execute = promisify(execFile);
const roots: string[] = [];
const empty: BoardScene = { type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} };
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhVEAAAAASUVORK5CYII=';
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-boards-'));
  roots.push(root);
  await execute('git', ['init', '-b', 'deckmate/sandbox', root], { windowsHide: true });
  return { root, boards: new Boards({ editMode: 'sandbox', dataRoot: root, writeRoot: root, projectName: 'Fixture', port: 4317, python: 'python' }) };
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.basename(root).startsWith('deckmate-boards-') || path.dirname(root) !== tmpdir().replace(/[\\/]$/u, '')) throw new Error('Unsafe fixture cleanup');
    await rm(root, { recursive: true, force: true });
  }
});

it('roundtrips drawing and card links, with external image bytes and no base64 on disk', async () => {
  const { root, boards } = await fixture();
  const scene: BoardScene = { ...empty, elements: [
    { id: 'card', type: 'rectangle', link: '/?view=deck&card=card:abc', customData: { deckmateCardId: 'card:abc' } },
    { id: 'image', type: 'image', fileId: 'file-one' },
    { id: 'deleted', type: 'rectangle', isDeleted: true, customData: { deckmateCardId: 'missing' } },
  ], files: { 'file-one': { dataURL: `data:image/png;base64,${png}`, mimeType: 'image/png', created: 100 } } };
  const saved = await boards.save('sandbox', { title: 'Звуковой поток', hash: '', scene });
  expect(saved.linkedCardIds).toEqual(['card:abc']);
  expect(saved.scene.elements).toEqual(scene.elements);
  expect(saved.scene.files['file-one']).toMatchObject(scene.files['file-one'] as object);
  const disk = await readFile(path.join(root, saved.path), 'utf8');
  expect(disk).not.toContain('base64');
  expect(JSON.parse(disk).files).toEqual({});
  const updated = await boards.save('sandbox', { id: saved.id, title: saved.title, hash: saved.hash, scene: saved.scene });
  expect(updated.hash).toBe(saved.hash);
  expect(await readdir(path.join(root, 'tasks/deckmate-assets/covers'))).toHaveLength(1);
  expect(await boards.list('sandbox')).toEqual([expect.objectContaining({ id: saved.id, linkedCardIds: ['card:abc'] })]);
});

it('rejects stale saves and preserves the actual board', async () => {
  const { boards } = await fixture();
  const first = await boards.save('sandbox', { title: 'Первый', hash: '', scene: empty });
  await boards.save('sandbox', { id: first.id, title: 'Новый', hash: first.hash, scene: empty });
  await expect(boards.save('sandbox', { id: first.id, title: 'Устаревший', hash: first.hash, scene: empty })).rejects.toMatchObject({ status: 409 });
  expect((await boards.read('sandbox', first.id)).title).toBe('Новый');
});

it('blocks live writes, path escapes, malformed scenes and missing image files', async () => {
  const { boards } = await fixture();
  await expect(boards.save('live', { title: 'No', hash: '', scene: empty })).rejects.toMatchObject({ status: 403 });
  await expect(boards.read('sandbox', '../outside')).rejects.toMatchObject({ status: 400 });
  await expect(boards.save('sandbox', { title: 'No', hash: '', scene: { ...empty, elements: [{ id: 'same' }, { id: 'same' }] } })).rejects.toMatchObject({ status: 422 });
  await expect(boards.save('sandbox', { title: 'No', hash: '', scene: { ...empty, elements: [{ id: 'image', type: 'image', fileId: 'missing' }] } })).rejects.toMatchObject({ status: 422 });
});

it('refuses a boards junction without creating files outside', async () => {
  const { root, boards } = await fixture();
  const outside = path.join(root, 'outside');
  await mkdir(outside);
  await symlink(outside, path.join(root, 'boards'), 'junction');
  await expect(boards.save('sandbox', { title: 'No', hash: '', scene: empty })).rejects.toMatchObject({ status: 422 });
  expect(await readdir(outside)).toEqual([]);
});

it('refuses a project root replaced by a junction', async () => {
  const { root, boards } = await fixture();
  const moved = root + '-moved';
  await rename(root, moved);
  roots.push(moved);
  await symlink(moved, root, 'junction');
  await expect(boards.save('sandbox', { title: 'No', hash: '', scene: empty })).rejects.toMatchObject({ status: 422 });
  expect(await readdir(moved)).toEqual(['.git']);
});
