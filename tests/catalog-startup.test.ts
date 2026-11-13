import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CatalogService } from '../server/catalog-service.ts';
import * as catalog from '../server/catalog.ts';
import type { ServerConfig } from '../server/config.ts';
import * as writeLock from '../server/write-lock.ts';
import { prepareCardOptionsPatch, readCardOptions } from '../server/card-options.ts';

vi.mock('../server/catalog.ts', async importOriginal => {
  const actual = await importOriginal<typeof catalog>();
  return { ...actual, readFreshProjectCatalog: vi.fn(actual.readFreshProjectCatalog) };
});

const directories: string[] = [];
const services: CatalogService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'deckmate-catalog-startup-'));
  directories.push(directory);
  vi.stubEnv('DECKMATE_COORDINATION', path.join(directory, 'coordination'));
  const root = path.join(directory, 'project');
  const cache = path.join(directory, 'index');
  await mkdir(path.join(root, 'features'), { recursive: true });
  const filename = path.join(root, 'features/work.md');
  await writeFile(filename, '# Work\n### 1.0 Original task\nSearchable body.\n');
  const config: ServerConfig = { dataRoot: root, writeRoot: root, editMode: 'direct', port: 4317, projectName: 'Startup', python: 'python' };
  const open = () => {
    const service = new CatalogService(config, cache);
    services.push(service);
    return service;
  };
  return { root, cache, filename, open };
}

it('reuses a current disk index, but rebuilds after same-size source changes with preserved file times', async () => {
  const { cache, filename, open } = await fixture();
  const first = open();
  const before = await first.get('sandbox');
  await first.close();
  const second = open();
  const same = await second.get('sandbox');
  expect(same.indexedAt).toBe(before.indexedAt);
  expect(same.cards).toEqual(before.cards);
  await second.close();
  const info = await stat(filename);
  await writeFile(filename, (await readFile(filename, 'utf8')).replace('Original', 'Modified'));
  await utimes(filename, info.atime, info.mtime);
  const third = open();
  expect((await third.search('sandbox', { text: 'Modified', kind: 'task' })).map(card => card.title)).toEqual(['Modified task']);
  expect(await third.search('sandbox', { text: 'Original' })).toEqual([]);
  expect((await readdir(cache)).filter(name => name.endsWith('.sqlite'))).toHaveLength(1);
});

it('avoids coordination work for a project with no housekeeping mutations', async () => {
  const { open } = await fixture();
  const lock = vi.spyOn(writeLock, 'withProjectWriteLock');
  const service = open();
  const view = await service.get('sandbox');
  expect(view.cards.some(card => card.title === 'Original task')).toBe(true);
  expect(lock).not.toHaveBeenCalled();
  await expect(readdir(process.env.DECKMATE_COORDINATION!)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('retains the project write lock when accepted cards need archiving', async () => {
  const { root, filename, open } = await fixture();
  await writeFile(filename, '# Work\n### 1.0 Original task (done)\nSearchable body.\n');
  const id = 'task:features/work.md#1.0';
  const options = await readCardOptions(root);
  await (await prepareCardOptionsPatch(root, options.hash, { [id]: { doneAt: '2000-01-01' } })).publish();
  const service = open();
  await service.get('sandbox');
  const lock = vi.spyOn(writeLock, 'withProjectWriteLock');
  service.invalidate('sandbox');
  const after = await service.get('sandbox');
  expect(after.cards.find(card => card.id === id)?.archived).toBe(true);
  expect(lock).toHaveBeenCalled();
});

it('rebuilds corrupt FTS storage even when the saved fingerprint still matches Markdown', async () => {
  const { cache, open } = await fixture();
  const first = open();
  const before = await first.get('sandbox');
  await first.close();
  const filename = path.join(cache, (await readdir(cache)).find(name => name.endsWith('.sqlite'))!);
  const database = new DatabaseSync(filename, { defensive: false });
  try { database.exec('DELETE FROM cards_fts_data'); }
  finally { database.close(); }
  const recovered = open();
  expect((await recovered.get('sandbox')).cards).toEqual(before.cards);
  expect((await recovered.search('sandbox', { text: 'Searchable', kind: 'task' })).map(card => card.title)).toEqual(['Original task']);
});

it('discards a speculative first read invalidated while housekeeping is pending', async () => {
  const { filename, open } = await fixture();
  const service = open();
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  const actual = await vi.importActual<typeof catalog>('../server/catalog.ts');
  vi.mocked(catalog.readFreshProjectCatalog).mockImplementationOnce(async root => {
    const view = await actual.readFreshProjectCatalog(root);
    entered();
    return view;
  });
  vi.spyOn(service as unknown as { checkHousekeeping(): Promise<void> }, 'checkHousekeeping').mockImplementationOnce(() => blocked);
  const pending = service.get('sandbox');
  try {
    await reading;
    await writeFile(filename, (await readFile(filename, 'utf8')).replace('Original', 'Modified'));
    service.invalidate('sandbox', 'features/work.md');
    release();
    expect((await pending).cards.find(card => card.kind === 'task')?.title).toBe('Modified task');
    expect(await service.search('sandbox', { text: 'Original' })).toEqual([]);
  } finally { release(); await pending; }
});
