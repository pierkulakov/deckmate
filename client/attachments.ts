import { readStoredValue } from './storage.ts';
import type { CardAttachment, CardAttachments, CatalogView } from '../src/catalog-contracts.ts';
import type { DataSource } from '../src/workspace-contracts.ts';
import { defineText, locale, textNow } from './i18n.ts';

const text = defineText({
  loadFailed: 'Could not load card attachments.',
  invalidType: (name: string) => `“${name}”: use PNG, JPEG, WebP, GIF or PDF.`,
  empty: (name: string) => `“${name}”: the file is empty.`,
  tooLarge: (name: string) => `“${name}”: the file is larger than 10 MB.`,
  readFailed: (name: string) => `“${name}”: could not read the file.`,
  bytes: 'B',
  kilobytes: 'KB',
  megabytes: 'MB',
}, {
  loadFailed: 'Не удалось загрузить вложения карточки.',
  invalidType: (name: string) => `«${name}»: нужен PNG, JPEG, WebP, GIF или PDF.`,
  empty: (name: string) => `«${name}»: файл пустой.`,
  tooLarge: (name: string) => `«${name}»: файл больше 10 МБ.`,
  readFailed: (name: string) => `«${name}»: не удалось прочитать файл.`,
  bytes: 'Б',
  kilobytes: 'КБ',
  megabytes: 'МБ',
});

// Attachment requests use /api/attachments and /api/file; the chosen sort order applies to all cards.

// Keep the 10 MB file limit in sync with server validation.
export const attachmentMaximumBytes = 10 * 1024 * 1024;
export const attachmentAcceptedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];
const sortOrderStorageKey = 'deckmate.attachments.sort';

export type AttachmentSortOrder = 'newest' | 'oldest';
export type AttachmentTypeFilter = 'all' | 'image' | 'pdf';

/** The panel gets its source from the URL updated on navigation; the default is sandbox. */
export function attachmentSource(): DataSource {
  return new URLSearchParams(location.search).get('catalogSource') === 'live' ? 'live' : 'sandbox';
}

export async function fetchCardAttachments(source: DataSource, cardId: string): Promise<CardAttachments> {
  const response = await fetch(`/api/attachments?source=${source}&cardId=${encodeURIComponent(cardId)}`, { cache: 'no-store' });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = result && typeof result === 'object' && 'message' in result ? String((result as { message: unknown }).message) : '';
    throw new Error(message || textNow(text).loadFailed);
  }
  return result as CardAttachments;
}

export function attachmentFileUrl(source: DataSource, file: string): string {
  return `/api/file?source=${source}&path=${encodeURIComponent(file)}`;
}
export function validateAttachmentFile(file: File): string | null {
  const t = textNow(text);
  if (!attachmentAcceptedTypes.includes(file.type)) return t.invalidType(file.name);
  if (file.size === 0) return t.empty(file.name);
  if (file.size > attachmentMaximumBytes) return t.tooLarge(file.name);
  return null;
}

export function readAttachmentAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(textNow(text).readFailed(file.name)));
    reader.readAsDataURL(file);
  });
}

/** One saved list order applies to every card. */
export function readAttachmentSortOrder(): AttachmentSortOrder {
  try { return readStoredValue(localStorage, sortOrderStorageKey) === 'oldest' ? 'oldest' : 'newest'; }
  catch { return 'newest'; }
}

export function writeAttachmentSortOrder(order: AttachmentSortOrder): void {
  try { localStorage.setItem(sortOrderStorageKey, order); } catch { /* Private browsing may prevent saving the order. */ }
}

export function sortAttachmentFiles(files: CardAttachment[], order: AttachmentSortOrder): CardAttachment[] {
  const sorted = [...files].sort((first, second) => first.addedAt === second.addedAt
    ? first.file.localeCompare(second.file)
    : first.addedAt < second.addedAt ? -1 : 1);
  return order === 'newest' ? sorted.reverse() : sorted;
}

export function formatAttachmentSize(bytes: number): string {
  const t = textNow(text);
  if (bytes < 1024) return `${bytes} ${t.bytes}`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} ${t.kilobytes}`;
  const megabytes = (bytes / (1024 * 1024)).toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${megabytes} ${t.megabytes}`;
}

export function formatAttachmentDate(addedAt: string): string {
  const date = new Date(addedAt);
  if (Number.isNaN(date.getTime())) return addedAt;
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
  return date.toLocaleDateString(locale(), options);
}

/** Resolve the uploader by member ID, name, or alias; keep unknown labels as written. */
export function attachmentAddedByLabel(catalog: CatalogView, addedBy: string | null): string {
  if (!addedBy) return '—';
  const member = (catalog.members ?? []).find(candidate =>
    candidate.id === addedBy || candidate.label === addedBy || candidate.aliases.includes(addedBy));
  return member ? member.label : addedBy;
}

/** Markdown links are relative to the card's directory, with attachments resolved from the project root. */
export function attachmentMarkdownReference(file: string, cardPath: string): string {
  const directoryDepth = cardPath.slice(0, Math.max(0, cardPath.lastIndexOf('/'))).split('/').filter(Boolean).length;
  return '../'.repeat(directoryDepth) + file;
}
