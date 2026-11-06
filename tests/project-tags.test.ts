import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectProjectTags, sanitizeTagSvg, tagIconDataUrl, validateProjectTag } from '../src/project-tags.ts';
import { prepareProjectTag, projectTagsPath, readProjectTags } from '../server/project-tags.ts';
import { prepareCardOptionsPatch } from '../server/card-options.ts';
import { emptyManifest, readProjectCatalog, renderCatalogManifest } from '../server/catalog.ts';
import { createApp } from '../server/app.ts';
import type { FastifyInstance } from 'fastify';
import type { CatalogView } from '../src/catalog-contracts.ts';

const roots: string[] = [];
const apps: FastifyInstance[] = [];
const execute = promisify(execFile);
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 8L12 4L20 8L12 20Z"/></svg>';
const cardId = 'task:features/match.md#1.1';
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-tags-')); roots.push(root);
  return root;
}
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0)) {
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(root));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(root).startsWith('deckmate-tags-')) throw new Error('Unexpected tag test cleanup target');
    await rm(root, { recursive: true, force: true });
  }
});

it('accepts a bounded vector icon and only exposes it as a safe encoded image', () => {
  const tag = validateProjectTag({ name: 'Audio, UI', color: '#AABBCC', iconSvg: icon });
  expect(tag.color).toBe('#aabbcc');
  expect(tag.iconSvg).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(sanitizeTagSvg(tag.iconSvg)).toBe(tag.iconSvg);
  const url = tagIconDataUrl(tag)!;
  expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
  expect(decodeURIComponent(url.slice(url.indexOf(',') + 1))).toContain('stroke="#aabbcc"');
  expect(tagIconDataUrl({ name: 'unsafe', color: '#123456', iconSvg: '<svg onload="alert(1)"/>' })).toBeUndefined();
});

it.each([
  '<svg><script>alert(1)</script></svg>',
  '<svg><foreignObject><div/></foreignObject></svg>',
  '<svg onload="alert(1)"/>',
  '<svg><g onclick="alert(1)"><path d="M0 0"/></g></svg>',
  '<svg><image href="https://example.com/a.svg"/></svg>',
  '<svg><use href="#shape"/></svg>',
  '<svg><path d="M0 0" xlink:href="https://example.com"/></svg>',
  '<svg><path d="M0 0" style="fill:url(https://example.com)"/></svg>',
  '<svg><path d="M0 0" fill="url(#paint)"/></svg>',
  '<svg><style>path { fill: red }</style></svg>',
  '<!DOCTYPE svg [<!ENTITY exploit SYSTEM "file:///etc/passwd">]><svg/>',
  '<svg><path d="&#77;0 0"/></svg>',
  '<svg xmlns="http://example.com"/>',
  '<svg fill="none" fill="currentColor"/>',
  '<svg><g></svg>',
  '<svg/><svg/>',
  '<svg><animate attributeName="href"/></svg>',
  '<svg><path d="M0 0"><g/></path></svg>',
  '<svg><path d="M0 0"/></svg><',
  '<svg><path d="M0 0"/ ></svg>',
])('rejects active, external, or malformed SVG before persistence: %s', svg => {
  expect(() => sanitizeTagSvg(svg)).toThrow();
});

it('validates exact tag names and resource limits without changing existing assignment strings', () => {
  expect(() => validateProjectTag({ name: ' tag ', color: '#123456' })).toThrow();
  expect(() => validateProjectTag({ name: 'tag\nname', color: '#123456' })).toThrow();
  expect(() => validateProjectTag({ name: 'tag', color: 'url(https://example.com)' })).toThrow();
  expect(() => validateProjectTag({ name: 'tag', color: '#123456', rename: 'other' })).toThrow();
  expect(() => sanitizeTagSvg('<svg>' + '<g/>'.repeat(256) + '</svg>')).toThrow();
  expect(() => sanitizeTagSvg('<svg>' + ' '.repeat(16384) + '</svg>')).toThrow();
  const known = collectProjectTags([{ tags: ['old tag', 'Audio, UI', 'audio'] }], [{ name: 'Audio, UI', color: '#aabbcc' }, { name: 'Unused', color: '#aabbcc' }]);
  expect(known.map(tag => tag.name)).toEqual(expect.arrayContaining(['old tag', 'Audio, UI', 'audio', 'Unused']));
  expect(known.find(tag => tag.name === 'Audio, UI')?.color).toBe('#aabbcc');
});

it('reads an absent registry without writes, then prepares and atomically creates it', async () => {
  const root = await fixture();
  expect(await readProjectTags(root)).toEqual({ hash: '', tags: [] });
  expect(await readdir(root)).toEqual([]);
  const plan = await prepareProjectTag(root, '', { name: 'Audio, UI', color: '#AABBCC', iconSvg: icon });
  expect(await readdir(root)).toEqual([]);
  await plan.publish();
  const bytes = await readFile(path.join(root, projectTagsPath));
  const source = await readProjectTags(root);
  expect(source).toEqual({ hash: hash(bytes), tags: [validateProjectTag({ name: 'Audio, UI', color: '#AABBCC', iconSvg: icon })] });
  expect(plan.nextHash).toBe(source.hash);
  expect((await prepareProjectTag(root, source.hash, source.tags[0])).changed).toBe(false);
  expect(bytes.toString()).toContain('editing this registry never renames them');
});

it('patches only requested metadata, preserving BOM, CRLF, comments, other tags and prose', async () => {
  const root = await fixture(); await mkdir(path.join(root, 'tasks'));
  const before = '\uFEFF---\r\nschema: 1\r\n# Keep registry comment\r\ntags:\r\n  audio: { color: "#123456" } # Keep tag comment\r\n  UI: { color: "#abcdef" }\r\n---\r\n# Notes\r\nKeep body **exactly**.\r\n';
  await writeFile(path.join(root, projectTagsPath), before);
  const plan = await prepareProjectTag(root, hash(before), { name: 'audio', color: '#654321' });
  await plan.publish();
  expect(await readFile(path.join(root, projectTagsPath), 'utf8')).toBe(before.replace('"#123456"', '"#654321"'));
  const source = await readProjectTags(root);
  const withIcon = await prepareProjectTag(root, source.hash, { name: 'audio', color: '#654321', iconSvg: icon });
  await withIcon.publish();
  expect((await readProjectTags(root)).tags.find(tag => tag.name === 'audio')?.iconSvg).toBe(sanitizeTagSvg(icon));
  const removeIcon = await prepareProjectTag(root, (await readProjectTags(root)).hash, { name: 'audio', color: '#654321' });
  await removeIcon.publish();
  expect((await readProjectTags(root)).tags.find(tag => tag.name === 'audio')).toEqual({ name: 'audio', color: '#654321' });
  expect(await readFile(path.join(root, projectTagsPath), 'utf8')).toContain('# Keep tag comment\r\n  UI: { color: "#abcdef" }\r\n---\r\n# Notes\r\nKeep body **exactly**.\r\n');
});

it('changes tag color without replacing its stored SVG or recoloring explicit SVG fills', async () => {
  const root = await fixture();
  const fixedFillIcon = '<svg viewBox="0 0 24 24"><path fill="#123456" stroke="currentColor" d="M4 8L12 4L20 8L12 20Z"/></svg>';
  await (await prepareProjectTag(root, '', { name: 'Audio', color: '#aabbcc', iconSvg: fixedFillIcon })).publish();
  const before = await readProjectTags(root);
  const bytesBefore = await readFile(path.join(root, projectTagsPath), 'utf8');
  await (await prepareProjectTag(root, before.hash, { ...before.tags[0], color: '#ddeeff' })).publish();
  const after = await readProjectTags(root);
  expect(after.tags[0]).toEqual({ ...before.tags[0], color: '#ddeeff' });
  expect(after.tags[0].iconSvg).toBe(before.tags[0].iconSvg);
  expect(await readFile(path.join(root, projectTagsPath), 'utf8')).toBe(bytesBefore.replace('color: "#aabbcc"', 'color: "#ddeeff"'));
  const image = tagIconDataUrl(after.tags[0])!;
  const rendered = decodeURIComponent(image.slice(image.indexOf(',') + 1));
  expect(rendered).toContain('fill="#123456"');
  expect(rendered).toContain('stroke="#ddeeff"');
});

it('preserves hand-authored SVG bytes when only the tag color changes', async () => {
  const root = await fixture(); await mkdir(path.join(root, 'tasks'));
  const before = [
    '\uFEFF---', 'schema: 1', 'tags:', '  Audio:', '    color: "#aabbcc"',
    '    iconSvg: |- # Keep icon formatting',
    "      <svg viewBox='0 0 24 24'>",
    "        <circle cx='12' cy='12' r='7' fill='#123456' />",
    '      </svg>', '---', '# Notes', 'Keep body exactly.', '',
  ].join('\r\n');
  await writeFile(path.join(root, projectTagsPath), before);
  const source = await readProjectTags(root);
  await (await prepareProjectTag(root, source.hash, { ...source.tags[0], color: '#ddeeff' })).publish();
  expect(await readFile(path.join(root, projectTagsPath))).toEqual(Buffer.from(before.replace('"#aabbcc"', '"#ddeeff"')));
  expect((await readProjectTags(root)).tags[0]).toEqual({ ...source.tags[0], color: '#ddeeff' });
});

it('replaces an existing SVG without resetting the separately selected tag color', async () => {
  const root = await fixture();
  await (await prepareProjectTag(root, '', { name: 'Audio', color: '#cb6e32', iconSvg: icon })).publish();
  const before = await readProjectTags(root);
  const replacement = '<svg viewBox="0 0 24 24"><circle fill="#098765" cx="12" cy="12" r="7"/></svg>';
  await (await prepareProjectTag(root, before.hash, { ...before.tags[0], iconSvg: replacement })).publish();
  const after = await readProjectTags(root);
  expect(after.tags[0]).toEqual({ name: 'Audio', color: '#cb6e32', iconSvg: sanitizeTagSvg(replacement) });
  expect(after.tags[0].color).toBe(before.tags[0].color);
  expect(after.tags[0].iconSvg).not.toBe(before.tags[0].iconSvg);
});

it('detects stale revisions both at preflight and at publication without overwriting external bytes', async () => {
  const root = await fixture();
  const initial = await prepareProjectTag(root, '', { name: 'audio', color: '#123456' }); await initial.publish();
  const source = await readProjectTags(root);
  const plan = await prepareProjectTag(root, source.hash, { name: 'audio', color: '#654321' });
  const external = Buffer.concat([await readFile(path.join(root, projectTagsPath)), Buffer.from('\nExternal note.\n')]);
  await writeFile(path.join(root, projectTagsPath), external);
  await expect(plan.publish()).rejects.toThrow('PROJECT_TAGS_CONFLICT');
  await expect(prepareProjectTag(root, source.hash, { name: 'audio', color: '#654321' })).rejects.toThrow('PROJECT_TAGS_CONFLICT');
  expect(await readFile(path.join(root, projectTagsPath))).toEqual(external);
  expect((await readdir(path.join(root, 'tasks'))).sort()).toEqual(['deckmate-tags.md']);
});

it('refuses symlinked registry directories and unsafe persisted icons', async () => {
  const root = await fixture(); const outside = path.join(root, 'outside'); const project = path.join(root, 'project');
  await mkdir(outside); await mkdir(project);
  await symlink(outside, path.join(project, 'tasks'), process.platform === 'win32' ? 'junction' : 'dir');
  await expect(prepareProjectTag(project, '', { name: 'audio', color: '#123456' })).rejects.toThrow();
  expect(await readdir(outside)).toEqual([]);
  await mkdir(path.join(root, 'tasks'));
  await writeFile(path.join(root, projectTagsPath), '---\nschema: 1\ntags:\n  unsafe:\n    color: "#123456"\n    iconSvg: \'<svg onload="alert(1)"/>\'\n---\n');
  await expect(readProjectTags(root)).rejects.toThrow();
});

it('API enforces auth/sandbox, returns 409 on stale tag hashes, and preserves existing tag assignments', async () => {
  const root = await fixture();
  for (const directory of ['tasks', 'features', 'Tools']) await mkdir(path.join(root, directory));
  await writeFile(path.join(root, 'features/match.md'), '# Game\n## 1 — Parent\n### 1.1 Task (обсуждаем)\nKeep content.\n');
  await writeFile(path.join(root, 'tasks/iterations.md'), '## Итерация 1 — Test\n');
  await writeFile(path.join(root, 'Tools/board.py'), '# fixture\n');
  await writeFile(path.join(root, 'tasks/deckmate.md'), renderCatalogManifest(emptyManifest()));
  await (await prepareCardOptionsPatch(root, '', { [cardId]: { tags: ['old tag', 'Audio, UI'] } })).publish();
  const sourceBytes = await readFile(path.join(root, 'features/match.md'));
  const originalOptions = await readFile(path.join(root, 'tasks/deckmate-card-options.md'));
  await execute('git', ['init', '-b', 'deckmate/sandbox', root], { windowsHide: true });
  const app = await createApp({ editMode: 'sandbox', dataRoot: root, writeRoot: root, projectName: 'Test', port: 44371, python: 'python' }); apps.push(app);
  const host = { host: '127.0.0.1:44371' };
  const token = (await app.inject({ url: '/api/snapshot', headers: host })).json().token;
  const headers = { ...host, 'x-deckmate-token': token };
  let catalog = await readProjectCatalog(root);
  const payload = { action: 'save-project-tag', source: 'sandbox', manifestHash: catalog.manifestHash, tagsHash: '', tag: { name: 'Audio, UI', color: '#987654', iconSvg: icon } };
  expect((await app.inject({ method: 'POST', url: '/api/catalog', headers: host, payload })).statusCode).toBe(403);
  expect((await app.inject({ method: 'POST', url: '/api/catalog', headers, payload: { ...payload, source: 'live' } })).statusCode).toBe(403);
  // 2026-11-05: an unrelated manifest edit must not invalidate the independent tag registry revision.
  const manifest = path.join(root, 'tasks/deckmate.md');
  const changedManifest = (await readFile(manifest, 'utf8')) + '\nIndependent manifest change.\n';
  await writeFile(manifest, changedManifest);
  const saved = await app.inject({ method: 'POST', url: '/api/catalog', headers, payload });
  expect(saved.statusCode, saved.body).toBe(200);
  expect(await readFile(manifest, 'utf8')).toBe(changedManifest);
  catalog = saved.json<CatalogView>();
  expect(catalog.projectTags).toEqual([validateProjectTag(payload.tag)]);
  expect(catalog.tagsHash).toMatch(/^[0-9a-f]{64}$/u);
  expect(catalog.cards.some(card => card.path === projectTagsPath)).toBe(false);
  expect(await readFile(path.join(root, 'tasks/deckmate-card-options.md'))).toEqual(originalOptions);
  const bytes = await readFile(path.join(root, projectTagsPath));
  expect((await app.inject({ method: 'POST', url: '/api/catalog', headers, payload: { ...payload, tag: { name: 'Audio, UI', color: '#111111' } } })).statusCode).toBe(409);
  expect(await readFile(path.join(root, projectTagsPath))).toEqual(bytes);
  const invalid = await app.inject({ method: 'POST', url: '/api/catalog', headers, payload: { ...payload, tagsHash: catalog.tagsHash, tag: { ...payload.tag, iconSvg: '<svg><script/></svg>' } } });
  expect(invalid.statusCode).toBe(422);
  expect(await readFile(path.join(root, projectTagsPath))).toEqual(bytes);
  async function assign(mode: 'add' | 'remove', tag: string) {
    const result = await app.inject({ method: 'POST', url: '/api/catalog', headers, payload: { action: 'bulk-edit-cards', source: 'sandbox',
      manifestHash: catalog.manifestHash, optionsHash: catalog.optionsHash, cards: [{ cardId, sourceHash: catalog.cards.find(card => card.id === cardId)!.sourceHash }], change: { kind: 'tags', tags: [tag], mode } } });
    expect(result.statusCode, result.body).toBe(200); catalog = result.json<CatalogView>();
  }
  await assign('add', 'new tag');
  expect(catalog.cards.find(card => card.id === cardId)?.tags).toEqual(['old tag', 'Audio, UI', 'new tag']);
  await assign('remove', 'old tag');
  expect(catalog.cards.find(card => card.id === cardId)?.tags).toEqual(['Audio, UI', 'new tag']);
  expect(await readFile(path.join(root, 'features/match.md'))).toEqual(sourceBytes);
});
