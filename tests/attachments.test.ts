import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseDocument, stringify } from 'yaml';
import { applyAttachmentEdit, attachmentKey, readCardAttachments } from '../server/attachments.ts';

const temporaryRoot = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode') : tmpdir();
const roots: string[] = [];
const cardId = 'card:ca1d0000-0000-4000-8000-000000000001';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhVEAAAAASUVORK5CYII=', 'base64');
const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
const upload = { action: 'upload-attachment' as const, cardId, manifestHash: '', dataUrl, fileName: 'cover.png', addedBy: null };
const registryPath = `tasks/deckmate-assets/cards/${attachmentKey(cardId)}/attachments.md`;

afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== temporaryRoot || !path.basename(root).startsWith('deckmate-attachments-')) throw new Error('Unexpected fixture cleanup target');
    await rm(root, { recursive: true, force: true });
  }
});

async function project(): Promise<string> {
  const root = await mkdtemp(path.join(temporaryRoot, 'deckmate-attachments-'));
  roots.push(root);
  return root;
}

/** Compare every byte outside the only editable block, not just the parsed cover settings. */
function outsideFiles(bytes: Buffer): Buffer[] {
  const text = bytes.toString('utf8');
  const header = /^(?:\uFEFF)?---\r?\n([\s\S]*?)^---/mu.exec(text)!;
  const start = text.indexOf('\n') + 1;
  const files = parseDocument(header[1]).get('files', true) as { range: [number, number, number] };
  const from = Buffer.byteLength(text.slice(0, start + files.range[0]));
  const to = Buffer.byteLength(text.slice(0, start + files.range[1]));
  return [bytes.subarray(0, from), bytes.subarray(to)];
}

function expectOutsideFilesUnchanged(before: Buffer, after: Buffer): void {
  const [prefix, suffix] = outsideFiles(before);
  expect(after.subarray(0, prefix.length)).toEqual(prefix);
  expect(after.subarray(after.length - suffix.length)).toEqual(suffix);
}

it.each([
  { newline: '\n', bom: '', flow: false, coverFirst: false },
  { newline: '\r\n', bom: '\uFEFF', flow: false, coverFirst: true },
  { newline: '\r\n', bom: '\uFEFF', flow: false, coverFirst: false },
  { newline: '\n', bom: '\uFEFF', flow: true, coverFirst: true },
  { newline: '\r\n', bom: '', flow: true, coverFirst: false },
])('preserves legacy cover bytes through upload and removal: %j', async ({ newline, bom, flow, coverFirst }) => {
  const root = await project();
  await applyAttachmentEdit(root, { ...upload, attachmentsHash: '' });
  const initial = await readCardAttachments(root, cardId);
  const image = initial.files[0];
  const cover = flow
    ? `cover: {file: '${image.file}', position: 23.50, titleMode: "dark", blur: true, note: 'Сохранить'}`
    : `# Чужая обложка — не изменять\ncover: # old settings\n  file: '${image.file}'\n  position: 23.50 # crop\n  titleMode: "dark"\n  blur: true\n  note: 'Сохранить'\n`;
  const files = flow ? `files: ${JSON.stringify(initial.files)}` : stringify({ files: initial.files }, { lineWidth: 0 });
  const pairs = coverFirst ? [cover, files] : [files, cover];
  const metadata = flow
    ? `{schema: 1, card: '${cardId}', ${pairs.join(', ')}, custom: 'Не менять'}\n`
    : `# Метаданные\nschema: 1 # version\ncard: '${cardId}'\n${pairs.join('\n')}\ncustom: 'Не менять'\n`;
  const before = Buffer.from(bom + '---' + newline + metadata.replace(/\n/gu, newline) + '--- \t' + newline + '\n# Тело\r\nСвои переводы строк.\n');
  const filename = path.join(root, registryPath);
  await writeFile(filename, before);
  const legacy = await readCardAttachments(root, cardId);
  expect(legacy).not.toHaveProperty('cover');
  expect(legacy.warnings).toEqual([]);
  expect(legacy.hash).toBe(createHash('sha256').update(before).digest('hex'));

  await applyAttachmentEdit(root, { ...upload, attachmentsHash: legacy.hash, fileName: 'Notes [v2].pdf',
    dataUrl: `data:application/pdf;base64,${Buffer.from('%PDF-1.7\n%%EOF\n').toString('base64')}` });
  const added = await readCardAttachments(root, cardId);
  expect(added.files).toHaveLength(2);
  expect(added).not.toHaveProperty('cover');
  expectOutsideFilesUnchanged(before, await readFile(filename));

  const other = added.files.find(file => file.file !== image.file)!;
  await applyAttachmentEdit(root, { action: 'remove-attachment', manifestHash: '', cardId, attachmentsHash: added.hash, file: other.file });
  const removed = await readCardAttachments(root, cardId);
  expect(removed.files).toEqual(initial.files);
  expectOutsideFilesUnchanged(before, await readFile(filename));
  await expect(readFile(path.join(root, other.file))).rejects.toMatchObject({ code: 'ENOENT' });

  // 2026-11-09: even removing the old image must not activate, validate or clear its retired cover record.
  await applyAttachmentEdit(root, { action: 'remove-attachment', manifestHash: '', cardId, attachmentsHash: removed.hash, file: image.file });
  const empty = await readCardAttachments(root, cardId);
  expect(empty.files).toEqual([]);
  expect(empty.warnings).toEqual([]);
  expectOutsideFilesUnchanged(before, await readFile(filename));
  await applyAttachmentEdit(root, { ...upload, attachmentsHash: empty.hash });
  expect((await readCardAttachments(root, cardId)).warnings).toEqual([]);
  expectOutsideFilesUnchanged(before, await readFile(filename));
});

it('rejects stale upload and removal hashes without changing the registry or leaving an uploaded file', async () => {
  const root = await project();
  await applyAttachmentEdit(root, { ...upload, attachmentsHash: '' });
  const view = await readCardAttachments(root, cardId);
  const filename = path.join(root, registryPath);
  const before = await readFile(filename);
  const files = await readdir(path.dirname(filename));
  await expect(applyAttachmentEdit(root, { ...upload, attachmentsHash: '' })).rejects.toThrow('ATTACHMENTS_CONFLICT');
  await expect(applyAttachmentEdit(root, { action: 'remove-attachment', manifestHash: '', cardId, attachmentsHash: '', file: view.files[0].file })).rejects.toThrow('ATTACHMENTS_CONFLICT');
  expect(await readFile(filename)).toEqual(before);
  expect(await readdir(path.dirname(filename))).toEqual(files);
});
