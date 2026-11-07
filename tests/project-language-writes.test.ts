import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { readActivity } from '../server/activity.ts';
import { createApp } from '../server/app.ts';
import { readCardOptions } from '../server/card-options.ts';
import { CatalogService } from '../server/catalog-service.ts';
import { emptyManifest, renderCatalogManifest } from '../server/catalog.ts';
import type { ServerConfig } from '../server/config.ts';
import { readMilestones } from '../server/milestones.ts';
import { recordPlanningObservation } from '../server/planning-history.ts';
import { readProjectTags } from '../server/project-tags.ts';
import { projectLanguage } from '../server/project-language.ts';
import { readRuns } from '../server/runs.ts';
import { activityEventGroups } from '../src/activity-groups.ts';
import type { CatalogView, RunConfiguration } from '../src/catalog-contracts.ts';
import type { FormatLanguage } from '../src/format-vocabulary.ts';

// 2026-11-06: the journal and the managed registries are project files. Their words follow the manifest's
// formatLanguage, never the interface language of the request, so every write below carries the other language.
const execute = promisify(execFile);
const roots: string[] = [];
const applications: FastifyInstance[] = [];
const services: CatalogService[] = [];
const host = { host: '127.0.0.1:44321' };

afterEach(async () => {
  for (const application of applications.splice(0)) await application.close();
  for (const service of services.splice(0)) await service.close();
  for (const root of roots.splice(0)) {
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(root));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(root).startsWith('deckmate-project-language-')) {
      throw new Error('Unexpected fixture cleanup target');
    }
    await rm(root, { recursive: true, force: true });
  }
});

/** An English project records `formatLanguage: en`; a manifest without the field is a legacy Russian project. */
async function project(language: FormatLanguage) {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-project-language-'));
  roots.push(root);
  await mkdir(path.join(root, 'tasks'));
  const manifest = emptyManifest();
  if (language === 'en') manifest.formatLanguage = 'en';
  manifest.spaces.push({ id: 'work', title: 'Work' });
  manifest.decks.push({ id: 'audio', title: 'Audio', kind: 'task', spaceId: 'work', description: '', icon: 'box', color: '#234567' });
  manifest.members = [{ id: 'kimi', label: 'Kimi', kind: 'agent', aliases: [] }];
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  await execute('git', ['init', '-b', 'deckmate/sandbox', root], { windowsHide: true });
  const config: ServerConfig = { editMode: 'sandbox', dataRoot: root, writeRoot: root, projectName: 'Language test', port: 44321, python: 'python' };
  const app = await createApp(config);
  applications.push(app);
  const token = (await app.inject({ url: '/api/snapshot?source=sandbox', headers: host })).json<{ token: string }>().token;
  const headers = { ...host, 'x-deckmate-token': token, cookie: `deckmate-lang=${language === 'en' ? 'ru' : 'en'}` };
  const post = async (url: string, payload: Record<string, unknown>): Promise<CatalogView> => {
    const response = await app.inject({ method: 'POST', url, headers, payload: { source: 'sandbox', ...payload } });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<CatalogView>();
  };
  const cardId = 'card:' + randomUUID();
  const initial = (await app.inject({ url: '/api/catalog?source=sandbox', headers })).json<CatalogView>();
  const view = await post('/api/catalog', { action: 'create-card', manifestHash: initial.manifestHash, cardId, kind: 'task', title: 'Bell',
    markdown: 'Ring.\n', deckId: 'audio', parentId: null, trackIds: [], owner: 'Kimi', effort: 2, priority: 'medium' });
  return { root, config, post, view, cardId };
}

/** The first line below the YAML block, where a managed registry keeps its human header. */
async function heading(root: string, relative: string): Promise<string | undefined> {
  const text = await readFile(path.join(root, relative), 'utf8');
  return text.slice(text.indexOf('\n---\n') + 5).split('\n').find(line => line.trim());
}

const configuration: RunConfiguration = { id: 'team', shortName: 'team', color: '#9258e5', labelTemplate: 'Cycle %RUN_NR%',
  startDate: '2026-11-02', durationWeeks: 1, upcomingCount: 1, finishTime: '24:00', timeZone: 'UTC',
  carryOver: { review: true, blocked: true, other: true } };

const expected = {
  en: { created: 'Card created', properties: 'Card properties changed', updated: 'Cards updated', owner: 'Owner: Kimi → —',
    board: 'Vision board saved', boardTitle: 'Board: “Vision”', options: '# Card options', tags: '# Project tags',
    milestones: '# Milestones', runs: '# Runs', notifications: '# Notifications', history: '# Planning history' },
  ru: { created: 'Создана карточка', properties: 'Изменены свойства карточки', updated: 'Карточки обновлены', owner: 'Исполнитель: Kimi → —',
    board: 'Сохранена доска Vision', boardTitle: 'Доска: «Vision»', options: '# Параметры карточек', tags: '# Теги проекта',
    milestones: '# Вехи', runs: '# Run', notifications: '# Уведомления', history: '# История планирования' },
} as const;

for (const language of ['en', 'ru'] as const) {
  it(`journals card and board changes in the ${language} project language, readable by the deck feed filters`, async () => {
    const { root, post, view: created, cardId } = await project(language);
    const words = expected[language];
    const sourceHash = (catalog: CatalogView) => catalog.cards.find(card => card.id === cardId)!.sourceHash;
    const changed = await post('/api/catalog', { action: 'set-card-properties', manifestHash: created.manifestHash, cardId,
      sourceHash: sourceHash(created), owner: null, effort: 5, priority: 'medium' });
    await post('/api/catalog', { action: 'bulk-edit-cards', manifestHash: changed.manifestHash, optionsHash: changed.optionsHash ?? '',
      cards: [{ cardId, sourceHash: sourceHash(changed) }], change: { kind: 'hand', memberId: 'kimi', mode: 'add' } });
    await post('/api/boards', { title: 'Vision', hash: '', scene: { type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} } });

    const [hand, properties, creation] = (await readActivity(root, 'audio')).events;
    expect([creation.summary, properties.summary, hand.summary]).toEqual([words.created, words.properties, words.updated]);
    expect(creation.details).toEqual([`Bell: ${words.created}`]);
    expect(properties.details).toEqual([`Bell: ${words.owner}`, 'Bell: Effort: 2 → 5']);
    expect(hand.details).toEqual(['Bell: Hand: null → ["kimi"]']);
    expect(activityEventGroups(creation)).toEqual(new Set(['created']));
    expect(activityEventGroups(properties)).toEqual(new Set(['properties']));
    expect(activityEventGroups(hand)).toEqual(new Set(['properties']));
    const directory = path.join(root, 'tasks/deckmate-activity');
    const files = await Promise.all((await readdir(directory)).map(name => readFile(path.join(directory, name), 'utf8')));
    const board = files.find(text => text.includes('action: save-board'))!;
    expect(board).toContain(`# ${words.board}\n`);
    expect(board).toContain(`- ${words.boardTitle}\n`);
  });

  it(`creates registry headers in the ${language} project language and parses them by YAML alone`, async () => {
    const { root, config, post, view: created, cardId } = await project(language);
    const words = expected[language];
    const sourceHash = created.cards.find(card => card.id === cardId)!.sourceHash;
    const milestones = await post('/api/planning', { action: 'create-milestone', milestonesHash: '',
      milestone: { id: 'release', title: 'Release', date: '2030-12-31', color: '#123456' } });
    const runs = await post('/api/planning', { action: 'save-run-configuration', configuration, runsHash: milestones.runsHash ?? '' });
    const options = await post('/api/catalog', { action: 'bulk-edit-cards', manifestHash: runs.manifestHash, optionsHash: runs.optionsHash ?? '',
      cards: [{ cardId, sourceHash }], change: { kind: 'options', patch: { milestone: 'release' } } });
    await post('/api/catalog', { action: 'save-project-tag', manifestHash: options.manifestHash, tagsHash: '', tag: { name: 'ui', color: '#123456' } });
    await post('/api/notifications/dismiss', { memberId: 'kimi', stack: 'owned', at: '2026-11-06T12:00:00.000Z' });
    const service = new CatalogService(config, ':memory:');
    services.push(service);
    expect(await recordPlanningObservation(root, await service.get('sandbox'))).toBe(true);

    expect(await heading(root, 'tasks/deckmate-card-options.md')).toBe(words.options);
    expect(await heading(root, 'tasks/deckmate-tags.md')).toBe(words.tags);
    expect(await heading(root, 'tasks/deckmate-milestones.md')).toBe(words.milestones);
    expect(await heading(root, 'tasks/deckmate-runs.md')).toBe(words.runs);
    expect(await heading(root, 'tasks/deckmate-notifications.md')).toBe(words.notifications);
    expect(await heading(root, 'tasks/deckmate-planning-history.md')).toBe(words.history);
    // Readers take only the YAML, so a header in either language reads back the same data.
    expect((await readCardOptions(root)).options[cardId]).toMatchObject({ milestone: 'release' });
    expect((await readProjectTags(root)).tags).toEqual([{ name: 'ui', color: '#123456' }]);
    expect((await readMilestones(root)).milestones.map(milestone => milestone.id)).toEqual(['release']);
    expect((await readRuns(root)).configurations.map(item => item.id)).toEqual(['team']);
    service.invalidate('sandbox');
    expect((await service.get('sandbox')).planningHistory?.['milestone:release']).toHaveLength(1);
  });
}

it('takes the project language from the manifest field alone: no manifest is English, no field is Russian', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-project-language-'));
  roots.push(root);
  await mkdir(path.join(root, 'tasks'));
  expect(await projectLanguage(root)).toBe('en');
  const manifest = path.join(root, 'tasks/deckmate.md');
  for (const [text, language] of [
    ['\uFEFF---\r\nschema: 1\r\nformatLanguage: en\r\n---\r\n# Workspace\r\n', 'en'],
    ['---\nschema: 1\n---\n', 'ru'],
    ['---\nschema: [1\n---\n', 'ru'],
  ] as const) {
    await writeFile(manifest, text);
    expect(await projectLanguage(root)).toBe(language);
  }
});
