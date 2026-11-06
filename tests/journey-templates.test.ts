import { afterEach, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CatalogEdit, CatalogJourneyStep, JourneyRoleTarget } from '../src/catalog-contracts.ts';
import { editProjectCatalog, emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { CatalogError, CatalogService } from '../server/catalog-service.ts';
import { importJourneyTemplate, readJourneyTemplates, saveJourneyTemplate } from '../server/journey-templates.ts';

const execute = promisify(execFile);

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const journeySteps: CatalogJourneyStep[] = [
  { id: 'review', title: 'Review %PARENT_TITLE%', markdown: 'Verify %PARENT_TITLE%.', deckId: 'code', owner: '@pavel', dependsOn: ['model'] },
  { id: 'model', title: 'Model %PARENT_TITLE%', markdown: 'Build %PARENT_TITLE%.', deckId: 'art', owner: '@kimi', dependsOn: ['refs'] },
  { id: 'refs', title: 'Refs %PARENT_TITLE%', markdown: 'Collect references for %PARENT_TITLE%.', deckId: 'art', owner: '@glm', dependsOn: [] },
];
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-journey-templates-'));
  roots.push(root);
  for (const directory of ['features', 'docs', 'tasks']) await mkdir(path.join(root, directory));
  await writeFile(path.join(root, 'features/vehicle.md'), '# Vehicles\n\n## 1 — Tiger\n### 1.0 Legacy task (план)\nExisting content.\n');
  const manifest = emptyManifest();
  manifest.spaces.push({ id: 'production', title: 'Production' });
  for (const [id, kind] of [['assets', 'asset'], ['code', 'task'], ['art', 'task'], ['knowledge', 'knowledge']] as const) {
    manifest.decks.push({ id, kind, spaceId: 'production', title: id, icon: 'box', color: '#123456', description: '' });
  }
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  return root;
}
async function createJourney(root: string, steps = journeySteps) {
  await editProjectCatalog(root, { action: 'create-journey', title: 'Vehicle pipeline', deckId: 'assets', steps, manifestHash: (await readProjectCatalog(root)).manifestHash });
  return (await readProjectCatalog(root)).journeys![0];
}
/** Project template with two roles, two zones, and a zone and effort on the second step. */
async function writeTemplate(root: string, id = 'unit-3d', overrides: { index?: string; steps?: Record<string, string> } = {}) {
  const directory = path.join(root, 'tasks/journey-templates', id);
  await mkdir(path.join(directory, 'steps'), { recursive: true });
  await writeFile(path.join(directory, 'steps/design.md'), overrides.steps?.design ?? [
    '---',
    'id: design',
    'title: Дизайн %PARENT_TITLE%',
    'roleId: design',
    'dependsOn: []',
    '---',
    'Собрать референсы для %PARENT_TITLE%.',
    '',
  ].join('\n'));
  await writeFile(path.join(directory, 'steps/model.md'), overrides.steps?.model ?? [
    '---',
    'id: model',
    'title: Модель %PARENT_TITLE%',
    'roleId: art',
    'dependsOn: [design]',
    'effort: 2',
    'priority: high',
    'zoneId: sculpt',
    '---',
    'Построить модель %PARENT_TITLE%.',
    '',
  ].join('\n'));
  await writeFile(path.join(directory, 'index.md'), overrides.index ?? [
    '---',
    'deckmate: journey-template',
    'schema: 1',
    `id: ${id}`,
    'title: Отряд (3D)',
    'description: Путь отряда от дизайна до проверки.',
    'category: Production',
    'tags: [3D, Production]',
    'author: Deckmate',
    "updated: '2026-11-04'",
    'roles:',
    '  - { id: design, title: Дизайн }',
    '  - { id: art, title: Модели и вид }',
    'zones:',
    '  - { id: default, title: Основные шаги }',
    '  - { id: sculpt, title: Лепка }',
    'steps: [steps/design.md, steps/model.md]',
    '---',
    '',
    '# Отряд (3D)',
    '',
  ].join('\n'));
  return directory;
}
async function importEdit(root: string, mode: 'add' | 'replace', roleMapping: Record<string, JourneyRoleTarget>,
  journeyId: string | null = null, journeyHash: string | null = null): Promise<Extract<CatalogEdit, { action: 'import-journey-template' }>> {
  const catalog = await readProjectCatalog(root);
  const template = catalog.journeyTemplates!.find(candidate => candidate.id === 'unit-3d' && candidate.source === 'project')!;
  return { action: 'import-journey-template', deckId: 'assets', manifestHash: catalog.manifestHash,
    templateId: 'unit-3d', templateSource: 'project', templateHash: template.fileHash, mode, journeyId, journeyHash, roleMapping };
}

it('reads bundled and project templates with fields, zones and an aggregate hash', async () => {
  const root = await fixture();
  await writeTemplate(root);
  const bundled = await mkdtemp(path.join(tmpdir(), 'deckmate-bundled-templates-'));
  roots.push(bundled);
  await mkdir(path.join(bundled, 'unit-2d', 'steps'), { recursive: true });
  await writeFile(path.join(bundled, 'unit-2d/steps/paint.md'), '---\nid: paint\ntitle: Покраска\nroleId: art\ndependsOn: []\n---\nПокрасить модель.\n');
  await writeFile(path.join(bundled, 'unit-2d/index.md'), [
    '---', 'deckmate: journey-template', 'schema: 1', 'id: unit-2d', 'title: Отряд (2D)', 'description: Двумерный путь.',
    'category: 2D', 'tags: [2D]', 'author: Deckmate', "updated: '2026-11-03'",
    'roles:', '  - { id: art, title: Вид }', 'steps: [steps/paint.md]', '---', '',
  ].join('\n'));
  const first = await readJourneyTemplates(bundled, root);
  expect(first.templates.map(template => [template.id, template.source])).toEqual([['unit-2d', 'bundled'], ['unit-3d', 'project']]);
  const template = first.templates.find(candidate => candidate.id === 'unit-3d' && candidate.source === 'project')!;
  expect(template).toMatchObject({ title: 'Отряд (3D)', description: 'Путь отряда от дизайна до проверки.', category: 'Production',
    tags: ['3D', 'Production'], author: 'Deckmate', updated: '2026-11-04',
    roles: [{ id: 'design', title: 'Дизайн' }, { id: 'art', title: 'Модели и вид' }],
    zones: [{ id: 'default', title: 'Основные шаги' }, { id: 'sculpt', title: 'Лепка' }] });
  expect(template.steps).toHaveLength(2);
  expect(template.steps[0]).toMatchObject({ id: 'design', roleId: 'design', effort: null, priority: null });
  expect(template.steps[0].zoneId).toBeUndefined();
  expect(template.steps[1]).toMatchObject({ id: 'model', roleId: 'art', dependsOn: ['design'], effort: 2, priority: 'high', zoneId: 'sculpt' });
  const second = await readJourneyTemplates(bundled, root);
  expect(second.templates.find(candidate => candidate.id === 'unit-3d' && candidate.source === 'project')!.fileHash).toBe(template.fileHash);
  const catalog = await readProjectCatalog(root);
  expect(catalog.journeyTemplates!.filter(template => template.source === 'project').map(candidate => candidate.id)).toEqual(['unit-3d']);
  expect(catalog.warnings).toEqual([]);
});

it('reports a broken template as a warning and keeps the rest of the catalog', async () => {
  const root = await fixture();
  await writeTemplate(root);
  await writeTemplate(root, 'broken', { steps: { model: '---\nid: model\ntitle: Модель\nroleId: ghost\ndependsOn: []\n---\nСломанная роль.\n' } });
  await mkdir(path.join(root, 'tasks/journey-templates/orphan/steps'), { recursive: true });
  await writeFile(path.join(root, 'tasks/journey-templates/orphan/steps/lost.md'), '---\nid: lost\ntitle: Без index\nroleId: art\ndependsOn: []\n---\nНевидим.\n');
  const catalog = await readProjectCatalog(root);
  expect(catalog.journeyTemplates!.filter(template => template.source === 'project').map(template => template.id)).toEqual(['unit-3d']);
  expect(catalog.warnings).toEqual(['tasks/journey-templates/broken/index.md: The step references an unknown role: steps/model.md']);
});

it('import add creates a new journey, maps roles and creates a Task deck for unmapped roles', async () => {
  const root = await fixture();
  await writeTemplate(root);
  await importJourneyTemplate(root, await readProjectCatalog(root), await importEdit(root, 'add',
    { design: { deckId: 'code' }, art: { createDeck: { title: 'Моделирование', spaceId: 'production' } } }));
  const after = await readProjectCatalog(root);
  const created = after.decks.find(deck => deck.title === 'Моделирование')!;
  expect(created).toMatchObject({ kind: 'task', spaceId: 'production' });
  const journey = after.journeys![0];
  expect(journey).toMatchObject({ title: 'Отряд (3D)', version: 1, deckId: 'assets', description: 'Путь отряда от дизайна до проверки.' });
  expect(journey.zones?.map(zone => zone.id)).toEqual(['default', 'sculpt']);
  expect(journey.steps.map(step => [step.id, step.deckId])).toEqual([['design', 'code'], ['model', created.id]]);
  expect(journey.steps[1]).toMatchObject({ effort: 2, priority: 'high', zoneId: 'sculpt', owner: null, dependsOn: ['design'] });
  expect(after.warnings).toEqual([]);
});

it('import add appends into an existing journey, renames colliding ids and merges zones', async () => {
  const root = await fixture();
  const journey = await createJourney(root);
  await writeTemplate(root);
  const refsBytes = await readFile(path.join(root, `tasks/journeys/${journey.id}/steps/refs.md`));
  await importJourneyTemplate(root, await readProjectCatalog(root), await importEdit(root, 'add',
    { design: { deckId: 'art' }, art: { deckId: 'art' } }, journey.id, journey.fileHash));
  const after = await readProjectCatalog(root);
  const updated = after.journeys![0];
  expect(updated.version).toBe(2);
  expect(updated.steps.map(step => step.id)).toEqual(['review', 'model', 'refs', 'design', 'model-2']);
  expect(updated.steps.find(step => step.id === 'model-2')!.dependsOn).toEqual(['design']);
  expect(updated.steps.find(step => step.id === 'model')!.dependsOn).toEqual(['refs']);
  expect(updated.zones?.map(zone => zone.id)).toEqual(['default', 'sculpt']);
  for (const step of updated.steps.slice(0, 3)) expect(step.zoneId).toBeUndefined();
  expect(await readFile(path.join(root, `tasks/journeys/${journey.id}/steps/refs.md`))).toEqual(refsBytes);
  expect(after.warnings).toEqual([]);
});

it('import replace swaps the steps and zones of the existing journey', async () => {
  const root = await fixture();
  const journey = await createJourney(root);
  await writeTemplate(root);
  await importJourneyTemplate(root, await readProjectCatalog(root), await importEdit(root, 'replace',
    { design: { deckId: 'code' }, art: { deckId: 'code' } }, journey.id, journey.fileHash));
  const after = await readProjectCatalog(root);
  const updated = after.journeys![0];
  expect(updated.version).toBe(2);
  expect(updated.title).toBe('Vehicle pipeline');
  expect(updated.steps.map(step => [step.id, step.deckId, step.zoneId])).toEqual([['design', 'code', undefined], ['model', 'code', 'sculpt']]);
  expect(updated.zones?.map(zone => zone.id)).toEqual(['default', 'sculpt']);
  // review and refs are removed; model matches the template step ID and is updated in place.
  for (const removed of ['review', 'refs']) {
    await expect(readFile(path.join(root, `tasks/journeys/${journey.id}/steps/${removed}.md`))).rejects.toMatchObject({ code: 'ENOENT' });
  }
  expect((await readFile(path.join(root, `tasks/journeys/${journey.id}/steps/model.md`))).toString('utf8')).toContain('Модель %PARENT_TITLE%');
  expect((await readdir(path.join(root, `tasks/journeys/${journey.id}/steps`))).sort()).toEqual(['design.md', 'model.md']);
  expect(after.warnings).toEqual([]);
});

it('rejects a stale template hash and an incomplete or invalid role mapping without writing', async () => {
  const root = await fixture();
  await writeTemplate(root);
  const catalog = await readProjectCatalog(root);
  const stale = await importEdit(root, 'add', { design: { deckId: 'code' }, art: { deckId: 'art' } });
  await expect(importJourneyTemplate(root, catalog, { ...stale, templateHash: '0'.repeat(64) })).rejects.toThrow('TEMPLATE_CONFLICT');
  await expect(importJourneyTemplate(root, catalog, await importEdit(root, 'add', { design: { deckId: 'code' } })))
    .rejects.toThrow('Choose a Deck for role “Модели и вид”.');
  await expect(importJourneyTemplate(root, catalog, await importEdit(root, 'add', { design: { deckId: 'knowledge' }, art: { deckId: 'art' } })))
    .rejects.toThrow('Task/Mixed');
  await expect(importJourneyTemplate(root, catalog, await importEdit(root, 'add', { design: { deckId: 'code' }, art: { deckId: 'art' }, ghost: { deckId: 'art' } })))
    .rejects.toThrow('Unknown template role: ghost');
  const after = await readProjectCatalog(root);
  expect(after.journeys).toEqual([]);
  expect(after.decks).toHaveLength(4);
  expect(await readdir(path.join(root, 'tasks'))).toEqual(['deckmate.md', 'journey-templates']);
});

it('save-journey-template stores a project template the catalog reads back and imports', async () => {
  const root = await fixture();
  const journey = await createJourney(root);
  const catalog = await readProjectCatalog(root);
  await expect(saveJourneyTemplate(root, catalog, { action: 'save-journey-template', journeyId: journey.id, journeyHash: '0'.repeat(64),
    title: 'Конвейер машины', description: 'Полный путь машины.', category: 'Production', tags: ['auto'], manifestHash: catalog.manifestHash })).rejects.toThrow('JOURNEY_CONFLICT');
  const written = await saveJourneyTemplate(root, catalog, { action: 'save-journey-template', journeyId: journey.id, journeyHash: journey.fileHash,
    title: 'Конвейер машины', description: 'Полный путь машины.', category: 'Production', tags: ['auto'], manifestHash: catalog.manifestHash });
  const directory = written.at(-1)!.replace(/index\.md$/u, '');
  expect(written).toHaveLength(4);
  const after = await readProjectCatalog(root);
  const template = after.journeyTemplates!.find(candidate => candidate.source === 'project')!;
  expect(template).toMatchObject({ title: 'Конвейер машины', description: 'Полный путь машины.', category: 'Production',
    tags: ['auto'], author: 'Проект', updated: new Date().toISOString().slice(0, 10) });
  expect(template.roles).toEqual([{ id: 'code', title: 'code' }, { id: 'art', title: 'art' }]);
  expect(template.steps.map(step => [step.id, step.roleId])).toEqual([['review', 'code'], ['model', 'art'], ['refs', 'art']]);
  expect(after.warnings).toEqual([]);
  await importJourneyTemplate(root, after, { action: 'import-journey-template', deckId: 'assets', manifestHash: after.manifestHash,
    templateId: template.id, templateSource: 'project', templateHash: template.fileHash, mode: 'add', journeyId: null, journeyHash: null,
    roleMapping: { code: { deckId: 'code' }, art: { deckId: 'art' } } });
  const final = await readProjectCatalog(root);
  expect(final.journeys).toHaveLength(2);
  expect(final.journeys!.find(candidate => candidate.title === 'Конвейер машины')!.steps.map(step => step.deckId))
    .toEqual(['code', 'art', 'art']);
  expect(final.warnings).toEqual([]);
  expect((await readdir(path.join(root, directory, 'steps'))).sort()).toEqual(['model.md', 'refs.md', 'review.md']);
});

it('dispatches import, update and save-as-template through the catalog queue', async () => {
  const root = await fixture();
  await execute('git', ['init', '-b', 'deckmate/sandbox', root], { windowsHide: true });
  await createJourney(root, journeySteps);
  await writeTemplate(root);
  const service = new CatalogService({ editMode: 'sandbox', dataRoot: root, writeRoot: root, projectName: 'Тест', port: 4317, python: 'python' }, ':memory:');
  try {
    const before = await service.get('sandbox');
    const template = before.journeyTemplates!.find(candidate => candidate.id === 'unit-3d' && candidate.source === 'project')!;
    const imported = await service.edit({ action: 'import-journey-template', deckId: 'assets', manifestHash: before.manifestHash,
      templateId: 'unit-3d', templateSource: 'project', templateHash: template.fileHash, mode: 'add', journeyId: null, journeyHash: null,
      roleMapping: { design: { deckId: 'code' }, art: { createDeck: { title: 'Моделирование', spaceId: 'production' } } } }, 'sandbox');
    expect(imported.journeys).toHaveLength(2);
    expect(imported.decks.find(deck => deck.title === 'Моделирование')).toMatchObject({ kind: 'task', spaceId: 'production' });
    const stale = await service.edit({ action: 'import-journey-template', deckId: 'assets', manifestHash: imported.manifestHash,
      templateId: 'unit-3d', templateSource: 'project', templateHash: '0'.repeat(64), mode: 'add', journeyId: null, journeyHash: null,
      roleMapping: { design: { deckId: 'code' }, art: { deckId: 'code' } } }, 'sandbox').catch(error => error);
    expect(stale).toBeInstanceOf(CatalogError);
    expect(stale.status).toBe(409);
    const created = imported.journeys!.find(journey => journey.title === 'Отряд (3D)')!;
    const updated = await service.edit({ action: 'update-journey', journeyId: created.id, journeyHash: created.fileHash,
      title: 'Отряд (3D) v2', description: 'Обновлён импортом.', zones: [{ id: 'default', title: 'Основные шаги' }],
      steps: created.steps.map(step => ({ ...step, effort: 1, zoneId: 'default' })), manifestHash: imported.manifestHash }, 'sandbox');
    expect(updated.journeys!.find(journey => journey.id === created.id))
      .toMatchObject({ version: 2, title: 'Отряд (3D) v2', description: 'Обновлён импортом.' });
    const saved = await service.edit({ action: 'save-journey-template', journeyId: created.id,
      journeyHash: updated.journeys!.find(journey => journey.id === created.id)!.fileHash,
      title: 'Проектный отряд', description: '', category: 'Production', tags: [], manifestHash: updated.manifestHash }, 'sandbox');
    expect(saved.journeyTemplates!.some(candidate => candidate.title === 'Проектный отряд' && candidate.source === 'project')).toBe(true);
    expect(saved.warnings).toEqual([]);
  } finally { await service.close(); }
});
