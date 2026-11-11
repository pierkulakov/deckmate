import { afterEach, expect, it, vi } from 'vitest';
import { freePort } from './free-port.ts';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/app.ts';
import { readWholeActivity } from '../server/activity.ts';
import { editProjectCatalog, emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { applyProjectTemplate, listProjectTemplates, planProjectTemplate } from '../server/project-templates.ts';
import { run as runInit } from '../tools/commands/init.ts';
import type { CatalogEdit } from '../src/catalog-contracts.ts';

const fixturePaths = vi.hoisted(() => ({
  templatesRoot: `${process.cwd()}/tests/fixtures/project-templates`,
  journeysRoot: `${process.cwd()}/tests/fixtures/journey-templates`,
  artRoot: `${process.cwd()}/assets/deck-art`,
}));

const renameFault = vi.hoisted(() => ({ codes: [] as string[], calls: 0, external: '' }));
vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, rename: async (...args: Parameters<typeof original.rename>) => {
    if (String(args[1]).replaceAll('\\', '/').endsWith('/tasks/deckmate.md') && renameFault.codes.length > 0) {
      renameFault.calls += 1;
      if (renameFault.external) await original.writeFile(args[1], renameFault.external);
      throw Object.assign(new Error('Temporary Windows reader lock'), { code: renameFault.codes.shift() });
    }
    return original.rename(...args);
  } };
});

// 2026-11-05: a small bundled fixture isolates public route behavior from production template content.
vi.mock('../server/package-path.ts', async importOriginal => {
  const original = await importOriginal<typeof import('../server/package-path.ts')>();
  return { ...original, packagePath: (...segments: string[]) => {
    if (segments.join('/') === 'assets/project-templates') return fixturePaths.templatesRoot;
    if (segments.join('/') === 'assets/journey-templates') return fixturePaths.journeysRoot;
    return original.packagePath(...segments);
  } };
});

const roots: string[] = [];
const applications: FastifyInstance[] = [];
const headers = { host: '127.0.0.1:4398' };
type TemplateEdit = Extract<CatalogEdit, { action: 'apply-project-template' }>;

afterEach(async () => {
  renameFault.codes = [];
  renameFault.calls = 0;
  renameFault.external = '';
  for (const application of applications.splice(0)) await application.close();
  for (const root of roots.splice(0)) {
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('deckmate-project-templates-')) {
      throw new Error('Unsafe project-template test cleanup target.');
    }
    await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

async function fixture() {
  const temporary = await mkdtemp(path.join(tmpdir(), 'deckmate-project-templates-'));
  roots.push(temporary);
  const root = path.join(temporary, 'project');
  await mkdir(path.join(root, 'docs'), { recursive: true });
  await mkdir(path.join(root, 'tasks'));
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(emptyManifest()));
  let existing = Buffer.from('\uFEFF# Existing notes\r\n\r\nKeep these bytes.\r\n');
  // 2026-11-05: an optional supplied file exercises copying; the default fixture keeps tests portable.
  try {
    const environment = parseEnv(await readFile('.env.local', 'utf8'));
    const sandbox = environment.DECKMATE_WRITE ?? environment.FREETION_WRITE;
    if (sandbox) existing = await readFile(path.join(sandbox, 'AGENTS.md'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await writeFile(path.join(root, 'docs/existing.md'), existing);
  return { root, temporary };
}

async function snapshot(root: string): Promise<Record<string, { hash: string; modified: string }>> {
  const result: Record<string, { hash: string; modified: string }> = {};
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === '.deckmate' || entry.name === '.freetion') continue;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else result[path.relative(root, filename)] = {
        hash: createHash('sha256').update(await readFile(filename)).digest('hex'),
        modified: (await stat(filename, { bigint: true })).mtimeNs.toString(),
      };
    }
  }
  await visit(root);
  return result;
}

async function editFor(root: string, samples = true, options = fixturePaths): Promise<TemplateEdit> {
  const plan = await planProjectTemplate(root, 'fixture', options);
  return { action: 'apply-project-template', templateId: plan.templateId,
    templateHash: plan.templateHash, manifestHash: plan.manifestHash, samples };
}

async function open(root: string, readOnly = false) {
  const application = await createApp({ dataRoot: root, writeRoot: readOnly ? null : root,
    editMode: readOnly ? 'read-only' : 'direct', projectName: 'Template fixture', port: 4398, python: 'python' });
  applications.push(application);
  const snapshotResponse = await application.inject({ url: '/api/snapshot', headers });
  return { application, authorized: { ...headers, 'x-deckmate-token': snapshotResponse.json().token } };
}

it('recreates template Spaces after the last empty Space was deleted', async () => {
  const { root } = await fixture();
  await editProjectCatalog(root, { action: 'create-space', title: 'Removed', manifestHash: (await readProjectCatalog(root)).manifestHash });
  const before = await readProjectCatalog(root);
  await editProjectCatalog(root, { action: 'delete-space', spaceId: before.spaces[0].id, manifestHash: before.manifestHash });
  expect((await readProjectCatalog(root)).spaces).toEqual([]);
  await applyProjectTemplate(root, await editFor(root, false), null, fixturePaths);
  const after = await readProjectCatalog(root);
  expect(after.spaces.length).toBeGreaterThan(0);
  expect(after.decks.every(deck => after.spaces.some(space => space.id === deck.spaceId))).toBe(true);
});

it('creates the declared decks, artwork, mapped Journey, tags and optional Hero families on an empty copy', async () => {
  const { root } = await fixture();
  const existing = await readFile(path.join(root, 'docs/existing.md'));
  const templates = await listProjectTemplates(fixturePaths);
  expect(templates.map(template => template.id)).toEqual(['fixture']);
  const template = templates[0];
  const plan = await planProjectTemplate(root, template.id, fixturePaths);
  expect(plan.items.every(item => item.status === 'create')).toBe(true);
  const changed = await applyProjectTemplate(root, await editFor(root), null, fixturePaths);
  expect(changed.length).toBeGreaterThan(0);
  const catalog = await readProjectCatalog(root);
  expect(catalog.spaces.map(space => space.title)).toEqual(template.spaces.map(space => space.title));
  expect(catalog.decks.map(deck => deck.title)).toEqual(template.decks.map(deck => deck.title));
  expect(catalog.projectTags).toEqual(template.tags);
  const units = catalog.decks.find(deck => deck.title === 'Units')!;
  const coding = catalog.decks.find(deck => deck.title === 'Coding')!;
  expect(catalog.inboxDeckId).toBe(coding.id);
  expect(units.kind).toBe('asset');
  expect(units.style).toBe('artwork');
  expect(await readFile(path.join(root, units.cover!))).toEqual(await readFile(path.join(fixturePaths.artRoot, 'units.webp')));
  expect(catalog.journeys).toHaveLength(1);
  expect(catalog.journeys![0].deckId).toBe(units.id);
  expect(catalog.journeys![0].steps[0]).toMatchObject({ deckId: coding.id, effort: 2 });
  const heroes = catalog.cards.filter(card => card.kind === 'hero');
  expect(heroes.map(card => card.title).sort()).toEqual(template.samples.map(sample => sample.title).sort());
  for (const hero of heroes) {
    expect(hero.deckId).toBe(units.id);
    const children = catalog.cards.filter(card => card.parentId === hero.id);
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({ kind: 'task', deckId: coding.id, effort: 2 });
    expect(children[0].journey?.journeyId).toBe(catalog.journeys![0].id);
  }
  expect(await readFile(path.join(root, 'docs/existing.md'))).toEqual(existing);
  const beforeRepeat = await snapshot(root);
  expect(await applyProjectTemplate(root, await editFor(root), null, fixturePaths)).toEqual([]);
  expect(await snapshot(root)).toEqual(beforeRepeat);
  const missingChild = catalog.cards.find(card => card.parentId === heroes[0].id)!;
  const missingPath = path.resolve(root, missingChild.path);
  const relative = path.relative(path.resolve(root), missingPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !relative.startsWith('cards' + path.sep)) {
    throw new Error('Unsafe missing Journey child fixture target.');
  }
  await rm(missingPath);
  expect((await readProjectCatalog(root)).cards.some(card => card.id === missingChild.id)).toBe(false);
  const recoveredPaths = await applyProjectTemplate(root, await editFor(root), null, fixturePaths);
  expect(recoveredPaths.map(filename => path.resolve(root, filename))).toContain(missingPath);
  const recovered = await readProjectCatalog(root);
  expect(recovered.cards.find(card => card.id === missingChild.id)).toMatchObject({ parentId: heroes[0].id, journey: missingChild.journey });
  expect(recovered.cards).toHaveLength(catalog.cards.length);
  const afterRecovery = await snapshot(root);
  expect(afterRecovery[relative].hash).toBe(beforeRepeat[relative].hash);
  for (const card of catalog.cards.filter(card => card.id !== missingChild.id)) {
    const filename = path.relative(root, path.resolve(root, card.path));
    expect(afterRecovery[filename]).toEqual(beforeRepeat[filename]);
  }
});

it('reuses case-insensitive names and leaves existing deck, tag, Journey and foreign file bytes intact', async () => {
  const { root } = await fixture();
  await applyProjectTemplate(root, await editFor(root, false), null, fixturePaths);
  expect((await readProjectCatalog(root)).cards.filter(card => card.kind === 'hero')).toEqual([]);
  const manifestPath = path.join(root, 'tasks/deckmate.md');
  await writeFile(manifestPath, (await readFile(manifestPath, 'utf8')).replace('title: Units', 'title: uNiTs').replace('title: Production', 'title: pRoDuCtIoN'));
  const catalog = await readProjectCatalog(root);
  expect(catalog.decks.some(deck => deck.title === 'uNiTs')).toBe(true);
  const plan = await planProjectTemplate(root, 'fixture', fixturePaths);
  expect(plan.items.filter(item => item.kind === 'space' || item.kind === 'deck').every(item => item.status === 'reuse')).toBe(true);
  expect(plan.items.find(item => item.kind === 'journey')).toMatchObject({ status: 'skip', reason: expect.any(String) });
  expect(plan.items.find(item => item.kind === 'tag')?.status).not.toBe('create');
  const before = await snapshot(root);
  expect(await applyProjectTemplate(root, await editFor(root, false), null, fixturePaths)).toEqual([]);
  expect(await snapshot(root)).toEqual(before);
});

it('keeps the existing Inbox while applying a starter template', async () => {
  const { root } = await fixture();
  const manifest = emptyManifest();
  manifest.spaces.push({ id: 'existing', title: 'Existing' });
  manifest.decks.push({ id: 'inbox', title: 'Capture', kind: 'mixed', spaceId: 'existing', icon: 'box', color: '#123456', description: '' });
  manifest.inboxDeckId = 'inbox';
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  await applyProjectTemplate(root, await editFor(root, false), null, fixturePaths);
  expect((await readProjectCatalog(root)).inboxDeckId).toBe('inbox');
});

it('does not assign a reused template Task deck of an incompatible kind as Inbox', async () => {
  const { root } = await fixture();
  const manifest = emptyManifest();
  manifest.spaces.push({ id: 'existing', title: 'Existing' });
  manifest.decks.push({ id: 'coding', title: 'Coding', kind: 'asset', spaceId: 'existing', icon: 'box', color: '#123456', description: '' });
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  await applyProjectTemplate(root, await editFor(root, false), null, fixturePaths);
  expect((await readProjectCatalog(root)).inboxDeckId).toBeNull();
});

it('rejects external manifest and template edits before the first write', async () => {
  const { root, temporary } = await fixture();
  const options = { ...fixturePaths, templatesRoot: path.join(temporary, 'templates') };
  await cp(fixturePaths.templatesRoot, options.templatesRoot, { recursive: true });
  const original = await editFor(root, true, options);
  await writeFile(path.join(root, 'tasks/deckmate.md'), (await readFile(path.join(root, 'tasks/deckmate.md'), 'utf8')) + '\nForeign edit.\n');
  const afterForeignManifest = await snapshot(root);
  await expect(applyProjectTemplate(root, original, null, options)).rejects.toThrow('CATALOG_CONFLICT');
  expect(await snapshot(root)).toEqual(afterForeignManifest);
  const refreshed = await editFor(root, true, options);
  const filename = path.join(options.templatesRoot, 'fixture.md');
  await writeFile(filename, (await readFile(filename, 'utf8')) + '\nTemplate changed.\n');
  await expect(applyProjectTemplate(root, refreshed, null, options)).rejects.toThrow('TEMPLATE_CONFLICT');
  expect(await snapshot(root)).toEqual(afterForeignManifest);
});

it('routes one application through the write queue and journal, reports 409 conflicts and enforces read-only mode', async () => {
  const { root } = await fixture();
  const { application, authorized } = await open(root);
  const list = await application.inject({ url: '/api/project-templates', headers });
  expect(list.statusCode, list.body).toBe(200);
  expect(list.json().map((template: { id: string }) => template.id)).toEqual(['fixture']);
  const planned = await application.inject({ url: '/api/project-templates/fixture/plan?source=sandbox', headers });
  expect(planned.statusCode, planned.body).toBe(200);
  const missing = await application.inject({ url: '/api/project-templates/absent/plan?source=sandbox', headers });
  expect(missing.statusCode).toBe(404);
  expect(missing.json().message).toBe('Project template not found: absent');
  const edit = await editFor(root, false);
  for (const conflict of [{ ...edit, templateHash: '0'.repeat(64) }, { ...edit, manifestHash: '0'.repeat(64) }]) {
    const response = await application.inject({ method: 'POST', url: '/api/catalog', headers: authorized,
      payload: { ...conflict, source: 'sandbox' } });
    expect(response.statusCode, response.body).toBe(409);
  }
  const applied = await application.inject({ method: 'POST', url: '/api/catalog', headers: authorized,
    payload: { ...edit, source: 'sandbox' } });
  expect(applied.statusCode, applied.body).toBe(200);
  const events = (await readWholeActivity(root)).events;
  expect(events).toHaveLength(1);
  expect(events[0].action).toBe('apply-project-template');
  const beforeRepeat = await snapshot(root);
  const repeated = await application.inject({ method: 'POST', url: '/api/catalog', headers: authorized,
    payload: { ...await editFor(root, false), source: 'sandbox' } });
  expect(repeated.statusCode, repeated.body).toBe(200);
  expect(await snapshot(root)).toEqual(beforeRepeat);
  const readOnly = await open(root, true);
  const rejected = await readOnly.application.inject({ method: 'POST', url: '/api/catalog', headers: readOnly.authorized,
    payload: { ...await editFor(root), source: 'live' } });
  expect(rejected.statusCode, rejected.body).toBe(403);
  expect(await snapshot(root)).toEqual(beforeRepeat);
});

it.each(['version', 'instance', 'moved'] as const)('skips an existing example after its %s changes without writing or duplicating children', async change => {
  const { root } = await fixture();
  await applyProjectTemplate(root, await editFor(root), null, fixturePaths);
  const catalog = await readProjectCatalog(root);
  const child = catalog.cards.find(card => card.journey)!;
  const hero = catalog.cards.find(card => card.id === child.parentId)!;
  if (change === 'version') {
    const filename = path.join(root, catalog.journeys![0].path);
    await writeFile(filename, (await readFile(filename, 'utf8')).replace('version: 1', 'version: 2'));
  } else {
    const filename = path.join(root, child.path);
    const bytes = await readFile(filename, 'utf8');
    const updated = change === 'moved'
      ? bytes.replace(/^parentId:.*$/mu, 'parentId: null')
      : bytes.replace(child.journey!.instanceId, '00000000-0000-8000-8000-000000000000');
    expect(updated).not.toBe(bytes);
    await writeFile(filename, updated);
  }
  const plan = await planProjectTemplate(root, 'fixture', fixturePaths);
  expect(plan.items.find(item => item.kind === 'sample' && item.title === hero.title)).toMatchObject({ status: 'skip', reason: expect.any(String) });
  const before = await snapshot(root);
  expect(await applyProjectTemplate(root, await editFor(root), null, fixturePaths)).toEqual([]);
  expect(await snapshot(root)).toEqual(before);
  expect((await readProjectCatalog(root)).cards).toHaveLength(catalog.cards.length);
});

it('resumes only a missing step while preserving the existing children of the current instance', async () => {
  const { root, temporary } = await fixture();
  const options = { ...fixturePaths, journeysRoot: path.join(temporary, 'journeys') };
  await cp(fixturePaths.journeysRoot, options.journeysRoot, { recursive: true });
  const directory = path.join(options.journeysRoot, 'fixture-units');
  const index = path.join(directory, 'index.md');
  await writeFile(index, (await readFile(index, 'utf8')).replace('steps: [steps/implement.md]', 'steps: [steps/implement.md, steps/check.md]'));
  await writeFile(path.join(directory, 'steps/check.md'), (await readFile(path.join(directory, 'steps/implement.md'), 'utf8')).replace('id: implement', 'id: check'));
  await applyProjectTemplate(root, await editFor(root, true, options), null, options);
  const catalog = await readProjectCatalog(root);
  const child = catalog.cards.find(card => card.journey?.stepId === 'check')!;
  const hero = catalog.cards.find(card => card.id === child.parentId)!;
  const missingPath = path.resolve(root, child.path);
  expect(path.dirname(missingPath)).toBe(path.join(root, 'cards'));
  await rm(missingPath);
  const plan = await planProjectTemplate(root, 'fixture', options);
  expect(plan.items.find(item => item.kind === 'sample' && item.title === hero.title)?.status).toBe('resume');
  const before = await snapshot(root);
  await applyProjectTemplate(root, await editFor(root, true, options), null, options);
  const after = await snapshot(root);
  for (const [filename, value] of Object.entries(before)) expect(after[filename]).toEqual(value);
  expect((await readProjectCatalog(root)).cards).toHaveLength(catalog.cards.length);
});

it('creates only Heroes when an existing deck Journey differs from the bundled template', async () => {
  const { root } = await fixture();
  await applyProjectTemplate(root, await editFor(root, false), null, fixturePaths);
  const catalog = await readProjectCatalog(root);
  const journey = catalog.journeys![0];
  const filename = path.join(root, journey.path);
  await writeFile(filename, (await readFile(filename, 'utf8')).replace('title: Implement a unit', 'title: Custom process'));
  const before = await snapshot(root);
  const plan = await planProjectTemplate(root, 'fixture', fixturePaths);
  expect(plan.items.filter(item => item.kind === 'sample')).toEqual(expect.arrayContaining([
    expect.objectContaining({ status: 'create', reason: expect.stringContaining('Only the Hero') }),
  ]));
  await applyProjectTemplate(root, await editFor(root), null, fixturePaths);
  const after = await readProjectCatalog(root);
  expect(after.cards.filter(card => card.kind === 'hero')).toHaveLength(2);
  expect(after.cards.filter(card => card.parentId)).toHaveLength(0);
  const bytesAfter = await snapshot(root);
  for (const [relative, value] of Object.entries(before)) expect(bytesAfter[relative]).toEqual(value);
});

it('repairs an unchanged symbol deck cover, but preserves a customized uncovered deck', async () => {
  const { root } = await fixture();
  await applyProjectTemplate(root, await editFor(root, false), null, fixturePaths);
  let catalog = await readProjectCatalog(root);
  const units = catalog.decks.find(deck => deck.title === 'Units')!;
  await editProjectCatalog(root, { action: 'update-deck', manifestHash: catalog.manifestHash, deckId: units.id,
    title: units.title, icon: units.icon, color: units.color, description: units.description,
    style: 'symbol', cover: null, coverPosition: 50 });
  const plan = await planProjectTemplate(root, 'fixture', fixturePaths);
  expect(plan.items.find(item => item.kind === 'deck' && item.title === 'Units')?.status).toBe('resume');
  await applyProjectTemplate(root, await editFor(root, false), null, fixturePaths);
  catalog = await readProjectCatalog(root);
  expect(catalog.decks.find(deck => deck.id === units.id)).toMatchObject({ style: 'artwork', cover: expect.any(String) });
  await editProjectCatalog(root, { action: 'update-deck', manifestHash: catalog.manifestHash, deckId: units.id,
    title: units.title, icon: units.icon, color: units.color, description: 'My own deck',
    style: 'symbol', cover: null, coverPosition: 50 });
  const before = await snapshot(root);
  expect(await applyProjectTemplate(root, await editFor(root, false), null, fixturePaths)).toEqual([]);
  expect(await snapshot(root)).toEqual(before);
});

it('journals a partial template with its reason and gives init a nonzero exit code', async () => {
  const { root } = await fixture();
  await writeFile(path.join(root, 'tasks/deckmate-assets'), 'Block cover publication.');
  const { application, authorized } = await open(root);
  const result = await application.inject({ method: 'POST', url: '/api/catalog', headers: authorized,
    payload: { ...await editFor(root), source: 'sandbox' } });
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().savedWarning).toContain('not fully applied');
  const events = (await readWholeActivity(root)).events;
  expect(events).toHaveLength(1);
  // 2026-11-06: the summary follows the project language (this legacy manifest is Russian); the reason is the request's error text.
  expect(events[0]).toMatchObject({ summary: 'Шаблон проекта применён частично', details: expect.arrayContaining([expect.stringContaining('not fully applied')]) });

  const cli = await fixture();
  await writeFile(path.join(cli.root, 'tasks/deckmate-assets'), 'Block cover publication.');
  const priorExitCode = process.exitCode;
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    process.exitCode = 0;
    await runInit({ root: cli.root, source: 'sandbox', catalog: await readProjectCatalog(cli.root),
      config: { dataRoot: cli.root, writeRoot: cli.root, editMode: 'direct', projectName: 'CLI fixture', port: await freePort(), python: 'python' } },
    ['fixture'], new Map([['samples', 'true']]));
    expect(process.exitCode).toBe(1);
  } finally {
    process.exitCode = priorExitCode;
    output.mockRestore();
  }
});

it.skipIf(process.platform !== 'win32')('retries transient manifest renames and rechecks external changes before retry', async () => {
  const { root } = await fixture();
  renameFault.codes = ['EPERM', 'EBUSY', 'EACCES'];
  await editProjectCatalog(root, { action: 'create-space', manifestHash: (await readProjectCatalog(root)).manifestHash,
    title: 'Production', kind: 'tasks' });
  expect(renameFault.calls).toBe(3);
  expect((await readdir(path.join(root, 'tasks'))).filter(name => name.endsWith('.tmp'))).toEqual([]);
  const catalog = await readProjectCatalog(root);
  renameFault.external = (await readFile(path.join(root, 'tasks/deckmate.md'), 'utf8')) + '\nExternal edit.\n';
  renameFault.codes = ['EBUSY'];
  await expect(editProjectCatalog(root, { action: 'create-space', manifestHash: catalog.manifestHash,
    title: 'Notes', kind: 'knowledge' })).rejects.toThrow('CATALOG_CONFLICT');
  expect(renameFault.calls).toBe(4);
  expect(renameFault.codes).toEqual([]);
  expect(await readFile(path.join(root, 'tasks/deckmate.md'), 'utf8')).toBe(renameFault.external);
  expect((await readdir(path.join(root, 'tasks'))).filter(name => name.endsWith('.tmp'))).toEqual([]);
});
