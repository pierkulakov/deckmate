import path from 'node:path';

let warnedLegacyEnvironment = false;
let warnedIgnoredLegacy = false;

/**
 * New names win, including explicit empty values; warn once per process (2026-11-05).
 * The two name sets never mix: once any DECKMATE_* variable is set, FREETION_* is ignored. A per-name fallback once paired
 * DECKMATE_DATA from the shell with FREETION_WRITE from an old .env.local, and a starter template meant for an empty test
 * folder was written into another project's sandbox (2026-11-05).
 */
export function environmentValue(suffix: string): string | undefined {
  const current = process.env['DECKMATE_' + suffix];
  if (current !== undefined) return current;
  const legacy = process.env['FREETION_' + suffix];
  if (legacy === undefined) return undefined;
  if (Object.keys(process.env).some(name => name.startsWith('DECKMATE_'))) {
    if (!warnedIgnoredLegacy) {
      console.warn('Deckmate: FREETION_* variables are ignored because DECKMATE_* variables are set; rename the old ones to DECKMATE_*.');
      warnedIgnoredLegacy = true;
    }
    return undefined;
  }
  if (!warnedLegacyEnvironment) {
    console.warn('Deckmate: legacy FREETION_* variables are in use; DECKMATE_* takes precedence.');
    warnedLegacyEnvironment = true;
  }
  return legacy;
}

/**
 * 2026-11-06: launchers write DECKMATE_DATA (and --port, --read-only) themselves, and any DECKMATE_* name switches the
 * legacy set off — a FREETION_DATA/FREETION_WRITE sandbox then silently became direct edits of the live project. So before
 * a launcher writes, a legacy set with no DECKMATE_* name beside it moves to the new names as a whole. An explicit --data
 * for another folder never inherits the old sandbox: that folder opens as the person named it.
 */
export function adoptLegacyEnvironment(explicitData?: string): void {
  const names = Object.keys(process.env);
  if (names.some(name => name.startsWith('DECKMATE_'))) return;
  const legacy = names.filter(name => name.startsWith('FREETION_'));
  if (!legacy.length) return;
  if (explicitData !== undefined) {
    const legacyData = process.env.FREETION_DATA;
    const same = (left: string, right: string) => process.platform === 'win32'
      ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase() : path.resolve(left) === path.resolve(right);
    if (!legacyData || !same(explicitData, legacyData)) return;
  }
  for (const name of legacy) process.env['DECKMATE_' + name.slice('FREETION_'.length)] = process.env[name];
  if (!warnedLegacyEnvironment) {
    console.warn('Deckmate: legacy FREETION_* variables are in use; DECKMATE_* takes precedence.');
    warnedLegacyEnvironment = true;
  }
}
