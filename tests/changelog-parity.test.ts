import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// 2026-11-09: the desktop app shows "What's new" from CHANGELOG.md, or CHANGELOG.ru.md in the Russian
// interface. A release section added to only one file would go missing in the other language, so both
// files are checked for the same version headings and the same per-version structure.
const root = path.resolve(import.meta.dirname, '..');

interface VersionStructure {
  heading: string;
  /** Bullet count of each `###` subsection, in order; the length is the subsection count. */
  subsectionBullets: number[];
}

function changelogStructure(name: string): VersionStructure[] {
  const versions: VersionStructure[] = [];
  let version: VersionStructure | null = null;
  for (const line of readFileSync(path.join(root, name), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('## [')) {
      version = { heading: line, subsectionBullets: [] };
      versions.push(version);
    } else if (version && line.startsWith('### ')) {
      version.subsectionBullets.push(0);
    } else if (version && line.startsWith('- ') && version.subsectionBullets.length > 0) {
      const last = version.subsectionBullets.length - 1;
      version.subsectionBullets[last] = (version.subsectionBullets[last] ?? 0) + 1;
    }
  }
  return versions;
}

describe('changelog parity', () => {
  const english = changelogStructure('CHANGELOG.md');
  const russian = changelogStructure('CHANGELOG.ru.md');

  it('lists the same version headings in the same order', () => {
    expect(russian.map(version => version.heading)).toEqual(english.map(version => version.heading));
  });

  it('gives every version the same number of subsections and bullets', () => {
    expect(english.length, 'versions listed').toBeGreaterThan(0);
    expect(russian.length, 'versions listed').toBe(english.length);
    for (const [index, version] of english.entries()) {
      expect(russian[index]!.subsectionBullets, `${version.heading} subsection bullet counts`)
        .toEqual(version.subsectionBullets);
    }
  });
});
