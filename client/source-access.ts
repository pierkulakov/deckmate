// 2026-11-10: one implementation of the «page source and edit access» copy, shared by the shell and by
// panels (Members, Quick capture, CSV import, card editor). Consumers must not re-create these strings.
import { defineText, textNow } from './i18n.ts';
import type { WorkspaceSnapshot } from '../src/workspace-contracts.ts';

export const sourceText = defineText({
  testCopy: 'Test copy', original: 'Original', source: 'Page source', editable: 'Editable', readOnly: 'Read only',
  originalReadOnly: 'The original is open for reading only.', projectReadOnly: 'This project is open for reading only.',
  openTestCopy: 'Open test copy →',
}, {
  testCopy: 'Тестовая копия', original: 'Оригинал', source: 'Источник страницы', editable: 'Можно править', readOnly: 'Только чтение',
  originalReadOnly: 'Оригинал открыт только для чтения.', projectReadOnly: 'Проект открыт только для чтения.',
  openTestCopy: 'Открыть тестовую копию →',
});

type SourceLabels = (typeof sourceText)['en'];

/** All source labels in the current interface language; safe in render and in event handlers. */
export function currentSourceLabels(): SourceLabels {
  return textNow(sourceText);
}

interface ReadOnlyAccess {
  /** Localized explanation of why editing is unavailable; empty when the snapshot is writable. */
  description: string;
  /** Localized action that opens an existing writable copy; null when no such copy exists. */
  action: string | null;
}

/**
 * Read-only state of a snapshot. A sandbox project's live Original is readable but not writable and has the
 * existing test copy to switch to; a globally read-only project (--read-only, or any non-writable non-sandbox
 * snapshot) must only say that editing is unavailable — it has no test copy to offer.
 */
export function readOnlyAccess(snapshot: WorkspaceSnapshot): ReadOnlyAccess {
  const labels = currentSourceLabels();
  if (snapshot.writable) return { description: '', action: null };
  if (snapshot.editMode === 'sandbox') return { description: labels.originalReadOnly, action: labels.openTestCopy };
  return { description: labels.projectReadOnly, action: null };
}

/** Just the read-only sentence; prefer readOnlyAccess when the surface can also offer the test-copy action. */
export function readOnlyDescription(snapshot: WorkspaceSnapshot): string {
  return readOnlyAccess(snapshot).description;
}
