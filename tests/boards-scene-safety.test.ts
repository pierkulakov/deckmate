import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Boards } from '../server/boards.ts';
import type { BoardScene } from '../src/board-contracts.ts';

const roots: string[] = [];
const id = '11111111-1111-4111-8111-111111111111';
const empty: BoardScene = { type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} };
async function fixture(scene = empty) {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-board-safety-'));
  roots.push(root);
  await mkdir(path.join(root, 'boards'));
  const filename = path.join(root, 'boards', `${id}.excalidraw`);
  const bytes = Buffer.from(JSON.stringify({ ...scene, name: 'Untrusted board' }, null, '\t') + '\r\n');
  await writeFile(filename, bytes);
  return { root, filename, bytes, boards: new Boards({ editMode: 'direct', dataRoot: root, writeRoot: root, projectName: 'Safety', port: 4317, python: 'python' }) };
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.basename(root).startsWith('deckmate-board-safety-')) throw new Error('Unsafe fixture cleanup');
    await rm(root, { recursive: true, force: true });
  }
});

it('returns a sanitized read-only scene and board warnings without changing disk bytes, mtime or source hash', async () => {
  const { boards, filename, bytes } = await fixture({ ...empty, appState: { deckmateAccess: 'readonly', openDialog: { name: 'generate' } }, elements: [
    { id: 'safe', type: 'rectangle', link: 'javascript:alert(1)', customData: { generationData: { status: 'done', html: '<script />' }, deckmateCardView: 'mini' } },
    { id: 'frame', type: 'frame', groupIds: ['outer'] },
    { id: 'evil', type: 'iframe', frameId: 'frame', groupIds: ['inner', 'outer'], customData: { generationData: { status: 'done', html: '<script>fetch("https://evil.test")</script>' } } },
    { id: 'unknown', type: 'future' },
  ] });
  const before = await stat(filename);
  const result = await boards.read('sandbox', id);
  expect(result.scene.elements.map(element => element.id)).toEqual(['safe', 'frame']);
  expect(result.scene.elements[0]).toMatchObject({ link: null, customData: { deckmateCardView: 'mini' } });
  expect(result.scene.elements[0].customData).not.toHaveProperty('generationData');
  expect(result.scene.appState).toEqual({ deckmateAccess: 'readonly' });
  expect(result.access).toBe('readonly');
  expect(result.warnings).toContain('The board contained embedded HTML; it was not displayed.');
  expect((await boards.list('sandbox'))[0].warnings).toEqual(result.warnings);
  expect(result.hash).toBe(createHash('sha256').update(bytes).digest('hex'));
  expect(await readFile(filename)).toEqual(bytes);
  expect((await stat(filename)).mtimeMs).toBe(before.mtimeMs);
});

it.each(['iframe', 'magicframe', 'future'])('rejects client saves with %s without changing the existing file', async type => {
  const { boards, filename, bytes } = await fixture();
  const document = await boards.read('sandbox', id);
  await expect(boards.save('sandbox', { id, title: document.title, hash: document.hash, scene: { ...empty, elements: [{ id: 'evil', type, customData: { generationData: { status: 'done', html: '<script />' } } }] } })).rejects.toMatchObject({ status: 422, message: expect.stringContaining('cannot be saved') });
  expect(await readFile(filename)).toEqual(bytes);
});

it('strips generation data, executable links, invalid files and unexpected app state on save', async () => {
  const { boards, filename } = await fixture();
  const document = await boards.read('sandbox', id);
  const saved = await boards.save('sandbox', { id, title: document.title, hash: document.hash, scene: {
    ...empty, elements: [{ id: 'shape', type: 'rectangle', link: 'file:///C:/secret', customData: { generationData: { html: '<script />' }, opaque: 'keep' } }],
    appState: { gridModeEnabled: true, activeTool: { type: 'magicframe' } },
    files: { html: { mimeType: 'text/html', dataURL: 'data:text/html,<script />' } },
  } });
  expect(saved.scene.elements[0]).toEqual({ id: 'shape', type: 'rectangle', link: null, customData: { opaque: 'keep' } });
  expect(saved.scene.files).toEqual({});
  expect(saved.scene.appState).toEqual({ gridModeEnabled: true });
  const bytes = await readFile(filename);
  const before = await stat(filename);
  const noOp = await boards.save('sandbox', { id, title: saved.title, hash: saved.hash, scene: saved.scene });
  expect(noOp.hash).toBe(saved.hash);
  expect(await readFile(filename)).toEqual(bytes);
  expect((await stat(filename)).mtimeMs).toBe(before.mtimeMs);
});

it('never delivers inline SVG/HTML or raster MIME with non-image bytes to the renderer', async () => {
  const { boards } = await fixture({ ...empty, files: {
    svg: { mimeType: 'image/svg+xml', dataURL: 'data:image/svg+xml;base64,PHN2ZyAvPg==' },
    html: { mimeType: 'text/html', dataURL: 'data:text/html;base64,PHNjcmlwdCAvPg==' },
    fake: { mimeType: 'image/png', dataURL: 'data:image/png;base64,PHNjcmlwdCAvPg==' },
  } });
  const result = await boards.read('sandbox', id);
  expect(result.scene.files).toEqual({});
  expect(result.warnings?.some(warning => warning.includes('PNG, JPEG and WebP'))).toBe(true);
});

it('filters external active MIME types and validates raster signatures without touching assets', async () => {
  const { root, boards, filename } = await fixture({ ...empty, elements: [
    { id: 'svg-node', type: 'image', fileId: 'svg' }, { id: 'html-node', type: 'image', fileId: 'html' }, { id: 'fake-node', type: 'image', fileId: 'fake' },
  ] });
  const directory = path.join(root, 'tasks/deckmate-assets/covers');
  await mkdir(directory, { recursive: true });
  const htmlBytes = Buffer.from('<script>fetch("https://evil.test")</script>');
  const imagePath = 'tasks/deckmate-assets/covers/fake.png';
  await writeFile(path.join(root, imagePath), htmlBytes);
  const stored = JSON.parse(await readFile(filename, 'utf8'));
  stored.externalFiles = {
    svg: { path: 'tasks/deckmate-assets/covers/bad.svg', mimeType: 'image/svg+xml', created: 1 },
    html: { path: imagePath, mimeType: 'text/html', created: 1 },
    fake: { path: imagePath, mimeType: 'image/png', created: 1 },
  };
  await writeFile(filename, JSON.stringify(stored));
  const result = await boards.read('sandbox', id);
  expect(result.scene.files).toEqual({});
  expect(result.warnings).toContain('Unsupported board images were not displayed. Only PNG, JPEG and WebP are allowed.');
  expect(await readFile(path.join(root, imagePath))).toEqual(htmlBytes);
});
