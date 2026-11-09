import type { TemplateLocales } from './catalog-contracts.ts';
import type { Lang } from './i18n.ts';

/** 2026-11-09: picker text of a template in `lang`, field by field, with the English `title`/`description` as fallback.
 *  The client passes the interface language; an import into a project passes the project's format language. */
export function templateText(template: { title: string; description: string; locales?: TemplateLocales }, lang: Lang): { title: string; description: string } {
  const localized = lang === 'en' ? undefined : template.locales?.[lang];
  return {
    title: localized?.title ?? template.title,
    description: localized?.description ?? template.description,
  };
}
