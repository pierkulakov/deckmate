import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { applyAttachmentEdit, attachmentKey, readCardAttachments } from '../server/attachments.ts';
import { assertCatalogCoverFile, storeCatalogCover } from '../server/catalog-covers.ts';
import { publishJourney, readJourney, stepFileHashes } from '../server/journeys.ts';
import { readJourneyTemplates } from '../server/journey-templates.ts';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhVEAAAAASUVORK5CYII=', 'base64');
const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
const cardId = 'card:ca1d0000-0000-4000-8000-000000000001';
const roots: string[] = [];
async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-rename-assets-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const relative = path.relative(tmpdir(), root);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(root).startsWith('deckmate-rename-assets-')) {
      throw new Error('Unexpected fixture cleanup target');
    }
    await rm(root, { recursive: true, force: true });
  }
});

it('creates new assets with Deckmate names and appends covers under an existing legacy directory', async () => {
  const fresh = await fixture();
  expect((await storeCatalogCover(fresh, dataUrl)).relativePath).toMatch(/^tasks\/deckmate-assets\/covers\//u);
  await applyAttachmentEdit(fresh, { action: 'upload-attachment', manifestHash: '', cardId, attachmentsHash: '', dataUrl, fileName: 'new.png', addedBy: null });
  expect((await readCardAttachments(fresh, cardId)).files[0].file).toMatch(/^tasks\/deckmate-assets\/cards\//u);
  const legacy = await fixture();
  await mkdir(path.join(legacy, 'tasks/freetion-assets'), { recursive: true });
  expect((await storeCatalogCover(legacy, dataUrl)).relativePath).toMatch(/^tasks\/freetion-assets\/covers\//u);
});

it('keeps an existing legacy attachment registry when the new assets root also exists', async () => {
  const root = await fixture();
  await mkdir(path.join(root, 'tasks/freetion-assets'), { recursive: true });
  await applyAttachmentEdit(root, { action: 'upload-attachment', manifestHash: '', cardId, attachmentsHash: '', dataUrl, fileName: 'first.png', addedBy: null });
  await mkdir(path.join(root, 'tasks/deckmate-assets'));
  const before = await readCardAttachments(root, cardId);
  await applyAttachmentEdit(root, { action: 'upload-attachment', manifestHash: '', cardId, attachmentsHash: before.hash, dataUrl, fileName: 'second.png', addedBy: null });
  const after = await readCardAttachments(root, cardId);
  expect(after.files).toHaveLength(2);
  expect(after.files.every(file => file.file.startsWith('tasks/freetion-assets/'))).toBe(true);
  expect(after.warnings).toEqual([]);
  expect(await readdir(path.join(root, 'tasks/deckmate-assets'))).toEqual([]);
});

it('validates exact old and new cover ancestors when both directories exist', async () => {
  const root = await fixture();
  await mkdir(path.join(root, 'tasks/freetion-assets/covers'), { recursive: true });
  await writeFile(path.join(root, 'tasks/freetion-assets/covers/old.png'), png);
  await mkdir(path.join(root, 'tasks/deckmate-assets/covers'), { recursive: true });
  await writeFile(path.join(root, 'tasks/deckmate-assets/covers/new.png'), png);
  await assertCatalogCoverFile(root, 'tasks/freetion-assets/covers/old.png');
  await assertCatalogCoverFile(root, 'tasks/deckmate-assets/covers/new.png');
  const unsafe = await fixture();
  await mkdir(path.join(unsafe, 'tasks/deckmate-assets/covers'), { recursive: true });
  const outside = path.join(unsafe, 'outside');
  await mkdir(path.join(outside, 'covers'), { recursive: true });
  await writeFile(path.join(outside, 'covers/old.png'), png);
  await symlink(outside, path.join(unsafe, 'tasks/freetion-assets'), 'junction');
  await expect(assertCatalogCoverFile(unsafe, 'tasks/freetion-assets/covers/old.png')).rejects.toThrow('symbolic');
});

it('reads mixed attachment references through each actual guarded directory', async () => {
  const root = await fixture();
  await applyAttachmentEdit(root, { action: 'upload-attachment', manifestHash: '', cardId, attachmentsHash: '', dataUrl, fileName: 'new.png', addedBy: null });
  const key = attachmentKey(cardId);
  const registryPath = path.join(root, `tasks/deckmate-assets/cards/${key}/attachments.md`);
  const original = await readFile(registryPath, 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n/u.exec(original)!;
  const registry = parse(match[1]);
  const legacyFile = registry.files[0].file.replace('deckmate-assets', 'freetion-assets');
  await mkdir(path.dirname(path.join(root, legacyFile)), { recursive: true });
  await writeFile(path.join(root, legacyFile), png);
  registry.files.push({ ...registry.files[0], file: legacyFile, name: 'old.png' });
  await writeFile(registryPath, `---\n${stringify(registry)}---\n${original.slice(match[0].length)}`);
  const result = await readCardAttachments(root, cardId);
  expect(result.files).toHaveLength(2);
  expect(result.warnings).toEqual([]);
});

it('reads legacy Journey markers and preserves them when publishing an edit', async () => {
  const root = await fixture();
  const publication = { id: 'd0000000-0000-4000-8000-000000000001', version: 1, title: 'Original', deckId: 'assets', description: '', zones: [],
    steps: [{ id: 'first', title: 'First', markdown: 'Instruction\n', deckId: 'tasks', owner: null, dependsOn: [] }] };
  await publishJourney(root, async () => {}, publication, 'en');
  const indexPath = path.join(root, `tasks/journeys/${publication.id}/index.md`);
  const initial = await readFile(indexPath, 'utf8');
  expect(initial).toContain('deckmate: journey');
  await writeFile(indexPath, initial.replace('deckmate: journey', 'freetion: journey'));
  const current = (await readJourney(root, publication.id))!;
  expect(current.journey.title).toBe('Original');
  await publishJourney(root, async () => {}, { ...publication, title: 'Edited', existing: {
    steps: current.journey.steps, hashes: stepFileHashes(current.documents), indexHash: current.documents[0].hash,
  } }, 'en');
  const saved = await readFile(indexPath, 'utf8');
  expect(saved).toContain('freetion: journey');
  expect(saved).not.toContain('deckmate:');
  expect((await readJourney(root, publication.id))!.journey.title).toBe('Edited');
});

it('reads project templates with the legacy marker without changing the file', async () => {
  const root = await fixture();
  const directory = path.join(root, 'tasks/journey-templates/legacy-template');
  await mkdir(path.join(directory, 'steps'), { recursive: true });
  const index = `---\n${stringify({ freetion: 'journey-template', schema: 1, id: 'legacy-template', title: 'Legacy', category: 'Testing', author: 'Project', updated: '2026-11-05',
    roles: [{ id: 'task', title: 'Tasks' }], steps: ['steps/first.md'] })}---\nOriginal body\n`;
  await writeFile(path.join(directory, 'index.md'), index);
  await writeFile(path.join(directory, 'steps/first.md'), `---\n${stringify({ id: 'first', title: 'First', roleId: 'task', dependsOn: [] })}---\nInstruction\n`);
  const result = await readJourneyTemplates(path.join(root, 'no-bundled'), root);
  expect(result.warnings).toEqual([]);
  expect(result.templates).toHaveLength(1);
  expect(result.templates[0].title).toBe('Legacy');
  expect(await readFile(path.join(directory, 'index.md'), 'utf8')).toBe(index);
});
