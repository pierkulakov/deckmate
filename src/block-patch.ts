import type { ByteRange } from './contracts.ts';
import { markdownModel } from './markdown-model.ts';
import { defaultLang, defineText, type Lang } from './i18n.ts';
export { markdownModel } from './markdown-model.ts';

const text = defineText({
  invalidRange: 'Invalid byte range',
  modelChanged: 'Block model changed during serialization; use raw Markdown',
}, {
  invalidRange: 'Некорректный диапазон байтов',
  modelChanged: 'Модель блока изменилась при сериализации; используйте исходный Markdown',
});

export function replaceMarkdownBlock(
  source: Uint8Array,
  range: ByteRange,
  replacement: Uint8Array,
  expectedModel: string,
  lang: Lang = defaultLang,
): Buffer {
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end)
    || range.start < 0 || range.end < range.start || range.end > source.length) {
    throw new Error(text[lang].invalidRange);
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  // Reject a position inside a multibyte character before any write (2026-11-03).
  decoder.decode(source.subarray(0, range.start));
  decoder.decode(source.subarray(range.start, range.end));
  decoder.decode(source.subarray(range.end));
  const replacementText = decoder.decode(replacement);
  if (markdownModel(replacementText) !== expectedModel) {
    throw new Error(text[lang].modelChanged);
  }
  return Buffer.concat([source.subarray(0, range.start), replacement, source.subarray(range.end)]);
}
