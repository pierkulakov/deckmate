import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertCatalogCoverFile, decodeCatalogCover, isCatalogCoverPath, storeCatalogCover } from '../server/catalog-covers.ts';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhVEAAAAASUVORK5CYII=', 'base64');
const pngUrl = `data:image/png;base64,${png.toString('base64')}`;
const roots: string[] = [];
async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), 'deckmate-covers-'));
  roots.push(base);
  const root = path.join(base, 'project');
  const outside = path.join(base, 'outside');
  await mkdir(root);
  await mkdir(outside);
  return { base, root, outside };
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const relative = path.relative(tmpdir(), root);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(root).startsWith('deckmate-covers-')) throw new Error('Unexpected fixture cleanup target');
    await rm(root, { recursive: true, force: true });
  }
});

it('stores image bytes as an exclusive UUID file and validates the reference', async () => {
  const { root } = await fixture();
  const asset = await storeCatalogCover(root, pngUrl);
  expect(asset.relativePath).toMatch(/^tasks\/deckmate-assets\/covers\/[0-9a-f-]{36}\.png$/u);
  expect(await readFile(path.join(root, asset.relativePath))).toEqual(png);
  await assertCatalogCoverFile(root, asset.relativePath);
  await asset.remove();
  expect(await readdir(path.join(root, 'tasks/deckmate-assets/covers'))).toEqual([]);
});

it('rejects noncanonical base64, wrong MIME, malformed magic and decoded oversize', () => {
  const invalid = [
    `https://example.com/cover.png`, `data:image/svg+xml;base64,${png.toString('base64')}`,
    `data:image/jpeg;base64,${png.toString('base64')}`, pngUrl + '\n', pngUrl.replace(/I=$/u, 'J='),
    'data:image/png;base64,AAAA===', 'data:image/png;base64,',
  ];
  for (const value of invalid) expect(() => decodeCatalogCover(value), value).toThrow();
  const oversized = Buffer.alloc(5 * 1024 * 1024 + 1);
  png.copy(oversized, 0);
  expect(() => decodeCatalogCover(`data:image/png;base64,${oversized.toString('base64')}`)).toThrow('5 MB');
  expect(decodeCatalogCover(pngUrl).bytes).toEqual(png);
});

it('checks exact WebP bytes, including the high bit and RIFF length', () => {
  const webp = Buffer.alloc(20);
  webp.write('RIFF', 0);
  webp.writeUInt32LE(12, 4);
  webp.write('WEBPVP8 ', 8);
  expect(decodeCatalogCover(`data:image/webp;base64,${webp.toString('base64')}`).extension).toBe('webp');
  for (const offset of [0, 8, 12]) {
    const invalid = Buffer.from(webp);
    invalid[offset] |= 128;
    expect(() => decodeCatalogCover(`data:image/webp;base64,${invalid.toString('base64')}`)).toThrow('cover contents');
  }
  webp.writeUInt32LE(99, 4);
  expect(() => decodeCatalogCover(`data:image/webp;base64,${webp.toString('base64')}`)).toThrow('cover contents');
});

it('rejects traversal, external URLs and non-image references', () => {
  for (const value of ['../cover.png', 'tasks/deckmate-assets/covers/../../outside.png', 'tasks/deckmate-assets/covers/cover.svg',
    'tasks/deckmate-assets/covers/sub/cover.png', 'tasks\\freetion-assets\\covers\\cover.png', '/tasks/freetion-assets/covers/cover.png', pngUrl]) {
    expect(isCatalogCoverPath(value), value).toBe(false);
  }
});

it.each([0, 1, 2])('rejects a junction at cover ancestor %s without writing outside', async blockedIndex => {
  const { root, outside } = await fixture();
  const parts = ['tasks', 'deckmate-assets', 'covers'];
  let directory = root;
  for (let index = 0; index < blockedIndex; index += 1) { directory = path.join(directory, parts[index]); await mkdir(directory); }
  await symlink(outside, path.join(directory, parts[blockedIndex]), 'junction');
  await expect(storeCatalogCover(root, pngUrl)).rejects.toThrow('symbolic link');
  expect(await readdir(outside)).toEqual([]);
});

it('rejects a root replaced by a junction before the operation', async () => {
  const { base, root, outside } = await fixture();
  await rename(root, path.join(base, 'original-project'));
  await symlink(outside, root, 'junction');
  await expect(storeCatalogCover(root, pngUrl)).rejects.toThrow('root');
  expect(await readdir(outside)).toEqual([]);
});

it('never removes a replacement file during cleanup', async () => {
  const { root } = await fixture();
  const asset = await storeCatalogCover(root, pngUrl);
  const filename = path.join(root, asset.relativePath);
  await rename(filename, filename + '.original');
  await writeFile(filename, 'another writer owns this');
  await expect(asset.remove()).rejects.toThrow('replaced');
  expect(await readFile(filename, 'utf8')).toBe('another writer owns this');
  expect(await readFile(filename + '.original')).toEqual(png);
});

it('refuses cleanup through a changed ancestor and preserves the outside file', async () => {
  const { root, outside } = await fixture();
  const asset = await storeCatalogCover(root, pngUrl);
  const directory = path.join(root, 'tasks/deckmate-assets/covers');
  const keptDirectory = path.join(root, 'tasks/deckmate-assets/kept-covers');
  await rename(directory, keptDirectory);
  await symlink(outside, directory, 'junction');
  const outsideFile = path.join(outside, path.basename(asset.relativePath));
  await writeFile(outsideFile, 'outside owner');
  await expect(asset.remove()).rejects.toThrow('symbolic link');
  expect(await readFile(outsideFile, 'utf8')).toBe('outside owner');
  expect(await readFile(path.join(keptDirectory, path.basename(asset.relativePath)))).toEqual(png);
});
