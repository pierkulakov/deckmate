import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// The manifest builder ships as plain .mjs for node in CI, outside the TypeScript project, so tests
// load it with require exactly the way node would.
const require = createRequire(import.meta.url);

type ManifestModule = {
  buildUpdaterManifest: (options: {
    version: string;
    url: string;
    signature: string;
    changelog: string;
    changelogRu?: string | null;
    now?: Date;
  }) => {
    version: string;
    notes: string;
    notes_ru?: string;
    pub_date: string;
    platforms: Record<string, { url: string; signature: string }>;
  };
};

const { buildUpdaterManifest } = require('../desktop/scripts/updater-manifest.mjs') as ManifestModule;
const { extractReleaseNotes } = require('../desktop/scripts/release-notes.mjs') as {
  extractReleaseNotes: (changelog: string, version: string, file?: string) => string;
};

const CHANGELOG_EN = `# Changelog

## [Unreleased]

## [0.6.0] - 2026-11-09

### Added

- **Spaces.** Reorder spaces with Move up and Move down.

### Fixed

- The board no longer flashes on launch.

## [0.5.0] - 2026-11-08

### Added

- Older release.
`;

const CHANGELOG_RU = `# Changelog

## [Unreleased]

## [0.6.0] - 2026-11-09

### Добавлено

- **Пространства.** Изменение порядка пространств.

## [0.5.0] - 2026-11-08

### Добавлено

- Старый релиз.
`;

const SIGNATURE = 'untrusted comment: signature from tauri secret key\nRWQf0p+fakebase64signaturefortests==\ntrusted comment: timestamp: 1762684800\tfile:Deckmate_0.6.0_x64-setup.exe\tversion:0.6.0\nfaketrustedbase64==\n';
const INSTALLER_URL = 'https://github.com/pierkulakov/deckmate/releases/download/v0.6.0/Deckmate.Setup.0.6.0.exe';
const NOW = new Date('2026-11-09T12:00:00.000Z');

describe('extractReleaseNotes', () => {
  it('returns the section body up to the next version heading', () => {
    const notes = extractReleaseNotes(CHANGELOG_EN, '0.6.0');
    expect(notes).toContain('**Spaces.**');
    expect(notes).toContain('The board no longer flashes on launch.');
    expect(notes).not.toContain('Older release');
    expect(notes.startsWith('### Added')).toBe(true);
  });

  it('extracts a Russian section the same way', () => {
    const notes = extractReleaseNotes(CHANGELOG_RU, '0.6.0', 'CHANGELOG.ru.md');
    expect(notes).toContain('**Пространства.**');
    expect(notes).not.toContain('Старый релиз');
  });

  it('throws a clear error when the section is missing', () => {
    expect(() => extractReleaseNotes(CHANGELOG_EN, '0.6.1')).toThrow('CHANGELOG.md needs a dated [0.6.1] release section.');
  });

  it('throws when the section has no notes', () => {
    const changelog = '## [0.6.0] - 2026-11-09\n\n## [0.5.0] - 2026-11-08\n\n- Old.\n';
    expect(() => extractReleaseNotes(changelog, '0.6.0')).toThrow('must not be empty');
  });
});

describe('buildUpdaterManifest', () => {
  const base = { version: '0.6.0', url: INSTALLER_URL, signature: SIGNATURE, now: NOW };

  it('lists both Windows platform keys with the url and signature', () => {
    const manifest = buildUpdaterManifest({ ...base, changelog: CHANGELOG_EN });
    expect(Object.keys(manifest.platforms).sort()).toEqual(['windows-x86_64', 'windows-x86_64-nsis']);
    for (const platform of Object.values(manifest.platforms)) {
      expect(platform.url).toBe(INSTALLER_URL);
      expect(platform.signature).toBe(SIGNATURE);
    }
  });

  it('carries the version, English notes, and an RFC 3339 pub_date', () => {
    const manifest = buildUpdaterManifest({ ...base, changelog: CHANGELOG_EN });
    expect(manifest.version).toBe('0.6.0');
    expect(manifest.notes).toBe(extractReleaseNotes(CHANGELOG_EN, '0.6.0'));
    expect(manifest.pub_date).toBe('2026-11-09T12:00:00.000Z');
  });

  it('adds notes_ru when the Russian changelog has the section', () => {
    const manifest = buildUpdaterManifest({ ...base, changelog: CHANGELOG_EN, changelogRu: CHANGELOG_RU });
    expect(manifest.notes_ru).toBe(extractReleaseNotes(CHANGELOG_RU, '0.6.0', 'CHANGELOG.ru.md'));
  });

  it('omits notes_ru without a Russian changelog or section', () => {
    expect(buildUpdaterManifest({ ...base, changelog: CHANGELOG_EN }).notes_ru).toBeUndefined();
    const staleRu = '# Changelog\n\n## [0.5.0] - 2026-11-08\n\n### Добавлено\n\n- Старый релиз.\n';
    const manifest = buildUpdaterManifest({ ...base, changelog: CHANGELOG_EN, changelogRu: staleRu });
    expect(manifest.notes_ru).toBeUndefined();
  });

  it('rejects an empty signature', () => {
    expect(() => buildUpdaterManifest({ ...base, signature: '   ', changelog: CHANGELOG_EN }))
      .toThrow('The updater signature is empty');
  });

  it('rejects a missing changelog section', () => {
    expect(() => buildUpdaterManifest({ ...base, changelog: CHANGELOG_EN, version: '0.6.1' }))
      .toThrow('CHANGELOG.md needs a dated [0.6.1] release section.');
  });
});
