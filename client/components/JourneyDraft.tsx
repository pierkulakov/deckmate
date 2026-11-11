import type { CatalogDeck, CatalogJourney, CatalogJourneyStep, CatalogJourneyZone, CatalogView } from '../../src/catalog-contracts.ts';
import type { FormatLanguage } from '../../src/format-vocabulary.ts';
import { defineText, textNow } from '../i18n.ts';

const text = defineText({
  titleRequired: 'Enter the Journey title.',
  stepRequired: 'Add at least one step.',
  stepLimit: 'A Journey can contain at most 30 steps.',
  zoneLimit: 'A Journey can contain at most 20 zones.',
  zoneTitleRequired: 'Enter a title for every zone.',
  stepTitleRequired: 'Enter a title for every step.',
  deckRequired: 'Choose a Task or Mixed deck for every step.',
  ownerRequired: 'Choose an available Owner or clear the assignment.',
  effortInvalid: 'Effort must be a number greater than or equal to zero.',
  removedDependency: 'Remove the dependency on the deleted step.',
  zoneRequired: 'Choose an existing zone for every step.',
  dependencyCycle: 'The chain creates a dependency cycle. Changes were not applied.',
}, {
  titleRequired: 'Укажите название Journey.',
  stepRequired: 'Добавьте хотя бы один шаг.',
  stepLimit: 'В Journey можно сохранить не больше 30 шагов.',
  zoneLimit: 'В Journey можно сохранить не больше 20 зон.',
  zoneTitleRequired: 'Укажите название каждой зоны.',
  stepTitleRequired: 'Укажите название каждого шага.',
  deckRequired: 'Выберите Task или Mixed колоду для каждого шага.',
  ownerRequired: 'Выберите доступного исполнителя или снимите назначение.',
  effortInvalid: 'Оценка должна быть числом не меньше нуля.',
  removedDependency: 'Снимите зависимость от удалённого шага.',
  zoneRequired: 'Выберите существующую зону для каждого шага.',
  dependencyCycle: 'Цепочка создаёт цикл зависимостей. Изменения не применены.',
});

// The default zone title is saved to the project file, so it follows the project's format language, not the interface language.
const formatText = defineText({
  defaultZoneTitle: 'Main steps',
}, {
  defaultZoneTitle: 'Основные шаги',
});

export interface JourneyDraft { title: string; description: string; zones: CatalogJourneyZone[]; steps: CatalogJourneyStep[] }
export interface JourneySnapshot { journey: CatalogJourney | null; manifestHash: string; draft: JourneyDraft }

export function journeyDraft(journey: CatalogJourney | null, deck: CatalogDeck, formatLanguage: FormatLanguage): JourneyDraft {
  const zones = journey?.zones?.length ? journey.zones.map(zone => ({ ...zone })) : [{ id: 'default', title: formatText[formatLanguage].defaultZoneTitle }];
  const steps = (journey?.steps ?? []).map(step => ({ id: step.id, title: step.title, markdown: step.markdown, deckId: step.deckId, owner: step.owner ?? null, dependsOn: [...step.dependsOn], effort: step.effort ?? null, priority: step.priority ?? null, zoneId: step.zoneId ?? 'default' }));
  for (const step of steps) if (!zones.some(zone => zone.id === step.zoneId)) zones.push({ id: step.zoneId, title: step.zoneId });
  return { title: journey?.title ?? deck.title, description: journey?.description ?? '', zones, steps };
}

export function normalizedDraft(draft: JourneyDraft): JourneyDraft {
  return { ...draft, title: draft.title.trim(), zones: draft.zones.map(zone => ({ ...zone, title: zone.title.trim() })), steps: visibleSteps(draft).map(step => ({ ...step, title: step.title.trim() })) };
}

export function sameDraft(left: JourneyDraft, right: JourneyDraft): boolean {
  return JSON.stringify(normalizedDraft(left)) === JSON.stringify(normalizedDraft(right));
}

export function dependencyCycle(steps: CatalogJourneyStep[]): boolean {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visit(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if (steps.find(step => step.id === id)?.dependsOn.some(visit)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  }
  return steps.some(step => visit(step.id));
}

export function draftError(draft: JourneyDraft, catalog: CatalogView): string | null {
  const t = textNow(text);
  if (!draft.title.trim()) return t.titleRequired;
  if (!draft.steps.length) return t.stepRequired;
  if (draft.steps.length > 30) return t.stepLimit;
  if (draft.zones.length > 20) return t.zoneLimit;
  if (draft.zones.some(zone => !zone.title.trim())) return t.zoneTitleRequired;
  for (const step of draft.steps) {
    if (!step.title.trim()) return t.stepTitleRequired;
    if (!catalog.decks.some(deck => deck.id === step.deckId && (deck.kind === 'task' || deck.kind === 'mixed'))) return t.deckRequired;
    if (step.owner && !catalog.members?.some(member => member.label === step.owner)) return t.ownerRequired;
    if (step.effort != null && (!Number.isFinite(step.effort) || step.effort < 0)) return t.effortInvalid;
    if (step.dependsOn.some(id => !draft.steps.some(candidate => candidate.id === id))) return t.removedDependency;
    if (!draft.zones.some(zone => zone.id === step.zoneId)) return t.zoneRequired;
  }
  return dependencyCycle(draft.steps) ? t.dependencyCycle : null;
}

export function nextJourneyId(prefix: string, existing: { id: string }[]): string {
  let number = 1;
  const used = new Set(existing.map(item => item.id.toLowerCase()));
  while (used.has(`${prefix}-${number}`)) number += 1;
  return `${prefix}-${number}`;
}

export function visibleSteps(draft: JourneyDraft): CatalogJourneyStep[] {
  const ordered = draft.zones.flatMap(zone => draft.steps.filter(step => (step.zoneId ?? 'default') === zone.id));
  return [...ordered, ...draft.steps.filter(step => !draft.zones.some(zone => zone.id === (step.zoneId ?? 'default')))];
}

// 2026-11-04: after an explicit conflict decision, replay only local field changes;
// unrelated changes from the other writer must survive the full-Journey API payload.
function mergeItems<Item extends { id: string }>(before: Item[], local: Item[], remote: Item[]): Item[] {
  const localById = new Map(local.map(item => [item.id, item]));
  const beforeById = new Map(before.map(item => [item.id, item]));
  const merged = remote.filter(item => !beforeById.has(item.id) || localById.has(item.id)).map(item => {
    const previous = beforeById.get(item.id);
    const edited = localById.get(item.id);
    if (!edited) return { ...item };
    if (!previous) return { ...edited };
    const result = { ...item };
    for (const key of Object.keys(edited) as (keyof Item)[]) {
      if (JSON.stringify(edited[key]) !== JSON.stringify(previous[key])) result[key] = edited[key];
    }
    return result;
  });
  for (const item of local) {
    if (!merged.some(candidate => candidate.id === item.id) && (!beforeById.has(item.id) || JSON.stringify(item) !== JSON.stringify(beforeById.get(item.id)))) merged.push({ ...item });
  }
  if (JSON.stringify(before.map(item => item.id)) === JSON.stringify(local.map(item => item.id))) return merged;
  const ordered = local.flatMap(item => merged.find(candidate => candidate.id === item.id) ?? []);
  return [...ordered, ...merged.filter(item => !localById.has(item.id))];
}

export function mergeJourneyDraft(before: JourneyDraft, local: JourneyDraft, remote: JourneyDraft): JourneyDraft {
  // 2026-11-04: short IDs can collide, but an identical remote addition can also
  // be our successful write followed by another writer before the verifying GET.
  const localZones = local.zones.map(zone => ({ ...zone }));
  const localSteps = local.steps.map(step => ({ ...step, dependsOn: [...step.dependsOn] }));
  const zoneRemap = new Map<string, string>();
  for (const zone of localZones) {
    const other = remote.zones.find(candidate => candidate.id === zone.id);
    if (!before.zones.some(candidate => candidate.id === zone.id) && other && JSON.stringify(zone) !== JSON.stringify(other)) {
      const id = nextJourneyId('zone', [...localZones, ...remote.zones]);
      zoneRemap.set(zone.id, id); zone.id = id;
    }
  }
  for (const step of localSteps) {
    step.zoneId = zoneRemap.get(step.zoneId!) ?? step.zoneId;
  }
  // Remapping one addition can make a previously equal dependent step differ.
  // Repeat until the dependency references settle; each step gets a fresh ID once.
  while (true) {
    const stepRemap = new Map<string, string>();
    for (const step of localSteps) {
      const other = remote.steps.find(candidate => candidate.id === step.id);
      if (!before.steps.some(candidate => candidate.id === step.id) && other && JSON.stringify(step) !== JSON.stringify(other)) {
        const id = nextJourneyId('step', [...localSteps, ...remote.steps]);
        stepRemap.set(step.id, id); step.id = id;
      }
    }
    if (!stepRemap.size) break;
    for (const step of localSteps) step.dependsOn = step.dependsOn.map(id => stepRemap.get(id) ?? id);
  }
  local = { ...local, zones: localZones, steps: localSteps };
  const zones = mergeItems(before.zones, local.zones, remote.zones);
  const steps = mergeItems(before.steps, local.steps, remote.steps);
  for (const step of steps) {
    step.dependsOn = step.dependsOn.filter(id => steps.some(candidate => candidate.id === id));
    if (!zones.some(zone => zone.id === step.zoneId)) {
      const zone = local.zones.find(candidate => candidate.id === step.zoneId) ?? remote.zones.find(candidate => candidate.id === step.zoneId);
      if (zone) zones.push(zone);
    }
  }
  return { title: local.title === before.title ? remote.title : local.title, description: local.description === before.description ? remote.description : local.description, zones, steps };
}

export function duplicateJourneySteps(source: JourneyDraft, target: JourneyDraft, selectedIds: string[]): { draft: JourneyDraft; dropped: number; ids: string[] } {
  const selected = visibleSteps(source).filter(step => selectedIds.includes(step.id));
  const zones = target.zones.map(zone => ({ ...zone }));
  const zoneIds = new Map<string, string>();
  for (const zone of source.zones.filter(zone => selected.some(step => step.zoneId === zone.id))) {
    const match = zones.find(candidate => candidate.id === zone.id && candidate.title === zone.title);
    if (match) zoneIds.set(zone.id, match.id);
    else {
      const id = zones.some(candidate => candidate.id === zone.id) ? nextJourneyId('zone', zones) : zone.id;
      zones.push({ ...zone, id }); zoneIds.set(zone.id, id);
    }
  }
  const steps = [...target.steps];
  const ids = new Map<string, string>();
  for (const step of selected) {
    const id = nextJourneyId('step', [...steps, ...[...ids.values()].map(id => ({ id }))]);
    ids.set(step.id, id);
  }
  let dropped = 0;
  for (const step of selected) {
    dropped += step.dependsOn.filter(id => !ids.has(id)).length;
    steps.push({ ...step, id: ids.get(step.id)!, zoneId: zoneIds.get(step.zoneId!)!, dependsOn: step.dependsOn.flatMap(id => ids.get(id) ?? []) });
  }
  return { draft: { ...target, zones, steps }, dropped, ids: [...ids.values()] };
}
