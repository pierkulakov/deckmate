import { expect } from 'vitest';
import { parseManifestBytes, type CatalogManifest } from '../server/catalog.ts';

/** 2026-11-04: Manual Order may change; every other fixture byte, including BOM/EOL, must survive. */
export function expectOnlyDeckOrderChanged(before: Buffer, after: Buffer, expected: CatalogManifest['deckOrder']): void {
  expect(parseManifestBytes(after).manifest.deckOrder).toEqual(expected);
  // These fixtures store deckOrder as a single YAML flow line, leaving the rest directly comparable.
  const withoutOrder = (bytes: Buffer): string => bytes.toString('utf8').replace(/^deckOrder:[^\r\n]*(?:\r\n|\n)/gmu, '');
  expect(withoutOrder(after)).toBe(withoutOrder(before));
}
