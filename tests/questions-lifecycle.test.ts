import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { CardKind, CatalogEdit, CatalogView } from '../src/catalog-contracts.ts';
import { pendingDecisions, waitingOn } from '../src/catalog-contracts.ts';
import { localIsoDate } from '../src/catalog-hand.ts';
import { shortReference } from '../src/references.ts';
import { createApp } from '../server/app.ts';
import { readCardContent } from '../server/card-content.ts';
import { editProjectCatalog, emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { decisionTargetRange } from '../server/decision-target.ts';
import * as nativeFiles from '../server/native-cards.ts';
import { tempProjects } from './helpers/temp-projects.ts';

const projects = tempProjects('deckmate-questions-lifecycle-');
const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const app of apps.splice(0)) await app.close();
  await projects.removeAll();
});

async function fixture(kind: CardKind = 'task', native = true, eol = '\r\n', format: 'en' | 'ru' = 'en') {
  const root = await projects.create();
  for (const directory of ['tasks', 'docs', 'features']) await mkdir(path.join(root, directory));
  const manifest = emptyManifest();
  manifest.formatLanguage = format;
  manifest.members = [
    { id: 'pier', label: 'Pier', kind: 'human', aliases: [] },
    { id: 'builder', label: 'Builder', kind: 'agent', aliases: [] },
  ];
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  const body = `Intro 👣.  ${eol}${eol}`;
  let cardId: string;
  let relative: string;
  if (native) {
    const id = randomUUID();
    cardId = `card:${id}`;
    relative = `cards/${id}.md`;
    await nativeFiles.createManagedMarkdown(root, relative, { deckmate: 'card', schema: 1, id, kind, title: 'Subject',
      state: kind === 'task' ? 'started' : null, owner: null, parentId: null, deckId: null, trackIds: [] }, body);
    await writeFile(path.join(root, relative), Buffer.concat([Buffer.from('\uFEFF'), await readFile(path.join(root, relative))]));
  } else {
    relative = kind === 'doc' ? 'docs/subject.md' : 'features/subject.md';
    cardId = kind === 'doc' ? `doc:${relative}` : `${kind}:${relative}#${kind === 'hero' ? '1' : '1.0'}`;
    const headings = kind === 'doc' ? '# Subject' : '# Subject' + eol + '## 1 — Hero' + (kind === 'task' ? eol + '### 1.0 Subject (started)' : '');
    const suffix = kind === 'hero' ? `### 1.0 Child (not-started)${eol}Keep child.  ${eol}` : '';
    await writeFile(path.join(root, relative), '\uFEFF' + headings + eol + body + suffix);
  }
  await writeFile(path.join(root, 'docs/target.md'), '\uFEFF# Rules\r\n\r\n## Камера\r\nKeep.\r\n### Detail\r\nValue.\r\n## Next\r\nUnchanged');
  const current = async () => {
    const catalog = await readProjectCatalog(root);
    return { catalog, card: catalog.cards.find(card => card.id === cardId)! };
  };
  const target = shortReference('c', 'doc:docs/target.md') + '#камера';
  return { root, cardId, relative, filename: path.join(root, relative), body, current, target };
}

for (const native of [true, false]) for (const kind of ['task', 'hero', 'doc'] as const) for (const eol of ['\n', '\r\n', '\r']) {
  it(`keeps local bytes and completes questions on ${native ? 'native' : 'legacy'} ${kind}, ${JSON.stringify(eol)}`, async () => {
    const format = eol === '\r' ? 'ru' : 'en';
    const f = await fixture(kind, native, eol, format);
    const { card, catalog } = await f.current();
    const before = await readFile(f.filename);
    const targetBefore = await readFile(path.join(f.root, 'docs/target.md'));
    const ask = { action: 'ask-question' as const, cardId: card.id, sourceHash: card.sourceHash,
      manifestHash: catalog.manifestHash, text: 'Which **FPS**?', assignee: 'pier', target: f.target };
    await expect(editProjectCatalog(f.root, { ...ask, sourceHash: '0'.repeat(64) })).rejects.toThrow('CARD_CONFLICT');
    expect(await readFile(f.filename)).toEqual(before);
    await editProjectCatalog(f.root, ask);
    const asked = await readFile(f.filename);
    const depth = !native && kind !== 'doc' ? '####' : '##';
    const title = format === 'ru' ? 'Открыто' : 'Open questions';
    const addition = `${depth} ${title}${eol}${eol}- Which **FPS**? @pier → [${f.target}](/r/${f.target})${eol}${eol}`;
    expect(asked.toString('utf8')).toBe(before.toString('utf8').replace(f.body, f.body + addition));
    expect(await editProjectCatalog(f.root, ask)).toEqual([]);
    let fresh = await f.current();
    expect(fresh.card.openQuestions).toEqual([{ text: 'Which FPS?', taskRef: null, assignee: 'pier', target: f.target }]);
    expect(waitingOn(fresh.card)).toEqual(kind === 'task' ? ['pier'] : null);
    const assign = { action: 'assign-question' as const, cardId: card.id, sourceHash: fresh.card.sourceHash,
      manifestHash: catalog.manifestHash, questionIndex: 0, questionText: 'Which FPS?', assignee: 'builder' };
    await expect(editProjectCatalog(f.root, { ...assign, sourceHash: card.sourceHash })).rejects.toThrow('CARD_CONFLICT');
    await editProjectCatalog(f.root, assign);
    expect(await readFile(f.filename, 'utf8')).toBe(asked.toString('utf8').replace('@pier', '@builder'));
    expect(await editProjectCatalog(f.root, assign)).toEqual([]);
    fresh = await f.current();
    const record = { action: 'record-decision' as const, cardId: card.id, sourceHash: fresh.card.sourceHash,
      manifestHash: catalog.manifestHash, questionIndex: 0, questionText: 'Which FPS?', answer: '60 **FPS**', memberId: 'pier' };
    await editProjectCatalog(f.root, record);
    const saved = await readFile(f.filename);
    expect(await editProjectCatalog(f.root, record)).toEqual([]);
    fresh = await f.current();
    expect(fresh.card.decisions).toEqual([{ index: 0, question: 'Which FPS?', answer: '60 FPS', by: 'Pier', assignee: 'builder', date: localIsoDate(), target: f.target, applied: null }]);
    expect(waitingOn(fresh.card)).toBeNull();
    expect(pendingDecisions(fresh.catalog).map(entry => entry.card.id)).toEqual([card.id]);
    expect(pendingDecisions({ cards: [{ ...fresh.card, archived: true, deleted: true }] })).toHaveLength(1);
    const apply = { action: 'apply-decision' as const, cardId: card.id, sourceHash: fresh.card.sourceHash,
      manifestHash: catalog.manifestHash, decisionIndex: 0, answer: '60 FPS' };
    await expect(editProjectCatalog(f.root, { ...apply, sourceHash: card.sourceHash })).rejects.toThrow('CARD_CONFLICT');
    await expect(editProjectCatalog(f.root, { ...apply, answer: '120 FPS' })).rejects.toThrow();
    expect(await readFile(f.filename)).toEqual(saved);
    await editProjectCatalog(f.root, apply);
    const applied = await readFile(f.filename);
    expect(applied.toString('utf8')).toBe(saved.toString('utf8').replace('<!-- deckmate:pending -->', `<!-- deckmate:applied ${localIsoDate()} -->`));
    expect(await editProjectCatalog(f.root, apply)).toEqual([]);
    expect(await readFile(f.filename)).toEqual(applied);
    fresh = await f.current();
    expect(fresh.card.decisions?.[0].applied).toBe(localIsoDate());
    expect(pendingDecisions(fresh.catalog)).toEqual([]);
    expect(await readFile(path.join(f.root, 'docs/target.md'))).toEqual(targetBefore);
    expect(fresh.catalog.cards).toHaveLength(catalog.cards.length);
    expect(fresh.card.state).toBe(card.state);
  });
}

it('resolves exact target line ranges, duplicate anchors and whole legacy cards without reading neighbors', async () => {
  const f = await fixture('task', false);
  await writeFile(path.join(f.root, 'docs/duplicate.md'), '# Rules\n## Same\nA\n## Same\nB\n');
  const { catalog } = await f.current();
  expect(await decisionTargetRange(f.root, catalog, f.target)).toBe('docs/target.md:3-6');
  expect(await decisionTargetRange(f.root, catalog, f.target.replace('#камера', '#' + encodeURIComponent('камера')))).toBe('docs/target.md:3-6');
  expect(await decisionTargetRange(f.root, catalog, shortReference('c', 'doc:docs/duplicate.md') + '#same-1')).toBe('docs/duplicate.md:4-5');
  expect(await decisionTargetRange(f.root, catalog, shortReference('c', f.cardId))).toBe('features/subject.md:3-5');
  await expect(decisionTargetRange(f.root, catalog, f.target + '-missing')).rejects.toThrow();
  await expect(decisionTargetRange(f.root, catalog, 'c-0000000000')).rejects.toThrow();
  await expect(decisionTargetRange(f.root, catalog, '../../outside.md')).rejects.toThrow();
  await writeFile(path.join(f.root, 'docs/target.md'), 'External edit');
  await expect(decisionTargetRange(f.root, catalog, f.target)).rejects.toThrow('CARD_CONFLICT');
});

it.each([true, false])('bounds a whole Hero target and its section to that card, native=%s', async native => {
  const f = await fixture('hero', native, '\n');
  await writeFile(f.filename, (await readFile(f.filename, 'utf8')).replace(f.body, f.body + '#### Camera\nValue\n#### Next\nOther\n'));
  const { catalog } = await f.current();
  const ref = shortReference('c', f.cardId);
  const bytes = await readFile(f.filename, 'utf8');
  const start = bytes.slice(0, bytes.indexOf('#### Camera')).split('\n').length;
  expect(await decisionTargetRange(f.root, catalog, ref + '#camera')).toBe(`${f.relative}:${start}-${start + 1}`);
  if (native) expect(await decisionTargetRange(f.root, catalog, ref)).toBe(`${f.relative}:1-${bytes.split('\n').length - 1}`);
  else expect(await decisionTargetRange(f.root, catalog, ref)).toBe(`${f.relative}:2-${start + 3}`);
});

it('does not answer the next identical question on a stale retry when targets differ', async () => {
  const f = await fixture();
  let fresh = await f.current();
  for (const target of [f.target, null]) {
    await editProjectCatalog(f.root, { action: 'ask-question', cardId: f.cardId, sourceHash: fresh.card.sourceHash,
      manifestHash: fresh.catalog.manifestHash, text: 'Which?', assignee: 'pier', target });
    fresh = await f.current();
  }
  const record = { action: 'record-decision' as const, cardId: f.cardId, sourceHash: fresh.card.sourceHash,
    manifestHash: fresh.catalog.manifestHash, questionIndex: 0, questionText: 'Which?', answer: 'Answer', memberId: 'pier' };
  await editProjectCatalog(f.root, record);
  const saved = await readFile(f.filename);
  expect(await editProjectCatalog(f.root, record)).toEqual([]);
  expect(await readFile(f.filename)).toEqual(saved);
  fresh = await f.current();
  expect(fresh.card.openQuestions).toHaveLength(1);
  expect(fresh.card.decisions).toHaveLength(1);
  expect(fresh.card.decisions?.[0].target).toBe(f.target);
  await editProjectCatalog(f.root, { ...record, sourceHash: fresh.card.sourceHash });
  fresh = await f.current();
  expect(fresh.card.openQuestions).toHaveLength(0);
  expect(fresh.card.decisions?.map(decision => decision.target)).toEqual([f.target, null]);
});

it('validates metadata and preserves source bytes after invalid input or a publication failure', async () => {
  const f = await fixture();
  const { card, catalog } = await f.current();
  const edit = { action: 'ask-question' as const, cardId: card.id, sourceHash: card.sourceHash, manifestHash: catalog.manifestHash, text: 'Which?', assignee: null };
  const before = await readFile(f.filename);
  for (const invalid of [{ assignee: 'missing' }, { target: 'https://example.com' }, { target: f.target + '-missing' }, { text: 'One\nTwo' }, { text: '' }, { manifestHash: '0'.repeat(64) }]) {
    await expect(editProjectCatalog(f.root, { ...edit, ...invalid })).rejects.toThrow();
    expect(await readFile(f.filename)).toEqual(before);
  }
  vi.spyOn(nativeFiles, 'replaceProjectMarkdown').mockRejectedValueOnce(new Error('EACCES'));
  await expect(editProjectCatalog(f.root, edit)).rejects.toThrow('EACCES');
  expect(await readFile(f.filename)).toEqual(before);
  await editProjectCatalog(f.root, edit);
  const fresh = await f.current();
  expect(fresh.card.openQuestions?.[0]).toMatchObject({ assignee: null, target: null });
  expect(waitingOn(fresh.card)).toEqual([]);
  expect(await readCardContent(f.root, card.id)).toMatchObject({ sourceHash: fresh.card.sourceHash });
});

it('keeps file-level and imported child questions independent in one mechanics document', async () => {
  const f = await fixture('task', false, '\n');
  const markdown = '# Subject\n\n## Open questions\n- File question?\n\n## 1 — Hero\n\n#### Open questions\n- Hero question? @pier\n\n'
    + '### 1.0 Task (started)\n\n#### Open questions\n- Task question? @builder\n\n#### Decided\n- Old answer — Pier, 2026-11-01\n';
  await writeFile(f.filename, markdown);
  const { catalog } = await f.current();
  const ids = ['doc:features/subject.md', 'hero:features/subject.md#1', f.cardId];
  const cards = ids.map(id => catalog.cards.find(card => card.id === id)!);
  expect(cards.map(card => card.openQuestions?.map(question => question.text))).toEqual([['File question?'], ['Hero question?'], ['Task question?']]);
  expect(cards.map(card => card.decisions?.length ?? 0)).toEqual([0, 0, 1]);
  await editProjectCatalog(f.root, { action: 'record-decision', cardId: ids[0], sourceHash: cards[0].sourceHash,
    manifestHash: catalog.manifestHash, questionIndex: 0, questionText: 'File question?', answer: 'File answer', memberId: 'pier' });
  const saved = await readFile(f.filename, 'utf8');
  expect(saved.slice(saved.indexOf('## 1 — Hero'))).toBe(markdown.slice(markdown.indexOf('## 1 — Hero')));
  const fresh = await f.current();
  expect(fresh.catalog.cards.find(card => card.id === ids[0])?.decisions?.[0].answer).toBe('File answer');
  expect(pendingDecisions(fresh.catalog).map(entry => entry.card.id)).toEqual([ids[0]]);
});

for (const action of ['ask-question', 'assign-question', 'record-decision', 'apply-decision'] as const) {
  it.each([true, false])(`rejects a last-moment external write during ${action}, native=%s`, async native => {
    const f = await fixture('task', native, '\n');
    let fresh = await f.current();
    if (action !== 'ask-question') {
      await editProjectCatalog(f.root, { action: 'ask-question', cardId: f.cardId, sourceHash: fresh.card.sourceHash,
        manifestHash: fresh.catalog.manifestHash, text: 'Which?', assignee: null });
      fresh = await f.current();
    }
    if (action === 'apply-decision') {
      await editProjectCatalog(f.root, { action: 'record-decision', cardId: f.cardId, sourceHash: fresh.card.sourceHash,
        manifestHash: fresh.catalog.manifestHash, questionIndex: 0, questionText: 'Which?', answer: 'Answer', memberId: 'pier' });
      fresh = await f.current();
    }
    const shared = { cardId: f.cardId, sourceHash: fresh.card.sourceHash, manifestHash: fresh.catalog.manifestHash };
    const edits: Record<typeof action, CatalogEdit> = {
      'ask-question': { ...shared, action: 'ask-question', text: 'New question?', assignee: null },
      'assign-question': { ...shared, action: 'assign-question', questionIndex: 0, questionText: 'Which?', assignee: 'pier' },
      'record-decision': { ...shared, action: 'record-decision', questionIndex: 0, questionText: 'Which?', answer: 'Answer', memberId: 'pier' },
      'apply-decision': { ...shared, action: 'apply-decision', decisionIndex: 0, answer: 'Answer' },
    };
    const external = (await readFile(f.filename, 'utf8')) + '\nExternal bytes.  ';
    const publish = nativeFiles.replaceProjectMarkdown;
    vi.spyOn(nativeFiles, 'replaceProjectMarkdown').mockImplementationOnce(async (...args) => {
      await writeFile(f.filename, external);
      return publish(...args);
    });
    await expect(editProjectCatalog(f.root, edits[action])).rejects.toThrow('CONFLICT');
    expect(await readFile(f.filename, 'utf8')).toBe(external);
  });
}

it('refuses to append a question inside an unfinished code fence', async () => {
  const f = await fixture('doc', false, '\n');
  await writeFile(f.filename, '# Subject\n\n```\nUnfinished');
  const { card, catalog } = await f.current();
  const before = await readFile(f.filename);
  await expect(editProjectCatalog(f.root, { action: 'ask-question', cardId: f.cardId, sourceHash: card.sourceHash,
    manifestHash: catalog.manifestHash, text: 'Which?', assignee: null })).rejects.toThrow();
  expect(await readFile(f.filename)).toEqual(before);
});

it('does not insert a title or rewrite YAML in a headingless legacy Doc during question writes', async () => {
  const f = await fixture('doc', false, '\r\n');
  const prefix = '\uFEFF---\r\ntopic: keep # comment\r\n---\r\n\r\nKeep body 👣.  \r\n\r\n';
  await writeFile(f.filename, prefix);
  const shared = async () => {
    const fresh = await f.current();
    return { cardId: f.cardId, sourceHash: fresh.card.sourceHash, manifestHash: fresh.catalog.manifestHash };
  };
  await editProjectCatalog(f.root, { ...await shared(), action: 'ask-question', text: 'Which?', assignee: null });
  expect((await readFile(f.filename, 'utf8')).startsWith(prefix)).toBe(true);
  await editProjectCatalog(f.root, { ...await shared(), action: 'assign-question', questionIndex: 0, questionText: 'Which?', assignee: 'pier' });
  await editProjectCatalog(f.root, { ...await shared(), action: 'record-decision', questionIndex: 0, questionText: 'Which?', answer: 'Answer', memberId: 'pier' });
  await editProjectCatalog(f.root, { ...await shared(), action: 'apply-decision', decisionIndex: 0, answer: 'Answer' });
  const saved = await readFile(f.filename, 'utf8');
  expect(saved.startsWith(prefix)).toBe(true);
  expect(saved).not.toContain('# subject');
});

it.each(['en', 'ru'] as const)('journals the whole HTTP lifecycle once without a Deck, in %s', async format => {
  const f = await fixture('task', true, '\n', format);
  const app = await createApp({ editMode: 'direct', dataRoot: f.root, writeRoot: f.root, projectName: 'Questions', port: 44327, python: 'python' });
  apps.push(app);
  const host = { host: '127.0.0.1:44327' };
  const { token } = (await app.inject({ url: '/api/snapshot?source=sandbox', headers: host })).json();
  const headers = { ...host, 'x-deckmate-token': token, 'x-deckmate-actor': 'builder' };
  let catalog = (await f.current()).catalog;
  const send = async (edit: CatalogEdit, status = 200) => {
    const response = await app.inject({ method: 'POST', url: '/api/catalog', headers, payload: { ...edit, source: 'sandbox' } });
    expect(response.statusCode, response.body).toBe(status);
    if (status === 200) catalog = response.json<CatalogView>();
    return response;
  };
  const shared = () => ({ cardId: f.cardId, manifestHash: catalog.manifestHash, sourceHash: catalog.cards.find(card => card.id === f.cardId)!.sourceHash });
  const ask = { ...shared(), action: 'ask-question' as const, text: 'Which?', assignee: 'pier', target: f.target };
  await send(ask);
  await send(ask);
  const assign = { ...shared(), action: 'assign-question' as const, questionIndex: 0, questionText: 'Which?', assignee: null };
  await send(assign);
  await send(assign);
  const before = await readFile(f.filename);
  await send({ ...shared(), sourceHash: '0'.repeat(64), action: 'assign-question', questionIndex: 0, questionText: 'Which?', assignee: 'pier' }, 409);
  expect(await readFile(f.filename)).toEqual(before);
  await send({ ...shared(), action: 'record-decision', questionIndex: 0, questionText: 'Which?', answer: 'Stable', memberId: 'builder' }, 422);
  const record = { ...shared(), action: 'record-decision' as const, questionIndex: 0, questionText: 'Which?', answer: 'Stable', memberId: 'pier' };
  await send(record);
  await send(record);
  const apply = { ...shared(), action: 'apply-decision' as const, decisionIndex: 0, answer: 'Stable', note: 'Rule updated.' };
  await send(apply);
  expect(await readFile(f.filename, 'utf8')).toContain('Rule updated.');
  await send(apply);
  const history = (await app.inject({ url: `/api/card-activity?source=sandbox&cardId=${encodeURIComponent(f.cardId)}`, headers: host })).json();
  expect(history.events.map((event: { action: string }) => event.action).sort()).toEqual(['ask-question', 'assign-question', 'record-decision', 'apply-decision'].sort());
  expect(history.events.find((event: { action: string }) => event.action === 'record-decision')).toMatchObject({ actorMemberId: 'builder' });
  expect(catalog.cards.find(card => card.id === f.cardId)?.decisions?.[0]).toMatchObject({ by: 'Pier', recordedBy: 'Builder' });
  expect(history.events.find((event: { action: string }) => event.action === 'apply-decision').summary).toBe(format === 'ru' ? 'Решение внесено' : 'Decision applied');
  const malformed = await app.inject({ method: 'POST', url: '/api/catalog', headers, payload: { ...shared(), action: 'ask-question', text: 'Missing assignee', source: 'sandbox' } });
  expect(malformed.statusCode).toBe(400);
});
