// «2 hours ago» labels. 2026-11-08: moved out of Notifications so the project menu's recent list
// reuses the same rounding and plural rules instead of a second implementation.
import { locale, type Lang } from './i18n.ts';

export function relativeTimeAgo(moment: string, lang: Lang): string {
  const timestamp = Date.parse(moment);
  if (Number.isNaN(timestamp)) return '';
  const relativeTime = new Intl.RelativeTimeFormat(locale(lang), { numeric: 'auto' });
  const minutes = Math.round((timestamp - Date.now()) / 60000);
  if (Math.abs(minutes) < 60) return relativeTime.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  return Math.abs(hours) < 24 ? relativeTime.format(hours, 'hour') : relativeTime.format(Math.round(hours / 24), 'day');
}
