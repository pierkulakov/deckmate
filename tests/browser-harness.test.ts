import { afterEach, expect, it, vi } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { TestModule } from 'vitest/node';
import config from '../vitest.config.ts';
import { browserFiles, browserFixtures } from './browser-files.ts';
import BrowserSkipReporter from './browser-skip-reporter.ts';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it('keeps browser selection disjoint and resource limits independent of root config merging', () => {
  const projects = config.test!.projects as { extends: boolean; test: {
    name: string; include: string[]; exclude: string[]; maxWorkers: number; fileParallelism?: boolean;
  } }[];
  const browser = projects.find(project => project.test.name === 'browser')!;
  const unit = projects.find(project => project.test.name === 'unit')!;
  expect(browser.extends).toBe(false);
  expect(unit.extends).toBe(false);
  expect(browser.test.include).toEqual(browserFiles);
  expect(unit.test.exclude).toEqual(expect.arrayContaining(browserFiles));
  expect(browser.test.maxWorkers).toBe(1);
  expect(browser.test.fileParallelism).toBe(false);
  expect(unit.test.maxWorkers).toBe(4);
  for (const [fixture, file] of Object.entries(browserFixtures)) {
    expect(existsSync(file), file).toBe(true);
    expect(existsSync(`tests/fixtures/${fixture}.tsx`), fixture).toBe(true);
  }
});

it('registers every browser suite so new files cannot bypass resource limits or missing-browser reporting', () => {
  const suites = readdirSync('tests').filter(file => /\.test\.tsx?$/.test(file))
    .filter(file => /describe\.skipIf\(!browser(?:Path|Available)\)/.test(readFileSync(`tests/${file}`, 'utf8')))
    .map(file => `tests/${file}`);
  expect([...browserFiles].sort()).toEqual(suites.sort());
  for (const file of suites) expect(readFileSync(file, 'utf8'), file).toContain('const browserPath = requireBrowser();');
});

it('prints exactly one final count of skipped browser cases, excluding non-browser files', () => {
  vi.stubEnv('DECKMATE_BROWSER', '/deckmate-missing-browser');
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const module = (file: string, states: string[]) => ({ moduleId: '/repo/' + file,
    children: { allTests: () => states.map(state => ({ result: () => ({ state }) })) } }) as unknown as TestModule;
  new BrowserSkipReporter().onTestRunEnd([
    module(browserFiles[0], ['skipped', 'skipped']),
    module(browserFiles[1], ['passed', 'skipped']),
    module('tests/catalog.test.ts', ['skipped']),
  ]);
  expect(warning).toHaveBeenCalledOnce();
  expect(warning).toHaveBeenCalledWith(expect.stringContaining('Browser tests skipped: 3'));
  expect(warning).toHaveBeenCalledWith(expect.stringContaining('DECKMATE_BROWSER'));
});
