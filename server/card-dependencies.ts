import { defineText, serverText } from './i18n.ts';
import { isDeepStrictEqual } from 'node:util';
import type { CatalogView } from '../src/catalog-contracts.ts';
import { dependencyCycle, type SetCardDependenciesEdit } from '../src/dependency-contracts.ts';
import { readFreshProjectCatalog, readProjectCatalog } from './catalog.ts';
import { patchNativeCardFields, readNativeCard, replaceProjectMarkdown } from './native-cards.ts';

const messages = defineText({
  invalidDependencies: (limit: number) => `Dependencies must be a list of up to ${limit} unique card IDs.`,
  dependencyNotFound: (id: string) => `Dependency not found in the catalog: ${id}`,
  dependencyInactive: (title: string) => `Dependency is unavailable (Archive or Trash): ${title}`,
  dependencyCycle: (names: string) => `Dependencies form a cycle: ${names}`,
  cardNotFound: "Card not found.",
  dependencyHashRequired: "Editing dependencies needs the card's current version. Refresh the catalog and try again.",
  legacyDependenciesReadOnly: "Edit legacy card dependencies in the project file; they are read-only in the interface.",
  journeyDependenciesReadOnly: "Journey card dependencies are managed by the Journey and cannot be edited separately.",
  restoreCardFirst: "Restore the card from Archive or Trash first.",
  selfDependency: "A card cannot depend on itself.",
}, {
  invalidDependencies: (limit: number) => `Зависимости — список до ${limit} уникальных ID карточек.`,
  dependencyNotFound: (id: string) => `Зависимость не найдена в каталоге: ${id}`,
  dependencyInactive: (title: string) => `Зависимость недоступна (архив или удаление): ${title}`,
  dependencyCycle: (names: string) => `Зависимости образуют цикл: ${names}`,
  cardNotFound: "Карточка не найдена.",
  dependencyHashRequired: "Для правки зависимостей нужна актуальная версия карточки. Обновите каталог и повторите действие.",
  legacyDependenciesReadOnly: "Зависимости legacy-карточки меняются правкой файла проекта; интерфейс их только читает.",
  journeyDependenciesReadOnly: "Зависимости карточки Journey задаёт сам Journey; отдельная правка недоступна.",
  restoreCardFirst: "Сначала верните карточку из архива или удаления.",
  selfDependency: "Карточка не может ждать саму себя.",
});


const maximumDependencies = 200;

function dependencyNames(catalog: CatalogView, ids: readonly string[]): string {
  return ids.map(id => catalog.cards.find(card => card.id === id)?.title ?? id).join(' → ');
}

function validateDependencies(catalog: CatalogView, edit: SetCardDependenciesEdit) {
  if (catalog.manifestHash !== edit.manifestHash) throw new Error('CATALOG_CONFLICT');
  const card = catalog.cards.find(candidate => candidate.id === edit.cardId);
  if (!card) throw new Error(serverText(messages).cardNotFound);
  if (card.sourceHash !== edit.sourceHash) throw new Error('CARD_CONFLICT');
  if (!card.id.startsWith('card:')) throw new Error(serverText(messages).legacyDependenciesReadOnly);
  if (card.journey) throw new Error(serverText(messages).journeyDependenciesReadOnly);
  if (card.archived || card.deleted) throw new Error(serverText(messages).restoreCardFirst);
  for (const id of edit.dependsOn) {
    if (id === card.id) throw new Error(serverText(messages).selfDependency);
    const dependency = catalog.cards.find(candidate => candidate.id === id);
    if (!dependency) throw new Error(serverText(messages).dependencyNotFound(id));
    if (dependency.archived || dependency.deleted) throw new Error(serverText(messages).dependencyInactive(dependency.title));
  }
  const cycle = dependencyCycle(catalog.cards, card.id, edit.dependsOn);
  if (cycle) throw new Error(serverText(messages).dependencyCycle(dependencyNames(catalog, cycle)));
  return card;
}

/** 2026-11-09: legacy and Journey dependencies stay source-managed; native edits guard the whole graph. */
export async function setCardDependencies(root: string, edit: SetCardDependenciesEdit): Promise<string[]> {
  if (!/^[0-9a-f]{64}$/u.test(edit.sourceHash)) throw new Error(serverText(messages).dependencyHashRequired);
  if (!Array.isArray(edit.dependsOn) || edit.dependsOn.length > maximumDependencies
    || edit.dependsOn.some(id => typeof id !== 'string' || !id || id.length > 1000)
    || new Set(edit.dependsOn).size !== edit.dependsOn.length) {
    throw new Error(serverText(messages).invalidDependencies(maximumDependencies));
  }
  const catalog = await readProjectCatalog(root);
  const card = validateDependencies(catalog, edit);
  if (isDeepStrictEqual(card.dependsOn ?? [], edit.dependsOn)) return [];
  const existing = await readNativeCard(root, card.id);
  if (!existing) throw new Error(serverText(messages).cardNotFound);
  if (existing.fileHash !== edit.sourceHash) throw new Error('CARD_CONFLICT');
  const bytes = patchNativeCardFields(existing, { dependsOn: edit.dependsOn });
  if (bytes.equals(existing.bytes)) return [];
  await replaceProjectMarkdown(root, card.path, edit.sourceHash, bytes, async () => {
    // 2026-11-09: external edits can add edges or cards without touching this card's source.
    const current = await readFreshProjectCatalog(root);
    validateDependencies(current, edit);
    if (current.optionsHash !== catalog.optionsHash) throw new Error('CARD_OPTIONS_CONFLICT');
    const hashes = (view: CatalogView) => new Map(view.cards.map(candidate => [candidate.id, candidate.sourceHash]));
    if (!isDeepStrictEqual(hashes(current), hashes(catalog))) throw new Error('CATALOG_CONFLICT');
  });
  return [card.path];
}
