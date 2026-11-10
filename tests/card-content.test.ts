import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as filesystem from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile, spawnSync } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import { editProjectCatalog, emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { readCardContent } from '../server/card-content.ts';
import { CatalogService } from '../server/catalog-service.ts';
import { createApp } from '../server/app.ts';
import { readProjectMarkdown, replaceProjectMarkdown } from '../server/native-cards.ts';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename), readFile: vi.fn(actual.readFile) };
});
const execute = promisify(execFile);
const pythonAvailable = spawnSync('python', ['--version'], { windowsHide: true }).status === 0;
const roots: string[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const heroId = 'hero:features/match.md#1';
const taskId = 'task:features/match.md#1.0';
const tailId = 'task:features/match.md#1.1';
const docId = 'doc:docs/guide.md';
const mechanicDocId = 'doc:features/match.md';
const longTitle = 'Длинное название эпика про снабжение и сеть, которое не влезает в seventy characters — точно длиннее';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-content-'));
  roots.push(root);
  for (const folder of ['features', 'docs', 'tasks', 'Tools']) await mkdir(path.join(root, folder));
  await writeFile(path.join(root, 'features/match.md'), Buffer.from(
    '﻿# Матч и штаб\r\n'
    + '\r\n'
    + '## 1 — ' + longTitle + '\r\n'
    + 'Вступление эпика: «объёмный» текст 👣 со ссылкой [→](<../features/match.md#1.0>).\r\n'
    + 'Вторая строка вступления.\r\n'
    + '\r\n'
    + '### 1.0 Условная цена (в работе, Павел — выбрать вариант)\r\n'
    + '**Кто:** Павел\r\n'
    + 'Тело среза с эмодзи 🎯.\r\n'
    + '\r\n'
    + '### 1.1 Хвост поставок (принято 2026-11-02)\r\n'
    + 'Готово.\r\n'
    + '```md\r\n'
    + '### 9.9 Не срез: внутри fenced code\r\n'
    + '```\r\n', 'utf8'));
  await writeFile(path.join(root, 'docs/guide.md'), '# Руководство\nТело документа без статуса.\n');
  await writeFile(path.join(root, 'tasks/iterations.md'), '## Итерация 1 — Проверка\nНачало: 2026-11-03\n');
  await writeFile(path.join(root, 'Tools/board.py'), '# Read-only fixture\n');
  const manifest = emptyManifest();
  manifest.members = [{ id: 'pavel', label: 'Павел', kind: 'human', aliases: ['Паша'] }];
  manifest.spaces.push({ id: 'work', title: 'Work' });
  manifest.decks.push({ id: 'sound', kind: 'task', title: 'Sound', spaceId: 'work', description: '', icon: 'box', color: '#123456' });
  manifest.tracks.push({ id: 'release', title: 'Release', description: '' });
  manifest.membership.push({ card: taskId, deck: 'sound', tracks: ['release'] });
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  return root;
}

it('edits hero title and intro in place, preserving BOM, CRLF, epic number, separator and child tasks', async () => {
  const root = await fixture();
  const before = await readFile(path.join(root, 'features/match.md'));
  const content = await readCardContent(root, heroId);
  expect(content.title).toBe(longTitle);
  expect(content.markdown).toBe('Вступление эпика: «объёмный» текст 👣 со ссылкой [→](<../features/match.md#1.0>).\r\nВторая строка вступления.\r\n\r\n');
  const catalog = await readProjectCatalog(root);
  const hash = catalog.cards.find(card => card.id === heroId)!.sourceHash;
  expect(content.sourceHash).toBe(hash);
  vi.mocked(filesystem.rename).mockClear();
  await editProjectCatalog(root, { action: 'update-card-content', cardId: heroId, sourceHash: content.sourceHash,
    title: 'Короткое название', markdown: 'Новое вступление.\r\n', manifestHash: catalog.manifestHash });
  expect(vi.mocked(filesystem.rename).mock.calls).toHaveLength(1);
  const after = await readFile(path.join(root, 'features/match.md'));
  expect(after.subarray(0, 8)).toEqual(before.subarray(0, 8)); // BOM and H1 remain unchanged.
  expect(after.toString('utf8')).toContain('## 1 — Короткое название\r\n');
  expect(after.toString('utf8')).toContain('Новое вступление.\r\n### 1.0');
  // Bytes outside the edited ranges stay intact, including both slices, their status markers, and fenced code.
  expect(after.toString('utf8')).toContain('### 1.0 Условная цена (в работе, Павел — выбрать вариант)');
  expect(after.toString('utf8')).toContain('### 1.1 Хвост поставок (принято 2026-11-02)');
  expect(after.toString('utf8')).toContain('### 9.9 Не срез: внутри fenced code');
  const tail = after.indexOf(Buffer.from('### 1.0'));
  const beforeTail = before.indexOf(Buffer.from('### 1.0'));
  expect(after.subarray(tail)).toEqual(before.subarray(beforeTail));
  const updated = await readProjectCatalog(root);
  const hero = updated.cards.find(card => card.id === heroId)!;
  expect(hero.title).toBe('Короткое название');
  expect(hero.markdown).toBe('Новое вступление.\r\n');
  expect(updated.cards.find(card => card.id === taskId)).toMatchObject({ state: 'started', parentId: heroId });
  expect(updated.cards.find(card => card.id === tailId)).toMatchObject({ state: 'done', parentId: heroId });
});

it('edits task title and body while keeping version, check, status brackets and neighbour slices byte for byte', async () => {
  const root = await fixture();
  const longTaskTitle = 'Условная цена, резерв и пополнение отряда в бою — подробное название длиннее семидесяти символов';
  await writeFile(path.join(root, 'features/match.md'), Buffer.from(
    '﻿# Матч и штаб\r\n\r\n## 1 — Тыл\r\nВступление.\r\n\r\n'
    + '### 1.0 ' + longTaskTitle + ' (в работе, Павел — выбрать вариант)\r\n'
    + '**Кто:** Павел\r\n'
    + 'Тело среза 🎯 «с кавычками».\r\n'
    + '### 1.1 Хвост (принято 2026-11-02)\r\n'
    + 'Сосед.\r\n'
    + '### ✅ 1.2 Проверенная вещь (принято 2026-11-01)\r\n'
    + 'Готово.\r\n', 'utf8'));
  const catalog = await readProjectCatalog(root);
  const content = await readCardContent(root, taskId);
  expect(content.title).toBe(longTaskTitle); // Keep the full source title, not shortText.
  expect(catalog.cards.find(card => card.id === taskId)!.title).not.toBe(longTaskTitle);
  expect(content.markdown).toBe('**Кто:** Павел\r\nТело среза 🎯 «с кавычками».\r\n');
  await editProjectCatalog(root, { action: 'update-card-content', cardId: taskId, sourceHash: content.sourceHash,
    title: 'Новое короткое название среза', markdown: '**Кто:** GLM\r\nОбновлённое тело.\r\n\r\n', manifestHash: catalog.manifestHash });
  const after = (await readFile(path.join(root, 'features/match.md'))).toString('utf8');
  expect(after).toContain('### 1.0 Новое короткое название среза (в работе, Павел — выбрать вариант)');
  expect(after).toContain('**Кто:** GLM\r\nОбновлённое тело.\r\n\r\n### 1.1');
  // The neighboring slice keeps its checkmark, version, and date.
  expect(after).toContain('### ✅ 1.2 Проверенная вещь (принято 2026-11-01)');
  const updated = await readProjectCatalog(root);
  expect(updated.cards.find(card => card.id === taskId)).toMatchObject({ state: 'started', owner: null, ownerNote: 'GLM', parentId: heroId });
  expect(updated.cards.find(card => card.id === 'task:features/match.md#1.2')).toMatchObject({ state: 'done' });
});

it('rejects task edits that smuggle a status mark, a new slice heading or an unclosed code fence', async () => {
  const root = await fixture();
  const content = await readCardContent(root, taskId);
  const manifestHash = (await readProjectCatalog(root)).manifestHash;
  const before = await readFile(path.join(root, 'features/match.md'));
  const edit = { action: 'update-card-content' as const, cardId: taskId, sourceHash: content.sourceHash, manifestHash };
  await expect(editProjectCatalog(root, { ...edit, title: 'Название (принято 2026-11-03)', markdown: content.markdown })).rejects.toThrow('state marker');
  await expect(editProjectCatalog(root, { ...edit, title: content.title, markdown: 'Тело.\r\n### 9.9 Новый срез (план)\r\nЕщё.\r\n' })).rejects.toThrow(/numbers, states or parents|breaks mechanic parsing/);
  await expect(editProjectCatalog(root, { ...edit, title: content.title, markdown: 'Тело.\r\n```\r\nнезакрытый fence\r\n' })).rejects.toThrow(/numbers, states or parents|breaks mechanic parsing/);
  expect(await readFile(path.join(root, 'features/match.md'))).toEqual(before);
});

it('treats hero intro edits that would absorb child slices or duplicate an epic as structure changes', async () => {
  const root = await fixture();
  const content = await readCardContent(root, heroId);
  const manifestHash = (await readProjectCatalog(root)).manifestHash;
  const before = await readFile(path.join(root, 'features/match.md'));
  const edit = { action: 'update-card-content' as const, cardId: heroId, sourceHash: content.sourceHash, manifestHash };
  await expect(editProjectCatalog(root, { ...edit, title: content.title, markdown: '### 1.0 Новый срез (план)\r\n' })).rejects.toThrow('numbers, states or parents');
  // An H2 without slices is ordinary text; a duplicate epic number makes parsing fail.
  await expect(editProjectCatalog(root, { ...edit, title: content.title, markdown: '## 1 — Дубль эпика\r\n' })).rejects.toThrow('Duplicate Hero number');
  expect(await readFile(path.join(root, 'features/match.md'))).toEqual(before);
});

it('writes an empty hero intro and preserves the empty line before the first slice', async () => {
  const root = await fixture();
  const content = await readCardContent(root, heroId);
  const manifestHash = (await readProjectCatalog(root)).manifestHash;
  await editProjectCatalog(root, { action: 'update-card-content', cardId: heroId, sourceHash: content.sourceHash,
    title: content.title, markdown: '', manifestHash });
  const after = (await readFile(path.join(root, 'features/match.md'))).toString('utf8');
  expect(after).toContain('## 1 — ' + longTitle + '\r\n### 1.0');
  const hero = (await readProjectCatalog(root)).cards.find(card => card.id === heroId)!;
  expect(hero.markdown).toBe('');
});

it('edits a plain document keeping its H1 line ending and inserting an H1 when absent', async () => {
  const root = await fixture();
  const content = await readCardContent(root, docId);
  expect(content).toMatchObject({ title: 'Руководство', markdown: 'Тело документа без статуса.\n' });
  const manifestHash = (await readProjectCatalog(root)).manifestHash;
  await editProjectCatalog(root, { action: 'update-card-content', cardId: docId, sourceHash: content.sourceHash,
    title: 'Новое руководство 👣', markdown: 'Обновлённое тело.\n\n- пункт\n', manifestHash });
  const after = await readFile(path.join(root, 'docs/guide.md'));
  expect(after.toString('utf8')).toBe('# Новое руководство 👣\nОбновлённое тело.\n\n- пункт\n');
  // Without an H1, insert the title after the YAML frontmatter and preserve its bytes and the BOM.
  const bare = Buffer.from('﻿---\r\nicon: 💰\r\n---\r\nТело без заголовка.\r\n', 'utf8');
  await writeFile(path.join(root, 'docs/bare.md'), bare);
  const bareContent = await readCardContent(root, 'doc:docs/bare.md');
  expect(bareContent).toMatchObject({ title: 'bare', markdown: 'Тело без заголовка.\r\n' });
  await editProjectCatalog(root, { action: 'update-card-content', cardId: 'doc:docs/bare.md', sourceHash: bareContent.sourceHash,
    title: 'Безымянная механика', markdown: 'Тело без заголовка.\r\n', manifestHash });
  const bareAfter = await readFile(path.join(root, 'docs/bare.md'));
  expect(bareAfter.subarray(0, 17)).toEqual(bare.subarray(0, 17)); // BOM and start of YAML.
  expect(bareAfter.toString('utf8')).toBe('﻿---\r\nicon: 💰\r\n---\r\n# Безымянная механика\r\n\r\nТело без заголовка.\r\n');
});

it('lets a mechanic document edit body text but keeps every slice id, state and parent', async () => {
  const root = await fixture();
  const before = await readFile(path.join(root, 'features/match.md'));
  const content = await readCardContent(root, mechanicDocId);
  expect(content.title).toBe('Матч и штаб');
  expect(content.markdown.startsWith('\r\n## 1 — ' + longTitle)).toBe(true);
  const manifestHash = (await readProjectCatalog(root)).manifestHash;
  const body = content.markdown.replace('Вторая строка вступления.', 'Вторая строка вступления — дописано агентом.');
  await editProjectCatalog(root, { action: 'update-card-content', cardId: mechanicDocId, sourceHash: content.sourceHash,
    title: 'Матч и штаб (правка)', markdown: body, manifestHash });
  const after = await readFile(path.join(root, 'features/match.md'));
  expect(after.toString('utf8')).toContain('# Матч и штаб (правка)');
  expect(after.toString('utf8')).toContain('дописано агентом');
  expect(after.subarray(after.indexOf(Buffer.from('### 1.0')))).toEqual(before.subarray(before.indexOf(Buffer.from('### 1.0'))));
  const updated = await readProjectCatalog(root);
  expect(updated.cards.find(card => card.id === mechanicDocId)!.title).toBe('Матч и штаб (правка)');
  expect(updated.cards.find(card => card.id === taskId)!.parentId).toBe(heroId);
  // Reject structural changes to the entire document body.
  const broken = (await readCardContent(root, mechanicDocId)).markdown.replace('### 1.1', '### 1.9');
  const fresh = await readProjectCatalog(root);
  await expect(editProjectCatalog(root, { action: 'update-card-content', cardId: mechanicDocId,
    sourceHash: fresh.cards.find(card => card.id === mechanicDocId)!.sourceHash, title: 'Матч и штаб (правка)', markdown: broken, manifestHash: fresh.manifestHash }))
    .rejects.toThrow('numbers, states or parents');
});

it('reports protected documents with an explanation instead of editable content', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'tasks/iteration-board.md'), '# Доска (генерируется)\n');
  const journeysDirectory = path.join(root, 'tasks/journeys');
  await mkdir(journeysDirectory, { recursive: true });
  await mkdir(path.join(journeysDirectory, '11111111-1111-4111-8111-111111111111'));
  for (const [cardId, fragment] of [['doc:tasks/freetion.md', 'workspace catalog'], ['doc:tasks/iteration-board.md', 'board.py'], ['doc:tasks/journeys/11111111-1111-4111-8111-111111111111/index.md', 'Journey']] as const) {
    await expect(readCardContent(root, cardId)).rejects.toMatchObject({ status: 422, message: expect.stringContaining(fragment) });
  }
  const manifestHash = (await readProjectCatalog(root)).manifestHash;
  const hash = manifestHash;
  await expect(editProjectCatalog(root, { action: 'update-card-content', cardId: 'doc:tasks/freetion.md',
    sourceHash: hash, title: 'Нельзя', markdown: '', manifestHash })).rejects.toThrow('workspace catalog');
  await expect(readCardContent(root, 'doc:tasks/missing-file.md')).rejects.toMatchObject({ status: 404 });
  await expect(readCardContent(root, 'card:11111111-1111-4111-8111-111111111111')).rejects.toMatchObject({ status: 404 });
  await expect(readCardContent(root, 'hero:docs/guide.md#1')).rejects.toMatchObject({ status: 404 });
});

it('saves native card content by patching only the title scalar and the body range', async () => {
  const root = await fixture();
  const uuid = '33333333-3333-4333-8333-333333333333';
  const relative = `cards/${uuid}.md`;
  await mkdir(path.join(root, 'cards'));
  const yamlHeader = '# верхний комментарий\r\n'
    + 'deckmate: card # тип записи\r\n'
    + 'schema: 1\r\n'
    + `id: ${uuid}\r\n`
    + 'kind: task\r\n'
    + 'title: Старое название 👣 # комментарий названия\r\n'
    + 'state: в работе\r\n'
    + 'owner: Павел\r\n'
    + 'deckId: sound\r\n'
    + 'trackIds:\r\n'
    + '  - release # трек\r\n'
    + 'parentId: null\r\n'
    + 'effort: 3.5\r\n'
    + 'priority: high\r\n'
    + 'unknownKey: сохранить байт в байт\r\n';
  const body = 'Тело карточки 🎯 «с кавычками».\r\nВторая строка.\r\n';
  await writeFile(path.join(root, relative), Buffer.from('﻿---\r\n' + yamlHeader + '---\r\n' + body, 'utf8'));
  const content = await readCardContent(root, 'card:' + uuid);
  expect(content).toMatchObject({ title: 'Старое название 👣', markdown: body });
  const manifestHash = (await readProjectCatalog(root)).manifestHash;
  const catalog = await readProjectCatalog(root);
  const native = catalog.cards.find(card => card.id === 'card:' + uuid)!;
  expect(native).toMatchObject({ effort: 3.5, priority: 'high', deckId: 'sound', trackIds: ['release'] });
  await editProjectCatalog(root, { action: 'update-card-content', cardId: 'card:' + uuid, sourceHash: content.sourceHash,
    title: 'Новое: название с двоеточием', markdown: 'Обновлённое тело.\r\n', manifestHash });
  const after = (await readFile(path.join(root, relative))).toString('utf8');
  expect(after).toContain('title: "Новое: название с двоеточием" # комментарий названия');
  expect(after).toContain('# верхний комментарий');
  expect(after).toContain('deckmate: card # тип записи');
  expect(after).toContain('  - release # трек');
  expect(after).toContain('unknownKey: сохранить байт в байт');
  expect(after).toContain('effort: 3.5');
  expect(after.endsWith('---\r\nОбновлённое тело.\r\n')).toBe(true);
  expect(after).not.toContain('Старое название');
  expect(after).not.toContain('Вторая строка');
  const updated = await readProjectCatalog(root);
  expect(updated.cards.find(card => card.id === 'card:' + uuid)).toMatchObject({ title: 'Новое: название с двоеточием', effort: 3.5, priority: 'high' });
});

it('performs zero writes for a no-op round trip of every card kind', async () => {
  const root = await fixture();
  const manifestHash = (await readProjectCatalog(root)).manifestHash;
  const uuid = '44444444-4444-4444-8444-444444444444';
  await mkdir(path.join(root, 'cards'));
  await writeFile(path.join(root, `cards/${uuid}.md`), Buffer.from('---\ndeckmate: card\nschema: 1\nid: ' + uuid
    + '\nkind: doc\ntitle: Карточка\nstate: null\nowner: null\ndeckId: null\ntrackIds: []\nparentId: null\n---\nТело native.\n', 'utf8'));
  for (const cardId of [heroId, taskId, docId, mechanicDocId, 'card:' + uuid]) {
    const content = await readCardContent(root, cardId);
    vi.mocked(filesystem.rename).mockClear();
    await editProjectCatalog(root, { action: 'update-card-content', cardId, sourceHash: content.sourceHash,
      title: content.title, markdown: content.markdown, manifestHash });
    expect(vi.mocked(filesystem.rename)).not.toHaveBeenCalled();
  }
});

it('refuses stale whole-file and manifest hashes without touching the file', async () => {
  const root = await fixture();
  const catalog = await readProjectCatalog(root);
  const content = await readCardContent(root, heroId);
  const before = await readFile(path.join(root, 'features/match.md'));
  const edit = { action: 'update-card-content' as const, cardId: heroId, title: 'Другое', markdown: 'Другое вступление.\r\n' };
  await expect(editProjectCatalog(root, { ...edit, sourceHash: '0'.repeat(64), manifestHash: catalog.manifestHash })).rejects.toThrow('CARD_CONFLICT');
  await expect(editProjectCatalog(root, { ...edit, sourceHash: content.sourceHash, manifestHash: 'stale' })).rejects.toThrow('CATALOG_CONFLICT');
  expect(await readFile(path.join(root, 'features/match.md'))).toEqual(before);
});

// 2026-11-10: API validation and saved content do not depend on an optional board rebuild succeeding.
it('serves card content over the API with validation, read-only live source and draft-preserving conflicts', async () => {
  const root = await fixture();
  await execute('git', ['init', '-b', 'deckmate/sandbox', root], { windowsHide: true });
  const app = await createApp({ editMode: 'sandbox', dataRoot: root, writeRoot: root, projectName: 'Test', port: 44320, python: 'python' });
  apps.push(app);
  const headers = { host: '127.0.0.1:44320' };
  const snapshot = (await app.inject({ url: '/api/snapshot', headers })).json();
  const authorized = { ...headers, 'x-deckmate-token': snapshot.token };
  const missing = await app.inject({ url: '/api/card-content', headers });
  expect(missing.statusCode).toBe(400);
  const unknown = await app.inject({ url: '/api/card-content?cardId=task:features/match.md#9.9', headers });
  expect(unknown.statusCode).toBe(404);
  const protectedDoc = await app.inject({ url: '/api/card-content?cardId=doc:tasks/freetion.md', headers });
  expect(protectedDoc.statusCode).toBe(422);
  expect(protectedDoc.json().message).toContain('workspace catalog');
  const localizedProtectedDocs = await Promise.all(['ru', 'en', 'ru'].map(language => app.inject({
    url: '/api/card-content?cardId=doc:tasks/freetion.md',
    headers: { ...headers, cookie: `deckmate-lang=${language}` },
  })));
  expect(localizedProtectedDocs.map(response => response.statusCode)).toEqual([422, 422, 422]);
  expect(localizedProtectedDocs[0].json().message).toBe('Каталог рабочих пространств (tasks/deckmate.md) управляется настройками колод и треков, а не текстовым редактором.');
  expect(localizedProtectedDocs[1].json().message).toBe(protectedDoc.json().message);
  expect(localizedProtectedDocs[2].json().message).toBe(localizedProtectedDocs[0].json().message);
  const live = await app.inject({ url: '/api/card-content?source=live&cardId=' + encodeURIComponent(heroId), headers });
  expect(live.statusCode).toBe(200);
  expect(live.json()).toMatchObject({ cardId: heroId, title: longTitle });
  const payload = { action: 'update-card-content', cardId: heroId, source: 'sandbox',
    sourceHash: live.json().sourceHash, title: 'API-название', markdown: 'API-вступление.\r\n', manifestHash: (await readProjectCatalog(root)).manifestHash };
  expect((await app.inject({ method: 'POST', url: '/api/catalog', headers, payload })).statusCode).toBe(403);
  const conflict = await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: { ...payload, sourceHash: '0'.repeat(64) } });
  expect(conflict.statusCode).toBe(409);
  const saved = await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload });
  expect(saved.statusCode, saved.body).toBe(200);
  const fresh = await app.inject({ url: '/api/card-content?cardId=' + encodeURIComponent(heroId), headers });
  expect(fresh.json()).toMatchObject({ title: 'API-название', markdown: 'API-вступление.\r\n' });
  for (const invalid of [{ ...payload, title: '' }, { ...payload, title: 'a\nb' }, { ...payload, markdown: 42 },
    { ...payload, title: 'д'.repeat(1001) }, { ...payload, markdown: 'x'.repeat(200001) }, { ...payload, cardId: 'hero:features/match.md#1', title: undefined }]) {
    const response = await app.inject({ method: 'POST', url: '/api/catalog', headers: authorized, payload: invalid });
    expect(response.statusCode, JSON.stringify(invalid)).toBe(400);
  }
});

it('keeps a saved mechanic edit when the board rebuild fails, without rollback or false retry', async () => {
  const root = await fixture();
  await execute('git', ['init', '-b', 'deckmate/sandbox', root], { windowsHide: true });
  const service = new CatalogService({ editMode: 'sandbox', dataRoot: root, writeRoot: root, projectName: 'Test', port: 44321, python: 'definitely-missing-python' }, ':memory:');
  try {
    const catalog = await service.get('sandbox');
    const content = await readCardContent(root, heroId);
    const result = await service.edit({ action: 'update-card-content', cardId: heroId, sourceHash: content.sourceHash,
      title: 'Сохранено без доски', markdown: 'Вступление сохранено.\r\n', manifestHash: catalog.manifestHash }, 'sandbox');
    expect(result.savedWarning).toContain('board was not rebuilt');
    const after = (await readFile(path.join(root, 'features/match.md'))).toString('utf8');
    expect(after).toContain('## 1 — Сохранено без доски');
    expect(after).toContain('### 1.1 Хвост поставок (принято 2026-11-02)');
  } finally { await service.close(); }
});

it.skipIf(!pythonAvailable)('rebuilds the board quietly when python and Tools/board.py are healthy', async () => {
  const root = await fixture();
  // 2026-11-10: a document edit never invokes the renderer; edit a mechanic and verify generated bytes to prove the rebuild ran.
  await writeFile(path.join(root, 'Tools/board.py'), [
    'from pathlib import Path', "ROOT = Path(__file__).resolve().parents[1]",
    "BOARD = 'tasks/iteration-board.md'", "TABLE = 'tasks/iteration-table.md'",
    'def build():', "    return {BOARD: (ROOT / 'features/match.md').read_text(encoding='utf-8-sig'), TABLE: '# Rendered table\\n'}", '',
  ].join('\n'));
  await writeFile(path.join(root, 'tasks/iteration-board.md'), '# Old board\n');
  await writeFile(path.join(root, 'tasks/iteration-table.md'), '# Old table\n');
  await execute('git', ['init', '-b', 'deckmate/sandbox', root], { windowsHide: true });
  const service = new CatalogService({ editMode: 'sandbox', dataRoot: root, writeRoot: root, projectName: 'Test', port: 44322, python: 'python' }, ':memory:');
  try {
    const catalog = await service.get('sandbox');
    const document = await readCardContent(root, docId);
    const documentResult = await service.edit({ action: 'update-card-content', cardId: docId, sourceHash: document.sourceHash,
      title: 'Спокойное руководство', markdown: 'Тело.\n', manifestHash: catalog.manifestHash }, 'sandbox');
    expect(documentResult.savedWarning).toBeUndefined();
    expect((await readFile(path.join(root, 'docs/guide.md'))).toString('utf8')).toBe('# Спокойное руководство\nТело.\n');
    expect(await readFile(path.join(root, 'tasks/iteration-board.md'), 'utf8')).toBe('# Old board\n');
    const content = await readCardContent(root, heroId);
    const result = await service.edit({ action: 'update-card-content', cardId: heroId, sourceHash: content.sourceHash,
      title: 'Спокойное руководство', markdown: 'Тело.\n', manifestHash: catalog.manifestHash }, 'sandbox');
    expect(result.savedWarning).toBeUndefined();
    expect(result.warnings.join(' ')).not.toContain('board');
    expect((await readCardContent(root, heroId)).title).toBe('Спокойное руководство');
    expect(await readFile(path.join(root, 'tasks/iteration-board.md'), 'utf8')).toContain('## 1 — Спокойное руководство');
    expect(await readFile(path.join(root, 'tasks/iteration-table.md'), 'utf8')).toBe('# Rendered table\n');
  } finally { await service.close(); }
});

it('preserves mixed line endings on title-only edits and performs zero writes for documents without H1', async () => {
  const root = await fixture();
  const filename = path.join(root, 'features/match.md');
  const original = (await readFile(filename, 'utf8')).replace('Вторая строка вступления.\r\n', 'Вторая строка вступления.\n').replace('Тело среза с эмодзи 🎯.\r\n', 'Тело среза с эмодзи 🎯.\n');
  await writeFile(filename, original);
  const manifestHash = (await readProjectCatalog(root)).manifestHash;
  for (const cardId of [heroId, taskId, mechanicDocId]) {
    const content = await readCardContent(root, cardId);
    const before = await readFile(filename, 'utf8');
    await editProjectCatalog(root, { action: 'update-card-content', cardId, sourceHash: content.sourceHash, title: content.title + ' revised', markdown: content.markdown, manifestHash });
    expect(await readFile(filename, 'utf8')).toBe(before.replace(content.title, content.title + ' revised'));
  }
  await writeFile(path.join(root, 'docs/bare.md'), '---\r\nicon: box\r\n---\r\nBody\nOther\r\n');
  const bare = await readCardContent(root, 'doc:docs/bare.md');
  vi.mocked(filesystem.rename).mockClear();
  await editProjectCatalog(root, { action: 'update-card-content', ...bare, manifestHash });
  expect(filesystem.rename).not.toHaveBeenCalled();
});

it('preserves native body bytes on a title-only edit and updates body after a differently sized title', async () => {
  const root = await fixture();
  const uuid = '55555555-5555-4555-8555-555555555555';
  const cardId = 'card:' + uuid;
  const filename = path.join(root, 'cards', uuid + '.md');
  await mkdir(path.dirname(filename));
  const header = '---\r\ndeckmate: card\r\nschema: 1\r\nid: ' + uuid + '\r\nkind: doc\r\ntitle: |\r\n  Old\r\nstate: null\r\nowner: null\r\ndeckId: null\r\ntrackIds: []\r\nparentId: null\r\ncustom: keep # comment\r\n---\r\n';
  const body = 'Mixed\nBody\r\n';
  await writeFile(filename, header + body);
  const manifestHash = (await readProjectCatalog(root)).manifestHash;
  const content = await readCardContent(root, cardId);
  await editProjectCatalog(root, { action: 'update-card-content', cardId, sourceHash: content.sourceHash, title: 'Longer title with emoji 🎯', markdown: body, manifestHash });
  expect((await readFile(filename, 'utf8')).endsWith(body)).toBe(true);
  const updated = await readCardContent(root, cardId);
  await editProjectCatalog(root, { action: 'update-card-content', cardId, sourceHash: updated.sourceHash, title: 'X', markdown: 'Replaced body.', manifestHash });
  const final = await readFile(filename, 'utf8');
  expect(final).toContain('title: "X"\r\nstate: null\r\n');
  expect(final).toContain('custom: keep # comment\r\n---\r\nReplaced body.');
  expect((await readCardContent(root, cardId)).markdown).toBe('Replaced body.');
});

it('separates new body text from neighbouring headings and a heading at EOF', async () => {
  const root = await fixture();
  const manifestHash = (await readProjectCatalog(root)).manifestHash;
  for (const cardId of [heroId, taskId]) {
    const content = await readCardContent(root, cardId);
    await editProjectCatalog(root, { action: 'update-card-content', cardId, sourceHash: content.sourceHash, title: content.title, markdown: 'Without final newline', manifestHash });
    const after = await readFile(path.join(root, 'features/match.md'), 'utf8');
    expect(after).toContain('Without final newline\r\n### ');
  }
  await writeFile(path.join(root, 'features/eof.md'), '# EOF\n### 1.0 Last (в работе)');
  const content = await readCardContent(root, 'task:features/eof.md#1.0');
  await editProjectCatalog(root, { action: 'update-card-content', ...content, markdown: 'New body', manifestHash });
  expect(await readFile(path.join(root, 'features/eof.md'), 'utf8')).toBe('# EOF\n### 1.0 Last (в работе)\nNew body');
});

it('edits Setext and closed ATX document titles without duplicating or consuming heading syntax', async () => {
  const root = await fixture();
  const manifestHash = (await readProjectCatalog(root)).manifestHash;
  for (const [source, expected] of [['Old\r\n===\r\nBody\n', 'New\r\n===\r\nBody\n'], ['# Old ###\r\nBody\n', '# New ###\r\nBody\n']]) {
    await writeFile(path.join(root, 'docs/guide.md'), source);
    const content = await readCardContent(root, docId);
    expect(content.title).toBe('Old');
    expect(content.markdown).toBe('Body\n');
    await editProjectCatalog(root, { action: 'update-card-content', ...content, title: 'New', manifestHash });
    expect(await readFile(path.join(root, 'docs/guide.md'), 'utf8')).toBe(expected);
  }
});

it('rejects aliases of protected documents and linked legacy folders before reading or writing', async () => {
  const root = await fixture();
  const before = await readFile(path.join(root, 'tasks/deckmate.md'));
  const manifestHash = (await readProjectCatalog(root)).manifestHash;
  for (const cardId of ['doc:features/../tasks/freetion.md', 'doc:tasks/FREETION.md', 'doc:tasks\\freetion.md', 'doc:tasks/JOURNEYS/any/index.md']) {
    await expect(readCardContent(root, cardId)).rejects.toThrow();
    await expect(editProjectCatalog(root, { action: 'update-card-content', cardId, sourceHash: manifestHash, title: 'Blocked', markdown: '', manifestHash })).rejects.toThrow();
  }
  await symlink(path.join(root, 'tasks'), path.join(root, 'docs/linked'), 'junction');
  await expect(readCardContent(root, 'doc:docs/linked/deckmate.md')).rejects.toThrow('symbolic link');
  expect(await readFile(path.join(root, 'tasks/deckmate.md'))).toEqual(before);
});

it('refuses a changed parent directory during publication and never writes into its replacement', async () => {
  const root = await fixture();
  const before = await readProjectMarkdown(root, 'docs/guide.md');
  const hash = createHash('sha256').update(before).digest('hex');
  await expect(replaceProjectMarkdown(root, 'docs/guide.md', hash, Buffer.from('New'), async () => {
    await rename(path.join(root, 'docs'), path.join(root, 'original-docs'));
    await mkdir(path.join(root, 'docs'));
    await writeFile(path.join(root, 'docs/guide.md'), 'Replacement');
  })).rejects.toThrow();
  expect(await readFile(path.join(root, 'original-docs/guide.md'))).toEqual(before);
  expect(await readFile(path.join(root, 'docs/guide.md'), 'utf8')).toBe('Replacement');
});

it('keeps empty YAML and a closing frontmatter fence at EOF intact when adding a title', async () => {
  const root = await fixture();
  const manifestHash = (await readProjectCatalog(root)).manifestHash;
  for (const header of ['---\n---\n', '\uFEFF---\r\nicon: box\r\n---', '---\n---']) {
    await writeFile(path.join(root, 'docs/bare.md'), header);
    const content = await readCardContent(root, 'doc:docs/bare.md');
    expect(content.markdown).toBe('');
    await editProjectCatalog(root, { action: 'update-card-content', ...content, title: 'New title', manifestHash });
    const after = await readFile(path.join(root, 'docs/bare.md'), 'utf8');
    expect(after.startsWith(header)).toBe(true);
    expect(after).toContain('---' + (header.includes('\r\n') ? '\r\n' : '\n') + '# New title');
    expect((await readCardContent(root, 'doc:docs/bare.md')).markdown).toBe('');
  }
});
