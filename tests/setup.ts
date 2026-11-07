import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';

// 2026-11-06: Windows runners expose an 8.3 temp alias; fixtures and cleanup must share the canonical path used by loadConfig.
if (process.platform === 'win32') {
  const workingDirectory = process.cwd();
  const canonicalDirectory = realpathSync.native(workingDirectory);
  // 2026-11-07: Vitest fixes its root before setup, so chdir here cannot repair mock/import identity.
  if (/^[a-z]:/i.test(workingDirectory)
    && workingDirectory[0] !== canonicalDirectory[0]
    && workingDirectory.slice(1) === canonicalDirectory.slice(1)) {
    throw new Error(`Run tests from a cwd with an uppercase drive letter (${canonicalDirectory}): vitest registers vi.mock under the cwd spelling`);
  }
  const temporaryRoot = realpathSync.native(tmpdir());
  process.env.TMP = temporaryRoot;
  process.env.TEMP = temporaryRoot;
}
