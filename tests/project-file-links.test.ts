import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { link, mkdir, readFile, rename, symlink, truncate, unlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseDocument, stringify } from 'yaml';
import { applyAttachmentEdit, attachmentKey, readCardAttachments } from '../server/attachments.ts';
import { checkedProjectFile, isProjectFilePath, launchProjectFile, projectFileOpenPolicy } from '../server/project-file-links.ts';
import { resolveSystemFileLauncher } from '../server/launch-process.ts';
import { tempProjects } from './helpers/temp-projects.ts';

const temps = tempProjects('deckmate-project-file-');
const cardId = 'card:ca1d0000-0000-4000-8000-000000000001';
const file = 'ArtSource/Props/Берёза [v2]/Birch & inspect.blend';
const attach = { action: 'attach-project-file' as const, cardId, manifestHash: '', file, attachmentsHash: '', addedBy: null };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhVEAAAAASUVORK5CYII=';

vi.mock('../server/launch-process.ts', () => ({ resolveSystemFileLauncher: vi.fn() }));
beforeEach(() => {
  vi.mocked(resolveSystemFileLauncher).mockReset().mockImplementation(async platform => {
    if (platform === 'win32') return 'C:\\Windows\\explorer.exe';
    if (platform === 'darwin') return '/usr/bin/open';
    return '/usr/bin/xdg-open';
  });
});
afterEach(async () => { await temps.removeAll(); });

async function fixture() {
  const root = await temps.create();
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), 'BLENDER');
  const registry = path.join(root, 'tasks/deckmate-assets/cards', attachmentKey(cardId), 'attachments.md');
  return { root, registry };
}

it('links arbitrary large and empty files without copying, refreshes size and detaches without deleting', async () => {
  const { root, registry } = await fixture();
  await truncate(path.join(root, file), 32 * 1024 * 1024);
  await applyAttachmentEdit(root, attach);
  let view = await readCardAttachments(root, cardId);
  expect(view.files).toEqual([]);
  expect(view.projectFiles).toEqual([expect.objectContaining({ kind: 'project-file', file, name: 'Birch & inspect.blend', bytes: 32 * 1024 * 1024 })]);
  const stored = parseDocument((await readFile(registry, 'utf8')).split('---')[1]).toJS();
  expect(stored.schema).toBe(1);
  expect(stored.files).toEqual([]);
  expect(stored.projectFiles[0].file).toBe(file);
  expect(stored.projectFiles[0]).not.toHaveProperty('canOpen');
  expect(stored.projectFiles[0]).not.toHaveProperty('openBlockedReason');
  await writeFile(path.join(root, file), 'rebuilt');
  view = await readCardAttachments(root, cardId);
  expect(view.projectFiles![0].bytes).toBe(7);
  const before = await readFile(registry);
  await expect(applyAttachmentEdit(root, attach)).rejects.toThrow('ATTACHMENTS_CONFLICT');
  await expect(applyAttachmentEdit(root, { ...attach, attachmentsHash: view.hash })).rejects.toThrow();
  expect(await readFile(registry)).toEqual(before);
  await applyAttachmentEdit(root, { action: 'detach-project-file', manifestHash: '', cardId, file, attachmentsHash: view.hash });
  expect((await readCardAttachments(root, cardId)).projectFiles).toBeUndefined();
  expect(await readFile(path.join(root, file), 'utf8')).toBe('rebuilt');
  await writeFile(path.join(root, 'empty.custom-extension'), '');
  await applyAttachmentEdit(root, { ...attach, file: 'empty.custom-extension', attachmentsHash: (await readCardAttachments(root, cardId)).hash });
  expect((await readCardAttachments(root, cardId)).projectFiles![0].bytes).toBe(0);
});

it.each(['../outside.blend', '/absolute.blend', '/select,file.blend', 'C:/outside.blend', 'ArtSource/../file.blend', 'a//b.blend', 'folder//select,file.blend', 'a\\b.blend', 'a:stream', '\\server\\file', './file', 'bad\u0000file'])('rejects unsafe path %j', async file => {
  const { root } = await fixture();
  const launcher = vi.fn().mockResolvedValue(undefined);
  expect(isProjectFilePath(file)).toBe(false);
  await expect(applyAttachmentEdit(root, { ...attach, file })).rejects.toThrow();
  for (const action of ['open', 'reveal'] as const) await expect(launchProjectFile(root, file, action, launcher)).rejects.toThrow();
  expect(launcher).not.toHaveBeenCalled();
});

it('refuses missing files and directories', async () => {
  const { root } = await fixture();
  for (const file of ['missing.blend', 'ArtSource']) {
    await expect(applyAttachmentEdit(root, { ...attach, file })).rejects.toThrow();
  }
});

it('refuses junctions even inside the project and rechecks replaced ancestors before launching', async () => {
  const { root } = await fixture();
  const launcher = vi.fn().mockResolvedValue(undefined);
  await symlink(path.join(root, 'ArtSource/Props'), path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await expect(checkedProjectFile(root, 'linked/Берёза [v2]/Birch & inspect.blend')).rejects.toThrow();
  await applyAttachmentEdit(root, attach);
  const realFile = path.join(root, file);
  await unlink(realFile);
  await symlink(path.join(root, 'ArtSource/Props'), realFile, process.platform === 'win32' ? 'junction' : 'dir');
  expect((await readCardAttachments(root, cardId)).projectFiles![0].missing).toBe(true);
  await expect(launchProjectFile(root, file, 'open', launcher)).rejects.toThrow();
  expect(launcher).not.toHaveBeenCalled();
  const view = await readCardAttachments(root, cardId);
  await applyAttachmentEdit(root, { action: 'detach-project-file', manifestHash: '', cardId, file, attachmentsHash: view.hash });
});

it('refuses a junction to an outside folder', async () => {
  const { root } = await fixture();
  const outside = await temps.create();
  await writeFile(path.join(outside, 'outside.blend'), 'BLENDER');
  await symlink(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await expect(applyAttachmentEdit(root, { ...attach, file: 'escape/outside.blend' })).rejects.toThrow();
});

it('rechecks ancestors replaced by an outside junction after attachment', async () => {
  const { root } = await fixture();
  await applyAttachmentEdit(root, attach);
  const outside = await temps.create();
  await mkdir(path.dirname(path.join(outside, file)), { recursive: true });
  await writeFile(path.join(outside, file), 'replacement');
  await rename(path.join(root, 'ArtSource'), path.join(root, 'Original'));
  await symlink(path.join(outside, 'ArtSource'), path.join(root, 'ArtSource'), process.platform === 'win32' ? 'junction' : 'dir');
  const launcher = vi.fn().mockResolvedValue(undefined);
  await expect(launchProjectFile(root, file, 'open', launcher)).rejects.toThrow();
  expect(launcher).not.toHaveBeenCalled();
  expect((await readCardAttachments(root, cardId)).projectFiles![0].missing).toBe(true);
});

it.skipIf(process.platform === 'win32')('refuses file symlinks inside and outside the project', async () => {
  const { root } = await fixture();
  const outside = await temps.create();
  await writeFile(path.join(outside, 'outside.blend'), 'BLENDER');
  await symlink(path.join(root, file), path.join(root, 'inside.blend'));
  await symlink(path.join(outside, 'outside.blend'), path.join(root, 'outside.blend'));
  for (const file of ['inside.blend', 'outside.blend']) await expect(checkedProjectFile(root, file)).rejects.toThrow();
});

it.each([
  ['win32', 'open', 'C:\\Windows\\explorer.exe'], ['win32', 'reveal', 'C:\\Windows\\explorer.exe'],
  ['darwin', 'open', '/usr/bin/open'], ['darwin', 'reveal', '/usr/bin/open'],
  ['linux', 'open', '/usr/bin/xdg-open'], ['linux', 'reveal', '/usr/bin/xdg-open'],
] as const)('launches %s/%s by absolute command with no shell despite a planted project shim', async (platform, action, command) => {
  const { root } = await fixture();
  const platformPath = platform === 'win32' ? path.win32 : path.posix;
  await writeFile(path.join(root, platformPath.basename(command)), 'planted');
  const launcher = vi.fn().mockResolvedValue(undefined);
  await launchProjectFile(root, file, action, launcher, platform);
  const absolute = path.join(root, file);
  let args = [absolute];
  if (platform === 'win32') args = [`"${absolute}"`];
  if (action === 'reveal') {
    if (platform === 'win32') args = [`/select,"${absolute}"`];
    if (platform === 'darwin') args = ['-R', absolute];
    if (platform === 'linux') args = [path.dirname(absolute)];
  }
  expect(launcher).toHaveBeenCalledExactlyOnceWith(command, args, { shell: false, windowsHide: true, stdio: 'ignore',
    cwd: platformPath.dirname(command),
    ...(platform === 'win32' ? { windowsVerbatimArguments: true } : {}) });
});

it.each('.txt .md .markdown .json .jsonc .csv .tsv .yaml .yml .toml .png .jpg .jpeg .webp .gif .pdf .blend .fbx .obj .gltf .glb .wav .mp3 .ogg .flac .mp4 .webm'.split(' '))(
  'allows only the last, case-insensitive extension %s', extension => {
    for (const suffix of [extension, extension.toUpperCase()]) {
      expect(projectFileOpenPolicy('source.exe' + suffix)).toEqual({ canOpen: true, openBlockedReason: null });
    }
  });

it.each(['win32', 'darwin', 'linux'] as const)('enforces default-deny open on %s while permitting reveal', async platform => {
  const { root } = await fixture();
  const launcher = vi.fn().mockResolvedValue(undefined);
  for (const relative of ['invoice.pdf.exe', 'setup.CmD', 'shortcut.lnk', 'run.command', 'run.desktop', 'run.sh',
    'payload.js', 'unknown.custom', 'no-extension', '.pdf', 'file.pdf.', 'folder.pdf/no-extension']) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), 'untrusted');
    expect(projectFileOpenPolicy(relative)).toEqual({ canOpen: false, openBlockedReason: 'UNSAFE_FILE_TYPE' });
    await expect(launchProjectFile(root, relative, 'open', launcher, platform)).rejects.toMatchObject({ code: 'UNSAFE_FILE_TYPE' });
    expect(launcher).not.toHaveBeenCalled();
    expect(resolveSystemFileLauncher).not.toHaveBeenCalled();
    await launchProjectFile(root, relative, 'reveal', launcher, platform);
    expect(launcher).toHaveBeenCalledTimes(1);
    launcher.mockClear();
    vi.mocked(resolveSystemFileLauncher).mockClear();
  }
  for (const relative of ['document.PdF', 'payload.exe.TxT', 'model.BlEnD']) {
    await writeFile(path.join(root, relative), 'document');
    await launchProjectFile(root, relative, 'open', launcher, platform);
  }
  expect(launcher).toHaveBeenCalledTimes(3);
});

it.each(['comma,only.blend', 'with spaces.blend', 'a&b.blend', 'Берёза.blend', '-R/--select.blend', 'folder/-file, & Ю.blend'])(
  'quotes the entire Windows open/reveal path %j for Explorer without a shell', async relative => {
    const { root } = await fixture();
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), 'BLENDER');
    const launcher = vi.fn().mockResolvedValue(undefined);
    for (const action of ['open', 'reveal'] as const) await launchProjectFile(root, relative, action, launcher, 'win32');
    const absolute = path.join(root, relative);
    expect(launcher.mock.calls.map(call => call[1])).toEqual([[`"${absolute}"`], [`/select,"${absolute}"`]]);
    for (const [command, , options] of launcher.mock.calls) {
      expect(path.win32.isAbsolute(command)).toBe(true);
      expect(options).toEqual({ shell: false, windowsHide: true, stdio: 'ignore', cwd: 'C:\\Windows', windowsVerbatimArguments: true });
    }
  });

it.each(['darwin', 'linux'] as const)('keeps option-like POSIX path segments literal on %s', async platform => {
  const { root } = await fixture();
  const relative = '-R/--help, & Ю.blend';
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), 'BLENDER');
  const launcher = vi.fn().mockResolvedValue(undefined);
  for (const action of ['open', 'reveal'] as const) await launchProjectFile(root, relative, action, launcher, platform);
  const absolute = path.join(root, relative);
  const reveal = platform === 'darwin' ? ['-R', absolute] : [path.dirname(absolute)];
  expect(launcher.mock.calls.map(call => call[1])).toEqual([[absolute], reveal]);
  expect(launcher.mock.calls.every(call => call[2].shell === false && !call[2].windowsVerbatimArguments)).toBe(true);
});

it('rejects outside hardlinks on attach and read/open/reveal after a previously safe attachment', async () => {
  const { root } = await fixture();
  const outside = await temps.create();
  const external = path.join(outside, 'outside.blend');
  await writeFile(external, 'outside');
  await link(external, path.join(root, 'linked.blend'));
  await expect(checkedProjectFile(root, 'linked.blend')).rejects.toThrow();
  await expect(applyAttachmentEdit(root, { ...attach, file: 'linked.blend' })).rejects.toThrow();
  await applyAttachmentEdit(root, attach);
  await unlink(path.join(root, file));
  await link(external, path.join(root, file));
  expect((await readCardAttachments(root, cardId)).projectFiles![0]).toMatchObject({ missing: true, canOpen: false, openBlockedReason: 'FILE_UNAVAILABLE' });
  const launcher = vi.fn().mockResolvedValue(undefined);
  for (const action of ['open', 'reveal'] as const) await expect(launchProjectFile(root, file, action, launcher)).rejects.toThrow();
  expect(launcher).not.toHaveBeenCalled();
});

it.each(['identity', 'size', 'mtime', 'hardlink', 'ancestor'] as const)(
  'rejects a %s change between initial verification and dispatch', async change => {
    for (const action of ['open', 'reveal'] as const) {
      const { root } = await fixture();
      const absolute = path.join(root, file);
      vi.mocked(resolveSystemFileLauncher).mockImplementationOnce(async () => {
        if (change === 'identity') {
          await rename(absolute, absolute + '.old');
          await writeFile(absolute, 'BLENDER');
        }
        if (change === 'size') await writeFile(absolute, 'longer replacement');
        if (change === 'mtime') await utimes(absolute, new Date('2020-01-01'), new Date('2020-01-01'));
        if (change === 'hardlink') await link(absolute, path.join(root, 'another.blend'));
        if (change === 'ancestor') {
          await rename(path.join(root, 'ArtSource'), path.join(root, 'Original'));
          await symlink(path.join(root, 'Original'), path.join(root, 'ArtSource'), process.platform === 'win32' ? 'junction' : 'dir');
        }
        return 'C:\\Windows\\explorer.exe';
      });
      const launcher = vi.fn().mockResolvedValue(undefined);
      await expect(launchProjectFile(root, file, action, launcher, 'win32')).rejects.toThrow();
      expect(launcher).not.toHaveBeenCalled();
    }
  });

it.each([false, true])('preserves BOM, CRLF, body and opaque metadata for links and legacy uploads (flow=%s)', async flow => {
  const { root, registry } = await fixture();
  await applyAttachmentEdit(root, { action: 'upload-attachment', manifestHash: '', cardId, attachmentsHash: '', dataUrl: png, fileName: 'old.png', addedBy: null });
  const old = (await readCardAttachments(root, cardId)).files;
  const data = { schema: 1, card: cardId, files: old, custom: { text: 'Не менять', value: 23.5 } };
  const yaml = stringify(data, { collectionStyle: flow ? 'flow' : 'block', lineWidth: 0 }).replace(/\n/gu, '\r\n');
  const before = Buffer.from('\uFEFF---\r\n' + yaml + '--- \t\r\n# Тело\r\nKeep bytes.\n');
  await writeFile(registry, before);
  await applyAttachmentEdit(root, { ...attach, attachmentsHash: (await readCardAttachments(root, cardId)).hash });
  const added = await readFile(registry);
  const addedLength = added.length - before.length;
  const at = flow ? before.indexOf(Buffer.from(' }\r\n---')) : before.indexOf(Buffer.from('--- \t'));
  expect(Buffer.concat([added.subarray(0, at), added.subarray(at + addedLength)])).toEqual(before);
  let view = await readCardAttachments(root, cardId);
  await applyAttachmentEdit(root, { action: 'upload-attachment', manifestHash: '', cardId, attachmentsHash: view.hash, dataUrl: png, fileName: 'new.png', addedBy: null });
  view = await readCardAttachments(root, cardId);
  expect(view.files).toHaveLength(2);
  expect(view.projectFiles![0].file).toBe(file);
  await applyAttachmentEdit(root, { action: 'detach-project-file', manifestHash: '', cardId, file, attachmentsHash: view.hash });
  const after = await readFile(registry, 'utf8');
  expect(after.startsWith('\uFEFF---\r\n')).toBe(true);
  expect(after.endsWith('--- \t\r\n# Тело\r\nKeep bytes.\n')).toBe(true);
  expect(after).toContain(flow ? '{ text: Не менять, value: 23.5 }' : 'custom:\r\n  text: Не менять\r\n  value: 23.5');
});

it('shows missing files without losing the stored path and permits detaching them', async () => {
  const { root } = await fixture();
  await applyAttachmentEdit(root, attach);
  await unlink(path.join(root, file));
  const view = await readCardAttachments(root, cardId);
  expect(view.projectFiles![0]).toMatchObject({ file, missing: true, canOpen: false, openBlockedReason: 'FILE_UNAVAILABLE' });
  expect(view.warnings).toHaveLength(1);
  await applyAttachmentEdit(root, { action: 'detach-project-file', manifestHash: '', cardId, attachmentsHash: view.hash, file });
  expect((await readCardAttachments(root, cardId)).warnings).toEqual([]);
});

it('appends project links to a flow map with a trailing comma and preserves later link comments', async () => {
  const { root, registry } = await fixture();
  await applyAttachmentEdit(root, attach);
  const view = await readCardAttachments(root, cardId);
  const first = { ...view.projectFiles![0], opaque: { keep: 23.5 } };
  const literal = stringify(first, { collectionStyle: 'flow', lineWidth: 0 }).trimEnd();
  const before = `\uFEFF---\r\n{schema: 1, card: '${cardId}', files: [], projectFiles: [${literal}, # keep\r\n], custom: 23.50, # end\r\n}\r\n---\r\nBody.\n`;
  await writeFile(registry, before);
  await writeFile(path.join(root, 'other.blend'), 'other');
  await applyAttachmentEdit(root, { ...attach, file: 'other.blend', attachmentsHash: (await readCardAttachments(root, cardId)).hash });
  expect((await readFile(registry, 'utf8'))).toContain(literal);
  expect((await readFile(registry, 'utf8'))).toContain('custom: 23.50, # end\r\n}');
  const current = await readCardAttachments(root, cardId);
  await applyAttachmentEdit(root, { action: 'detach-project-file', manifestHash: '', cardId, file: 'other.blend', attachmentsHash: current.hash });
  const without = await readFile(registry, 'utf8');
  expect(without).toContain('# keep\r\n');
  expect(without).toContain(literal);

  const noLinks = `---\n{schema: 1, card: '${cardId}', files: [], custom: 23.50, # last\n}\n---\nBody.\n`;
  await writeFile(registry, noLinks);
  await applyAttachmentEdit(root, { ...attach, attachmentsHash: (await readCardAttachments(root, cardId)).hash });
  expect((await readFile(registry, 'utf8'))).toContain(', # last\n}\n---\nBody.\n');
  expect((await readCardAttachments(root, cardId)).projectFiles).toHaveLength(1);
});

it('does not link a file that is already an upload of this card', async () => {
  const { root } = await fixture();
  await applyAttachmentEdit(root, { action: 'upload-attachment', manifestHash: '', cardId, attachmentsHash: '', dataUrl: png, fileName: 'old.png', addedBy: null });
  const view = await readCardAttachments(root, cardId);
  await expect(applyAttachmentEdit(root, { ...attach, file: view.files[0].file, attachmentsHash: view.hash })).rejects.toThrow();
  expect(await readCardAttachments(root, cardId)).toEqual(view);
});

it('limits uploads and project links together without rewriting a full registry', async () => {
  const { root, registry } = await fixture();
  await applyAttachmentEdit(root, attach);
  const entry = (await readCardAttachments(root, cardId)).projectFiles![0];
  const data = { schema: 1, card: cardId, files: [], projectFiles: Array.from({ length: 500 }, (_, index) => ({ ...entry, file: `${index}.blend` })) };
  const before = Buffer.from('---\n' + stringify(data) + '---\nKeep.\n');
  await writeFile(registry, before);
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update(before).digest('hex');
  await expect(applyAttachmentEdit(root, { ...attach, attachmentsHash: hash })).rejects.toThrow();
  await expect(applyAttachmentEdit(root, { action: 'upload-attachment', manifestHash: '', cardId, attachmentsHash: hash, dataUrl: png, fileName: 'new.png', addedBy: null })).rejects.toThrow();
  expect(await readFile(registry)).toEqual(before);
});
