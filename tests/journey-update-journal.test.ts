import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import type { CatalogEdit, CatalogJourneyStep } from '../src/catalog-contracts.ts';
import { emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { abandonJourneyOperation, addJourneyStepLesson, applyJourney, publishJourney, readJourney, updateJourney } from '../server/journeys.ts';
import { parseManagedMarkdown, patchManagedMarkdown } from '../server/native-cards.ts';
import { watchProjectFiles } from '../server/file-events.ts';

const fault = vi.hoisted(() => ({ target: '', when: '', hit: false, operation: '', events: [] as string[],
  intervene: null as null | (() => Promise<void>) }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  async function checkpoint(filename: unknown, when: string) {
    const name = String(filename).replaceAll('\\', '/');
    if (when === 'after' && name.includes('/journeys/') && !name.endsWith('.tmp')) fault.events.push(name);
    if (when === 'after' && name.endsWith('/.deckmate-operation.json')) fault.operation = await actual.readFile(String(filename), 'utf8');
    if (fault.hit || (fault.when !== when && fault.when !== `intervene-${when}` && !(fault.when === 'eperm' && when === 'before')) || !name.endsWith(fault.target)) return;
    const mode = fault.when;
    fault.hit = true;
    await fault.intervene?.();
    if (mode.startsWith('intervene-')) return;
    throw Object.assign(new Error('Injected publication failure'), mode === 'eperm' ? { code: 'EPERM' } : {});
  }
  return { ...actual,
    async link(...args: Parameters<typeof actual.link>) {
      await checkpoint(args[1], 'before');
      await actual.link(...args);
      await checkpoint(args[1], 'after');
    },
    async rename(...args: Parameters<typeof actual.rename>) {
      await checkpoint(args[1], 'before');
      await actual.rename(...args);
      await checkpoint(args[1], 'after');
    },
    async unlink(...args: Parameters<typeof actual.unlink>) {
      await checkpoint(args[0], 'before-delete');
      await actual.unlink(...args);
      await checkpoint(args[0], 'after-delete');
    },
  };
});

const roots: string[] = [];
afterEach(async () => {
  const { target, when, hit } = fault;
  Object.assign(fault, { target: '', when: '', hit: false, operation: '', events: [], intervene: null });
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  if (target) expect(hit, `Fault did not fire: ${target} (${when})`).toBe(true);
});
const id = '11111111-2222-4333-8444-555555555555';
const directory = `tasks/journeys/${id}`;
const operationPath = `${directory}/.deckmate-operation.json`;
const parentId = 'hero:features/hero.md#1';
function step(id: string, dependsOn: string[] = []): CatalogJourneyStep {
  return { id, title: id, markdown: `Instruction ${id}.\n`, deckId: 'work', owner: null, dependsOn };
}
async function fixture(decorate = false) {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-journey-operation-'));
  roots.push(root);
  await mkdir(path.join(root, 'tasks'));
  await mkdir(path.join(root, 'features'));
  await writeFile(path.join(root, 'features/hero.md'), '# Heroes\n\n## 1 — Hero\n### 1.0 Existing (план)\nExisting task.\n');
  const manifest = emptyManifest();
  manifest.formatLanguage = 'en';
  manifest.spaces.push({ id: 'project', title: 'Project' });
  manifest.members = [{ id: 'alice', label: 'Alice', kind: 'human', aliases: [] }];
  for (const [id, kind] of [['assets', 'asset'], ['work', 'task']] as const) {
    manifest.decks.push({ id, kind, title: id, spaceId: 'project', icon: 'box', color: '#123456', description: '' });
  }
  manifest.membership.push({ card: parentId, deck: 'assets' });
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  await publishJourney(root, async () => {}, { id, title: 'Pipeline', version: 1, deckId: 'assets', description: '', zones: [],
    steps: [step('A'), step('B', ['A']), step('keep'), step('remove'), step('remove2')] });
  if (decorate) {
    for (const relative of ['index.md', 'steps/A.md', 'steps/B.md', 'steps/keep.md', 'steps/remove.md', 'steps/remove2.md']) {
      const filename = path.join(root, directory, relative);
      const text = (await readFile(filename, 'utf8')).replace('deckmate: journey', 'freetion: journey')
        .replace('schema: 1', 'schema: 1 # Keep schema').replace('title:', '# Keep this comment\ncustom: { untouched: yes }\ntitle:');
      await writeFile(filename, '\uFEFF' + (text + '\nHuman tail.  \n').replaceAll('\n', '\r\n'));
    }
  }
  const catalog = await readProjectCatalog(root);
  const journey = catalog.journeys![0];
  const edit: Extract<CatalogEdit, { action: 'update-journey' }> = {
    action: 'update-journey', journeyId: id, journeyHash: journey.fileHash, manifestHash: catalog.manifestHash,
    title: 'Pipeline next', description: 'Next description', zones: [{ id: 'next', title: 'Next' }],
    steps: [step('A', ['B']), step('B'), step('C', ['D']), step('D'), journey.steps.find(step => step.id === 'keep')!]
      .map(step => ({ ...step, zoneId: 'next' })),
  };
  // 2026-11-09: keep one file truly unchanged while moving the others into a newly introduced zone.
  edit.zones.push({ id: 'default', title: 'Default' });
  delete edit.steps[4].zoneId;
  fault.events = [];
  return { root, catalog, journey, edit };
}
function inject(target: string, when: string) {
  // 2026-11-10: assert the previous checkpoint before rearming, so retries cannot hide a missed injection.
  if (fault.target) expect(fault.hit, `Fault did not fire: ${fault.target}`).toBe(true);
  Object.assign(fault, { target, when, hit: false });
}

const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

async function serviceFor(root: string) {
  const { CatalogService } = await import('../server/catalog-service.ts');
  return new CatalogService({ dataRoot: root, writeRoot: root, editMode: 'direct', projectName: 'Journal', port: 44318, python: 'python' }, path.join(root, '.cache'));
}

async function interrupt(fixtureResult: Awaited<ReturnType<typeof fixture>>) {
  inject('/steps/B.md', 'after');
  await expect(updateJourney(fixtureResult.root, fixtureResult.catalog, fixtureResult.edit)).rejects.toMatchObject({ saved: true });
  fault.when = '';
}

async function snapshot(root: string, relative = directory): Promise<Record<string, Buffer>> {
  const result: Record<string, Buffer> = {};
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const next = `${relative}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(result, await snapshot(root, next));
    else result[next] = await readFile(path.join(root, next));
  }
  return result;
}

it.each([
  ['journal', '/.deckmate-operation.json', 'after'],
  ['reversed dependency B', '/steps/B.md', 'after'],
  ['existing step A', '/steps/A.md', 'after'],
  ['new dependency D', '/steps/D.md', 'after'],
  ['new step C', '/steps/C.md', 'after'],
  ['index write', '/index.md', 'before'],
  ['index commit', '/index.md', 'after'],
  ['before cleanup', '/steps/remove.md', 'before-delete'],
  ['between deletions', '/steps/remove.md', 'after-delete'],
  ['before journal deletion', '/.deckmate-operation.json', 'before-delete'],
  ['lost final response', '/.deckmate-operation.json', 'after-delete'],
])('reads and resumes exact target bytes after failure at %s', async (_stage, target, when) => {
  const { root, catalog, journey, edit } = await fixture();
  inject(target, when);
  await expect(updateJourney(root, catalog, edit)).rejects.toMatchObject({ saved: true });
  expect(fault.hit).toBe(true);
  const beforeRead = await snapshot(root);
  const read = await readJourney(root, id);
  const pending = when !== 'after-delete' || target !== '/.deckmate-operation.json';
  expect(read!.journey.version).toBe(pending ? 1 : 2);
  if (pending) {
    expect(read!.journey).toMatchObject({ ...journey, pendingOperation: { id: expect.any(String), journalHash: expect.any(String), state: 'pending' } });
    const view = await readProjectCatalog(root);
    expect(view.journeys![0].pendingOperation).toBeDefined();
    expect(view.documents.every(document => !document.path.endsWith('.json'))).toBe(true);
    expect(view.warnings.some(warning => warning.includes('not fully'))).toBe(true);
  }
  expect(await snapshot(root)).toEqual(beforeRead);
  const operation = JSON.parse(fault.operation) as { files: { path: string; after: { text: string } | null }[] };
  fault.when = '';
  // 2026-11-09: recovery must use disk state rather than any module-local prepared plan.
  vi.resetModules();
  const restarted = await import('../server/journeys.ts');
  await expect(restarted.updateJourney(root, catalog, edit)).rejects.toThrow('JOURNEY_CONFLICT');
  const completed = (await restarted.readJourney(root, id))!.journey;
  expect(completed).toMatchObject({ version: 2, title: edit.title, steps: edit.steps.map(step => ({ id: step.id })) });
  expect(completed.pendingOperation).toBeUndefined();
  for (const file of operation.files) {
    const current = readFile(path.join(root, directory, file.path));
    if (file.after) expect(await current).toEqual(Buffer.from(file.after.text));
    else await expect(current).rejects.toMatchObject({ code: 'ENOENT' });
  }
  await expect(readFile(path.join(root, operationPath))).rejects.toMatchObject({ code: 'ENOENT' });
  const final = await snapshot(root);
  await expect(restarted.updateJourney(root, catalog, edit)).rejects.toThrow('JOURNEY_CONFLICT');
  expect(await snapshot(root)).toEqual(final);
});

it('publishes new dependencies first while keeping the requested index order', async () => {
  const { root, catalog, edit } = await fixture();
  await updateJourney(root, catalog, edit);
  const names = fault.events.filter(name => name.endsWith('.md')).map(name => name.slice(name.indexOf('/steps/') + 1));
  expect(names.indexOf('steps/D.md')).toBeLessThan(names.indexOf('steps/C.md'));
  expect(names.indexOf('steps/B.md')).toBeLessThan(names.indexOf('steps/A.md'));
  expect((await readJourney(root, id))!.journey.steps.map(step => step.id)).toEqual(['A', 'B', 'C', 'D', 'keep']);
});

it.each(['steps/A.md', 'steps/B.md', 'steps/keep.md', 'steps/remove.md', 'index.md'])
('rejects external changes to %s without rolling back or writing another file', async relative => {
  const { root, catalog, edit } = await fixture();
  inject('/steps/B.md', 'after');
  await expect(updateJourney(root, catalog, edit)).rejects.toMatchObject({ saved: true });
  const filename = path.join(root, directory, relative);
  const external = Buffer.concat([await readFile(filename), Buffer.from('\nExternal edit.\n')]);
  await writeFile(filename, external);
  const before = await snapshot(root);
  fault.when = '';
  await expect(updateJourney(root, catalog, edit)).rejects.toMatchObject({ saved: true, message: expect.stringContaining(relative) });
  expect(await readFile(filename)).toEqual(external);
  expect(await snapshot(root)).toEqual(before);
  const disk = await readJourney(root, id);
  expect(disk!.journey.pendingOperation).toMatchObject({ state: 'conflict', file: relative });
  if (relative.startsWith('steps/') && relative !== 'steps/remove.md') {
    expect(disk!.journey.steps.find(step => relative === `steps/${step.id}.md`)!.markdown).toContain('External edit.');
  }
});

it('rechecks already published and unchanged files immediately before the index', async () => {
  const { root, catalog, edit } = await fixture();
  const index = await readFile(path.join(root, directory, 'index.md'));
  inject('/steps/C.md', 'intervene-after');
  const filename = path.join(root, directory, 'steps/keep.md');
  const external = Buffer.concat([await readFile(filename), Buffer.from('\nForeign bytes.\n')]);
  fault.intervene = () => writeFile(filename, external);
  await expect(updateJourney(root, catalog, edit)).rejects.toMatchObject({ saved: true, message: expect.stringContaining('steps/keep.md') });
  expect(await readFile(path.join(root, directory, 'index.md'))).toEqual(index);
  fault.when = '';
  await expect(updateJourney(root, catalog, edit)).rejects.toThrow('steps/keep.md');
  expect(await readFile(filename)).toEqual(external);
});

it('leaves all working bytes intact when journal preparation fails before publication', async () => {
  const { root, catalog, edit } = await fixture();
  const before = await snapshot(root);
  inject('/.deckmate-operation.json', 'before');
  await expect(updateJourney(root, catalog, edit)).rejects.toThrow('Injected publication failure');
  expect(await snapshot(root)).toEqual(before);
  fault.when = '';
  await updateJourney(root, catalog, edit);
  expect((await readJourney(root, id))!.journey.version).toBe(2);
});

it('recovers through Save as Template, rejects stale hashes, then saves with fresh hashes', async () => {
  const { root, edit } = await fixture();
  const { CatalogService } = await import('../server/catalog-service.ts');
  const service = new CatalogService({ dataRoot: root, writeRoot: root, editMode: 'direct', projectName: 'Journal', port: 44318, python: 'python' }, path.join(root, '.cache'));
  try {
    inject('/.deckmate-operation.json', 'after');
    const partial = await service.edit(edit, 'sandbox');
    expect(partial.journeys![0].pendingOperation).toBeDefined();
    expect(partial.warnings.some(warning => warning.includes('not fully'))).toBe(true);
    fault.when = '';
    const save: Extract<CatalogEdit, { action: 'save-journey-template' }> = { action: 'save-journey-template', manifestHash: edit.manifestHash,
      journeyId: id, journeyHash: edit.journeyHash, title: 'Saved template', description: '', category: 'Project', tags: [] };
    await expect(service.edit(save, 'sandbox')).rejects.toMatchObject({ status: 409 });
    const current = (await readJourney(root, id))!.journey;
    const completed = await service.edit({ ...save, journeyHash: current.fileHash }, 'sandbox');
    expect(completed.journeys![0]).toMatchObject({ version: 2, title: edit.title });
    expect(completed.journeys![0].pendingOperation).toBeUndefined();
  } finally { await service.close(); }
});

it('a different request recovers first and then uses ordinary source checks', async () => {
  const { root, catalog, edit } = await fixture();
  inject('/steps/B.md', 'after');
  await expect(updateJourney(root, catalog, edit)).rejects.toMatchObject({ saved: true });
  fault.when = '';
  await expect(updateJourney(root, catalog, { ...edit, title: 'Another request' })).rejects.toThrow('JOURNEY_CONFLICT');
  const current = (await readJourney(root, id))!.journey;
  expect(current).toMatchObject({ version: 2, title: edit.title });
  expect(current.pendingOperation).toBeUndefined();
  await expect(applyJourney(root, catalog, { action: 'apply-journey', journeyId: id, journeyHash: edit.journeyHash,
    manifestHash: catalog.manifestHash, cardId: parentId, sourceHash: catalog.cards.find(card => card.id === parentId)!.sourceHash,
    stepIds: ['A'], deckAssignments: {} })).rejects.toThrow('JOURNEY_CONFLICT');
  await updateJourney(root, catalog, { ...edit, journeyHash: current.fileHash, title: 'Another request' });
  expect((await readJourney(root, id))!.journey).toMatchObject({ version: 3, title: 'Another request' });
});

it('preserves BOM, CRLF, unknown YAML, comments and body notes while migrating only the legacy key', async () => {
  const { root, catalog, journey, edit } = await fixture(true);
  const indexBefore = await readFile(path.join(root, directory, 'index.md'), 'utf8');
  const stepBefore = await readFile(path.join(root, directory, 'steps/A.md'), 'utf8');
  const minimal = { ...edit, title: journey.title, description: '', zones: [], steps: journey.steps };
  await updateJourney(root, catalog, minimal);
  const indexAfter = await readFile(path.join(root, directory, 'index.md'), 'utf8');
  expect(indexAfter).toBe(indexBefore.replace('freetion: journey', 'deckmate: journey').replace('version: 1', 'version: 2').replace('Version: 1', 'Version: 2'));
  expect(await readFile(path.join(root, directory, 'steps/A.md'), 'utf8')).toBe(stepBefore);
  const current = await readProjectCatalog(root);
  const next = current.journeys![0];
  await updateJourney(root, current, { ...minimal, journeyHash: next.fileHash,
    steps: next.steps.map(step => step.id === 'A' ? { ...step, markdown: step.markdown.replace('Instruction A.', 'New instruction.') } : step) });
  expect(await readFile(path.join(root, directory, 'steps/A.md'), 'utf8')).toBe(stepBefore.replace('Instruction A.', 'New instruction.'));
  const final = await readFile(path.join(root, directory, 'index.md'), 'utf8');
  expect(final.startsWith('\uFEFF')).toBe(true);
  expect(final).not.toMatch(/(?<!\r)\n/u);
});

it('adding a lesson preserves the legacy index and the entire step YAML header', async () => {
  const { root, catalog, journey } = await fixture(true);
  await applyJourney(root, catalog, { action: 'apply-journey', journeyId: id, journeyHash: journey.fileHash,
    manifestHash: catalog.manifestHash, cardId: parentId, sourceHash: catalog.cards.find(card => card.id === parentId)!.sourceHash,
    stepIds: ['A'], deckAssignments: {} });
  const applied = await readProjectCatalog(root);
  const card = applied.cards.find(card => card.journey?.stepId === 'A')!;
  const index = await readFile(path.join(root, directory, 'index.md'));
  const before = await readFile(path.join(root, directory, 'steps/A.md'), 'utf8');
  await addJourneyStepLesson(root, applied, { action: 'add-journey-step-lesson', journeyId: id, journeyHash: journey.fileHash,
    manifestHash: applied.manifestHash, stepId: 'A', cardId: card.id, text: 'Verify the evidence.' }, 'alice', '2026-11-09');
  expect(await readFile(path.join(root, directory, 'index.md'))).toEqual(index);
  const after = await readFile(path.join(root, directory, 'steps/A.md'), 'utf8');
  expect(after.split('---\r\n')[1]).toBe(before.split('---\r\n')[1]);
  expect(after).toContain('Verify the evidence.');
});

it('patches changed YAML values without normalizing existing BOM/CRLF, comments or unknown fields', async () => {
  const { root, catalog, journey, edit } = await fixture(true);
  const filename = path.join(root, directory, 'steps/A.md');
  const before = await readFile(filename, 'utf8');
  await updateJourney(root, catalog, { ...edit, title: journey.title, description: '', zones: [],
    steps: journey.steps.map(step => step.id === 'A' ? { ...step, title: 'Another title' } : step) });
  expect(await readFile(filename, 'utf8')).toBe(before.replace('title: A', 'title: "Another title"'));
  const index = await readFile(path.join(root, directory, 'index.md'), 'utf8');
  expect(index.startsWith('\uFEFF')).toBe(true);
  expect(index).not.toMatch(/(?<!\r)\n/u);
  expect(index).toContain('custom: { untouched: yes }\r\n');
  expect(index).toContain('Human tail.  \r\n');
});

it('does not add omitted optional/default fields to untouched step headers', async () => {
  const { root, edit } = await fixture();
  const filename = path.join(root, directory, 'steps/A.md');
  const original = (await readFile(filename, 'utf8')).replace('owner: null\n', '').replace('dependsOn: []\n', '');
  await writeFile(filename, original);
  const catalog = await readProjectCatalog(root);
  const journey = catalog.journeys![0];
  await updateJourney(root, catalog, { ...edit, title: journey.title, description: '', zones: [], journeyHash: journey.fileHash,
    steps: journey.steps.map(step => step.id === 'A' ? { ...step, markdown: 'Changed instruction.\n' } : step) });
  expect(await readFile(filename, 'utf8')).toBe(original.replace('Instruction A.\n', 'Changed instruction.\n'));
});

it('rejects a damaged payload before resuming', async () => {
  const { root, catalog, edit } = await fixture();
  inject('/.deckmate-operation.json', 'after');
  await expect(updateJourney(root, catalog, edit)).rejects.toMatchObject({ saved: true });
  const operation = JSON.parse(fault.operation);
  operation.files[0].after.text += 'Damaged bytes';
  await writeFile(path.join(root, operationPath), JSON.stringify(operation));
  const before = await snapshot(root);
  await expect(updateJourney(root, catalog, edit)).rejects.toThrow('journal cannot be read');
  expect(await snapshot(root)).toEqual(before);
});

it('reports the operation journal as well as real step and index changes', async () => {
  const { root, catalog, edit } = await fixture();
  const changes: string[] = [];
  const watcher = watchProjectFiles(root, relative => changes.push(relative));
  try {
    await watcher.ready;
    inject('/.deckmate-operation.json', 'after');
    await expect(updateJourney(root, catalog, edit)).rejects.toMatchObject({ saved: true });
    await vi.waitFor(() => expect(changes).toContain(operationPath), { timeout: 5000 });
    fault.when = '';
    await expect(updateJourney(root, catalog, edit)).rejects.toThrow('JOURNEY_CONFLICT');
    await vi.waitFor(() => expect(changes).toContain(`${directory}/index.md`), { timeout: 5000 });
    expect(changes.filter(relative => relative.endsWith('.json')).every(relative => relative === operationPath)).toBe(true);
    expect(changes.some(relative => relative.endsWith('.tmp'))).toBe(false);
    expect(changes.some(relative => relative.includes('/steps/'))).toBe(true);
  } finally { await watcher.close(); }
});

it('finishes the journal after the manifest changes, before rejecting the stale new request', async () => {
  const data = await fixture();
  await interrupt(data);
  const manifest = path.join(data.root, 'tasks/deckmate.md');
  await writeFile(manifest, (await readFile(manifest, 'utf8')) + '\nHuman manifest note.\n');
  const service = await serviceFor(data.root);
  try {
    await expect(service.edit(data.edit, 'sandbox')).rejects.toMatchObject({ status: 409 });
    expect((await readJourney(data.root, id))!.journey).toMatchObject({ version: 2, title: data.edit.title });
    await expect(readFile(path.join(data.root, operationPath))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(manifest, 'utf8')).toContain('Human manifest note.');
    const current = await readProjectCatalog(data.root);
    const saved = await service.edit({ ...data.edit, manifestHash: current.manifestHash,
      journeyHash: current.journeys![0].fileHash, title: 'After manifest edit' }, 'sandbox');
    expect(saved.journeys![0].title).toBe('After manifest edit');
  } finally { await service.close(); }
});

it('a new service instance recovers a different payload after a client reload', async () => {
  const data = await fixture();
  const first = await serviceFor(data.root);
  inject('/steps/B.md', 'after');
  try { expect((await first.edit(data.edit, 'sandbox')).journeys![0].pendingOperation).toBeDefined(); }
  finally { await first.close(); }
  fault.when = '';
  const restarted = await serviceFor(data.root);
  try {
    expect((await restarted.get('sandbox')).journeys![0].pendingOperation).toBeDefined();
    await expect(restarted.edit({ ...data.edit, title: 'A new editor draft' }, 'sandbox')).rejects.toMatchObject({ status: 409 });
    expect((await restarted.get('sandbox')).journeys![0].pendingOperation).toBeUndefined();
    const current = (await readJourney(data.root, id))!.journey;
    expect(current.pendingOperation).toBeUndefined();
    const saved = await restarted.edit({ ...data.edit, journeyHash: current.fileHash, title: 'A new editor draft' }, 'sandbox');
    expect(saved.journeys![0]).toMatchObject({ title: 'A new editor draft', version: 3 });
  } finally { await restarted.close(); }
});

it.each(['apply', 'import', 'lesson'] as const)('%s recovers pending bytes before validating its own request', async action => {
  const data = await fixture();
  await interrupt(data);
  const service = await serviceFor(data.root);
  let edit: CatalogEdit;
  if (action === 'apply') edit = { action: 'apply-journey', journeyId: id, journeyHash: data.edit.journeyHash,
    manifestHash: data.catalog.manifestHash, cardId: parentId, sourceHash: data.catalog.cards.find(card => card.id === parentId)!.sourceHash,
    stepIds: ['B', 'A'], deckAssignments: {} };
  else if (action === 'import') {
    const template = data.catalog.journeyTemplates![0];
    edit = { action: 'import-journey-template', journeyId: id, journeyHash: data.edit.journeyHash, manifestHash: data.catalog.manifestHash,
      deckId: 'assets', templateId: template.id, templateHash: template.fileHash, templateSource: template.source,
      mode: 'replace', roleMapping: Object.fromEntries(template.roles.map(role => [role.id, { deckId: 'work' }])) };
  } else edit = { action: 'add-journey-step-lesson', journeyId: id, journeyHash: data.edit.journeyHash,
    manifestHash: data.catalog.manifestHash, stepId: 'B', cardId: 'unused', text: 'Lesson' };
  try {
    await expect(service.edit(edit, 'sandbox', 'alice')).rejects.toMatchObject({ status: 409 });
    const journey = (await readJourney(data.root, id))!.journey;
    expect(journey).toMatchObject({ version: 2, title: data.edit.title });
    expect(journey.pendingOperation).toBeUndefined();
    if (action !== 'lesson') {
      const saved = await service.edit({ ...edit, journeyHash: journey.fileHash }, 'sandbox');
      expect(saved.journeys![0].pendingOperation).toBeUndefined();
      if (action === 'apply') expect(saved.cards.filter(card => card.journey?.journeyId === id)).toHaveLength(2);
      else expect(saved.journeys![0].version).toBe(3);
    }
  } finally { await service.close(); }
});

it.each(['title in step YAML', 'index heading'])('regenerates generated lines after manual editing of %s', async change => {
  const { root, edit } = await fixture();
  const filename = path.join(root, directory, change === 'index heading' ? 'index.md' : 'steps/A.md');
  const original = await readFile(filename, 'utf8');
  await writeFile(filename, change === 'index heading' ? original.replace('# Pipeline', '# Manual heading') : original.replace('title: A', 'title: Manual A'));
  const indexPath = path.join(root, directory, 'index.md');
  const tail = '\nHuman LF note.\r\nHuman CRLF note.\nTrailing spaces.  \r\n';
  await writeFile(indexPath, (await readFile(indexPath, 'utf8')) + tail);
  const catalog = await readProjectCatalog(root);
  const journey = catalog.journeys![0];
  await updateJourney(root, catalog, { ...edit, journeyHash: journey.fileHash, title: 'Renamed Journey', description: '', zones: [],
    steps: journey.steps.map(step => step.id === 'B' ? { ...step, title: 'Renamed B' } : step) });
  const after = await readFile(indexPath, 'utf8');
  expect(after).toContain('# Renamed Journey');
  expect(after).toContain('— Renamed B;');
  expect(after.endsWith(tail)).toBe(true);
  if (change === 'title in step YAML') expect(after).toContain('— Manual A;');
});

it.each(['truncated', 'schema 2', 'payload', '../', 'foreign file'])('reads disk and permits guarded abandonment for a %s journal', async damage => {
  const { root, catalog, journey, edit } = await fixture();
  inject('/.deckmate-operation.json', 'after');
  await expect(updateJourney(root, catalog, edit)).rejects.toMatchObject({ saved: true });
  const operation = JSON.parse(fault.operation);
  if (damage === 'schema 2') operation.schema = 2;
  if (damage === 'payload') operation.files[0].after.text += 'Damaged';
  if (damage === '../') operation.files[0].path = '../outside.md';
  if (damage === 'foreign file') operation.files[0].path = 'steps/foreign.md';
  const bytes = damage === 'truncated' ? '{"deckmate":' : JSON.stringify(operation);
  await writeFile(path.join(root, operationPath), bytes);
  const before = await snapshot(root);
  const view = await readProjectCatalog(root);
  expect(view.journeys![0]).toMatchObject({ ...journey, pendingOperation: { state: 'invalid', id: null, journalHash: hash(bytes) } });
  expect(view.warnings.some(warning => warning.includes('journal cannot be read'))).toBe(true);
  await expect(updateJourney(root, catalog, edit)).rejects.toThrow('journal cannot be read');
  await expect(abandonJourneyOperation(root, id, '0'.repeat(64))).rejects.toThrow('JOURNEY_CONFLICT');
  expect(await snapshot(root)).toEqual(before);
  await abandonJourneyOperation(root, id, hash(bytes));
  delete before[operationPath];
  expect(await snapshot(root)).toEqual(before);
  expect((await readJourney(root, id))!.journey.pendingOperation).toBeUndefined();
});

it('abandonment through the API changes only the journal and rejects a stale journal hash', async () => {
  const data = await fixture();
  await interrupt(data);
  const filename = path.join(data.root, directory, 'steps/A.md');
  await writeFile(filename, (await readFile(filename, 'utf8')) + '\nExternal instructions.\n');
  const before = await snapshot(data.root);
  const pending = (await readJourney(data.root, id))!.journey.pendingOperation!;
  const service = await serviceFor(data.root);
  try {
    const edit: CatalogEdit = { action: 'abandon-journey-operation', journeyId: id, manifestHash: data.catalog.manifestHash, journalHash: '0'.repeat(64) };
    await expect(service.edit(edit, 'sandbox')).rejects.toMatchObject({ status: 409 });
    expect(await snapshot(data.root)).toEqual(before);
    await service.edit({ ...edit, journalHash: pending.journalHash }, 'sandbox');
    delete before[operationPath];
    expect(await snapshot(data.root)).toEqual(before);
    await expect(readFile(path.join(data.root, operationPath))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await service.close(); }
});

it.each(['deleted step', 'added step', 'deleted journal'])('preserves disk state after a manually %s', async change => {
  const data = await fixture();
  await interrupt(data);
  let file = 'steps/A.md';
  if (change === 'deleted step') await rm(path.join(data.root, directory, file));
  if (change === 'added step') {
    file = 'steps/C.md';
    await writeFile(path.join(data.root, directory, file), '---\nid: C\ntitle: Human C\ndeckId: work\ndependsOn: []\n---\nHuman instruction.\n');
  }
  if (change === 'deleted journal') await rm(path.join(data.root, operationPath));
  const before = await snapshot(data.root);
  if (change === 'deleted journal') {
    // 2026-11-09: after explicit manual removal, no saved payload may be used to repair an inconsistent disk graph.
    const view = await readProjectCatalog(data.root);
    expect(view.journeys?.some(journey => journey.pendingOperation)).toBe(false);
    await expect(updateJourney(data.root, data.catalog, data.edit)).rejects.toThrow();
  } else {
    expect((await readJourney(data.root, id))!.journey.pendingOperation).toMatchObject({ state: 'conflict', file });
    await expect(updateJourney(data.root, data.catalog, data.edit)).rejects.toThrow(file);
  }
  expect(await snapshot(data.root)).toEqual(before);
});

it.runIf(process.platform === 'win32')('retries EPERM during step rename with idempotent guards', async () => {
  const { root, catalog, edit } = await fixture();
  inject('/steps/B.md', 'eperm');
  await updateJourney(root, catalog, edit);
  expect(fault.hit).toBe(true);
  expect((await readJourney(root, id))!.journey).toMatchObject({ version: 2, title: edit.title });
  await expect(readFile(path.join(root, operationPath))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('a concurrent GET sees a coherent snapshot without a pending warning during a successful local save', async () => {
  const { root, catalog, journey, edit } = await fixture();
  inject('/steps/B.md', 'intervene-after');
  fault.intervene = async () => {
    const view = await readProjectCatalog(root);
    expect(view.journeys![0]).toEqual(journey);
    expect(view.warnings.some(warning => /not fully|unfinished save/u.test(warning))).toBe(false);
  };
  await updateJourney(root, catalog, edit);
  expect(fault.hit).toBe(true);
  expect((await readJourney(root, id))!.journey.version).toBe(2);
});

it('rejects sequence/map values when patching scalar YAML fields', () => {
  for (const value of ['[malformed]', '{ malformed: true }']) {
    const file = parseManagedMarkdown(Buffer.from(`---\ntitle: ${value}\n---\nBody\n`));
    expect(() => patchManagedMarkdown(file, { title: 'A scalar' })).toThrow('explicit YAML value');
  }
});

it.each(['en', 'ru'])('HTTP %s warnings identify conflicts and the abandonment action validates journal hashes', async language => {
  const data = await fixture();
  await interrupt(data);
  const filename = path.join(data.root, directory, 'steps/A.md');
  await writeFile(filename, (await readFile(filename, 'utf8')) + '\nExternal instructions.\n');
  const { createApp } = await import('../server/app.ts');
  const app = await createApp({ dataRoot: data.root, writeRoot: data.root, editMode: 'direct', projectName: 'Journal', port: 44318, python: 'python' });
  try {
    const headers = { host: '127.0.0.1:44318', cookie: `deckmate-lang=${language}` };
    const { token } = (await app.inject({ url: '/api/snapshot', headers })).json();
    const authorized = { ...headers, 'x-deckmate-token': token };
    const payload = { ...data.edit, source: 'sandbox', steps: data.edit.steps.map(step => ({ ...step,
      id: step.id.toLowerCase(), dependsOn: step.dependsOn.map(id => id.toLowerCase()) })) };
    const response = await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload });
    // 2026-11-09: a recovery stopped by a foreign edit did not perform the request, so it answers 409, never 200.
    expect(response.statusCode, response.body).toBe(409);
    const failure = response.json();
    expect(failure.saved).toBe(true);
    expect(failure.message).toContain('steps/A.md');
    expect(failure.message).toMatch(/changes were saved|not fully|изменения сохранены|не полностью/iu);
    expect(failure.message).toContain(language === 'en' ? 'file changed' : 'Файл Journey изменён');
    expect(response.body).not.toMatch(/JOURNEY_CONFLICT|CATALOG_CONFLICT/u);
    const view = { journeys: (await readProjectCatalog(data.root)).journeys ?? [] };
    expect(view.journeys[0].steps.find((step: CatalogJourneyStep) => step.id === 'A')!.markdown).toContain('External instructions.');
    const abandon = { action: 'abandon-journey-operation', journeyId: id, manifestHash: data.catalog.manifestHash, source: 'sandbox' };
    const before = await snapshot(data.root);
    const post = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload });
    expect((await post(abandon)).statusCode).toBe(400);
    expect((await post({ ...abandon, journalHash: 'invalid' })).statusCode).toBe(400);
    expect((await post({ ...abandon, journalHash: '0'.repeat(64) })).statusCode).toBe(409);
    expect(await snapshot(data.root)).toEqual(before);
    const result = await post({ ...abandon, journalHash: view.journeys[0].pendingOperation!.journalHash });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json().journeys.some((journey: { pendingOperation?: unknown }) => journey.pendingOperation)).toBe(false);
    expect(result.json().journeys).toEqual((await readProjectCatalog(data.root)).journeys);
    delete before[operationPath];
    expect(await snapshot(data.root)).toEqual(before);
  } finally { await app.close(); }
});

it('two processes racing to create the journal do not overwrite the winner on EEXIST', async () => {
  const { root, catalog, edit } = await fixture();
  let release!: () => void;
  let entered!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { entered = resolve; });
  inject('/.deckmate-operation.json', 'intervene-before');
  fault.intervene = async () => { entered(); await blocked; };
  const first = updateJourney(root, catalog, edit).then(() => null, error => error as Error);
  await ready;
  fault.intervene = null;
  let before: Record<string, Buffer>;
  try {
    // 2026-11-09: a real second Node process publishes independently while the first has checked sources and staged its intent.
    const staged = Object.entries(await snapshot(root)).find(([filename]) => filename.endsWith('.tmp'))![1];
    const winner = JSON.parse(staged.toString('utf8'));
    winner.id = randomUUID();
    const publisher = pathToFileURL(path.resolve('server/native-cards.ts')).href;
    const script = `import { createManagedBytes } from ${JSON.stringify(publisher)};
      console.log(await createManagedBytes(process.argv[1], process.argv[2], Buffer.from(process.argv[3])));`;
    const child = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, root, operationPath, JSON.stringify(winner)], { windowsHide: true });
    expect(child.stdout.trim()).toBe('true');
    before = Object.fromEntries(Object.entries(await snapshot(root)).filter(([filename]) => !filename.endsWith('.tmp')));
  } finally { fault.when = ''; release(); }
  expect(await first).toMatchObject({ message: 'JOURNEY_CONFLICT' });
  expect(await snapshot(root)).toEqual(before);
  await expect(updateJourney(root, catalog, edit)).rejects.toThrow('JOURNEY_CONFLICT');
  expect((await readJourney(root, id))!.journey.title).toBe(edit.title);
});
