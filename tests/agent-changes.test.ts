import { afterEach, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readAgentChanges, readAgentHistory } from '../server/agent-changes.ts';
import { appendActivity } from '../server/activity.ts';
import type { DeckActivityEvent } from '../src/activity-contracts.ts';
import type { CatalogCard } from '../src/catalog-contracts.ts';

const roots: string[] = [];
const card: CatalogCard = {
  id: 'task:features/context.md#1.0', path: 'features/context.md', kind: 'task', version: '1.0',
  title: 'Пролёт пули', state: 'not-started', owner: null, markdown: 'Устаревший текст каталога.',
  sourceHash: '0'.repeat(64), range: null, deckId: null, parentId: null, trackIds: [],
};
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

afterEach(async () => {
  for (const root of roots.splice(0)) {
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(root));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)
      || !path.basename(root).startsWith('deckmate-agent-changes-')) {
      throw new Error('Unexpected agent changes fixture cleanup target');
    }
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-agent-changes-'));
  roots.push(root);
  await mkdir(path.join(root, 'features'));
  await mkdir(path.join(root, 'tasks'));
  const bytes = Buffer.from('\uFEFF# Контекст\r\n## 1 — Бой\r\n### 1.0 Пролёт пули\r\nСвежий текст.\r\n');
  await writeFile(path.join(root, card.path), bytes);
  const events: DeckActivityEvent[] = [];
  for (let index = 0; index < 5; index += 1) {
    const event: DeckActivityEvent = {
      schema: 1, id: randomUUID(), at: new Date(Date.UTC(2026, 10, 1, 0, 0, index)).toISOString(),
      action: 'set-card-properties', actor: 'Deckmate', summary: `Свойства карты ${index}`,
      cards: [{ id: card.id, title: card.title }], deckIds: [], details: [`Изменение ${index}`],
    };
    events.push(event);
    await appendActivity(root, event, 'ru');
  }
  await appendActivity(root, { ...events[4], id: randomUUID(), at: '2026-11-01T00:00:05.000Z',
    cards: [{ id: 'task:features/context.md#1.1', title: 'Другая карта' }] }, 'ru');
  return { root, bytes, events };
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function visit(relative: string): Promise<void> {
    const entries = await readdir(path.join(root, relative), { withFileTypes: true });
    for (const entry of entries.sort((first, second) => first.name.localeCompare(second.name))) {
      const filename = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else files[filename] = (await readFile(path.join(root, filename))).toString('hex');
    }
  }
  await visit('');
  return files;
}

it('filters journal events by the ISO instant and card, hashes fresh CRLF/BOM bytes, and writes no files', async () => {
  const { root, bytes, events } = await fixture();
  const before = await snapshot(root);
  const changes = await readAgentChanges(root, card, '2026-11-01T03:00:02+03:00');
  expect(changes).toMatchObject({ cardId: card.id, sourceHash: digest(bytes), previousSourceHash: null,
    changed: null, eventScope: 'after-timestamp' });
  expect(changes.events.map(event => event.id)).toEqual([events[4].id, events[3].id]);
  expect(changes.git).toMatchObject({ available: false, status: 'not-repository', commits: [] });
  expect(changes.warnings).toContain(changes.git.warning);
  expect(await snapshot(root)).toEqual(before);
});

it('compares hash checkpoints without pretending they date journal events or cover separate card properties', async () => {
  const { root, bytes, events } = await fixture();
  const before = await snapshot(root);
  const currentHash = digest(bytes);
  const unchanged = await readAgentChanges(root, card, currentHash.toUpperCase());
  expect(unchanged).toMatchObject({ sourceHash: currentHash, previousSourceHash: currentHash,
    changed: false, eventScope: 'all-card-events' });
  expect(unchanged.events.map(event => event.id)).toEqual([...events].reverse().map(event => event.id));
  expect(unchanged.warnings.some(warning => warning.includes('A sourceHash carries no time'))).toBe(true);
  const previousHash = digest(Buffer.from('Previous file contents'));
  const changed = await readAgentChanges(root, card, previousHash);
  expect(changed).toMatchObject({ sourceHash: currentHash, previousSourceHash: previousHash, changed: true });
  expect(changed.events).toEqual(unchanged.events);
  expect(await snapshot(root)).toEqual(before);
});

it('limits brief history to the latest three card events and reports the complete matching count', async () => {
  const { root, bytes, events } = await fixture();
  const before = await snapshot(root);
  const history = await readAgentHistory(root, card);
  expect(history.sourceHash).toBe(digest(bytes));
  expect(history.totalEvents).toBe(5);
  expect(history.events.map(event => event.id)).toEqual([events[4].id, events[3].id, events[2].id]);
  expect(await snapshot(root)).toEqual(before);
});

it.each(['2026-02-29T00:00:00Z', '2026-11-31T00:00:00Z', '2026-11-01T24:00:00Z',
  '2026-11-01T00:00:00+25:00', '2026-11-01T00:00:00', '2026-11-01', 'a'.repeat(63), 'g'.repeat(64)])(
  'rejects invalid checkpoint %s before reading the project', async since => {
    await expect(readAgentChanges(path.join(tmpdir(), 'missing-agent-changes-project'), card, since)).rejects.toBeInstanceOf(RangeError);
  },
);
