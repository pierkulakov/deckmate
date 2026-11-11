import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { editProjectCatalog, emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { createManagedMarkdown, editNativeCardContent, readNativeCard } from '../server/native-cards.ts';
import { linkDecisionTask, recordDecision } from '../src/open-questions.ts';
import { localIsoDate } from '../src/catalog-hand.ts';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(formatLanguage: 'en' | 'ru' = 'en') {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-decision-write-'));
  roots.push(root);
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

it.each(['raise-decision', 'record-decision'] as const)('preserves mixed body EOL, BOM and the final line during %s', async action => {
  const { root, card, catalog, filename, markdown } = await fixture();
  const before = await readFile(filename);
  const taskCardId = `card:${randomUUID()}`;
  const shared = { cardId: card.id, sourceHash: card.sourceHash, manifestHash: catalog.manifestHash,
    questionIndex: 0, questionText: 'Which build?', memberId: 'maya' };
  const expected = action === 'raise-decision' ? linkDecisionTask(markdown, 0, 'Which build?', taskCardId, 'en', 'en')
    : recordDecision(markdown, 0, 'Which build?', 'Stable build', 'Майя', localIsoDate(), 'en', 'en');
  await editProjectCatalog(root, action === 'raise-decision' ? { ...shared, action, taskCardId, deckId: 'work' }
    : { ...shared, action, answer: 'Stable build' });
  const bodyStart = before.length - Buffer.byteLength(markdown);
  expect(await readFile(filename)).toEqual(Buffer.concat([before.subarray(0, bodyStart), Buffer.from(expected)]));
});

it.each(['Unrelated work', 'Decision: Which build?', 'Решение: Which build?'])('does not adopt an unrelated sibling Task titled %s as the retry key for a decision', async title => {
  const { root, card, filename } = await fixture();
  const taskId = randomUUID();
  const taskPath = `cards/${taskId}.md`;
  await createManagedMarkdown(root, taskPath, { deckmate: 'card', schema: 1, id: taskId, kind: 'task', title,
    state: 'started', owner: null, parentId: card.id, deckId: 'work', trackIds: [] }, 'Do not repurpose this card.\n');
  const before = await readFile(filename);
  const taskBefore = await readFile(path.join(root, taskPath));
  const catalog = await readProjectCatalog(root);
  await expect(editProjectCatalog(root, { action: 'raise-decision', cardId: card.id, sourceHash: card.sourceHash,
    manifestHash: catalog.manifestHash, questionIndex: 0, questionText: 'Which build?', memberId: 'maya',
    taskCardId: `card:${taskId}`, deckId: 'work' })).rejects.toThrow('taskCardId');
  expect(await readFile(filename)).toEqual(before);
  expect(await readFile(path.join(root, taskPath))).toEqual(taskBefore);
  expect((await readProjectCatalog(root)).optionsHash).toBe('');
});

it.each(['Decision:', 'Решение:'])('resumes a matching %s Task and permits an already linked task to be renamed', async marker => {
  const { root, card, filename } = await fixture(marker === 'Decision:' ? 'en' : 'ru');
  const taskId = randomUUID();
  const taskCardId = `card:${taskId}`;
  const catalog = await readProjectCatalog(root);
  const edit = { action: 'raise-decision' as const, cardId: card.id, sourceHash: card.sourceHash,
    manifestHash: catalog.manifestHash, questionIndex: 0, questionText: 'Which build?', memberId: 'maya', taskCardId, deckId: 'work' };
  await expect(editProjectCatalog(root, { ...edit, sourceHash: '0'.repeat(64) })).rejects.toMatchObject({ saved: true });
  expect((await readNativeCard(root, taskCardId))?.metadata.title).toBe(`${marker} Which build?`);
  await editProjectCatalog(root, edit);
  const task = (await readNativeCard(root, taskCardId))!;
  await editNativeCardContent(root, taskCardId, task.fileHash, { title: 'Human-edited title', markdown: 'Keep manual edits.\n' });
  const before = await readFile(filename);
  const renamed = await readFile(path.join(root, task.card.path));
  expect(await editProjectCatalog(root, edit)).toEqual([]);
  expect(await readFile(filename)).toEqual(before);
  expect(await readFile(path.join(root, task.card.path))).toEqual(renamed);
});
