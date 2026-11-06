// Shared UI labels. Markdown readers and writers translate these ids at the project boundary (2026-11-05).
import type { CardKind, CardPriority } from '../../src/catalog-contracts.ts';
import { defineText, textNow, type Lang } from '../i18n.ts';

const states = defineText({
  inbox: 'Inbox',
  'not-started': 'Not started',
  discussing: 'Discussing',
  'in-iteration': 'In iteration',
  started: 'Started',
  review: 'Review',
  done: 'Done',
  'wont-do': "Won't do",
}, {
  inbox: 'Входящие',
  'not-started': 'План',
  discussing: 'Обсуждаем',
  'in-iteration': 'Итерация',
  started: 'В работе',
  review: 'Приёмка',
  done: 'Принято',
  'wont-do': 'Не делаем',
});

const priorities = defineText({ high: 'High', medium: 'Medium', low: 'Low' }, { high: 'Высокий', medium: 'Средний', low: 'Низкий' });
const kinds = defineText({ hero: 'Hero', task: 'Task', doc: 'Doc' }, { hero: 'Hero', task: 'Task', doc: 'Doc' });

/** Label of a card state id; an unknown id (a project's own state) shows as written. */
export function stateLabel(state: string, lang?: Lang): string {
  const labels = lang ? states[lang] : textNow(states);
  return (labels as Record<string, string>)[state] ?? state;
}

export function priorityLabel(priority: CardPriority, lang?: Lang): string {
  return (lang ? priorities[lang] : textNow(priorities))[priority];
}

export function kindLabel(kind: CardKind, lang?: Lang): string {
  return (lang ? kinds[lang] : textNow(kinds))[kind];
}
