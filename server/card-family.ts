import { defineText, serverText } from './i18n.ts';
import type { CatalogCard, ProjectCatalog } from '../src/catalog-contracts.ts';

const messages = defineText({
  invalidChildKind: "A Sub Card must be a Task or Doc.",
  restoreChildFirst: "Restore the card from Archive or Trash first.",
  journeyParentMove: "A Journey card cannot move to another Hero separately from its Journey.",
  childHasChildren: "A card with Sub Cards cannot become a Sub Card.",
  invalidParentKind: "The parent must be an existing Hero or Doc.",
  parentInactive: "The parent is in Archive or Trash.",
  familyCycle: "Nested families and cycles are not allowed.",
}, {
  invalidChildKind: "Подкарточкой может быть Task или Doc.",
  restoreChildFirst: "Сначала восстановите карточку из архива или удаления.",
  journeyParentMove: "Карточку Journey нельзя переносить к другому Hero отдельно от конвейера.",
  childHasChildren: "Карточка со своими Sub Cards не может стать подкарточкой.",
  invalidParentKind: "Родителем может быть только существующий Hero или Doc.",
  parentInactive: "Родитель находится в архиве или удалён.",
  familyCycle: "Нельзя создать вложенную семью или цикл.",
});


type FamilyCard = Pick<CatalogCard, 'id' | 'kind' | 'parentId' | 'journey' | 'archived' | 'deleted'>;

/** 2026-11-03: Family is a role, independent of Deck/Card kind; only one child level is supported. */
export function validateCardFamily(catalog: Pick<ProjectCatalog, 'cards'>, children: FamilyCard[], parentId: string | null): CatalogCard | undefined {
  for (const child of children) {
    if (!['task', 'doc'].includes(child.kind)) throw new Error(serverText(messages).invalidChildKind);
    if (child.archived || child.deleted) throw new Error(serverText(messages).restoreChildFirst);
    if (child.journey && child.parentId !== parentId) throw new Error(serverText(messages).journeyParentMove);
    // Include inactive descendants: restoring them later must not introduce nesting.
    if (parentId !== null && catalog.cards.some(card => card.parentId === child.id)) throw new Error(serverText(messages).childHasChildren);
  }
  if (parentId === null) return undefined;
  const parent = catalog.cards.find(card => card.id === parentId);
  if (!parent || !['hero', 'doc'].includes(parent.kind)) throw new Error(serverText(messages).invalidParentKind);
  if (parent.archived || parent.deleted) throw new Error(serverText(messages).parentInactive);
  if (parent.parentId !== null || children.some(child => child.id === parent.id)) throw new Error(serverText(messages).familyCycle);
  return parent;
}
