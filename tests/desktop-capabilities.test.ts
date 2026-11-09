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

  it('grants the remote board exactly its seven narrow commands', () => {
    const board = JSON.parse(readFileSync(new URL('board.json', capabilitiesDir), 'utf8'));
    expect(board.local).toBe(false);
    expect(board.remote.urls).toEqual(['http://127.0.0.1:*']);
    expect(board.windows).toEqual(['main']);
    expect(board.permissions.slice().sort()).toEqual([
      'allow-board-recent-projects', 'allow-board-workspace-projects',
      'allow-board-add-to-workspace', 'allow-board-remove-from-workspace',
      'allow-board-move-in-workspace', 'allow-board-switch-project', 'allow-board-show-start-screen',
    ].sort());
  });

  it('keeps workspace launcher commands local', () => {
    const launcher = JSON.parse(readFileSync(new URL('launcher.json', capabilitiesDir), 'utf8'));
    expect(launcher.local).toBe(true);
    expect(launcher.remote).toBeUndefined();
    for (const command of ['add-to-workspace', 'remove-from-workspace', 'move-in-workspace']) {
      expect(launcher.permissions).toContain(`allow-desktop-${command}`);
    }
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
