import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launcherCommand, parseAgentsConfig, readAgentsConfig } from '../server/agents-config.ts';

const directories: string[] = [];
const filename = path.resolve('fixture-project', 'tasks', 'deckmate-agents.md');
const validConfig = `---
deckmate: agents
schema: 1
launchers:
  researcher:
    command: 'fixture-launcher --prompt "{prompt}" --cwd "{cwd}" --tools "{tools}" --cap {cap}'
    tools: 'Read,Write,WebSearch'
    capUsd: 10
  coder:
    command: 'fixture-coder "{prompt}" "{cwd}"'
routing:
  research: researcher
  code: coder
  synthesis: self
limits:
  parallel: 2
  startGapSeconds: 20
---
# Конфигурация для теста — 2026-11-05
`;

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(directory));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)
      || !path.basename(directory).startsWith('deckmate-agents-config-')) {
      throw new Error('Unexpected agents config cleanup target.');
    }
    await rm(directory, { recursive: true, force: true });
  }
});

it('reads the project YAML header, launchers, role routing and numeric limits', async () => {
  const project = await mkdtemp(path.join(tmpdir(), 'deckmate-agents-config-'));
  directories.push(project);
  await mkdir(path.join(project, 'tasks'));
  await writeFile(path.join(project, 'tasks/deckmate-agents.md'), '\uFEFF' + validConfig.replaceAll('\n', '\r\n'));
  const config = await readAgentsConfig(project);
  expect(config).toMatchObject({
    schema: 1,
    launchers: {
      researcher: { tools: 'Read,Write,WebSearch', capUsd: 10 },
      coder: { command: 'fixture-coder "{prompt}" "{cwd}"' },
    },
    routing: { research: 'researcher', code: 'coder', synthesis: 'self' },
    limits: { parallel: 2, startGapSeconds: 20 },
  });
  expect(config.routing.docs).toBeUndefined();
});

it.each([
  { key: 'schema', text: validConfig.replace('schema: 1', 'schema: 2') },
  { key: 'routing.research', text: validConfig.replace('research: researcher', 'research: absent') },
  { key: 'limits.parallel', text: validConfig.replace('parallel: 2', 'parallel: 0') },
])('reports the config path and invalid $key', ({ key, text }) => {
  expect(() => parseAgentsConfig(text, filename)).toThrow(filename);
  expect(() => parseAgentsConfig(text, filename)).toThrow(key);
});

it.each([
  { key: 'launchers.researcher.capUsd', text: validConfig.replace('capUsd: 10', 'capUsd: -1') },
  { key: 'launchers.researcher.tools', text: validConfig.replace("tools: 'Read,Write,WebSearch'", 'tools: [Read, Write]') },
  { key: 'limits.startGapSeconds', text: validConfig.replace('startGapSeconds: 20', 'startGapSeconds: -1') },
])('rejects invalid launcher and limit values at $key', ({ key, text }) => {
  expect(() => parseAgentsConfig(text, filename)).toThrow(key);
});

it('leaves a project without a config in manual mode', async () => {
  const project = await mkdtemp(path.join(tmpdir(), 'deckmate-agents-config-'));
  directories.push(project);
  const config = await readAgentsConfig(project);
  expect(Object.keys(config.launchers)).toEqual([]);
  expect(Object.keys(config.routing)).toEqual([]);
  expect(config.limits.parallel).toBeGreaterThan(0);
  expect(config.limits.startGapSeconds).toBeGreaterThanOrEqual(0);
});

it('substitutes all four launcher keys literally, without interpreting replacement text twice', () => {
  const launcher = parseAgentsConfig(validConfig, filename).launchers.researcher;
  const prompt = path.resolve('fixture $&', '{cwd}', 'tz-research.md');
  const project = path.resolve('project $` with spaces');
  expect(launcherCommand(launcher, prompt, project)).toBe(
    `fixture-launcher --prompt "${prompt}" --cwd "${project}" --tools "Read,Write,WebSearch" --cap 10`,
  );
});
