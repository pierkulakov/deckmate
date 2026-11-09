import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { emptyManifest, readFreshProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { readJourneyTemplates } from '../server/journey-templates.ts';

// 2026-11-09: a cloned project may carry a junction or symlink in tasks/journey-templates. Template reads and the
// catalog fingerprint followed it and read files outside the project; every read now goes through containedFile.
const sentinel = vi.hoisted(() => ({ text: 'OutsideContentMustNotLeak', reads: [] as string[] }));

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const readFile = (async (...args: Parameters<typeof actual.readFile>) => {
    const result = await actual.readFile(...args);
    if (String(result).includes(sentinel.text)) sentinel.reads.push(String(args[0]));
    return result;
  }) as typeof actual.readFile;
  return { ...actual, readFile };
});

const roots: string[] = [];
const linkType = process.platform === 'win32' ? 'junction' : 'dir';

afterEach(async () => {
  sentinel.reads.length = 0;
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), 'deckmate-template-links-'));
  roots.push(base);
  const root = path.join(base, 'project');
  const outside = path.join(base, 'outside');
  await mkdir(path.join(root, 'tasks'), { recursive: true });
  await mkdir(outside);
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(emptyManifest()));
  return { root, outside, bundled: path.join(base, 'no-bundled') };
}

async function writeIndex(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'index.md'), ['---', 'deckmate: journey-template', 'schema: 1', `id: ${path.basename(directory)}`,
    'title: Demo', 'category: Production', 'author: Deckmate', "updated: '2026-11-09'", 'roles:', '  - { id: build, title: Build }',
    'steps: [steps/plan.md]', '---', '', '# Demo', ''].join('\n'));
}

async function writeStep(directory: string, markdown: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'plan.md'), ['---', 'id: plan', 'title: Plan', 'roleId: build', 'dependsOn: []', '---', markdown, ''].join('\n'));
}

it('reports a project template folder linked outside the project and reads nothing behind it', async () => {
  const { root, outside, bundled } = await fixture();
  await writeIndex(path.join(outside, 'demo'));
  await writeStep(path.join(outside, 'demo/steps'), sentinel.text);
  await symlink(outside, path.join(root, 'tasks/journey-templates'), linkType);

  const result = await readJourneyTemplates(bundled, root);
  expect(result.templates).toEqual([]);
  expect(result.warnings).toEqual([expect.stringMatching(/^tasks\/journey-templates: /u)]);
  expect(sentinel.reads).toEqual([]);
});

it('refuses a template whose steps folder is linked outside the project', async () => {
  const { root, outside, bundled } = await fixture();
  const directory = path.join(root, 'tasks/journey-templates/demo');
  await writeIndex(directory);
  await writeStep(path.join(outside, 'steps'), sentinel.text);
  await symlink(path.join(outside, 'steps'), path.join(directory, 'steps'), linkType);

  const result = await readJourneyTemplates(bundled, root);
  expect(result.templates).toEqual([]);
  expect(result.warnings).toEqual([expect.stringMatching(/^tasks\/journey-templates\/demo\/index\.md: /u)]);
  expect(sentinel.reads).toEqual([]);
});

it('keeps reading a steps folder linked to another place inside the project', async () => {
  const { root, bundled } = await fixture();
  const directory = path.join(root, 'tasks/journey-templates/demo');
  await writeIndex(directory);
  await writeStep(path.join(root, 'docs/shared-steps'), sentinel.text);
  await symlink(path.join(root, 'docs/shared-steps'), path.join(directory, 'steps'), linkType);

  const result = await readJourneyTemplates(bundled, root);
  expect(result.warnings).toEqual([]);
  expect(result.templates.map(template => template.steps.map(step => step.markdown.trim()))).toEqual([[sentinel.text]]);
  // The read probe sees an inside read, so the empty probes of the other tests are real evidence.
  expect(sentinel.reads).toHaveLength(1);
});

it('does not fingerprint files behind a template folder linked outside the project', async () => {
  const { root, outside } = await fixture();
  await writeFile(path.join(outside, 'notes.txt'), sentinel.text);
  await symlink(outside, path.join(root, 'tasks/journey-templates'), linkType);

  const catalog = await readFreshProjectCatalog(root);
  expect(catalog.journeyTemplates?.filter(template => template.source === 'project')).toEqual([]);
  expect(catalog.warnings).toContainEqual(expect.stringMatching(/^tasks\/journey-templates: /u));
  expect(sentinel.reads).toEqual([]);
});
