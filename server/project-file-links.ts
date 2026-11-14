import path from 'node:path';
import { spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { checkDirectories, checkGuardedFile, guardedDirectory, sameIdentity } from './guarded-files.ts';
import { defineText, serverText } from './i18n.ts';
import { resolveSystemFileLauncher } from './launch-process.ts';

const text = defineText({
  invalidPath: 'Use a project-relative file path with forward slashes, without links or traversal segments.',
  invalidRoot: 'The project root is invalid or has been replaced.',
  unsafePath: 'The project file or path changed, or a symbolic link or hardlink was found.',
  invalidFile: 'Project file not found or not a regular file.',
  unsafeFileType: 'Opening this file type is blocked; use Show in folder instead.',
}, {
  invalidPath: 'Укажите путь файла от корня проекта с прямыми слешами, без ссылок и переходов между каталогами.',
  invalidRoot: 'Корень проекта некорректен или был подменён.',
  unsafePath: 'Файл проекта или его путь изменился, либо обнаружена символическая или жёсткая ссылка.',
  invalidFile: 'Файл проекта не найден или не является обычным файлом.',
  unsafeFileType: 'Открытие этого типа заблокировано; доступно «Показать в папке».',
});

const openExtensions = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonc', '.csv', '.tsv', '.yaml', '.yml', '.toml',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf', '.blend', '.fbx', '.obj', '.gltf', '.glb',
  '.wav', '.mp3', '.ogg', '.flac', '.mp4', '.webm',
]);

export function projectFileOpenPolicy(relative: string): { canOpen: boolean; openBlockedReason: 'UNSAFE_FILE_TYPE' | null } {
  const canOpen = openExtensions.has(path.posix.extname(relative).toLowerCase());
  return { canOpen, openBlockedReason: canOpen ? null : 'UNSAFE_FILE_TYPE' };
}

export class UnsafeProjectFileTypeError extends Error {
  readonly code = 'UNSAFE_FILE_TYPE';
  constructor() { super(serverText(text).unsafeFileType); }
}

export function isProjectFilePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 1000
    && !/[\u0000-\u001f\u007f\\:]/u.test(value) && !path.posix.isAbsolute(value)
    && value.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

/** Every ancestor and the final file are checked again for each local launch (2026-11-14). */
export async function checkedProjectFile(root: string, relative: string) {
  if (!isProjectFilePath(relative)) throw new Error(serverText(text).invalidPath);
  const guard = await guardedDirectory(root, path.posix.dirname(relative), {
    create: false, missing: 'throw', rootReference: 'absolute',
    messages: () => ({ invalidRoot: serverText(text).invalidRoot,
      pathChanged: serverText(text).unsafePath, directoryLink: serverText(text).unsafePath }),
  });
  if (!guard) throw new Error(serverText(text).invalidFile);
  const filename = path.join(guard.root, relative);
  const stat = await checkGuardedFile(guard, filename, { invalidFile: () => serverText(text).invalidFile });
  if (stat.nlink !== 1n) throw new Error(serverText(text).unsafePath);
  return { filename, bytes: Number(stat.size), stat, guard };
}

export type ProjectFileAction = 'open' | 'reveal';
export type FileLauncher = (command: string, args: string[], options: {
  shell: false; windowsHide: true; stdio: 'ignore'; cwd: string; windowsVerbatimArguments?: true;
}) => Promise<void>;

const launch: FileLauncher = (command, args, options) => new Promise((resolve, reject) => {
  const child = spawn(command, args, options);
  child.once('error', reject);
  child.once('spawn', () => { child.unref(); resolve(); });
});

export async function launchProjectFile(root: string, relative: string, action: ProjectFileAction,
  launcher: FileLauncher = launch, platform: NodeJS.Platform = process.platform): Promise<void> {
  const { filename, stat, guard } = await checkedProjectFile(root, relative);
  if (action === 'open' && !projectFileOpenPolicy(relative).canOpen) throw new UnsafeProjectFileTypeError();
  const command = await resolveSystemFileLauncher(platform);
  let args: string[];
  if (platform === 'win32') {
    args = [action === 'reveal' ? `/select,"${filename}"` : `"${filename}"`];
  } else if (platform === 'darwin') {
    args = action === 'reveal' ? ['-R', filename] : [filename];
  } else {
    args = [action === 'reveal' ? path.dirname(filename) : filename];
  }
  const options: Parameters<FileLauncher>[2] = { shell: false, windowsHide: true, stdio: 'ignore',
    cwd: (platform === 'win32' ? path.win32 : path.posix).dirname(command),
    ...(platform === 'win32' ? { windowsVerbatimArguments: true } : {}) };
  await checkDirectories(guard);
  const current = await lstat(filename, { bigint: true });
  if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1n || !sameIdentity(stat, current)
    || stat.size !== current.size || stat.mtimeNs !== current.mtimeNs) throw new Error(serverText(text).unsafePath);
  // 2026-11-14: launchers reopen the pathname; replacement after this check still needs a handle-based OS broker to prevent.
  await launcher(command, args, options);
}
