import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launcherInvocation, parseAgentsConfig, readAgentsConfig } from '../server/agents-config.ts';

const directories: string[] = [];
const filename = path.resolve('fixture-project', 'tasks', 'deckmate-agents.md');
const validConfig = `---
deckmate: agents
schema: 1
launchers:
  researcher:
    run: ['fixture-launcher', '--prompt', '{prompt}', '--cwd', '{cwd}', '--tools', '{tools}', '--cap', '{cap}']
    tools: 'Read,Write,WebSearch'
    capUsd: 10
  coder:
    run: ['fixture-coder', '{prompt}', '{cwd}']
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
      coder: { run: ['fixture-coder', '{prompt}', '{cwd}'] },
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

function withLauncher(launcher: unknown): string {
  return validConfig.replace(/  researcher:\n[\s\S]*?(?=  coder:)/u, () => `  researcher: ${JSON.stringify(launcher)}\n`);
}

it.each([
  {}, { run: ['agent'], command: 'agent', shell: true },
  { run: [] }, { run: 'agent' }, { run: [''] }, { run: [' '] }, { run: [42] }, { run: ['agent', null] },
  { run: ['agent'], shell: true }, { run: ['agent'], shell: 'false' },
  { command: 'agent' }, { command: 'agent', shell: false }, { command: ' ', shell: true },
  { command: 'agent {prompt}', shell: true }, { command: 'agent "{cwd}"', shell: true },
  { run: ['agent', '{cap}'] }, { run: ['agent-{cap}'] }, { command: 'agent {cap}', shell: true },
])('rejects an invalid launcher %j', launcher => {
  expect(() => parseAgentsConfig(withLauncher(launcher), filename)).toThrow('launchers.researcher');
});

it('explains the explicit migration from command to run or trusted shell mode', () => {
  expect(() => parseAgentsConfig(withLauncher({ command: 'agent' }), filename)).toThrow('Switch to run');
  expect(() => parseAgentsConfig(withLauncher({ command: 'agent' }), filename)).toThrow('shell: true');
});

it.each([
  { run: ['agent'] }, { run: ['agent', '{unknown}'], shell: false },
  { command: 'agent {tools} {cap}', shell: true, tools: 'Read', capUsd: 1 },
])('accepts an explicit launch mode %j', launcher => {
  expect(parseAgentsConfig(withLauncher(launcher), filename).launchers.researcher).toBeDefined();
});

it('preserves empty and whitespace-only arguments from configuration through invocation', () => {
  const run = ['agent', '--system-prompt', '', ' '];
  const launcher = parseAgentsConfig(withLauncher({ run }), filename).launchers.researcher;
  expect(launcher.run).toEqual(run);
  expect(launcherInvocation('researcher', launcher, '/prompt', '/project')).toEqual({ name: 'researcher', run });
});

it.each(['with spaces (x86)', '"quoted"', '$()', '`backticks`', '%PATH%', '!x!', '& | ^ < >', 'trailing\\', 'D:\\'])(
  'substitutes paths containing %j inside each element without splitting or interpretation', value => {
    const prompt = `/project/${value}`;
    const cwd = `/working/${value}`;
    const launcher = { run: ['agent-{tools}', 'Read {prompt} and finish.', '{prompt}', '{cwd}', '{tools}', '{cap}', '{unknown}'],
      tools: '$& $` {cwd}', capUsd: 10 };
    expect(launcherInvocation('test', launcher, prompt, cwd)).toEqual({ name: 'test', run: [
      'agent-$& $` {cwd}', `Read ${prompt} and finish.`, prompt, cwd, launcher.tools, '10', '{unknown}',
    ] });
  },
);

it('substitutes absent tools as an empty argument and does not modify the template', () => {
  const launcher = { run: ['agent', '{tools}', '{prompt}'] };
  expect(launcherInvocation('test', launcher, '$& {cwd}', '/project')).toEqual({ name: 'test', run: ['agent', '', '$& {cwd}'] });
  expect(launcher.run).toEqual(['agent', '{tools}', '{prompt}']);
});

it('passes shell paths only through environment variables and substitutes trusted tools and cap once', () => {
  const launcher = parseAgentsConfig(withLauncher({ command: 'agent {tools} {cap}', shell: true, tools: '$& {prompt}', capUsd: 2 }), filename)
    .launchers.researcher;
  expect(launcherInvocation('researcher', launcher, '/prompt %PATH%', '/cwd !x!')).toEqual({
    name: 'researcher', shell: true, command: 'agent $& {prompt} 2', env: { DECKMATE_PROMPT: '/prompt %PATH%', DECKMATE_CWD: '/cwd !x!' },
  });
});

it('accepts every bundled argv launcher', async () => {
  const template = await readFile(new URL('../assets/templates/deckmate-agents.md', import.meta.url), 'utf8');
  const config = parseAgentsConfig(template, 'assets/templates/deckmate-agents.md');
  expect(Object.keys(config.launchers)).toEqual(['claude', 'reader', 'codex']);
  for (const [name, launcher] of Object.entries(config.launchers)) {
    const invocation = launcherInvocation(name, launcher, '/project (x86)/prompt.md', '/project (x86)');
    expect(invocation.shell).not.toBe(true);
    if (!invocation.shell) expect(invocation.run).toContain('Read /project (x86)/prompt.md and complete the assignment.');
  }
});
