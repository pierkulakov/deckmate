import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// The manifest builder ships as plain .mjs for node in CI, outside the TypeScript project, so tests
// load it with require exactly the way node would.
const require = createRequire(import.meta.url);

type ManifestModule = {
  verifyUpdaterSignature: (options: {
    installer: Buffer;
    signature: string;
    publicKey: string;
    version: string;
  }) => true;
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
    notes_ru: string;
    pub_date: string;
    platforms: Record<string, { url: string; signature: string }>;
  };
};

const { buildUpdaterManifest, verifyUpdaterSignature } = require('../desktop/scripts/updater-manifest.mjs') as ManifestModule;
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

const RAW_SIGNATURE = 'untrusted comment: signature from tauri secret key\nRWQf0p+fakebase64signaturefortests==\ntrusted comment: timestamp: 1762684800\tfile:Deckmate_0.6.0_x64-setup.exe\tversion:0.6.0\nfaketrustedbase64==\n';
const SIGNATURE = Buffer.from(RAW_SIGNATURE, 'utf8').toString('base64');
const INSTALLER_URL = 'https://github.com/pierkulakov/deckmate/releases/download/v0.6.0/Deckmate.Setup.0.6.0.exe';
const NOW = new Date('2026-11-09T12:00:00.000Z');
const PUBLIC_FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/updater-public.json', import.meta.url), 'utf8')) as {
  payloadBase64: string;
  publicKeyFile: string;
  otherPublicKeyFile: string;
  signature: string;
};

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

describe('verifyUpdaterSignature', () => {
  const installer = Buffer.from(PUBLIC_FIXTURE.payloadBase64, 'base64');
  const publicKey = Buffer.from(PUBLIC_FIXTURE.publicKeyFile, 'utf8').toString('base64');
  const valid = { installer, publicKey, signature: PUBLIC_FIXTURE.signature, version: '2.0.0' };

  it('accepts a valid Tauri minisign signature and signed version', () => {
    expect(verifyUpdaterSignature(valid)).toBe(true);
    expect(verifyUpdaterSignature({ ...valid, version: 'v2.0.0' })).toBe(true);
  });

  it('accepts the base64 .sig form that the Tauri signer writes and latest.json carries', () => {
    const sigFile = `${Buffer.from(`${PUBLIC_FIXTURE.signature}
`, 'utf8').toString('base64')}
`;
    expect(verifyUpdaterSignature({ ...valid, signature: sigFile })).toBe(true);
    expect(() => verifyUpdaterSignature({ ...valid, signature: 'not a signature' })).toThrow('not valid base64');
  });

  it('rejects a signature made by another key', () => {
    const otherPublicKey = Buffer.from(PUBLIC_FIXTURE.otherPublicKeyFile, 'utf8').toString('base64');
    expect(() => verifyUpdaterSignature({ ...valid, publicKey: otherPublicKey })).toThrow('different key id');
  });

  it('rejects corrupted installer bytes', () => {
    expect(() => verifyUpdaterSignature({ ...valid, installer: Buffer.from('Test') }))
      .toThrow('artifact signature verification failed');
  });

  it('rejects a signature whose trusted comment names another version', () => {
    expect(() => verifyUpdaterSignature({ ...valid, version: '2.0.1' }))
      .toThrow('signature is for version 2.0.0, not 2.0.1');
  });

  it('rejects a changed trusted comment through its global signature', () => {
    const signature = PUBLIC_FIXTURE.signature.replace('version:2.0.0', 'version:9.9.9');
    expect(() => verifyUpdaterSignature({ ...valid, signature, version: '9.9.9' }))
      .toThrow('trusted-comment signature verification failed');
  });
});

describe('buildUpdaterManifest', () => {
  const base = { version: '0.6.0', url: INSTALLER_URL, signature: SIGNATURE, now: NOW, changelogRu: CHANGELOG_RU };

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

  it('includes the required Russian release notes', () => {
    const manifest = buildUpdaterManifest({ ...base, changelog: CHANGELOG_EN, changelogRu: CHANGELOG_RU });
    expect(manifest.notes_ru).toBe(extractReleaseNotes(CHANGELOG_RU, '0.6.0', 'CHANGELOG.ru.md'));
  });

  it('rejects a missing Russian changelog or section', () => {
    expect(() => buildUpdaterManifest({ ...base, changelog: CHANGELOG_EN, changelogRu: undefined })).toThrow('CHANGELOG.ru.md is required');
    const staleRu = '# Changelog\n\n## [0.5.0] - 2026-11-08\n\n### Добавлено\n\n- Старый релиз.\n';
    expect(() => buildUpdaterManifest({ ...base, changelog: CHANGELOG_EN, changelogRu: staleRu }))
      .toThrow('CHANGELOG.ru.md needs a dated [0.6.0] release section');
  });

  it('rejects raw SignatureBox input instead of sending undecodable bytes to the plugin', () => {
    expect(() => buildUpdaterManifest({ ...base, signature: RAW_SIGNATURE, changelog: CHANGELOG_EN }))
      .toThrow('not valid base64');
  });

  it('emits only canonical base64, trimming the .sig file newline', () => {
    const manifest = buildUpdaterManifest({ ...base, signature: `${SIGNATURE}\n`, changelog: CHANGELOG_EN });
    expect(manifest.platforms['windows-x86_64'].signature).toBe(SIGNATURE);
    expect(Buffer.from(manifest.platforms['windows-x86_64'].signature, 'base64').toString('utf8')).toBe(RAW_SIGNATURE);
  });

  it('requires a valid deterministic publication date', () => {
    expect(() => buildUpdaterManifest({ ...base, now: undefined, changelog: CHANGELOG_EN })).toThrow('valid commit date');
    expect(() => buildUpdaterManifest({ ...base, now: new Date('invalid'), changelog: CHANGELOG_EN })).toThrow('valid commit date');
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

describe('updater-manifest CLI', () => {
  const folders: string[] = [];
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });

  function fixture(signature = Buffer.from(PUBLIC_FIXTURE.signature, 'utf8').toString('base64')) {
    const tempBase = existsSync(path.join(tmpdir(), 'opencode')) ? path.join(tmpdir(), 'opencode') : tmpdir();
    const directory = mkdtempSync(path.join(tempBase, 'updater-manifest-'));
    folders.push(directory);
    writeFileSync(path.join(directory, 'installer.exe'), Buffer.from(PUBLIC_FIXTURE.payloadBase64, 'base64'));
    writeFileSync(path.join(directory, 'installer.exe.sig'), signature);
    writeFileSync(path.join(directory, 'config.json'), JSON.stringify({ plugins: { updater: {
      pubkey: Buffer.from(PUBLIC_FIXTURE.publicKeyFile, 'utf8').toString('base64'),
    } } }));
    writeFileSync(path.join(directory, 'en.md'), CHANGELOG_EN.replaceAll('0.6.0', '2.0.0'));
    writeFileSync(path.join(directory, 'ru.md'), CHANGELOG_RU.replaceAll('0.6.0', '2.0.0'));
    const output = path.join(directory, 'latest.json');
    const run = () => spawnSync(process.execPath, ['desktop/scripts/updater-manifest.mjs', '--version', '2.0.0',
      '--url', INSTALLER_URL, '--installer', path.join(directory, 'installer.exe'),
      '--signature-file', path.join(directory, 'installer.exe.sig'), '--config', path.join(directory, 'config.json'),
      '--changelog', path.join(directory, 'en.md'), '--changelog-ru', path.join(directory, 'ru.md'),
      '--pub-date', NOW.toISOString(), '--out', output], { encoding: 'utf8' });
    return { run, output, directory };
  }

  it('verifies a real signature and preserves exactly the same bytes on a retry', () => {
    const { run, output } = fixture();
    expect(run().status).toBe(0);
    const bytes = readFileSync(output);
    expect(run().status).toBe(0);
    expect(readFileSync(output).equals(bytes)).toBe(true);
    expect(JSON.parse(bytes.toString()).pub_date).toBe(NOW.toISOString());
  });

  it('fails closed on a valid raw signature without overwriting an existing manifest', () => {
    const { run, output } = fixture(PUBLIC_FIXTURE.signature);
    writeFileSync(output, 'existing manifest');
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not valid base64');
    expect(readFileSync(output, 'utf8')).toBe('existing manifest');
  });

  it('does not write a manifest without Russian notes', () => {
    const { run, output, directory } = fixture();
    rmSync(path.join(directory, 'ru.md'));
    expect(run().status).toBe(1);
    expect(existsSync(output)).toBe(false);
  });
});
