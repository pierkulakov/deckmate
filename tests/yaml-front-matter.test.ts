import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isAlias } from 'yaml';
import type { RunConfiguration, RunRecord } from '../src/catalog-contracts.ts';
import { milestonesPath, runsPath } from '../src/planning-files.ts';
import { cardOptionsPath, prepareCardOptionsPatch, readCardOptions } from '../server/card-options.ts';
import { parseMilestones, readMilestones } from '../server/milestones.ts';
import { prepareRunRegistry } from '../server/planning-files.ts';
import { parseRunRegistry, readRuns } from '../server/runs.ts';
import { parseYamlFrontMatter } from '../server/yaml-front-matter.ts';

const errors = { headerError: 'header', yamlError: 'yaml', aliases: 'reject' as const, aliasError: 'aliases' };
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const frontMatter = (yaml: string) => Buffer.from(`---\n${yaml}\n---\n`);
const roots: string[] = [];
const configuration: RunConfiguration = { id: 'team', shortName: 'team', color: '#9258e5', labelTemplate: 'Cycle %RUN_NR%',
  startDate: '2026-11-02', durationWeeks: 1, upcomingCount: 2, finishTime: '24:00', timeZone: 'UTC',
  carryOver: { review: true, blocked: true, other: true } };
const run: RunRecord = { id: 'team-1', configurationId: 'team', number: 1, start: '2026-11-02', end: '2026-11-08', goal: 'Цель 👣' };

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-yaml-front-matter-'));
  roots.push(root);
  await mkdir(path.join(root, 'tasks'));
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('deckmate-yaml-front-matter-')) {
      throw new Error('Unsafe front-matter fixture cleanup');
    }
    await rm(root, { recursive: true, force: true });
  }
});

for (const newline of ['\n', '\r\n']) for (const bom of ['', '\uFEFF']) {
  it(`preserves source bytes and character ranges (${JSON.stringify(newline)}, BOM=${Boolean(bom)})`, () => {
    const yaml = `# Я 👣${newline}schema: 1 # keep${newline}custom: 'текст'${newline}`;
    const suffix = `--- \t${newline}# Тело 👣\nMixed endings\r\n\uFEFF---\nuntouched\u0000`;
    const bytes = Buffer.from(`${bom}---${newline}${yaml}${suffix}`);
    const source = parseYamlFrontMatter(bytes, errors);
    expect(source.text).toBe(bytes.toString('utf8'));
    expect(source.yaml).toBe(yaml);
    expect(source.newline).toBe(newline);
    expect(source.yamlStart).toBe(bom.length + 3 + newline.length);
    expect(source.yamlEnd).toBe(source.yamlStart + yaml.length);
    expect(source.text.slice(source.yamlStart, source.yamlEnd)).toBe(yaml);
    expect(source.text.slice(source.yamlEnd)).toBe(suffix);
    expect(source.yamlEnd).not.toBe(Buffer.byteLength(source.text.slice(0, source.yamlEnd)));
    expect(Buffer.from(source.text.slice(0, source.yamlStart) + source.yaml + source.text.slice(source.yamlEnd))).toEqual(bytes);
    expect(source.document.toJS({ maxAliasCount: 0 })).toEqual({ schema: 1, custom: 'текст' });
  });
}

it.each(['---\nschema: 1\n---', '---\nschema: 1\n--- \t'])('accepts a closing boundary at EOF: %j', text => {
  const source = parseYamlFrontMatter(Buffer.from(text), errors);
  expect(source.yaml).toBe('schema: 1\n');
  expect(Buffer.from(source.text)).toEqual(Buffer.from(text));
});

it.each(['', 'No header', '\n---\nschema: 1\n---\n', 'prefix\n---\nschema: 1\n---\n',
  ' ---\nschema: 1\n---\n', '--- \nschema: 1\n---\n', '\uFEFF\uFEFF---\nschema: 1\n---\n',
  '---\nschema: 1\n', '---\nschema: 1\n---extra\n'])('rejects missing or misplaced boundaries: %j', text => {
  expect(() => parseYamlFrontMatter(Buffer.from(text), errors)).toThrow('header');
});

it.each(['', 'null', 'scalar', '[one, two]', '- one\n- two', 'key: [', 'key: 1\nkey: 2'])('rejects non-maps and invalid YAML: %j', yaml => {
  expect(() => parseYamlFrontMatter(frontMatter(yaml), errors)).toThrow('yaml');
});

it('rejects invalid UTF-8 anywhere in the file, including an untouched body', () => {
  for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.concat([frontMatter('schema: 1'), Buffer.from([0xff])])]) {
    expect(() => parseYamlFrontMatter(bytes, errors)).toThrow(TypeError);
    expect(() => parseRunRegistry(bytes)).toThrow(TypeError);
    expect(() => parseMilestones(bytes)).toThrow(TypeError);
  }
});

it('makes alias rejection explicit while preserving an unresolved AST for planning patches', () => {
  const bytes = frontMatter('value: &shared {nested: [one]}\ncopy: *shared');
  expect(() => parseYamlFrontMatter(bytes, errors)).toThrow('aliases');
  const source = parseYamlFrontMatter(bytes, { ...errors, aliases: 'preserve' });
  expect(isAlias(source.document.get('copy', true))).toBe(true);
  expect(() => source.document.toJS({ maxAliasCount: 0 })).toThrow();
  const unresolved = parseYamlFrontMatter(frontMatter('copy: *missing'), { ...errors, aliases: 'preserve' });
  expect(isAlias(unresolved.document.get('copy', true))).toBe(true);
});

it.each([
  ['Run', runsPath, parseRunRegistry, 'runs: []'],
  ['Milestone', milestonesPath, parseMilestones, 'milestones: []'],
] as const)('keeps %s domain errors, size limits and warning envelopes', async (name, relative, parse, list) => {
  const root = await fixture();
  const read = name === 'Run' ? readRuns : readMilestones;
  const empty = name === 'Run' ? { runs: [], configurations: [] } : { milestones: [] };
  expect(await read(root)).toEqual({ hash: '', ...empty, warnings: [] });
  const cases: Array<[Buffer, string]> = [
    [Buffer.from('\n---\nschema: 1\n---\n'), `The ${name} registry needs a YAML header.`],
    [frontMatter('[]'), `Invalid ${name} registry YAML.`],
    [frontMatter(`schema: 1\n${list}\nanchor: &shared {}\ncopy: *shared`), `The ${name} registry does not support YAML aliases.`],
    [Buffer.alloc(1024 * 1024 + 1), `The ${name} registry is larger than 1 MB.`],
  ];
  for (const [bytes, message] of cases) {
    expect(() => parse(bytes)).toThrow(message);
    await writeFile(path.join(root, relative), bytes);
    expect(await read(root)).toEqual({ hash: '', ...empty, warnings: [`${relative}: ${message}`] });
    expect(await readFile(path.join(root, relative))).toEqual(bytes);
  }
});

it('keeps Run configurations and hashes in the optional loader', async () => {
  const root = await fixture();
  const bytes = frontMatter(JSON.stringify({ schema: 1, runs: [run], configurations: [configuration] }));
  await writeFile(path.join(root, runsPath), bytes);
  expect(await readRuns(root)).toEqual({ hash: hash(bytes), runs: [run], configurations: [configuration], warnings: [] });
});

it('patches a Run without changing BOM, CRLF, extension data, comments or body bytes', async () => {
  const root = await fixture();
  const body = Buffer.from('--- \t\r\n# Тело 👣\nMixed endings\r\n\uFEFF---\nuntouched\u0000');
  const header = '\uFEFF---\r\n# keep header\r\nschema: 1 # schema\r\ncustom: {note: "Я: оставлен"}\r\n'
    + `configurations: [${JSON.stringify(configuration)}] # keep configuration\r\nruns: [${JSON.stringify(run)}] # keep run\r\n`;
  const bytes = Buffer.concat([Buffer.from(header), body]);
  const filename = path.join(root, runsPath);
  await writeFile(filename, bytes);
  const plan = await prepareRunRegistry(root, hash(bytes), [{ ...run, goal: 'Новая цель' }], [configuration]);
  expect(await readFile(filename)).toEqual(bytes);
  expect(plan.nextBytes).toEqual(Buffer.from(bytes.toString('utf8').replace(JSON.stringify(run), JSON.stringify({ ...run, goal: 'Новая цель' }))));
  expect(plan.nextBytes.subarray(plan.nextBytes.length - body.length)).toEqual(body);
  await plan.publish();
  expect(await readFile(filename)).toEqual(plan.nextBytes);
  expect((await readRuns(root)).hash).toBe(plan.nextHash);
});

it('never overwrites invalid UTF-8, non-map or aliased Card Options and Run registries', async () => {
  const root = await fixture();
  const cases = [Buffer.concat([frontMatter('schema: 1\ncards: {}\nruns: []'), Buffer.from([0xff])]),
    frontMatter('[]'), frontMatter('schema: 1\ncards: {}\nruns: []\nanchor: &shared {}\ncopy: *shared')];
  for (const bytes of cases) {
    await writeFile(path.join(root, cardOptionsPath), bytes);
    await writeFile(path.join(root, runsPath), bytes);
    await expect(readCardOptions(root)).rejects.toThrow();
    await expect(prepareCardOptionsPatch(root, hash(bytes), { 'task:test.md#1': { bookmarked: true } })).rejects.toThrow();
    await expect(prepareRunRegistry(root, hash(bytes), [], [])).rejects.toThrow();
    expect(await readFile(path.join(root, cardOptionsPath))).toEqual(bytes);
    expect(await readFile(path.join(root, runsPath))).toEqual(bytes);
  }
});

it('does not impose the planning registries byte limit on Card Options', async () => {
  const root = await fixture();
  const bytes = frontMatter(`schema: 1\ncards: {}\ncustom: ${'x'.repeat(1024 * 1024)}`);
  await writeFile(path.join(root, cardOptionsPath), bytes);
  expect(await readCardOptions(root)).toEqual({ hash: hash(bytes), options: {} });
});
