import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { build, preview } from 'vite';
import { buildBrowserFixtures, startBrowserFixturePreview } from './helpers/browser-fixtures.ts';

vi.mock('vite', () => ({ build: vi.fn(), preview: vi.fn() }));
vi.mock('@tailwindcss/vite', () => ({ default: () => ({ name: 'test-tailwind' }) }));
afterEach(() => { vi.resetAllMocks(); });

it('preserves the live-owner marker through builds and releases preview leases on close', async () => {
  vi.mocked(build).mockImplementation(async (config: any) => {
    expect(config.build.emptyOutDir).toBe(false);
    const desktop = path.basename(config.build.outDir) === 'desktop';
    const owner = desktop ? path.dirname(config.build.outDir) : config.build.outDir;
    expect(existsSync(path.join(owner, '.deckmate-owner.json'))).toBe(true);
    if (desktop) return {} as any;
    await mkdir(path.join(config.build.outDir, '.vite'));
    await writeFile(path.join(config.build.outDir, '.vite', 'manifest.json'), '{}');
    return {} as any;
  });
  const closed = vi.fn().mockResolvedValue(undefined);
  vi.mocked(preview).mockResolvedValue({ close: closed } as any);
  const built = await buildBrowserFixtures();
  try {
    expect(build).toHaveBeenCalledTimes(2);
    const server = await startBrowserFixturePreview(built.directory);
    expect((await readdir(built.directory)).filter(name => name.startsWith('.deckmate-reader-'))).toHaveLength(1);
    await server.close();
    expect(closed).toHaveBeenCalledOnce();
    expect((await readdir(built.directory)).filter(name => name.startsWith('.deckmate-reader-'))).toHaveLength(0);
  } finally { await built.close(); }
  expect(existsSync(built.directory)).toBe(false);
});

it.each([1, 2])('removes a failed build at step %s and releases leases when preview startup fails', async failedStep => {
  let directory = '';
  let step = 0;
  vi.mocked(build).mockImplementation(async (config: any) => {
    if (++step === 1) directory = config.build.outDir;
    if (step === failedStep) throw new Error('build failed');
    return {} as any;
  });
  await expect(buildBrowserFixtures()).rejects.toThrow('build failed');
  expect(existsSync(directory)).toBe(false);
  vi.mocked(build).mockResolvedValue({} as any);
  const built = await buildBrowserFixtures();
  try {
    await expect(startBrowserFixturePreview(built.directory)).rejects.toThrow();
    expect((await readdir(built.directory)).filter(name => name.startsWith('.deckmate-reader-'))).toHaveLength(0);
  } finally { await built.close(); }
});
