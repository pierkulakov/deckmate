import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { editProjectCatalog, emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { readCardContent } from '../server/card-content.ts';
import { createManagedMarkdown } from '../server/native-cards.ts';
import { localIsoDate } from '../src/catalog-hand.ts';
import { recordDecision } from '../src/open-questions.ts';
import { run as runState } from '../tools/commands/state.ts';

const race = vi.hoisted(() => ({ afterLegacyState: null as null | (() => Promise<void>) }));
vi.mock('../server/card-properties.ts', async importOriginal => {
  const original = await importOriginal<typeof import('../server/card-properties.ts')>();
  return { ...original, async updateLegacyCardState(...args: Parameters<typeof original.updateLegacyCardState>) {
    const changed = await original.updateLegacyCardState(...args);
    if (race.afterLegacyState) {
      const inject = race.afterLegacyState;
      race.afterLegacyState = null;
      await inject();
    }
    return changed;
  } };
});

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  race.afterLegacyState = null;
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-known-gaps-'));
  roots.push(root);
  for (const directory of ['tasks', 'docs', 'features']) await mkdir(path.join(root, directory));
  const manifest = emptyManifest();
  manifest.formatLanguage = 'en';
  manifest.members = [{ id: 'builder', label: 'Builder', kind: 'agent', aliases: [] },
    { id: 'reviewer', label: 'Reviewer', kind: 'human', aliases: [] }];
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(manifest));
  return root;
}

it.each(['owner', 'body'])('a legacy start rejects an external %s change between stages', async field => {
  const root = await fixture();
  const filename = path.join(root, 'features/work.md');
  await writeFile(filename, '\uFEFF# Work\r\n## 1 — Hero\r\n### 1.0 Work (not-started)\r\nOriginal body.  ');
  const catalog = await readProjectCatalog(root);
  const card = catalog.cards.find(card => card.id === 'task:features/work.md#1.0')!;
  const manifest = await readFile(path.join(root, 'tasks/deckmate.md'));
  let foreign: Buffer | undefined;
  race.afterLegacyState = async () => {
    const saved = await readFile(filename, 'utf8');
    foreign = Buffer.from(saved.replace('Original body.', field === 'owner' ? '**Кто:** Reviewer\r\nOriginal body.' : 'External body.'));
    await writeFile(filename, foreign);
  };
  await expect(editProjectCatalog(root, { action: 'set-card-state', cardId: card.id, sourceHash: card.sourceHash,
    manifestHash: catalog.manifestHash, state: 'started' }, 'builder')).rejects.toMatchObject({ saved: true });
  expect(await readFile(filename)).toEqual(foreign);
  expect(await readFile(path.join(root, 'tasks/deckmate.md'))).toEqual(manifest);
  expect((await readProjectCatalog(root)).optionsHash).toBe('');
});

it('a decision in a legacy Doc preserves unrelated mixed line endings', async () => {
  const root = await fixture();
  const filename = path.join(root, 'docs/rules.md');
  await writeFile(filename, '\uFEFF# Rules\r\n\r\n## Open questions\n\n- Which build?\n\n## Notes\r\nKeep these bytes.  ');
  const before = await readFile(filename);
  const content = await readCardContent(root, 'doc:docs/rules.md');
  const catalog = await readProjectCatalog(root);
  const markdown = recordDecision(content.markdown, 0, 'Which build?', 'Stable build', 'Reviewer', localIsoDate(), 'en', 'en');
  await editProjectCatalog(root, { action: 'record-decision', cardId: content.cardId, sourceHash: content.sourceHash,
    manifestHash: catalog.manifestHash, questionIndex: 0, questionText: 'Which build?', answer: 'Stable build', memberId: 'reviewer' });
  const bodyStart = before.length - Buffer.byteLength(content.markdown);
  expect(await readFile(filename)).toEqual(Buffer.concat([before.subarray(0, bodyStart), Buffer.from(markdown)]));
});

it('the state CLI refuses an agent accepting its own reported work', async () => {
  const root = await fixture();
  const id = randomUUID();
  await createManagedMarkdown(root, `cards/${id}.md`, { deckmate: 'card', schema: 1, id, kind: 'task', title: 'Work',
    state: 'review', owner: 'Builder', parentId: null, deckId: null, trackIds: [] }, '#### Report 2026-11-11 · builder\n\nCompleted.\n');
  const before = await readFile(path.join(root, `cards/${id}.md`));
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await expect(runState({ root, source: 'sandbox', catalog: await readProjectCatalog(root),
    config: { editMode: 'direct', dataRoot: root, writeRoot: root, projectName: 'Known gaps', port: 4397, python: 'python' } },
  [`card:${id}`, 'done'], new Map([['member', 'builder']]))).rejects.toThrow();
  expect(await readFile(path.join(root, `cards/${id}.md`))).toEqual(before);
  expect((await readProjectCatalog(root)).optionsHash).toBe('');
});
