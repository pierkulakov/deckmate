// «2 hours ago» labels. 2026-11-08: moved out of Notifications so the project menu's recent list
// reuses the same rounding and plural rules instead of a second implementation.
import { defineText, locale, type Lang } from './i18n.ts';

const text = defineText({ justNow: 'just now' }, { justNow: 'только что' });
const calendarUnits: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60],
];

export function relativeTimeAgo(moment: string, lang: Lang, style: 'compact' | 'calendar' = 'compact'): string {
  const timestamp = Date.parse(moment);
  if (Number.isNaN(timestamp)) return '';
  const relativeTime = new Intl.RelativeTimeFormat(locale(lang), { numeric: 'auto' });
  // 2026-11-13: project history spans years; notification labels retain their minute/hour/day rounding.
  if (style === 'calendar') {
    const seconds = Math.round((timestamp - Date.now()) / 1000);
    const unit = calendarUnits.find(([, size]) => Math.abs(seconds) >= size);
    return unit ? relativeTime.format(Math.round(seconds / unit[1]), unit[0]) : text[lang].justNow;
  }
  const minutes = Math.round((timestamp - Date.now()) / 60000);
  if (Math.abs(minutes) < 60) return relativeTime.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  return Math.abs(hours) < 24 ? relativeTime.format(hours, 'hour') : relativeTime.format(Math.round(hours / 24), 'day');
}
