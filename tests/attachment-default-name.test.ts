import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyAttachmentEdit, readCardAttachments } from '../server/attachments.ts';

// 2026-11-05 write path: an upload without a file name gets the default name of the project's format
// language (the manifest's formatLanguage), not the interface language of the request.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhVEAAAAASUVORK5CYII=', 'base64');
const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
const cardId = 'card:ca1d0000-0000-4000-8000-000000000001';
const roots: string[] = [];

/** A project whose manifest is valid; `formatLanguage: en` makes it English, a missing field is legacy Russian. */
async function project(manifestBody: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-attachment-name-'));
  roots.push(root);
  await mkdir(path.join(root, 'tasks'), { recursive: true });
  await writeFile(path.join(root, 'tasks/deckmate.md'), `---\n${manifestBody}\n---\n# Project\n`);
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    const relative = path.relative(tmpdir(), root);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(root).startsWith('deckmate-attachment-name-')) {
      throw new Error('Unexpected fixture cleanup target');
    }
    await rm(root, { recursive: true, force: true });
  }
});

async function uploadedName(root: string): Promise<string> {
  await applyAttachmentEdit(root, { action: 'upload-attachment', manifestHash: '', cardId, attachmentsHash: '', dataUrl, fileName: null, addedBy: null });
  return (await readCardAttachments(root, cardId)).files[0].name;
}

it('names an upload without a file name by the project format language', async () => {
  expect(await uploadedName(await project('schema: 1\nformatLanguage: en\nspaces: []\ndecks: []\ntracks: []\nmembership: []'))).toBe('attachment.png');
  expect(await uploadedName(await project('schema: 1\nspaces: []\ndecks: []\ntracks: []\nmembership: []'))).toBe('вложение.png');
});
