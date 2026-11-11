import type { DeckActivityEvent } from './activity-contracts.ts';
import { defaultLang, defineText } from './i18n.ts';
import { readCardState } from './format-vocabulary.ts';

const text = defineText({ created: 'Created', status: 'States', done: 'Done', properties: 'Properties', content: 'Content', links: 'Links' },
  { created: 'Создано', status: 'Статусы', done: 'Принято', properties: 'Свойства', content: 'Текст', links: 'Связи' });

/**
 * Journal groups support deck feed filters and History: creation, workflow changes
 * (including archive and deletion), completion, properties, content, and links.
 * Completion has its own group so it can be filtered separately from other state changes.
 */
export type ActivityEventGroup = 'created' | 'status' | 'done' | 'properties' | 'content' | 'links';

export const activityGroupChips: readonly { id: ActivityEventGroup; label: string }[] = [
  { id: 'created', label: text[defaultLang].created },
  { id: 'status', label: text[defaultLang].status },
  { id: 'done', label: text[defaultLang].done },
  { id: 'properties', label: text[defaultLang].properties },
  { id: 'content', label: text[defaultLang].content },
  { id: 'links', label: text[defaultLang].links },
];

const actionGroups: Record<string, ActivityEventGroup> = {
  'create-card': 'created', 'create-deck': 'created',
  'set-card-state': 'status', 'update-status': 'status',
  'set-card-properties': 'properties', 'configure-members': 'properties',
  'update-deck': 'properties', 'set-deck-kind': 'properties', 'upload-cover': 'properties',
  // 2026-11-10: removed pile actions stay mapped so old journal entries retain their Properties filter.
  'move-deck': 'properties', 'move-space': 'properties', 'delete-space': 'properties', 'set-deck-pile': 'properties', 'create-track': 'properties', 'save-project-tag': 'properties',
  'update-card-content': 'content', 'update-block': 'content',
  'set-card-parent': 'links', 'set-card-links': 'links', 'assign-deck': 'links',
  'bulk-assign-deck': 'links', 'set-tracks': 'links', 'bulk-add-track': 'links',
  'apply-journey': 'links', 'create-journey': 'links', 'update-journey': 'links',
  'import-journey-template': 'links', 'save-journey-template': 'links', 'reorder-subcards': 'links',
  'set-card-dependencies': 'links', 'card-unlocked': 'links', 'reorder-hand': 'properties',
};

// Diff lines start with a card title; property changes share one filter chip.
const fieldGroups: Record<string, ActivityEventGroup> = {
  'Название': 'content', 'Обновлено описание': 'content',
  'Статус': 'status', 'Архив': 'status', 'Удаление': 'status',
  'Hero': 'links', 'Колода': 'links', 'Треки': 'links', 'Зависимости': 'links',
  'Исполнитель': 'properties', 'Effort': 'properties', 'Priority': 'properties', 'Оценка': 'properties', 'Приоритет': 'properties', 'Тип': 'properties',
  'Hand': 'properties', 'Теги': 'properties', 'Run': 'properties', 'Milestone': 'properties',
  'Срок': 'properties', 'Закладка': 'properties',
  'Создана карточка': 'created',
  'Title': 'content', 'Description updated': 'content',
  'State': 'status', 'Archive': 'status', 'Deletion': 'status',
  'Deck': 'links', 'Tracks': 'links', 'Dependencies': 'links',
  'Owner': 'properties', 'Type': 'properties', 'Tags': 'properties',
  'Due date': 'properties', 'Bookmark': 'properties',
  'Card created': 'created',
};

// Card titles precede the field and may contain colons, so match a known field name
// instead of taking the first segment before a colon.
const fieldPattern = new RegExp(`: (${Object.keys(fieldGroups).join('|')})(?:: |$)`, 'u');

/** Events can belong to multiple groups; completion belongs to both States and Done. */
export function activityEventGroups(event: DeckActivityEvent): Set<ActivityEventGroup> {
  const groups = new Set<ActivityEventGroup>();
  const byAction = actionGroups[event.action];
  if (byAction) groups.add(byAction);
  for (const detail of event.details) {
    const field = fieldPattern.exec(detail)?.[1];
    if (field && fieldGroups[field]) groups.add(fieldGroups[field]);
    // Completion is also filterable independently of other state changes.
    const completed = /(?:Статус|State): .+ → (\S+)$/u.exec(detail);
    if (completed && readCardState(completed[1]) === 'done') groups.add('done');
  }
  if (event.transitions?.some(transition => transition.to !== null && readCardState(transition.to) === 'done')) groups.add('done');
  return groups;
}

/** Show all events with no filters, otherwise require a matching group. */
export function eventMatchesGroups(event: DeckActivityEvent, selected: ReadonlySet<ActivityEventGroup>): boolean {
  if (!selected.size) return true;
  for (const group of activityEventGroups(event)) if (selected.has(group)) return true;
  return false;
}
