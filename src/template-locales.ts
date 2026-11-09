import type { TemplateLocales } from './catalog-contracts.ts';
import { defaultLang, defineText, type Lang } from './i18n.ts';

const messages = defineText({
  object: (field: string) => `${field}: expected an object.`,
  text: (field: string, maximum: number) => `${field}: expected a string of up to ${maximum} characters.`,
}, {
  object: (field: string) => `${field}: ожидается объект.`,
  text: (field: string, maximum: number) => `${field}: ожидается строка до ${maximum} символов.`,
});

function object(value: unknown, field: string, lang: Lang): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(messages[lang].object(field));
  return value as Record<string, unknown>;
}

/** Unknown locale keys are reserved for future languages and do not affect the current template. */
export function parseTemplateLocales(value: unknown, lang: Lang = defaultLang): TemplateLocales | undefined {
  if (value === undefined) return undefined;
  const metadata = object(value, 'locales', lang);
  if (metadata.ru === undefined) return undefined;
  const russian = object(metadata.ru, 'locales.ru', lang);
  const ru: NonNullable<TemplateLocales['ru']> = {};
  for (const [field, maximum] of [['title', 200], ['description', 2000]] as const) {
    const localized = russian[field];
    if (localized === undefined) continue;
    if (typeof localized !== 'string' || localized.length > maximum) {
      throw new Error(messages[lang].text(`locales.ru.${field}`, maximum));
    }
    const trimmed = localized.trim();
    if (trimmed) ru[field] = trimmed;
  }
  return { ru };
}
