import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument, isMechanicPath } from '../src/markdown.ts';
import { markdownModel, replaceMarkdownBlock } from '../src/block-patch.ts';
import type { SliceRecord, ByteRange } from '../src/contracts.ts';
import { environmentValue } from '../server/environment.ts';

const workspace = fileURLToPath(new URL('..', import.meta.url));
const dataRoot = environmentValue('DATA');
assert(dataRoot, 'Set DECKMATE_DATA in .env.local or the environment; data is read-only.');
const root = path.resolve(dataRoot);
const outputDirectory = path.join(workspace, 'tasks', '.runs');
await mkdir(outputDirectory, { recursive: true });

async function markdownFiles(directory: string, recursive: boolean): Promise<string[]> {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory() && recursive) files.push(...await markdownFiles(relative, true));
    if (entry.isFile() && entry.name.endsWith('.md')) files.push(relative);
  }
  return files.sort();
}

const paths = [...await markdownFiles('features', true), ...await markdownFiles('tasks', false)].sort();
const documents = await Promise.all(paths.map(async relative => parseDocument(relative, await readFile(path.join(root, relative)))));
const boardBytes = await readFile(path.join(root, 'Tools', 'board.py'));
const oracleRun = spawnSync(environmentValue('PYTHON') ?? 'python', ['-B', path.join(workspace, 'tools', 'board-oracle.py')], {
  input: JSON.stringify({ root, documents: Object.fromEntries(documents.map(document => [document.relativePath, Buffer.from(document.bytes).toString('base64')])) }),
  encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true,
});
assert.equal(oracleRun.status, 0, oracleRun.stderr || oracleRun.error?.message || 'Oracle process failed');
interface Oracle {
  documents: Record<string, { name: string; slices: Omit<SliceRecord, 'range'>[]; ranges: ByteRange[] }>;
  mechanicFiles: string[];
  iteration: [number, string, string];
}
const oracle: Oracle = JSON.parse(oracleRun.stdout);
assert.deepEqual(paths.filter(isMechanicPath), oracle.mechanicFiles, 'Mechanic file selection differs');
let sliceCount = 0;
let mechanicSliceCount = 0;
let checkedBytes = 0;
for (const document of documents) {
  const expected = oracle.documents[document.relativePath];
  assert.equal(document.name, expected.name, document.relativePath);
  assert.deepEqual(document.slices.map(({ range: _range, ...slice }) => slice), expected.slices, document.relativePath);
  assert.deepEqual(document.slices.map(slice => slice.range), expected.ranges, `Independent byte ranges: ${document.relativePath}`);
  for (const slice of document.slices) {
    const block = document.bytes.subarray(slice.range.start, slice.range.end);
    assert(block.length > 0, `Empty block ${document.relativePath} ${slice.ver}`);
    const replacement = replaceMarkdownBlock(document.bytes, slice.range, block, markdownModel(Buffer.from(block).toString('utf8')));
    // The actual disk round trip stays entirely inside Deckmate, never in the data repository.
    const scratch = path.join(outputDirectory, 'roundtrip.md');
    await writeFile(scratch, replacement);
    assert.deepEqual(await readFile(scratch), Buffer.from(document.bytes), `No-op changed bytes: ${document.relativePath} ${slice.ver}`);
    checkedBytes += block.length;
    const blockText = Buffer.from(block).toString('utf8');
    assert.equal(blockText.split(/\r?\n/, 1)[0].slice(3).trim(), slice.heading, 'Range does not start at its own heading');
    const changed = Buffer.from(blockText.replace(/^(###\s+(?:✅\s+)?\S+\s+)/, '$1Проба — '));
    assert.notDeepEqual(changed, Buffer.from(block), 'Edited-block probe must change the heading');
    const edited = replaceMarkdownBlock(document.bytes, slice.range, changed, markdownModel(changed.toString('utf8')));
    assert.deepEqual(edited.subarray(0, slice.range.start), Buffer.from(document.bytes.subarray(0, slice.range.start)));
    assert.deepEqual(edited.subarray(slice.range.start + changed.length), Buffer.from(document.bytes.subarray(slice.range.end)));
    sliceCount += 1;
    if (isMechanicPath(document.relativePath)) mechanicSliceCount += 1;
  }
}

// Refuse stale comparisons if an external agent changed the corpus during the measurement.
for (const document of documents) {
  assert.deepEqual(await readFile(path.join(root, document.relativePath)), Buffer.from(document.bytes),
    `Data changed during measurement; rerun: ${document.relativePath}`);
}
assert.deepEqual(await readFile(path.join(root, 'Tools', 'board.py')), boardBytes, 'board.py changed during measurement');
const fingerprint = createHash('sha256');
for (const document of documents) fingerprint.update(document.relativePath).update(document.bytes);
const result = {
  measuredAt: new Date().toISOString(), node: process.version,
  markdownFiles: documents.length, featureFiles: paths.filter(relative => relative.startsWith('features/')).length,
  taskFiles: paths.filter(relative => relative.startsWith('tasks/')).length,
  mechanicFiles: oracle.mechanicFiles.length, mechanicSlices: mechanicSliceCount, allParsedSlices: sliceCount,
  matchingSlicesPercent: 100, unchangedBlockBytesChanged: 0, outsideBlockBytesChanged: 0, checkedBytes,
  boardSha256: createHash('sha256').update(boardBytes).digest('hex'), corpusSha256: fingerprint.digest('hex'), iteration: oracle.iteration,
};
// 2026-11-05: startup checks write to an ignored runtime folder so timestamps do not dirty tracked evidence.
await mkdir(path.join(workspace, '.deckmate'), { recursive: true });
await writeFile(path.join(workspace, '.deckmate', 'check-results.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
console.log('PASS: parser, byte preservation and board oracle.');
