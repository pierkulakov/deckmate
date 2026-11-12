import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Temporary project folders for one test file (2026-11-12): every folder is created under the system temp directory
 * with the file's own prefix, and cleanup removes one only after resolving it back inside that directory, so a
 * replaced or misplaced path never deletes anything else.
 */
export function tempProjects(prefix: string) {
  const directories: string[] = [];
  return {
    async create(): Promise<string> {
      const directory = await mkdtemp(path.join(tmpdir(), prefix));
      directories.push(directory);
      return directory;
    },
    async removeAll(): Promise<void> {
      for (const directory of directories.splice(0)) {
        const relative = path.relative(path.resolve(tmpdir()), await realpath(directory));
        if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
          || !path.basename(directory).startsWith(prefix)) {
          throw new Error(`Unsafe cleanup target: ${directory}`);
        }
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
