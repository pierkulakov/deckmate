import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { editProjectCatalog, emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { createManagedMarkdown, editNativeCardContent, patchManagedMarkdown, readNativeCard, replaceProjectMarkdown } from '../server/native-cards.ts';
import { assignQuestion, recordDecision, resolvedDecisionsOf } from '../src/open-questions.ts';
import { markdownParser } from '../src/markdown-model.ts';
import { shortReference } from '../src/references.ts';
import { localIsoDate } from '../src/catalog-hand.ts';
import * as nativeFiles from '../server/native-cards.ts';
import { legacyDecisionLink } from './helpers/legacy-decision.ts';
import { tempProjects } from './helpers/temp-projects.ts';

const projects = tempProjects('deckmate-decision-write-');
afterEach(async () => {
  vi.restoreAllMocks();
  await projects.removeAll();
});

async function fixture(formatLanguage: 'en' | 'ru' = 'en') {
  const root = await projects.create();
  await mkdir(path.join(root, 'tasks'));
  const manifest = emptyManifest();
  manifest.formatLanguage = formatLanguage;
  manifest.spaces = [{ id: 'work', title: 'Work' }];
  manifest.decks = [{ id: 'work', spaceId: 'work', title: 'Work', kind: 'mixed', description: '', icon: 'box', color: '#123456' }];
  manifest.members = [{ id: 'maya', label: 'Майя', kind: 'human', aliases: [] }];
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  const id = randomUUID();
  const cardId = `card:${id}`;
  const relative = `cards/${id}.md`;
  const filename = path.join(root, relative);
  const markdown = '# Правило\r\n\r\n## Open questions\n\n- Which build?  \n  - Option A\n\n## Notes\r\nKeep 👣.  \r\nNo final newline';
  await createManagedMarkdown(root, relative, { deckmate: 'card', schema: 1, id, kind: 'doc', title: 'Правило',
    state: null, owner: null, parentId: null, deckId: 'work', trackIds: [] }, markdown);
  await writeFile(filename, Buffer.concat([Buffer.from('\uFEFF'), await readFile(filename)]));
  const catalog = await readProjectCatalog(root);
  const card = catalog.cards.find(card => card.id === cardId)!;
  return { root, card, catalog, filename, markdown };
}

async function linkedLegacyTask(root: string, cardId: string) {
  const id = randomUUID();
  const taskCardId = `card:${id}`;
  await createManagedMarkdown(root, `cards/${id}.md`, { deckmate: 'card', schema: 1, id, kind: 'task', title: 'Decision: Which build?',
    state: 'started', owner: null, parentId: cardId, deckId: 'work', trackIds: [] }, 'Keep manual work.\n');
  const file = (await readNativeCard(root, cardId))!;
  const markdown = file.markdown.replace('- Which build?', '- Which build?' + legacyDecisionLink(taskCardId));
  await replaceProjectMarkdown(root, file.card.path, file.fileHash, patchManagedMarkdown(file, {}, markdown));
  return taskCardId;
}

it.each(['raise-decision', 'record-decision'] as const)('preserves mixed body EOL, BOM and the final line during %s', async action => {
  const { root, card, catalog, filename, markdown } = await fixture();
  const before = await readFile(filename);
  const taskCardId = `card:${randomUUID()}`;
  const shared = { cardId: card.id, sourceHash: card.sourceHash, manifestHash: catalog.manifestHash,
    questionIndex: 0, questionText: 'Which build?', memberId: 'maya' };
  const expected = action === 'raise-decision' ? assignQuestion(markdown, 0, 'Which build?', 'maya', 'en')
    : recordDecision(markdown, 0, 'Which build?', 'Stable build', 'Майя', localIsoDate(), 'en', 'en');
  await editProjectCatalog(root, action === 'raise-decision' ? { ...shared, action, taskCardId, deckId: 'work' }
    : { ...shared, action, answer: 'Stable build' });
  const bodyStart = before.length - Buffer.byteLength(markdown);
  expect(await readFile(filename)).toEqual(Buffer.concat([before.subarray(0, bodyStart), Buffer.from(expected)]));
  expect((await readProjectCatalog(root)).cards).toHaveLength(catalog.cards.length);
});

it.each(['en', 'ru'] as const)('records the question and Task link, accepts the Task and retries without writes (%s)', async format => {
  const { root, card, catalog, filename } = await fixture(format);
  const taskCardId = await linkedLegacyTask(root, card.id);
  const shared = { cardId: card.id, manifestHash: catalog.manifestHash, questionIndex: 0, questionText: 'Which build?', memberId: 'maya' };
  const fresh = (await readProjectCatalog(root)).cards.find(item => item.id === card.id)!;
  const edit = { ...shared, action: 'record-decision' as const, sourceHash: fresh.sourceHash, answer: 'Stable → release — [notes](https://example.com/(build))' };
  const before = await readFile(filename);
  await expect(editProjectCatalog(root, { ...edit, sourceHash: '0'.repeat(64) })).rejects.toThrow();
  expect(await readFile(filename)).toEqual(before);
  await editProjectCatalog(root, edit);
  const saved = await readFile(filename);
  expect(resolvedDecisionsOf(markdownParser.parse((await readNativeCard(root, card.id))!.markdown))[0]).toMatchObject({
    question: 'Which build?', taskRef: shortReference('c', taskCardId), answer: 'Stable → release — notes', author: 'Майя', date: localIsoDate(),
  });
  expect((await readProjectCatalog(root)).cards.find(item => item.id === taskCardId)?.state).toBe('done');
  expect(await editProjectCatalog(root, edit)).toEqual([]);
  expect(await readFile(filename)).toEqual(saved);
  await expect(editProjectCatalog(root, { ...edit, questionText: 'Another question?' })).rejects.toThrow();
  expect(await readFile(filename)).toEqual(saved);
});

it('refuses a missing legacy Task before recording an answer and resumes a previously saved answer', async () => {
  const { root, card, catalog, filename } = await fixture();
  const taskId = await linkedLegacyTask(root, card.id);
  const taskFile = path.join(root, `cards/${taskId.slice(5)}.md`);
  const taskBytes = await readFile(taskFile);
  const linked = (await readNativeCard(root, card.id))!;
  await rm(taskFile);
  const edit = { action: 'record-decision' as const, cardId: card.id, sourceHash: linked.fileHash,
    manifestHash: catalog.manifestHash, questionIndex: 0, questionText: 'Which build?', answer: 'Stable', memberId: 'maya' };
  const before = await readFile(filename);
  await expect(editProjectCatalog(root, edit)).rejects.toThrow();
  expect(await readFile(filename)).toEqual(before);
  // 2026-11-12: a saved legacy answer can outlive its Task; a retry may finish only after that Task is restored.
  const markdown = recordDecision(linked.markdown, 0, 'Which build?', 'Stable', 'Майя', localIsoDate(), 'en', 'en');
  await replaceProjectMarkdown(root, linked.card.path, linked.fileHash, patchManagedMarkdown(linked, {}, markdown));
  const saved = await readFile(filename);
  await expect(editProjectCatalog(root, edit)).rejects.toThrow();
  expect(await readFile(filename)).toEqual(saved);
  await writeFile(taskFile, taskBytes);
  await editProjectCatalog(root, edit);
  expect(await readFile(filename)).toEqual(saved);
  expect(resolvedDecisionsOf(markdownParser.parse((await readNativeCard(root, card.id))!.markdown))).toHaveLength(1);
  expect((await readProjectCatalog(root)).cards.find(card => card.id === taskId)?.state).toBe('done');
});

it.each(['no-parent', 'other-parent', 'doc', 'hero'] as const)('rejects a legacy link to an unrelated %s card before either file changes', async variant => {
  const { root, card, catalog, filename } = await fixture();
  const taskId = await linkedLegacyTask(root, card.id);
  const task = (await readNativeCard(root, taskId))!;
  const metadata = { ...task.metadata };
  if (variant === 'no-parent') metadata.parentId = null;
  else if (variant === 'other-parent') metadata.parentId = `card:${randomUUID()}`;
  else { metadata.kind = variant; metadata.state = null; }
  await replaceProjectMarkdown(root, task.card.path, task.fileHash, patchManagedMarkdown(task, metadata, task.markdown));
  const linked = (await readNativeCard(root, card.id))!;
  const before = await readFile(filename);
  const taskBefore = await readFile(path.join(root, task.card.path));
  const manifestBefore = await readFile(path.join(root, 'tasks/deckmate.md'));
  const edit = { action: 'record-decision' as const, cardId: card.id, sourceHash: linked.fileHash,
    manifestHash: catalog.manifestHash, questionIndex: 0, questionText: 'Which build?', answer: 'Stable', memberId: 'maya' };
  await expect(editProjectCatalog(root, edit)).rejects.toThrow();
  expect(await readFile(filename)).toEqual(before);
  expect(await readFile(path.join(root, task.card.path))).toEqual(taskBefore);
  expect(await readFile(path.join(root, 'tasks/deckmate.md'))).toEqual(manifestBefore);
  const recorded = recordDecision(linked.markdown, 0, 'Which build?', 'Stable', 'Майя', localIsoDate(), 'en', 'en');
  await replaceProjectMarkdown(root, linked.card.path, linked.fileHash, patchManagedMarkdown(linked, {}, recorded));
  const saved = await readFile(filename);
  await expect(editProjectCatalog(root, edit)).rejects.toThrow();
  expect(await readFile(filename)).toEqual(saved);
  expect(await readFile(path.join(root, task.card.path))).toEqual(taskBefore);
});

it('accepts a linked child Task whose title and body were edited by a person', async () => {
  const { root, card, catalog } = await fixture();
  const taskId = await linkedLegacyTask(root, card.id);
  const task = (await readNativeCard(root, taskId))!;
  await editNativeCardContent(root, taskId, task.fileHash, { title: 'Manual title', markdown: 'Manual body.\n' });
  const linked = (await readNativeCard(root, card.id))!;
  await editProjectCatalog(root, { action: 'record-decision', cardId: card.id, sourceHash: linked.fileHash,
    manifestHash: catalog.manifestHash, questionIndex: 0, questionText: 'Which build?', answer: 'Stable', memberId: 'maya' });
  expect((await readNativeCard(root, taskId))?.card).toMatchObject({ state: 'done', title: 'Manual title' });
  expect((await readNativeCard(root, taskId))?.markdown).toBe('Manual body.\n');
});

it('rechecks Task membership after the answer is published and never accepts a reparented Task', async () => {
  const { root, card, catalog } = await fixture();
  const taskId = await linkedLegacyTask(root, card.id);
  const linked = (await readNativeCard(root, card.id))!;
  const publish = nativeFiles.replaceProjectMarkdown;
  vi.spyOn(nativeFiles, 'replaceProjectMarkdown').mockImplementationOnce(async (...args) => {
    await publish(...args);
    const task = (await readNativeCard(root, taskId))!;
    await publish(root, task.card.path, task.fileHash, patchManagedMarkdown(task, { parentId: null }, task.markdown));
  });
  await expect(editProjectCatalog(root, { action: 'record-decision', cardId: card.id, sourceHash: linked.fileHash,
    manifestHash: catalog.manifestHash, questionIndex: 0, questionText: 'Which build?', answer: 'Stable', memberId: 'maya' }))
    .rejects.toMatchObject({ saved: true });
  expect((await readNativeCard(root, taskId))?.card).toMatchObject({ state: 'started', parentId: null });
  expect(resolvedDecisionsOf(markdownParser.parse((await readNativeCard(root, card.id))!.markdown))).toHaveLength(1);
});

it.each(['Decided', 'Решено'])('recognizes legacy retries only inside %s', async title => {
  const { root, card, catalog, filename } = await fixture();
  const edit = { action: 'record-decision' as const, cardId: card.id, manifestHash: catalog.manifestHash,
    sourceHash: card.sourceHash, questionIndex: 0, questionText: 'Which build?', memberId: 'maya', answer: 'Stable → release' };
  const file = (await readNativeCard(root, card.id))!;
  await editNativeCardContent(root, card.id, file.fileHash, { title: file.metadata.title,
    markdown: `## ${title}\n\n- Stable → release — Майя, 2026-11-01\n\n## Open questions\n` });
  const saved = await readFile(filename);
  expect(await editProjectCatalog(root, edit)).toEqual([]);
  expect(await readFile(filename)).toEqual(saved);
  const updated = (await readNativeCard(root, card.id))!;
  await editNativeCardContent(root, card.id, updated.fileHash, { title: updated.metadata.title, markdown: updated.markdown.replace(`## ${title}`, '## Notes') });
  const outside = await readFile(filename);
  await expect(editProjectCatalog(root, edit)).rejects.toThrow();
  expect(await readFile(filename)).toEqual(outside);
});

it.each(['# Heading', '- Option', '[ ] Ready', '> Quoted', '---', '**Bold**', '\\[literal\\]'])('retries an inline answer beginning with Markdown syntax: %s', async answer => {
  const { root, card, catalog, filename } = await fixture();
  const edit = { action: 'record-decision' as const, cardId: card.id, manifestHash: catalog.manifestHash,
    sourceHash: card.sourceHash, questionIndex: 0, questionText: 'Which build?', memberId: 'maya', answer };
  await editProjectCatalog(root, edit);
  const saved = await readFile(filename);
  expect(await editProjectCatalog(root, edit)).toEqual([]);
  expect(await readFile(filename)).toEqual(saved);
});

it.each(['Unrelated work', 'Decision: Which build?', 'Решение: Which build?'])('does not adopt a sibling Task titled %s during compatibility assignment', async title => {
  const { root, card, filename } = await fixture();
  const taskId = randomUUID();
  const taskPath = `cards/${taskId}.md`;
  await createManagedMarkdown(root, taskPath, { deckmate: 'card', schema: 1, id: taskId, kind: 'task', title,
    state: 'started', owner: null, parentId: card.id, deckId: 'work', trackIds: [] }, 'Do not repurpose this card.\n');
  const before = await readFile(filename);
  const taskBefore = await readFile(path.join(root, taskPath));
  const catalog = await readProjectCatalog(root);
  await editProjectCatalog(root, { action: 'raise-decision', cardId: card.id, sourceHash: card.sourceHash,
    manifestHash: catalog.manifestHash, questionIndex: 0, questionText: 'Which build?', memberId: 'maya',
    taskCardId: `card:${taskId}`, deckId: 'work' });
  expect(await readFile(filename, 'utf8')).toBe(before.toString('utf8').replace('Which build?', 'Which build? @maya'));
  expect(await readFile(path.join(root, taskPath))).toEqual(taskBefore);
  expect((await readProjectCatalog(root)).optionsHash).toBe('');
});

it.each(['Decision:', 'Решение:'])('keeps a linked legacy %s Task unchanged during compatibility assignment', async marker => {
  const { root, card, filename } = await fixture(marker === 'Decision:' ? 'en' : 'ru');
  const taskCardId = await linkedLegacyTask(root, card.id);
  const taskId = taskCardId.slice(5);
  const catalog = await readProjectCatalog(root);
  const edit = { action: 'raise-decision' as const, cardId: card.id, sourceHash: catalog.cards.find(item => item.id === card.id)!.sourceHash,
    manifestHash: catalog.manifestHash, questionIndex: 0, questionText: 'Which build?', memberId: 'maya', taskCardId, deckId: 'work' };
  const unchanged = await readFile(filename);
  await expect(editProjectCatalog(root, { ...edit, sourceHash: '0'.repeat(64) })).rejects.toThrow('CARD_CONFLICT');
  expect(await readFile(filename)).toEqual(unchanged);
  await editProjectCatalog(root, edit);
  const task = (await readNativeCard(root, taskCardId))!;
  await editNativeCardContent(root, taskCardId, task.fileHash, { title: 'Human-edited title', markdown: 'Keep manual edits.\n' });
  const before = await readFile(filename);
  const renamed = await readFile(path.join(root, task.card.path));
  expect(await editProjectCatalog(root, edit)).toEqual([]);
  expect(await readFile(filename)).toEqual(before);
  expect(await readFile(path.join(root, task.card.path))).toEqual(renamed);
});
