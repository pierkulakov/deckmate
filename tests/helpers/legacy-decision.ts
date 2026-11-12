import { writeMarker, type FormatLanguage } from '../../src/format-vocabulary.ts';
import { shortReference } from '../../src/references.ts';

/** 2026-11-12: fixtures retain old links because saved answers must still complete their legacy child Tasks. */
export function legacyDecisionLink(cardId: string, language: FormatLanguage = 'en'): string {
  const label = writeMarker('decision', language).replace(/:$/u, '');
  return ` — [${label}](/r/${shortReference('c', cardId)})`;
}
