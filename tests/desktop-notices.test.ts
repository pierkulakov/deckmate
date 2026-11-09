import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  fallbackLicenseTexts,
  groupIdenticalNotices,
  noticesForCrate,
} = require('../desktop/scripts/desktop-notices.mjs') as {
  fallbackLicenseTexts: (expression: string) => Array<{ license: string; text: string; source: string }>;
  noticesForCrate: (
    crate: { name: string; version: string; license: string },
    files: Array<{ name: string; text: string }>,
  ) => Array<{
    crate: { name: string; version: string; license: string };
    source: string;
    text: string;
  }>;
  groupIdenticalNotices: (notices: ReturnType<typeof noticesForCrate>) => Array<{
    text: string;
    crates: Map<string, { name: string; version: string; license: string }>;
    sources: Set<string>;
  }>;
};

describe('desktop third-party notices', () => {
  it('groups byte-equivalent license texts across line endings and keeps every crate and source', () => {
    const alpha = noticesForCrate({ name: 'alpha', version: '1.0.0', license: 'MIT' }, [{ name: 'LICENSE', text: 'same text\n' }]);
    const beta = noticesForCrate({ name: 'beta', version: '2.0.0', license: 'MIT OR Apache-2.0' }, [{ name: 'LICENSE.txt', text: 'same text\r\n' }]);
    const other = noticesForCrate({ name: 'other', version: '3.0.0', license: 'ISC' }, [{ name: 'COPYING', text: 'different\n' }]);
    const groups = groupIdenticalNotices([...alpha, ...beta, ...other]);
    expect(groups).toHaveLength(2);
    const shared = groups.find(group => group.text === 'same text')!;
    expect([...shared.crates.values()]).toEqual([
      { name: 'alpha', version: '1.0.0', license: 'MIT' },
      { name: 'beta', version: '2.0.0', license: 'MIT OR Apache-2.0' },
    ]);
    expect([...shared.sources]).toEqual(['alpha 1.0.0: LICENSE', 'beta 2.0.0: LICENSE.txt']);
  });

  it('falls back to the full standard SPDX text when a crate ships no license file', () => {
    const [mit] = fallbackLicenseTexts('MIT');
    expect(mit.text).toContain('Permission is hereby granted, free of charge');
    expect(mit.text).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
    expect(mit.source).toContain('SPDX MIT standard text');
    expect(fallbackLicenseTexts('BSD-3-Clause')[0].text).toContain('Redistribution and use in source and binary forms');
    expect(fallbackLicenseTexts('MPL-2.0')[0].text).toContain('Mozilla Public License Version 2.0');
    expect(fallbackLicenseTexts('MPL-2.0')[0].text).toContain('Exhibit B - "Incompatible With Secondary Licenses" Notice');
  });

  it('uses a crate license file instead of a fallback and retains the SPDX expression', () => {
    const notices = noticesForCrate(
      { name: 'with-file', version: '1.2.3', license: 'MIT' },
      [{ name: 'LICENSE-MIT', text: 'upstream copyright and terms' }],
    );
    expect(notices).toHaveLength(1);
    expect(notices[0].crate.license).toBe('MIT');
    expect(notices[0].text).toBe('upstream copyright and terms');
    expect(notices[0].source).toBe('with-file 1.2.3: LICENSE-MIT');
  });

  it('fails closed for an unknown SPDX identifier or a missing expression', () => {
    expect(() => fallbackLicenseTexts('LicenseRef-Proprietary')).toThrow('No standard license text is known for SPDX identifier LicenseRef-Proprietary');
    expect(() => fallbackLicenseTexts('')).toThrow('must declare an SPDX license expression');
    expect(() => noticesForCrate({ name: 'unknown', version: '1.0.0', license: 'X-Unknown' }, []))
      .toThrow('No standard license text is known for SPDX identifier X-Unknown');
  });
});
