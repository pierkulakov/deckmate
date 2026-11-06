import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';

// 2026-11-06: Windows runners expose an 8.3 temp alias; fixtures and cleanup must share the canonical path used by loadConfig.
if (process.platform === 'win32') {
  const temporaryRoot = realpathSync.native(tmpdir());
  process.env.TMP = temporaryRoot;
  process.env.TEMP = temporaryRoot;
}
