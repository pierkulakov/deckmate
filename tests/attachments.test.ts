import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { parseDocument, stringify } from 'yaml';
import { applyAttachmentEdit, attachmentKey, readCardAttachments } from '../server/attachments.ts';
import { registerRequestLang } from '../server/i18n.ts';
import type { CardAttachment } from '../src/catalog-contracts.ts';

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

/** 2026-11-09: fixture literals, not YAML node ranges, independently bound the editable bytes. */
function expectOutsideFilesUnchanged(before: Buffer, after: Buffer, files: string): void {
  const block = Buffer.from(files);
  const start = before.indexOf(block);
  expect(start).toBeGreaterThanOrEqual(0);
  const prefix = before.subarray(0, start);
  const suffix = before.subarray(start + block.length);
  expect(after.subarray(0, prefix.length)).toEqual(prefix);
  expect(after.subarray(after.length - suffix.length)).toEqual(suffix);
}

function expectOnlyInsertion(before: Buffer, after: Buffer, offset: number): void {
  const added = after.length - before.length;
  expect(added).toBeGreaterThan(0);
  expect(after.subarray(0, offset)).toEqual(before.subarray(0, offset));
  expect(after.subarray(offset + added)).toEqual(before.subarray(offset));
}

function withoutLiteral(bytes: Buffer, literal: string): Buffer {
  const block = Buffer.from(literal);
  const start = bytes.indexOf(block);
  expect(start).toBeGreaterThanOrEqual(0);
  return Buffer.concat([bytes.subarray(0, start), bytes.subarray(start + block.length)]);
}

function registryDocument(bytes: Buffer) {
  const header = /^(?:\uFEFF)?---\r?\n([\s\S]*?)^---/mu.exec(bytes.toString('utf8'))!;
  const document = parseDocument(header[1]);
  expect(document.errors).toEqual([]);
  return document;
}

async function storedAttachments(count: number) {
  const root = await project();
  let view = await readCardAttachments(root, cardId);
  for (let index = 0; index < count; index++) {
    await applyAttachmentEdit(root, { ...upload, fileName: `original-${index}.png`, attachmentsHash: view.hash });
    view = await readCardAttachments(root, cardId);
  }
  return { root, filename: path.join(root, registryPath), files: view.files };
}

function blockEntry(entry: CardAttachment, indent: string): string {
  return `${indent}- file: '${entry.file}' # путь\n`
    + `${indent}  name: '${entry.name}'\n${indent}  kind: image\n${indent}  mime: image/png\n`
    + `${indent}  bytes: ${entry.bytes} # размер\n${indent}  addedAt: '${entry.addedAt}'\n${indent}  addedBy: null # автор\n`;
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
  const originalFiles = files.replace(/\n/gu, newline);
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
  expectOutsideFilesUnchanged(before, await readFile(filename), originalFiles);

  const other = added.files.find(file => file.file !== image.file)!;
  await applyAttachmentEdit(root, { action: 'remove-attachment', manifestHash: '', cardId, attachmentsHash: added.hash, file: other.file });
  const removed = await readCardAttachments(root, cardId);
  expect(removed.files).toEqual(initial.files);
  expectOutsideFilesUnchanged(before, await readFile(filename), originalFiles);
  await expect(readFile(path.join(root, other.file))).rejects.toMatchObject({ code: 'ENOENT' });

  // 2026-11-09: even removing the old image must not activate, validate or clear its retired cover record.
  await applyAttachmentEdit(root, { action: 'remove-attachment', manifestHash: '', cardId, attachmentsHash: removed.hash, file: image.file });
  const empty = await readCardAttachments(root, cardId);
  expect(empty.files).toEqual([]);
  expect(empty.warnings).toEqual([]);
  expectOutsideFilesUnchanged(before, await readFile(filename), originalFiles);
  await applyAttachmentEdit(root, { ...upload, attachmentsHash: empty.hash });
  expect((await readCardAttachments(root, cardId)).warnings).toEqual([]);
  expectOutsideFilesUnchanged(before, await readFile(filename), originalFiles);
});

it.each([
  { indent: '', keyIndent: '', newline: '\n', bom: '' },
  { indent: '', keyIndent: '', newline: '\r\n', bom: '\uFEFF' },
  { indent: '  ', keyIndent: '', newline: '\n', bom: '' },
  { indent: '    ', keyIndent: '  ', newline: '\r\n', bom: '\uFEFF' },
])('removes the sole block item and uploads a block list again: %j', async ({ indent, keyIndent, newline, bom }) => {
  const { root, filename, files } = await storedAttachments(1);
  const prefix = `${bom}---${newline}${keyIndent}schema: 1${newline}${keyIndent}card: '${cardId}'${newline}`
    + `${keyIndent}note: 'Кириллица 🗂 перед списком'${newline}${keyIndent}files: # список${newline}`;
  const item = blockEntry(files[0], indent).replace(/\n/gu, newline);
  const suffix = `${keyIndent}# После списка${newline}${keyIndent}custom: 'Не менять'${newline}--- \t${newline}Тело.\n`;
  const before = Buffer.from(prefix + item + suffix);
  await writeFile(filename, before);
  const current = await readCardAttachments(root, cardId);
  await applyAttachmentEdit(root, { action: 'remove-attachment', manifestHash: '', cardId, attachmentsHash: current.hash, file: files[0].file });
  const emptyBytes = await readFile(filename);
  expect(emptyBytes).toEqual(Buffer.from(prefix + keyIndent + '  []' + newline + suffix));
  const empty = await readCardAttachments(root, cardId);
  expect(empty.files).toEqual([]);

  await applyAttachmentEdit(root, { ...upload, attachmentsHash: empty.hash });
  const addedBytes = await readFile(filename);
  const sequence = registryDocument(addedBytes).get('files', true) as { flow?: boolean };
  expect(sequence.flow).not.toBe(true);
  expect(addedBytes.subarray(0, Buffer.byteLength(prefix))).toEqual(Buffer.from(prefix));
  expect(addedBytes.subarray(addedBytes.length - Buffer.byteLength(suffix))).toEqual(Buffer.from(suffix));
  if (newline === '\r\n') expect(addedBytes.toString('utf8').split('--- \t')[0]).not.toMatch(/(?<!\r)\n/u);
  const added = await readCardAttachments(root, cardId);
  expect(added.files).toHaveLength(1);
  expect(added.warnings).toEqual([]);
});

it.each([
  { indent: '', newline: '\n', bom: '', removedIndex: 0 },
  { indent: '  ', newline: '\n', bom: '', removedIndex: 1 },
  { indent: '', newline: '\r\n', bom: '\uFEFF', removedIndex: 2 },
  { indent: '    ', newline: '\r\n', bom: '\uFEFF', removedIndex: 0 },
])('changes only the added or removed block item, retaining opaque metadata and comments: %j', async ({ indent, newline, bom, removedIndex }) => {
  const { root, filename, files } = await storedAttachments(3);
  const prefix = `${bom}---\nschema: 1\ncard: '${cardId}'\nnote: 'Кириллица 🗂 до files'\nfiles: # список\n${indent}# Перед первым\n`;
  const items = files.map((entry, index) => blockEntry(entry, indent)
    + `${indent}  sha256: '000${index}abc'\n${indent}  extra: { scale: 23.50, flags: [a, b] } # чужие поля\n`
    + `${indent}  caption: |+\n${indent}    Подпись ${index}\n\n`);
  // 2026-11-09: starting at the value's line would leave an empty entry for a marker on its own line.
  items[1] = items[1].replace(`${indent}- file:`, `${indent}- # комментарий маркера\n${indent}  file:`);
  const gap = `${indent}  # Более глубокий комментарий\n${indent}# Между элементами\n\n`;
  const suffix = `${indent}# После последнего\ncustom: 'Не менять'\n--- \t\nТело.\n`;
  const original = prefix + items.join(gap) + suffix;
  const before = Buffer.from(original.replace(/\n/gu, newline));
  await writeFile(filename, before);
  const rawBefore = registryDocument(before).toJS();
  const current = await readCardAttachments(root, cardId);
  expect(current.files).toEqual(files);

  await applyAttachmentEdit(root, { ...upload, attachmentsHash: current.hash, fileName: 'Новое.png' });
  const afterUpload = await readFile(filename);
  const insertionOffset = Buffer.byteLength((prefix + items.join(gap)).replace(/\n/gu, newline));
  expectOnlyInsertion(before, afterUpload, insertionOffset);
  const rawAdded = registryDocument(afterUpload).toJS();
  expect(rawAdded.files.slice(0, 3)).toEqual(rawBefore.files);
  const added = await readCardAttachments(root, cardId);
  expect(added.files.slice(0, 3)).toEqual(files);

  await applyAttachmentEdit(root, { action: 'remove-attachment', manifestHash: '', cardId, attachmentsHash: added.hash, file: files[removedIndex].file });
  const afterRemoval = await readFile(filename);
  expect(afterRemoval).toEqual(withoutLiteral(afterUpload, items[removedIndex].replace(/\n/gu, newline)));
  expect(registryDocument(afterRemoval).toJS().files).toEqual(rawAdded.files.filter((_: unknown, index: number) => index !== removedIndex));
  expect((await readCardAttachments(root, cardId)).warnings).toEqual([]);
});

it.each(['files: [] # пусто\n', 'files:\n  [] # пусто\n', 'files: [ # пусто\n  # внутри\n] # конец\n'])('turns an empty flow sequence in a block map into a block list without losing comments: %s', async files => {
  const { root, filename } = await storedAttachments(1);
  const prefix = `\uFEFF---\r\n# Заголовок\r\nschema: 1\r\ncard: '${cardId}'\r\n`;
  const suffix = `custom: 'Не менять'\r\n---\r\nТело.\n`;
  const before = Buffer.from(prefix + files.replace(/\n/gu, '\r\n') + suffix);
  await writeFile(filename, before);
  const empty = await readCardAttachments(root, cardId);
  await applyAttachmentEdit(root, { ...upload, attachmentsHash: empty.hash });
  const after = await readFile(filename);
  const document = registryDocument(after);
  expect((document.get('files', true) as { flow?: boolean }).flow).not.toBe(true);
  expect(document.toJS().files).toHaveLength(1);
  const headerWithoutBrackets = files.replace('[', '').replace(']', '').replace(/\n/gu, '\r\n');
  expect(after.subarray(0, Buffer.byteLength(prefix + headerWithoutBrackets))).toEqual(Buffer.from(prefix + headerWithoutBrackets));
  expect(after.subarray(after.length - Buffer.byteLength(suffix))).toEqual(Buffer.from(suffix));
});

it.each([
  { removedIndex: 0, flowMap: true }, { removedIndex: 1, flowMap: true }, { removedIndex: 2, flowMap: true },
  { removedIndex: 0, flowMap: false }, { removedIndex: 1, flowMap: false }, { removedIndex: 2, flowMap: false },
])('preserves flow entries and comments while removing and appending: %j', async ({ removedIndex, flowMap }) => {
  const { root, filename, files } = await storedAttachments(3);
  const entries = files.map((entry, index) => stringify({ ...entry, caption: `Подпись ${index}`, sha256: `000${index}` }, { collectionStyle: 'flow', lineWidth: 0 }).trimEnd());
  const prefix = flowMap ? `\uFEFF---\r\n{schema: 1, card: '${cardId}', note: 'Кириллица 🗂', files: [ # сначала\r\n `
    : `\uFEFF---\r\nschema: 1\r\ncard: '${cardId}'\r\nnote: 'Кириллица 🗂'\r\nfiles: [ # сначала\r\n `;
  const gap = ', # между\r\n ';
  const suffix = flowMap ? ', # после\r\n], custom: true}\r\n---\r\nТело.\n' : ', # после\r\n]\r\ncustom: true\r\n---\r\nТело.\n';
  const before = Buffer.from(prefix + entries.join(gap) + suffix);
  await writeFile(filename, before);
  const current = await readCardAttachments(root, cardId);
  expect(current.files).toEqual(files);
  await applyAttachmentEdit(root, { action: 'remove-attachment', manifestHash: '', cardId, attachmentsHash: current.hash, file: files[removedIndex].file });
  const segments = [prefix, entries[0], gap, entries[1], gap, entries[2], suffix];
  segments[1 + removedIndex * 2] = '';
  const separator = removedIndex < 2 ? 2 + removedIndex * 2 : 4;
  segments[separator] = gap.slice(1);
  const removedBytes = await readFile(filename);
  expect(removedBytes).toEqual(Buffer.from(segments.join('')));
  const removed = await readCardAttachments(root, cardId);
  expect(removed.files).toEqual(files.filter((_, index) => index !== removedIndex));

  await applyAttachmentEdit(root, { ...upload, attachmentsHash: removed.hash });
  const afterUpload = await readFile(filename);
  const lastEntry = entries[removedIndex === 2 ? 1 : 2];
  const insertionOffset = removedBytes.indexOf(Buffer.from(lastEntry)) + Buffer.byteLength(lastEntry);
  expectOnlyInsertion(removedBytes, afterUpload, insertionOffset);
  expect(registryDocument(afterUpload).toJS().files.slice(0, 2)).toEqual(registryDocument(before).toJS().files.filter((_: unknown, index: number) => index !== removedIndex));
});

it.each([false, true])('preserves a sole flow item\'s surrounding comments through empty and upload (flow map: %s)', async flowMap => {
  const { root, filename, files } = await storedAttachments(1);
  const entry = '&image ' + stringify({ ...files[0], caption: 'Чужая подпись' }, { collectionStyle: 'flow', lineWidth: 0 }).trimEnd();
  const prefix = flowMap ? `---\n{schema: 1, card: '${cardId}', files: [ # перед\n `
    : `---\nschema: 1\ncard: '${cardId}'\nfiles: [ # перед\n `;
  const suffix = flowMap ? ' # после\n], custom: true}\n---\nТело.\n' : ' # после\n]\ncustom: true\n---\nТело.\n';
  const before = Buffer.from(prefix + entry + ',' + suffix);
  await writeFile(filename, before);
  const current = await readCardAttachments(root, cardId);
  await applyAttachmentEdit(root, { action: 'remove-attachment', manifestHash: '', cardId, attachmentsHash: current.hash, file: files[0].file });
  const emptyBytes = await readFile(filename);
  expect(emptyBytes).toEqual(Buffer.from(prefix + suffix));
  const empty = await readCardAttachments(root, cardId);
  expect(empty.files).toEqual([]);
  await applyAttachmentEdit(root, { ...upload, attachmentsHash: empty.hash });
  const after = await readFile(filename);
  const document = registryDocument(after);
  expect(Boolean((document.get('files', true) as { flow?: boolean }).flow)).toBe(flowMap);
  expect(document.toJS().files).toHaveLength(1);
  if (flowMap) expectOnlyInsertion(emptyBytes, after, Buffer.byteLength(prefix.slice(0, prefix.indexOf('[') + 1)));
  else {
    expect(after.toString('utf8')).toContain('files:  # перед\n  # после\n\n  - file:');
    expect(after.toString('utf8')).toContain('custom: true\n---\nТело.\n');
  }
});

it('inserts and removes a block item written as a flow map without touching its inline comment or a sibling', async () => {
  const { root, filename, files } = await storedAttachments(2);
  const first = '  - ' + stringify({ ...files[0], caption: 'Сохранить' }, { collectionStyle: 'flow', lineWidth: 0 }).trimEnd() + ' # в строке\r\n';
  const second = blockEntry(files[1], '  ').replace(/\n/gu, '\r\n');
  const prefix = `\uFEFF---\r\nschema: 1\r\ncard: '${cardId}'\r\nnote: 'Кириллица 🗂'\r\nfiles:\r\n`;
  const gap = '  # Между\r\n';
  const suffix = '# После\r\n---\r\nТело.\n';
  const before = Buffer.from(prefix + second + gap + first + suffix);
  await writeFile(filename, before);
  const current = await readCardAttachments(root, cardId);
  await applyAttachmentEdit(root, { ...upload, attachmentsHash: current.hash });
  const addedBytes = await readFile(filename);
  expectOnlyInsertion(before, addedBytes, Buffer.byteLength(prefix + second + gap + first));
  const added = await readCardAttachments(root, cardId);
  await applyAttachmentEdit(root, { action: 'remove-attachment', manifestHash: '', cardId, attachmentsHash: added.hash, file: files[0].file });
  expect(await readFile(filename)).toEqual(withoutLiteral(addedBytes, first));
});

it.each(['en', 'ru'])('localizes registry parse errors in %s and leaves failed uploads untouched', async language => {
  const { root, filename } = await storedAttachments(1);
  const app = Fastify();
  registerRequestLang(app);
  app.get('/read', async () => readCardAttachments(root, cardId));
  app.post('/upload', async () => {
    await applyAttachmentEdit(root, { ...upload, attachmentsHash: createHash('sha256').update(await readFile(filename)).digest('hex') });
    return {};
  });
  try {
    const malformed = ['files:\n[]\n', 'files: [\n', 'anchor: &entries []\nfiles: *entries\n']
      .map(files => Buffer.from(`---\nschema: 1\ncard: '${cardId}'\n${files}---\n`));
    malformed.push(Buffer.concat([Buffer.from(`---\nschema: 1\ncard: '${cardId}'\nfiles: []\n---\n`), Buffer.from([0xff])]));
    for (const before of malformed) {
      await writeFile(filename, before);
      const existingFiles = await readdir(path.dirname(filename));
      for (const [method, url] of [['GET', '/read'], ['POST', '/upload']] as const) {
        const response = await app.inject({ method, url, headers: { cookie: `deckmate-lang=${language}` } });
        expect(response.json().message).toBe(language === 'ru' ? 'Список вложений повреждён.' : 'The attachment list is damaged.');
        expect(await readFile(filename)).toEqual(before);
        expect(await readdir(path.dirname(filename))).toEqual(existingFiles);
      }
    }
  } finally { await app.close(); }
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
