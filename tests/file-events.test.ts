import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { watchProjectFiles, type ProjectFileWatcher } from '../server/file-events.ts';

const fixtureRoots: string[] = [];
const activeWatchers: ProjectFileWatcher[] = [];

async function createFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'deckmate-events-'));
  fixtureRoots.push(root);
  return root;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function startWatcher(root: string, onChange: (relativePath: string) => void): ProjectFileWatcher {
  const watcher = watchProjectFiles(root, onChange);
  activeWatchers.push(watcher);
  return watcher;
}

afterEach(async () => {
  for (const watcher of activeWatchers.splice(0)) await watcher.close();
  for (const root of fixtureRoots.splice(0)) {
    const absoluteRoot = resolve(root);
    assert.equal(dirname(absoluteRoot), resolve(tmpdir()));
    assert.ok(basename(absoluteRoot).startsWith('deckmate-events-'));
    await rm(absoluteRoot, { recursive: true, force: true });
  }
});

it('notifies about all three watched files within one second and stops after close', async () => {
  const root = await createFixture();
  const paths = ['features/match.md', 'tasks/iterations.md', 'tasks/iteration-board.md'];
  await mkdir(join(root, 'features'));
  await mkdir(join(root, 'tasks'));
  for (const relativePath of paths) await writeFile(join(root, relativePath), '# Исходное\n');
  const onChange = vi.fn();
  const watched = startWatcher(root, onChange);
  await watched.ready;
  expect(onChange).not.toHaveBeenCalled();

  for (const relativePath of paths) {
    const started = performance.now();
    await writeFile(join(root, relativePath), '# Правка агента\n');
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(relativePath), { timeout: 3000, interval: 10 });
    expect(performance.now() - started).toBeLessThanOrEqual(1000);
  }
  expect(onChange).toHaveBeenCalledTimes(3);
  await watched.close();
  await writeFile(join(root, paths[0]), '# После закрытия\n');
  await delay(200);
  expect(onChange).toHaveBeenCalledTimes(3);
}, 10_000);

it('observes atomic replacement, discovers other Markdown files and ignores temporary files', async () => {
  const root = await createFixture();
  await mkdir(join(root, 'features'));
  const target = join(root, 'features', 'match.md');
  await writeFile(target, '# Матч\n');
  const onChange = vi.fn();
  const watched = startWatcher(root, onChange);
  await watched.ready;

  const temporary = join(root, 'features', 'match.md.tmp');
  await writeFile(temporary, '# Матч после атомарного сохранения\n');
  await rename(temporary, target);
  await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('features/match.md'), { timeout: 3000 });
  expect(onChange).toHaveBeenCalledTimes(1);
  await writeFile(join(root, 'features', 'other.md'), '# Другой файл\n');
  await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('features/other.md'), { timeout: 3000 });
  await writeFile(join(root, 'features', 'other.md.tmp'), '# Временный файл\n');
  await delay(200);
  expect(onChange).toHaveBeenCalledTimes(2);
}, 5000);

it('cancels pending notifications and settles readiness when closed immediately', async () => {
  const root = await createFixture();
  await mkdir(join(root, 'features'));
  const target = join(root, 'features', 'match.md');
  await writeFile(target, '# Матч\n');
  const onChange = vi.fn();
  const watched = startWatcher(root, onChange);
  await watched.ready;
  await writeFile(target, '# Правка\n');
  await watched.close();
  await delay(200);
  expect(onChange).not.toHaveBeenCalled();

  const closing = startWatcher(root, onChange);
  await closing.close();
  await closing.ready;
}, 3000);
