import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The shell drives updates from Rust, and plugin commands without an updater:* permission are
// rejected, so no capability may grant one (plan, section 3).
const capabilitiesDir = new URL('../desktop/src-tauri/capabilities/', import.meta.url);

describe('desktop capabilities', () => {
  const files = readdirSync(capabilitiesDir).filter((name) => name.endsWith('.json'));

  it('discovers the capability files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s grants no updater permissions', (file) => {
    const capability = JSON.parse(readFileSync(new URL(file, capabilitiesDir), 'utf8')) as {
      permissions?: unknown[];
    };
    for (const permission of capability.permissions ?? []) {
      const identifier = typeof permission === 'string'
        ? permission
        : (permission as { identifier?: unknown })?.identifier;
      if (typeof identifier !== 'string') throw new Error(`${file} has a permission without a string identifier.`);
      expect(identifier.startsWith('updater:')).toBe(false);
    }
  });
});
