import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CatalogJourneyStep } from '../src/catalog-contracts.ts';
import { emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { publishJourney, readJourney, updateJourney } from '../server/journeys.ts';

const roots: string[] = [];
const id = '11111111-2222-4333-8444-555555555555';
const relative = `tasks/journeys/${id}/index.md`;
const step = (id: string): CatalogJourneyStep => ({ id, title: id, markdown: `Instruction ${id}.\n`,
  deckId: 'work', owner: null, dependsOn: [] });
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

function examples(newline: string): string {
  const lines: string[] = [];
  for (const fence of ['```', '~~~', '  ```', '  ~~~', '    ```', '    ~~~']) {
    const indent = fence.match(/^ */u)![0];
    lines.push(fence, indent + 'Version: 77 · Keep this example verbatim', indent + '1. [a](steps/a.md) — example', fence, '');
  }
  lines.push('> # Quoted heading', '> Version: 77 · Keep quote', '> 1. [a](steps/a.md) — quote', '',
    '<!--', '# Comment heading', 'Версия: 77 · Keep comment', '1. [a](steps/a.md) — comment', '-->', '');
  return lines.join(newline) + newline;
}

async function fixture(newline: string, bom: boolean, steps = [step('a'), step('b')]) {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-index-content-'));
  roots.push(root);
  await mkdir(path.join(root, 'tasks'));
  const manifest = emptyManifest();
  manifest.formatLanguage = 'en';
  manifest.spaces.push({ id: 'project', title: 'Project' });
  for (const [id, kind] of [['assets', 'asset'], ['work', 'task']] as const) {
    manifest.decks.push({ id, kind, title: id, spaceId: 'project', icon: 'box', color: '#123456', description: '' });
  }
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  await publishJourney(root, async () => {}, { id, title: 'Pipeline', version: 1, deckId: 'assets',
    description: 'Original', zones: [], steps });
  const filename = path.join(root, relative);
  let original = (await readFile(filename, 'utf8')).replaceAll('\n', newline);
  const prefix = examples(newline);
  const tail = newline + '## User list' + newline + newline
    + 'Version: 77 · Keep this user version' + newline + newline
    + '1. [a](steps/a.md) — user list' + newline + '2. [b](steps/b.md) — user second' + newline
    + examples(newline) + 'Mixed LF tail.  \nNo final newline';
  original = original.replace('# Pipeline' + newline, prefix + '# Pipeline' + newline + newline
    + '## Personal notes' + newline + '1. [a](steps/a.md) - KEEP MY NOTE' + newline + newline
    + '- Nested list' + newline + '  1. [a](steps/a.md) - KEEP NESTED' + newline)
    .replace('Version: 1', prefix + 'Version: 1');
  original = (bom ? '\uFEFF' : '') + original + tail;
  await writeFile(filename, original);
  return { root, filename, original };
}

for (const [newline, bom] of [['\n', false], ['\r\n', true]] as const) {
  it('preserves the exact REVIEW-2 Personal notes reproduction with one step (BOM/CRLF=' + bom + ')', async () => {
    const { root, filename, original } = await fixture(newline, bom, [step('a')]);
    const catalog = await readProjectCatalog(root);
    const journey = catalog.journeys![0];
    await updateJourney(root, catalog, { action: 'update-journey', manifestHash: catalog.manifestHash,
      journeyId: id, journeyHash: journey.fileHash, title: journey.title, description: 'Changed', zones: [], steps: journey.steps });
    expect(await readFile(filename)).toEqual(Buffer.from(original.replace('version: 1', 'version: 2')
      .replace('Version: 1 ·', 'Version: 2 ·').replace('description: Original', 'description: "Changed"')));
  });

  it('refuses a missing generated group rather than appending a guessed list (BOM/CRLF=' + bom + ')', async () => {
    const { root, filename, original } = await fixture(newline, bom);
    const modified = original.replace('Read only the step file needed for the current task; follow its dependencies first.', 'User reading notes.');
    await writeFile(filename, modified);
    const catalog = await readProjectCatalog(root);
    const journey = catalog.journeys![0];
    await expect(updateJourney(root, catalog, { action: 'update-journey', manifestHash: catalog.manifestHash,
      journeyId: id, journeyHash: journey.fileHash, title: journey.title, description: 'Changed', zones: [], steps: journey.steps })).rejects.toThrow(/uniquely|однозначно/u);
    expect(await readFile(filename)).toEqual(Buffer.from(modified));
    await expect(readFile(path.join(root, `tasks/journeys/${id}/.deckmate-operation.json`))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['description', 'step title', 'add', 'remove'] as const)
  ('preserves all non-generated bytes on %s edits (BOM/CRLF=' + bom + ')', async change => {
    const { root, filename, original } = await fixture(newline, bom);
    const catalog = await readProjectCatalog(root);
    const journey = (await readJourney(root, id))!.journey;
    let steps = journey.steps;
    if (change === 'step title') steps = steps.map(step => ({ ...step, title: step.id === 'a' ? 'Renamed a' : step.title }));
    if (change === 'add') steps = [...steps, step('c')];
    if (change === 'remove') steps = steps.filter(step => step.id !== 'b');
    await updateJourney(root, catalog, { action: 'update-journey', manifestHash: catalog.manifestHash,
      journeyId: id, journeyHash: journey.fileHash, title: journey.title,
      description: change === 'description' ? 'Changed' : journey.description!, zones: [], steps });
    let expected = original.replace('version: 1', 'version: 2').replace('Version: 1 ·', 'Version: 2 ·');
    if (change === 'description') expected = expected.replace('description: Original', 'description: "Changed"');
    if (change === 'add' || change === 'remove') {
      expected = expected.replace(`steps:${newline}  - steps/a.md${newline}  - steps/b.md${newline}`,
        `steps:${newline}  ${JSON.stringify(steps.map(step => `steps/${step.id}.md`))}${newline}`);
    }
    const generated = [step('a'), step('b')].map((step, index) => `${index + 1}. [${step.id}](steps/${step.id}.md) — ${step.title}; depends on: none${newline}`).join('');
    const replacement = steps.map((step, index) => `${index + 1}. [${step.id}](steps/${step.id}.md) — ${step.title}; depends on: none${newline}`).join('');
    expected = expected.replace(generated, replacement);
    expect(await readFile(filename)).toEqual(Buffer.from(expected));
    expect((await readJourney(root, id))!.journey.steps.map(step => step.id)).toEqual(steps.map(step => step.id));
  });
}

it('updates only the first structural block when two generated-looking lists exist', async () => {
  const { root, filename, original } = await fixture('\n', false);
  const second = '\n# Another pipeline\n\nVersion: 1 · Source deck: `assets`\n\n'
    + '1. [a](steps/a.md) — a; depends on: none\n2. [b](steps/b.md) — b; depends on: none\n';
  await writeFile(filename, original + second);
  const catalog = await readProjectCatalog(root);
  const journey = catalog.journeys![0];
  await updateJourney(root, catalog, { action: 'update-journey', manifestHash: catalog.manifestHash,
    journeyId: id, journeyHash: journey.fileHash, title: journey.title, description: 'Original', zones: [],
    steps: journey.steps.map(step => ({ ...step, title: 'New ' + step.id })) });
  const after = await readFile(filename, 'utf8');
  expect(after.endsWith(second)).toBe(true);
  expect(after).toContain('— New a;');
  expect(after).toContain('— New b;');
});

for (const [newline, bom] of [['\n', false], ['\r\n', true]] as const) {
  it.each(['description', 'step title', 'add', 'remove'] as const)
  ('rejects ambiguous generated groups without changing any files on %s (BOM/CRLF=' + bom + ')', async change => {
    const { root, filename, original } = await fixture(newline, bom);
    const duplicate = newline + newline + 'Version: 1 · Source deck: `assets`' + newline + newline
      + 'Read only the step file needed for the current task; follow its dependencies first.' + newline + newline
      + '1. [a](steps/a.md) — user a' + newline + '2. [b](steps/b.md) — user b' + newline;
    await writeFile(filename, original + duplicate);
    const catalog = await readProjectCatalog(root);
    const journey = catalog.journeys![0];
    const before = await Promise.all([filename, path.join(root, `tasks/journeys/${id}/steps/a.md`),
      path.join(root, `tasks/journeys/${id}/steps/b.md`)].map(file => readFile(file)));
    let steps = journey.steps;
    if (change === 'step title') steps = steps.map(step => ({ ...step, title: 'Changed' }));
    if (change === 'add') steps = [...steps, step('c')];
    if (change === 'remove') steps = steps.slice(0, 1);
    await expect(updateJourney(root, catalog, { action: 'update-journey', manifestHash: catalog.manifestHash,
      journeyId: id, journeyHash: journey.fileHash, title: journey.title,
      description: change === 'description' ? 'Changed' : journey.description!, zones: [], steps })).rejects.toThrow(/uniquely|однозначно/u);
    expect(await Promise.all([filename, path.join(root, `tasks/journeys/${id}/steps/a.md`),
      path.join(root, `tasks/journeys/${id}/steps/b.md`)].map(file => readFile(file)))).toEqual(before);
    await expect(readFile(path.join(root, `tasks/journeys/${id}/steps/c.md`))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(path.join(root, `tasks/journeys/${id}/.deckmate-operation.json`))).rejects.toMatchObject({ code: 'ENOENT' });
  });
}
