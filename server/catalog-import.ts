import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { deckAcceptsCard } from '../src/catalog-contracts.ts';
import type { CatalogImportEdit, CatalogImportReport, CatalogImportRow } from '../src/catalog-contracts.ts';
import { resolveMember } from '../src/members.ts';
import { readManifest, readProjectCatalog } from './catalog.ts';
import { cardOptionsPath, maximumCardOptionsChanges, prepareCardOptionsPatch } from './card-options.ts';
import { createManagedMarkdown, nativeCardPath, readNativeCard, validateNativeCardMetadata, type NativeCardMetadata } from './native-cards.ts';
import { defineText, serverText } from './i18n.ts';
import { cardStates, cardStateWords, readCardState, writeCardState } from '../src/format-vocabulary.ts';

// 2026-11-04: each CSV row becomes a native card at cards/<uuid>.md in the selected deck,
// using the same primitives as create-card (createManagedMarkdown and resolveMember).
// Reimporting the same file must not create duplicates: reuse the ID column when present;
// otherwise derive a deterministic UUID from the row contents.

const importText = defineText({
  rowLimit: "Import accepts 1 to 5000 rows.",
  deckMissing: "Deck not found.",
  kind: "card type must be task, hero or doc",
  title: "a title is required: one line of up to 1000 characters",
  markdown: "card text must be a string of up to 200000 characters",
  owner: "Owner must be one line of up to 120 characters",
  effort: "Effort must be a nonnegative number",
  priority: "Priority must be high, medium or low",
  stateTaskOnly: "only Task cards have a state",
  state: `state must be one of: ${cardStates.flatMap(cardStateWords).join(', ')}`,
  tags: "tags must contain up to 80 unique nonempty strings",
  identifier: "ID must have the form card:<uuid>",
  duplicateRow: "an identical row appears earlier in this file",
  idUsedUnchanged: "ID is already used by another card; the card was left unchanged",
  idUsed: "ID is already used by another card",
  rowName: (index: number) => `row ${index + 1}`,
  incompatibleKind: (row: { kind: string }, deck: { title: string }) => `type ${row.kind} is incompatible with deck ${deck.title}`,
  saveUnconfirmed: (plan: { metadata: { title: string } }, error: unknown) => `Card “${plan.metadata.title}” was saved, but the write could not be confirmed: ${error instanceof Error ? error.message : String(error)}`,
  tagsUnsaved: (error: unknown) => `Cards were created, but tags were not saved: ${error instanceof Error ? error.message : String(error)}. Importing the same file again will not create duplicates.`,
}, {
  rowLimit: "Импорт принимает от 1 до 5000 строк.",
  deckMissing: "Колода не найдена.",
  kind: "тип карточки — task, hero или doc",
  title: "нужен заголовок — одна строка до 1000 символов",
  markdown: "текст карточки — строка до 200000 символов",
  owner: "исполнитель — одна строка до 120 символов",
  effort: "цена — число не меньше нуля",
  priority: "приоритет — high, medium или low",
  stateTaskOnly: "состояние есть только у Task",
  state: `состояние — одно из: ${cardStates.flatMap(cardStateWords).join(', ')}`,
  tags: "теги — до 80 непустых строк без повторов",
  identifier: "ID должен быть вида card:<uuid>",
  duplicateRow: "такая же строка уже была выше в этом файле",
  idUsedUnchanged: "ID уже занят другой карточкой — карточка оставлена без изменений",
  idUsed: "ID уже занят другой карточкой",
  rowName: (index: number) => `строка ${index + 1}`,
  incompatibleKind: (row: { kind: string }, deck: { title: string }) => `тип ${row.kind} не подходит колоде ${deck.title}`,
  saveUnconfirmed: (plan: { metadata: { title: string } }, error: unknown) => `Карточка «${plan.metadata.title}» сохранена, но запись не подтвердилась: ${error instanceof Error ? error.message : String(error)}`,
  tagsUnsaved: (error: unknown) => `Карточки созданы, но теги не записаны: ${error instanceof Error ? error.message : String(error)}. Повторный импорт того же файла дублей не создаст.`,
});


const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Derive a UUID from row contents, with v5-style version and variant bits, for stable import IDs. */
export function derivedCardId(row: Omit<CatalogImportRow, 'cardId'>): string {
  const canonical = JSON.stringify([row.kind, row.title, row.markdown, row.owner, row.effort, row.priority, row.state, row.tags]);
  const bytes = createHash('sha256').update(canonical).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `card:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

interface PlannedRow {
  cardId: string;
  metadata: NativeCardMetadata;
  markdown: string;
  tags: string[];
}

export async function importCards(root: string, edit: CatalogImportEdit): Promise<CatalogImportReport & { changedPaths: string[] }> {
  if (!Array.isArray(edit.cards) || edit.cards.length < 1 || edit.cards.length > 5000) throw new Error(serverText(importText).rowLimit);
  const catalog = await readProjectCatalog(root);
  if (catalog.manifestHash !== edit.manifestHash) throw new Error('CATALOG_CONFLICT');
  if (catalog.optionsHash !== edit.optionsHash) throw new Error('CARD_OPTIONS_CONFLICT');
  const deck = catalog.decks.find(candidate => candidate.id === edit.deckId);
  if (!deck) throw new Error(serverText(importText).deckMissing);
  const members = catalog.members ?? [];
  const byId = new Map(catalog.cards.map(card => [card.id, card]));
  const report: CatalogImportReport = { created: [], unchanged: [], skipped: [], warnings: [] };
  const changedPaths: string[] = [];
  const planned: PlannedRow[] = [];
  const retryTags: PlannedRow[] = [];
  const plannedIds = new Set<string>();

  for (const [index, row] of edit.cards.entries()) {
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    const rowName = title || serverText(importText).rowName(index);
    const skip = (reason: string) => report.skipped.push({ title: rowName, reason });
    if (!['task', 'hero', 'doc'].includes(row.kind)) { skip(serverText(importText).kind); continue; }
    if (!title || title.length > 1000 || /[\r\n]/u.test(title)) { skip(serverText(importText).title); continue; }
    if (typeof row.markdown !== 'string' || row.markdown.length > 200000) { skip(serverText(importText).markdown); continue; }
    if (!deckAcceptsCard(deck.kind, row.kind)) { skip(serverText(importText).incompatibleKind(row, deck)); continue; }
    if (row.owner !== null && (typeof row.owner !== 'string' || !row.owner.trim() || row.owner.trim().length > 120 || /[\r\n\u0000]/u.test(row.owner))) {
      skip(serverText(importText).owner); continue;
    }
    if (row.effort !== null && (typeof row.effort !== 'number' || !Number.isFinite(row.effort) || row.effort < 0)) { skip(serverText(importText).effort); continue; }
    if (row.priority !== null && !['high', 'medium', 'low'].includes(row.priority)) { skip(serverText(importText).priority); continue; }
    if (row.state !== null && row.kind !== 'task') { skip(serverText(importText).stateTaskOnly); continue; }
    const inputState = row.state === null ? null : readCardState(row.state);
    if (row.state !== null && inputState === undefined) { skip(serverText(importText).state); continue; }
    if (!Array.isArray(row.tags) || row.tags.length > 100 || new Set(row.tags).size !== row.tags.length
      || row.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag !== tag.trim() || tag.length > 80 || /[\u0000-\u001f]/u.test(tag))) {
      skip(serverText(importText).tags); continue;
    }
    if (row.cardId !== null && !nativeCardPath(row.cardId)) { skip(serverText(importText).identifier); continue; }

    const owner = row.owner === null ? null : resolveMember(row.owner.trim(), members) ?? row.owner.trim();
    const state = row.kind === 'task' ? inputState ?? 'not-started' : null;
    // Match create-card field order so byte comparisons with existing cards remain valid.
    const metadata: NativeCardMetadata = { deckmate: 'card', schema: 1, id: '', kind: row.kind, title,
      state: state === null ? null : writeCardState(state, catalog.formatLanguage), owner, deckId: edit.deckId, trackIds: [], parentId: null };
    if (row.effort !== null) metadata.effort = row.effort;
    if (row.priority !== null) metadata.priority = row.priority;
    const cardId = row.cardId ?? derivedCardId({ kind: row.kind, title, markdown: row.markdown, owner, effort: row.effort, priority: row.priority, state: row.state, tags: row.tags });
    metadata.id = cardId.slice(5);
    validateNativeCardMetadata(metadata, metadata.id);
    if (plannedIds.has(cardId)) { skip(serverText(importText).duplicateRow); continue; }
    plannedIds.add(cardId);

    const existing = byId.get(cardId);
    if (existing) {
      // 2026-11-09: missing tags can be an interrupted import; unrelated tags still protect an occupied ID.
      const identical = existing.kind === row.kind && existing.title === title && existing.deckId === edit.deckId
        && existing.parentId === null && existing.trackIds.length === 0
        && (existing.owner ?? null) === owner && (existing.effort ?? null) === row.effort
        && (existing.priority ?? null) === row.priority && (existing.state ?? null) === state
        && existing.markdown === row.markdown
        && (existing.tags ?? []).every(tag => row.tags.includes(tag));
      if (identical) {
        report.unchanged.push(cardId);
        if ((existing.tags ?? []).length !== row.tags.length) retryTags.push({ cardId, metadata, markdown: row.markdown, tags: row.tags });
      } else skip(serverText(importText).idUsedUnchanged);
      continue;
    }
    planned.push({ cardId, metadata, markdown: row.markdown, tags: row.tags });
  }

  for (const plan of planned) {
    const relativePath = nativeCardPath(plan.cardId)!;
    try {
      const published = await createManagedMarkdown(root, relativePath, plan.metadata, plan.markdown);
      if (published) { report.created.push(plan.cardId); changedPaths.push(relativePath); continue; }
      // Another process created the file: identical contents confirm success; different contents conflict.
      const existing = await readNativeCard(root, plan.cardId).catch(() => null);
      if (existing && isDeepStrictEqual(existing.metadata, plan.metadata) && existing.markdown === plan.markdown) report.unchanged.push(plan.cardId);
      else report.skipped.push({ title: plan.metadata.title, reason: serverText(importText).idUsed });
    } catch (error) {
      const saved = error !== null && typeof error === 'object' && 'saved' in error && error.saved === true;
      if (saved) {
        report.created.push(plan.cardId);
        changedPaths.push(relativePath);
        report.warnings.push(serverText(importText).saveUnconfirmed(plan, error));
      } else report.skipped.push({ title: plan.metadata.title, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  // 2026-11-09: chain our own revisions, never adopt an external writer's hash between batches.
  const confirmed = new Set([...report.created, ...report.unchanged]);
  const tagRows = [...retryTags, ...planned.filter(plan => confirmed.has(plan.cardId))].filter(plan => plan.tags.length);
  let optionsHash = edit.optionsHash;
  try {
    for (let start = 0; start < tagRows.length; start += maximumCardOptionsChanges) {
      const tagPatches = Object.fromEntries(tagRows.slice(start, start + maximumCardOptionsChanges).map(plan => [plan.cardId, { tags: plan.tags }]));
      const optionsPlan = await prepareCardOptionsPatch(root, optionsHash, tagPatches);
      await optionsPlan.publish(async () => {
        const manifest = await readManifest(root);
        if ((manifest.bytes ? digest(manifest.bytes) : '') !== edit.manifestHash) throw new Error('CATALOG_CONFLICT');
      });
      optionsHash = optionsPlan.nextHash;
      if (optionsPlan.changed && !changedPaths.includes(cardOptionsPath)) changedPaths.push(cardOptionsPath);
    }
  } catch (error) {
    report.warnings.push(serverText(importText).tagsUnsaved(error));
  }
  return { ...report, changedPaths };
}
