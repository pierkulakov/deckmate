import { useLang, type Lang } from './i18n.ts';
import './reserved-text.css';

export interface ReservedTextProps {
  values: Record<Lang, string>;
  lang?: Lang;
  className?: string;
}

/** 2026-11-13: both translations size one cell without adding a second accessible label or replacing its DOM. */
export function ReservedText({ values, lang, className = '' }: ReservedTextProps) {
  const current = useLang();
  const language = lang ?? current;
  return <span className={`reserved-text ${className}`} data-reserve={values[language === 'en' ? 'ru' : 'en']}>
    <span>{values[language]}</span>
  </span>;
}
