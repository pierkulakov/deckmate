import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { packagePath } from './package-path.ts';
import { environmentValue } from './environment.ts';
import { ProjectIndex } from './project-index.ts';
import { attachSearchHits, SearchSourceChangedError, type SearchCard, type SearchHit } from './search-hits.ts';
import { editProjectCatalog, readProjectCatalog, readFreshProjectCatalog, refreshProjectCatalog } from './catalog.ts';
import { catalogFileChanged, withCatalogSnapshot } from './catalog-snapshot.ts';
import { abandonJourneyOperation, addJourneyStepLesson, readJourney, recoverJourneyOperation, updateJourney } from './journeys.ts';
import { saveJourneyTemplate } from './journey-templates.ts';
import { editCatalogBulk } from './catalog-bulk.ts';
import { prepareCardOptionsPatch, readCardOptions, type CardOptionsPatch } from './card-options.ts';
import type { BulkOutcome } from '../src/bulk-contracts.ts';
import { assertWritable, containedFile, type ServerConfig } from './config.ts';
import { isMechanicPath } from '../src/markdown.ts';
import type { CatalogCard, CatalogEdit, CatalogQuery, CatalogView } from '../src/catalog-contracts.ts';
import { resolveReference } from '../src/references.ts';
import { localIsoDate } from '../src/catalog-hand.ts';
import type { DeckActivityEvent } from '../src/activity-contracts.ts';
import type { DataSource } from '../src/workspace-contracts.ts';
import { appendActivity, describeActivity, describeUnlockedCards, readActivity, readCardActivity } from './activity.ts';
import { setCardDependencies } from './card-dependencies.ts';
import { attachPlanningRegistries, carryOverExpiredRuns } from './runs.ts';
import { defineText, serverText, serverLang, type Lang } from './i18n.ts';

/**
 * 2026-11-07: Node filesystem errors (EACCES, EBUSY, ...) carry absolute paths, so the browser gets the fallback
 * text and the original error stays in the server log. Our own validation errors keep their message.
 */
function clientMessage(error: unknown, fallback: string): string {
  const system = error && typeof error === 'object' && ['code', 'errno', 'syscall'].some(key => key in error);
  if (error instanceof Error && !system) return error.message;
  if (error !== null && error !== undefined) console.error('Deckmate:', error);
  return fallback;
}

const sourceConflictCodes = ['CATALOG_CONFLICT', 'CARD_CONFLICT', 'PARENT_CONFLICT', 'JOURNEY_CONFLICT', 'TEMPLATE_CONFLICT', 'CARD_OPTIONS_CONFLICT', 'PROJECT_TAGS_CONFLICT'];

const serviceText = defineText({
  watchStopped: "File watching has stopped. The catalog is reread on every request; restart Deckmate to restore automatic updates.",
  autoArchive: "Auto-archive accepted cards",
  watchersUpdated: "Watchers updated",
  noWatchers: "Nobody is watching this deck",
  guardiansUpdated: "Guardians updated",
  noGuardians: "Deck Guardians removed",
  automationUpdated: "Automation updated",
  inboxCleared: "Inbox destination cleared: this deck no longer takes Tasks.",
  autoTagOff: "Auto-tag disabled; existing card tags were kept",
  journalSaveFailed: "Changes were saved, but the activity entry could not be saved. Do not repeat the change; check access to tasks/deckmate-activity.",
  journalUpdateFailed: "Changes were saved, but the activity journal was not updated.",
  cardIdConflict: "A card with this ID already exists with different content. Refresh the catalog and create it again with a new ID.",
  sourceChanged: "The source changed in the files. Refresh the catalog and try again.",
  partialSave: "Some changes were saved. Refresh the data before continuing.",
  journeyRecovered: "An unfinished Journey save has now been completed. Check the Journey and repeat your action.",
  projectTemplatePartial: "Project template partly applied",
  editFailed: "Could not update the catalog.",
  carryOverFailed: (reason: (error: unknown) => string, error: unknown) => `Expired Runs were not carried over: ${reason(error)}. Will retry on the next refresh.`,
  autoArchiveFailed: (reason: (error: unknown) => string, error: unknown) => `Accepted cards were not auto-archived: ${reason(error)}. Will retry on the next refresh.`,
  archiveDetail: (card: { title: string }, previous: { archived?: boolean } | undefined, doneAt: string | null | undefined) => `${card.title}: Archive: ${JSON.stringify(previous?.archived ?? null)} → true (accepted ${doneAt}, older than ${autoArchiveAfterDays} days)`,
  watchers: (names: string[]) => `Watching this deck: ${names.join(', ')}`,
  guardians: (names: string[]) => `Deck Guardians: ${names.join(', ')}`,
  autoTag: (deck: { autoTag?: string | null; autoTagKeep?: boolean }) => `Auto-tag “${deck.autoTag}”${deck.autoTagKeep ? ' · kept when moved out of the deck' : ''}`,
  template: (deck: { templateMarkdown?: string | null; templateOwner?: string | null }) => `Card template: ${deck.templateMarkdown?.length ?? 0} characters${deck.templateOwner ? ', Owner ' + deck.templateOwner : ''}`,
  boardFailed: (failure: { stdout?: string; stderr?: string }) => `The edit was saved in Markdown, but the board was not rebuilt or did not pass validation. ${failure.stdout || failure.stderr || 'Check Python and Tools/board.py.'}`,
  indexFailed: (savedWarning: string | null, error: unknown) => `${savedWarning ? savedWarning + ' ' : ''}Changes were saved in Markdown, but the search index was not updated: ${clientMessage(error, 'index error')}.`,
  doNotCreateAgain: (message: string) => `${message} Do not create it again; check the catalog file.`,
}, {
  watchStopped: "Наблюдение за файлами остановилось. Каталог перечитывается при каждом запросе; для автоматических обновлений перезапустите Deckmate.",
  autoArchive: "Автоархивация «принято»",
  watchersUpdated: "Обновлено наблюдение",
  noWatchers: "Никто не наблюдает за колодой",
  guardiansUpdated: "Обновлены стражи",
  noGuardians: "Стражи колоды сняты",
  automationUpdated: "Обновлена автоматизация",
  inboxCleared: "Колода-приёмник Inbox снята: эта колода больше не принимает задачи.",
  autoTagOff: "Автотег выключен; теги на картах остались",
  journalSaveFailed: "Изменения сохранены, но запись журнала активности не удалось сохранить. Не повторяйте изменение; проверьте доступ к tasks/deckmate-activity.",
  journalUpdateFailed: "Изменения сохранены, но журнал активности не обновлён.",
  cardIdConflict: "Карточка с этим идентификатором уже существует с другим содержимым. Обновите каталог и создайте её заново с новым ID.",
  sourceChanged: "Источник изменился в файлах. Обновите каталог и повторите действие.",
  partialSave: "Часть изменений сохранена. Обновите данные перед продолжением.",
  journeyRecovered: "Незавершённое сохранение Journey сейчас завершено. Проверьте Journey и повторите действие.",
  projectTemplatePartial: "Шаблон проекта применён частично",
  editFailed: "Не удалось изменить каталог.",
  carryOverFailed: (reason: (error: unknown) => string, error: unknown) => `Перенос завершившихся Run не выполнен: ${reason(error)}. Повторим при следующем обновлении.`,
  autoArchiveFailed: (reason: (error: unknown) => string, error: unknown) => `Автоархивация «принято» не выполнена: ${reason(error)}. Повторим при следующем обновлении.`,
  archiveDetail: (card: { title: string }, previous: { archived?: boolean } | undefined, doneAt: string | null | undefined) => `${card.title}: Архив: ${JSON.stringify(previous?.archived ?? null)} → true (принято ${doneAt}, старше ${autoArchiveAfterDays} дней)`,
  watchers: (names: string[]) => `Наблюдают за колодой: ${names.join(', ')}`,
  guardians: (names: string[]) => `Стражи колоды: ${names.join(', ')}`,
  autoTag: (deck: { autoTag?: string | null; autoTagKeep?: boolean }) => `Автотег «${deck.autoTag}»${deck.autoTagKeep ? ' · тег остаётся при выносе из колоды' : ''}`,
  template: (deck: { templateMarkdown?: string | null; templateOwner?: string | null }) => `Шаблон карты: ${deck.templateMarkdown?.length ?? 0} символов${deck.templateOwner ? ', исполнитель ' + deck.templateOwner : ''}`,
  boardFailed: (failure: { stdout?: string; stderr?: string }) => `Правка сохранена в Markdown, но доска не пересобрана или не прошла проверку. ${failure.stdout || failure.stderr || 'Проверьте Python и Tools/board.py.'}`,
  indexFailed: (savedWarning: string | null, error: unknown) => `${savedWarning ? savedWarning + ' ' : ''}Изменения сохранены в Markdown, но поисковый индекс не обновлён: ${clientMessage(error, 'ошибка индекса')}.`,
  doNotCreateAgain: (message: string) => `${message} Не повторяйте создание; проверьте файл каталога.`,
});


const executeFile = promisify(execFile);

// 2026-11-04: check expired Runs on view rebuilds, at most once every 10 minutes.
const carryOverIntervalMs = 10 * 60 * 1000;
type MembershipBulk = Extract<CatalogEdit, { action: 'bulk-assign-deck' | 'bulk-add-track' }>;
type DeckSettingsEdit = Extract<CatalogEdit, { action: 'set-deck-watchers' | 'set-deck-guardians' | 'set-deck-automation' }>;

/** 2026-11-03: Older membership commands expose the same result contract as the unified bulk editor. */
function membershipOutcome(before: CatalogView, edit: MembershipBulk, updated: string[] | null, warnings: string[]): BulkOutcome {
  const byId = new Map(before.cards.map(card => [card.id, card]));
  const changed: string[] = [];
  const unchanged: string[] = [];
  for (const selection of edit.cards) {
    const card = byId.get(selection.cardId);
    const needsChange = !card || (edit.action === 'bulk-assign-deck' ? card.deckId !== edit.deckId : !card.trackIds.includes(edit.trackId));
    (needsChange ? changed : unchanged).push(selection.cardId);
  }
  const applied = updated === null ? changed : changed.filter(id => updated.includes(id));
  const appliedSet = new Set(applied);
  return { applied, unchanged, pending: changed.filter(id => !appliedSet.has(id)), warnings };
}
interface CachedCatalog {
  index: ProjectIndex | null;
  view: CatalogView | null;
  revision: number;
  builtRevision: number;
  loading: Promise<CatalogView> | null;
  watchFailed: boolean;
  pendingPaths: Set<string> | null;
  writeInvalidations: { paths: Set<string>; full: boolean } | null;
  housekeepingCheckedAt: number;
  housekeepingCheckedRevision: number;
  housekeepingWarnings: string[];
}

/** Accepted tasks are eligible for auto-archiving after 30 days (2026-11-04). */
const autoArchiveAfterDays = 30;

function localDateOffset(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localIsoDate(date);
}

/**
 * Auto-archive active, accepted Tasks older than the cutoff unless they resolve an open question.
 * Cards without doneAt do not age: only state changes set that date; never invent it retroactively.
 */
function autoArchiveCandidates(view: CatalogView, archiveAfterDays: number): CatalogCard[] {
  const deadline = localDateOffset(-archiveAfterDays);
  const openQuestionTargets = new Set<string>();
  for (const card of view.cards) {
    for (const question of card.openQuestions ?? []) {
      if (!question.taskRef) continue;
      try {
        const target = resolveReference(view.cards, 'c', question.taskRef, serverLang());
        if (target) openQuestionTargets.add(target.id);
      } catch { /* Parsing already warns about ambiguous links; they do not grant an exception. */ }
    }
  }
  return view.cards.filter(card => {
    const doneAt = card.doneAt;
    return card.kind === 'task' && card.state === 'done' && !card.archived && !card.deleted
      && typeof doneAt === 'string' && doneAt < deadline && !openQuestionTargets.has(card.id);
  });
}

function savedFailure(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'saved' in error && error.saved === true);
}

export class CatalogError extends Error {
  readonly status: number;
  readonly saved: boolean;
  constructor(status: number, message: string, saved = false) { super(message); this.status = status; this.saved = saved; }
}

export class CatalogService {
  private entries = new Map<string, CachedCatalog>();
  private writes: Promise<unknown> = Promise.resolve();
  private config: ServerConfig;
  private cacheDirectory: string;
  private carryOverBusy: Promise<void> | null = null;
  constructor(config: ServerConfig, cacheDirectory = environmentValue('INDEX') ?? path.join(homedir(), '.cache', 'deckmate')) {
    this.config = config;
    this.cacheDirectory = cacheDirectory;
  }

  root(source: DataSource): string {
    return source === 'sandbox' && this.config.writeRoot ? this.config.writeRoot : this.config.dataRoot;
  }

  private entry(source: DataSource, lang: Lang = serverLang()): CachedCatalog {
    const key = JSON.stringify([this.root(source), lang]);
    let cached = this.entries.get(key);
    if (!cached) {
      cached = { index: null, view: null, revision: 0, builtRevision: -1, loading: null, watchFailed: false, pendingPaths: null, writeInvalidations: null,
        housekeepingCheckedAt: 0, housekeepingCheckedRevision: -1, housekeepingWarnings: [] };
      this.entries.set(key, cached);
    }
    return cached;
  }

  invalidate(source: DataSource, relativePath?: string): void {
    for (const lang of ['en', 'ru'] as const) {
      const cached = this.entry(source, lang);
      cached.revision += 1;
      if (cached.writeInvalidations) {
        if (relativePath === undefined) cached.writeInvalidations.full = true;
        else cached.writeInvalidations.paths.add(relativePath);
      }
      if (relativePath === undefined) cached.pendingPaths = null;
      else cached.pendingPaths?.add(relativePath);
    }
  }
  watchFailed(source: DataSource): void {
    for (const lang of ['en', 'ru'] as const) this.entry(source, lang).watchFailed = true;
    this.invalidate(source);
  }

  private async openIndex(root: string): Promise<ProjectIndex> {
    if (this.cacheDirectory === ':memory:') return new ProjectIndex(':memory:');
    await mkdir(this.cacheDirectory, { recursive: true });
    const identity = createHash('sha256').update(JSON.stringify([root, serverLang()])).digest('hex').slice(0, 24);
    const filename = path.join(this.cacheDirectory, `index-${identity}.sqlite`);
    try { return new ProjectIndex(filename); }
    catch (error) {
      if (![11, 26].includes((error as { errcode?: number }).errcode ?? -1)) throw error;
      // 2026-11-03: Only corrupt cache errors justify removal; locks and permissions must remain visible.
      for (const suffix of ['', '-wal', '-shm']) await unlink(filename + suffix).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
      return new ProjectIndex(filename);
    }
  }

  /**
   * 2026-11-05: carry unfinished cards out of expired Runs and auto-archive tasks accepted over 30 days ago
   * before returning the writable source's view, so the response includes those changes.
   * Check on rebuilds after writable-file changes and every 10 minutes as time passes.
   * Failures become view warnings and are retried at the next check.
   */
  private async checkHousekeeping(): Promise<void> {
    while (this.carryOverBusy) await this.carryOverBusy;
    const cached = this.entry('sandbox');
    const revisionChanged = cached.revision !== cached.housekeepingCheckedRevision;
    if (!revisionChanged && Date.now() - cached.housekeepingCheckedAt < carryOverIntervalMs) return;
    cached.housekeepingCheckedAt = Date.now();
    cached.housekeepingCheckedRevision = cached.revision;
    const root = this.config.writeRoot!;
    // 2026-11-05: expired Run checks need the same incremental inputs as GET.
    // Load lazily: projects without overdue work need no catalog read here.
    this.carryOverBusy = withCatalogSnapshot(root, async () => {
      await cached.loading?.catch(() => {});
      return cached.view && cached.pendingPaths !== null
        ? refreshProjectCatalog(root, cached.view, cached.pendingPaths)
        : readFreshProjectCatalog(root);
    }, refreshProjectCatalog, async () => {
      const warnings: string[] = [];
      const reason = (error: unknown) => clientMessage(error, serverText(serviceText).editFailed);
      try {
        await assertWritable(this.config);
        const outcome = await carryOverExpiredRuns(root);
        if (outcome.blocked) warnings.push(outcome.blocked);
        if (outcome.movedCount > 0) this.invalidate('sandbox', 'tasks/deckmate-card-options.md');
      } catch (error) {
        warnings.push(serverText(serviceText).carryOverFailed(reason, error));
      }
      try {
        if (await this.runAutoArchive()) this.invalidate('sandbox', 'tasks/deckmate-card-options.md');
      } catch (error) {
        warnings.push(serverText(serviceText).autoArchiveFailed(reason, error));
      } finally {
        cached.housekeepingWarnings = warnings;
      }
    });
    try { await this.carryOverBusy; }
    finally { this.carryOverBusy = null; }
  }

  get(source: DataSource): Promise<CatalogView> {
    return this.load(source);
  }

  private async load(source: DataSource, prepare?: () => Promise<CatalogView>): Promise<CatalogView> {
    const cached = this.entry(source);
    if (cached.loading) {
      if (!prepare) return cached.loading;
      await cached.loading.catch(() => {});
    }
    if (source === 'sandbox' && this.config.editMode !== 'read-only' && this.config.writeRoot) await this.checkHousekeeping();
    if (cached.loading) {
      if (!prepare) return cached.loading;
      await cached.loading.catch(() => {});
    }
    if (!prepare && cached.view && !cached.watchFailed && cached.builtRevision === cached.revision) return cached.view;
    cached.loading = (async () => {
      if (prepare) {
        try {
          cached.view = await prepare();
          cached.builtRevision = -1;
        } catch (error) { cached.pendingPaths = null; throw error; }
      }
      let view: CatalogView;
      do {
        const revision = cached.revision;
        const pending = cached.pendingPaths;
        cached.pendingPaths = new Set();
        try {
          view = cached.view && pending !== null && !cached.watchFailed
            ? await refreshProjectCatalog(this.root(source), cached.view, pending)
            : await readFreshProjectCatalog(this.root(source));
          // Run and Milestone registries share the same view as cards.
          await attachPlanningRegistries(view, this.root(source));
          if (source === 'sandbox') view.warnings.push(...cached.housekeepingWarnings);
          if (cached.watchFailed) view.warnings.push(serverText(serviceText).watchStopped);
          cached.index ??= await this.openIndex(this.root(source));
          cached.index.replace(view);
          view.indexedAt = cached.index.summary().indexedAt;
          cached.view = view;
          cached.builtRevision = revision;
        } catch (error) { cached.pendingPaths = null; throw error; }
      } while (cached.builtRevision !== cached.revision);
      return view;
    })();
    try { return await cached.loading; }
    finally { cached.loading = null; }
  }

  async search(source: DataSource, query: CatalogQuery, options: { hits: true }): Promise<SearchCard[]>;
  async search(source: DataSource, query: CatalogQuery, options?: { hits?: boolean }): Promise<(CatalogCard & { hits?: SearchHit[] })[]>;
  async search(source: DataSource, query: CatalogQuery, options: { hits?: boolean } = {}): Promise<(CatalogCard & { hits?: SearchHit[] })[]> {
    await this.get(source);
    const index = this.entry(source).index!;
    const cards = index.search(query);
    if (!options.hits) return cards;
    try { return await attachSearchHits(this.root(source), cards, index.searchSnippets(query, cards.map(card => card.id))); }
    catch (error) {
      if (error instanceof SearchSourceChangedError) throw new CatalogError(409, error.message);
      throw error;
    }
  }

  /**
   * 2026-11-05: auto-archiving uses the shared write guard; true means cards were archived.
   * Find candidates in the latest view; reread the full catalog only when candidates exist.
   */
  private async runAutoArchive(): Promise<boolean> {
    const built = this.entry('sandbox').view;
    if (!built || !autoArchiveCandidates(built, autoArchiveAfterDays).length) return false;
    const root = await assertWritable(this.config);
    const before = await readProjectCatalog(root);
    const candidates = autoArchiveCandidates(before, autoArchiveAfterDays);
    if (!candidates.length) return false;
    const changes: Record<string, CardOptionsPatch> = {};
    for (const card of candidates) changes[card.id] = { archived: true };
    const options = await readCardOptions(root);
    const plan = await prepareCardOptionsPatch(root, options.hash, changes);
    if (!plan.changed) return false;
    await plan.publish();
    // Every archived card needs a journal entry; describeActivity skips cards without a deck,
    // so build the event directly to include tasks outside decks.
    for (const card of candidates) {
      const previous = before.cards.find(item => item.id === card.id);
      const doneAt = card.doneAt;
      const event: DeckActivityEvent = {
        schema: 1,
        id: randomUUID(),
        at: new Date().toISOString(),
        action: 'bulk-edit-cards',
        actor: 'Deckmate',
        summary: serviceText[before.formatLanguage].autoArchive,
        cards: [{ id: card.id, title: card.title }],
        deckIds: [...new Set([previous?.deckId, card.deckId].filter((id): id is string => Boolean(id)))],
        details: [serviceText[before.formatLanguage].archiveDetail(card, previous, doneAt)],
      };
      await appendActivity(root, event, before.formatLanguage);
    }
    return true;
  }

  activity(source: DataSource, deckId: string, limit?: number, cursor?: string) {
    return readActivity(this.root(source), deckId, limit, cursor);
  }

  /** Deck settings produce one journal event with a readable status summary (2026-11-04). */
  private async journalDeckSettings(after: CatalogView, edit: DeckSettingsEdit): Promise<void> {
    const deck = after.decks.find(candidate => candidate.id === edit.deckId);
    if (!deck) return;
    // 2026-11-06: journal records are project files and speak the project's format language.
    const text = serviceText[after.formatLanguage];
    const labels = (ids: string[] | undefined) => (ids ?? []).map(id => after.members?.find(member => member.id === id)?.label ?? id);
    let summary = '';
    const details: string[] = [];
    if (edit.action === 'set-deck-watchers') {
      const names = labels(deck.watcherIds);
      summary = text.watchersUpdated;
      details.push(names.length ? text.watchers(names) : text.noWatchers);
    } else if (edit.action === 'set-deck-guardians') {
      const names = labels(deck.guardianIds);
      summary = text.guardiansUpdated;
      details.push(names.length ? text.guardians(names) : text.noGuardians);
    } else {
      summary = text.automationUpdated;
      details.push(deck.autoTag
        ? text.autoTag(deck)
        : text.autoTagOff);
      if (deck.templateMarkdown || deck.templateOwner != null || deck.templateEffort != null || deck.templatePriority != null) {
        details.push(text.template(deck));
      }
    }
    const event: DeckActivityEvent = { schema: 1, id: randomUUID(), at: new Date().toISOString(), action: edit.action,
      actor: 'Deckmate', summary, cards: [], deckIds: [deck.id], details };
    await appendActivity(this.root('sandbox'), event, after.formatLanguage);
  }

  cardActivity(source: DataSource, cardId: string, limit?: number, cursor?: string) {
    return readCardActivity(this.root(source), cardId, limit, cursor);
  }

  /** 2026-11-04: the actor is written into every record (null = unknown API caller) so notifications can skip one's own changes. */
  private async journal(before: CatalogView, after: CatalogView, action: string, affectedCardIds: Set<string> | undefined, affectedDeckId: string | undefined, actorMemberId: string | null, returnReasons?: ReadonlyMap<string, string>, partialReason?: string | null): Promise<string | null> {
    try {
      let event = describeActivity(before, after, action, affectedCardIds, affectedDeckId, returnReasons);
      if (action === 'apply-project-template' && partialReason) {
        // 2026-11-05: even an interrupted publication with no visible cards must explain its saved warning.
        event ??= { schema: 1, id: randomUUID(), at: new Date().toISOString(), action, actor: 'Deckmate',
          summary: '', cards: [], deckIds: [], details: [] };
        event.summary = serviceText[after.formatLanguage].projectTemplatePartial;
        event.details.push(partialReason);
      }
      if (event) await appendActivity(this.root('sandbox'), { ...event, actorMemberId }, after.formatLanguage);
      // Accepting the last dependency produces a separate journal event for each newly unblocked card.
      for (const unlocked of describeUnlockedCards(before, after)) await appendActivity(this.root('sandbox'), { ...unlocked, actorMemberId }, after.formatLanguage);
      return null;
    } catch {
      return serverText(serviceText).journalSaveFailed;
    }
  }

  /** 2026-11-04: external writes such as CSV imports share the mutation queue for unambiguous journal snapshots. Include every changed card. */
  recordMutation<Result>(action: string, mutate: () => Promise<Result>, actorMemberId: string | null = null): Promise<Result & { warnings?: string[] }> {
    const operation = this.writes.then(async () => {
      await assertWritable(this.config);
      const before = await readProjectCatalog(this.root('sandbox'));
      const result = await mutate();
      this.invalidate('sandbox');
      let warning: string | null;
      try { warning = await this.journal(before, await readProjectCatalog(this.root('sandbox')), action, undefined, undefined, actorMemberId); }
      catch { warning = serverText(serviceText).journalUpdateFailed; }
      return Object.assign({}, result, warning ? { warnings: [warning] } : {});
    });
    this.writes = operation.catch(() => {});
    return operation;
  }

  /** Rebuild the board after a mechanics edit; source data is already saved and cannot be rolled back. */
  /** 2026-11-09: completes an unfinished Journey save; a recovery stopped by a foreign edit is a conflict that names the file. */
  private async recoverJourney(root: string, journeyId: string): Promise<boolean> {
    try { return await recoverJourneyOperation(root, journeyId); }
    catch (error) {
      if (savedFailure(error)) throw new CatalogError(409, clientMessage(error, serverText(serviceText).partialSave), true);
      if (error instanceof Error && sourceConflictCodes.includes(error.message)) throw new CatalogError(409, serverText(serviceText).sourceChanged);
      throw new CatalogError(422, clientMessage(error, serverText(serviceText).editFailed));
    }
  }

  private async rebuildBoard(root: string): Promise<void> {
    let script: string;
    try { script = await containedFile(root, 'Tools/board.py'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; // No board exists to rebuild.
      throw error;
    }
    try {
    const rebuild = packagePath('tools', 'rebuild-board.py');
      const result = await executeFile(this.config.python, ['-B', rebuild, root], { cwd: root, windowsHide: true, timeout: 15000, encoding: 'utf8' });
      for (const line of result.stdout.split(/\r?\n/u)) {
        if (line.startsWith('rebuilt: tasks/')) catalogFileChanged(root, line.slice('rebuilt: '.length).trim());
      }
      await executeFile(this.config.python, ['-B', script, '--check'], { cwd: root, windowsHide: true, timeout: 15000, encoding: 'utf8' });
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string };
      const message = serverText(serviceText).boardFailed(failure);
      throw Object.assign(new Error(message), { saved: true });
    }
  }

  edit(edit: CatalogEdit, source: DataSource, actorMemberId: string | null = null): Promise<CatalogView> {
    // 2026-11-10: a decision explicitly confirms a human; its journal author must match the Markdown signature,
    // including when the ambient UI/CLI actor is an agent. readRuleCard validates the chosen human before saving.
    if (edit.action === 'record-decision') actorMemberId = edit.memberId;
    const operation = this.writes.then(async () => {
      const cached = this.entry(source);
      await cached.loading;
      const root = await assertWritable(this.config, source);
      const invalidations = { paths: new Set<string>(), full: false };
      cached.writeInvalidations = invalidations;
      try {
        const before = await readProjectCatalog(root);
        return await withCatalogSnapshot(root, before, refreshProjectCatalog, async () => {
          let savedWarning: string | null = null;
          let bulkOutcome: BulkOutcome | undefined;
          // 2026-11-09: recovery consumes its own prepared bytes, before the new request's manifest/target checks (including imports).
          // It runs outside the edit's own error handling: a recovery that stops halfway must answer 409, not pass for a completed request.
          if ('journeyId' in edit && edit.journeyId && edit.action !== 'abandon-journey-operation') {
            const recovered = await this.recoverJourney(root, edit.journeyId);
            if (recovered) this.invalidate(source);
            const current = await readJourney(root, edit.journeyId);
            if (!current || current.journey.fileHash !== edit.journeyHash) {
              throw new CatalogError(409, serverText(serviceText)[recovered ? 'journeyRecovered' : 'sourceChanged']);
            }
          }
          try {
            let changedPaths: string[];
            if (edit.action === 'abandon-journey-operation') {
              changedPaths = await abandonJourneyOperation(root, edit.journeyId, edit.journalHash);
            } else if (edit.action === 'bulk-edit-cards') {
              const result = await editCatalogBulk(root, edit, actorMemberId);
              changedPaths = result.changedPaths; bulkOutcome = result.outcome;
              if (bulkOutcome.warnings.length) savedWarning = bulkOutcome.warnings.join(' ');
            } else if (edit.action === 'update-journey' || edit.action === 'save-journey-template' || edit.action === 'add-journey-step-lesson') {
              // 2026-11-04: templates and step lessons update Journey files; role imports also update the manifest.
              const catalog = await readProjectCatalog(root);
              if (catalog.manifestHash !== edit.manifestHash) throw new Error('CATALOG_CONFLICT');
              if (edit.action === 'update-journey') changedPaths = await updateJourney(root, catalog, edit);
              else if (edit.action === 'add-journey-step-lesson') changedPaths = await addJourneyStepLesson(root, catalog, edit, actorMemberId, localIsoDate());
              else {
                changedPaths = await saveJourneyTemplate(root, catalog, edit);
              }
            } else if (edit.action === 'set-card-dependencies') {
              // 2026-11-04: dependencies live in native-card YAML and do not change the manifest.
              changedPaths = await setCardDependencies(root, edit);
            } else {
              changedPaths = await editProjectCatalog(root, edit, actorMemberId);
              if (edit.action === 'bulk-assign-deck' || edit.action === 'bulk-add-track') bulkOutcome = membershipOutcome(before, edit, null, []);
            }
            for (const relative of changedPaths) catalogFileChanged(root, relative);
            if (changedPaths.some(relative => isMechanicPath(relative))) await this.rebuildBoard(root);
          }
          catch (error) {
            // 2026-11-09: a later-stage conflict must not make an already saved mutation look safe to repeat.
            if (error && typeof error === 'object' && 'saved' in error && error.saved === true) {
              // 2026-11-09: a conflict code is an internal marker, not text for the person; show the partial-save notice instead.
              const readable = error instanceof Error && !sourceConflictCodes.includes(error.message) && error.message !== 'CARD_ID_CONFLICT';
              savedWarning = readable ? clientMessage(error, serverText(serviceText).partialSave) : serverText(serviceText).partialSave;
              if (edit.action === 'bulk-assign-deck' || edit.action === 'bulk-add-track') {
                const updated = 'updated' in error && Array.isArray(error.updated) ? error.updated.filter((id): id is string => typeof id === 'string') : [];
                bulkOutcome = membershipOutcome(before, edit, updated, [savedWarning]);
              }
            }
            else if (error instanceof Error && error.message === 'CARD_ID_CONFLICT') throw new CatalogError(409, serverText(serviceText).cardIdConflict);
            else if (error instanceof Error && sourceConflictCodes.includes(error.message)) throw new CatalogError(409, serverText(serviceText).sourceChanged);
            else throw new CatalogError(422, clientMessage(error, serverText(serviceText).editFailed));
          }
          // 2026-11-03: Journal is secondary; a logging failure must never turn a successful write into a retryable failure.
          try {
            const after = await readProjectCatalog(root);
            if (edit.action === 'set-deck-kind' && before.inboxDeckId === edit.deckId && after.inboxDeckId == null) {
              savedWarning = [savedWarning, serverText(serviceText).inboxCleared].filter(Boolean).join(' ');
            }
            let affected: Set<string> | undefined;
            if (bulkOutcome) affected = new Set([...bulkOutcome.applied, ...bulkOutcome.pending, ...bulkOutcome.created ?? []]);
            else if ('cards' in edit) affected = new Set(edit.cards.map(card => card.cardId));
            // 2026-11-04: open questions affect the Doc and the decision Task being created or accepted.
            else if (edit.action === 'raise-decision') affected = new Set([edit.cardId, edit.taskCardId]);
            else if (edit.action === 'record-decision') affected = new Set([edit.cardId, ...after.cards
              .filter(card => card.parentId === edit.cardId && card.state === 'done'
                && (before.cards.find(previous => previous.id === card.id)?.state ?? null) !== 'done')
              .map(card => card.id)]);
            else if ('cardId' in edit && edit.action !== 'apply-journey') affected = new Set([edit.cardId]);
            else if (edit.action === 'apply-journey') affected = new Set(after.cards.filter(card => card.parentId === edit.cardId && card.journey?.journeyId === edit.journeyId).map(card => card.id));
            // 2026-11-04: Journey edits affect only cards it already created; a new Journey has no cards.
            else if (edit.action === 'update-journey' || (edit.action === 'import-journey-template' && edit.journeyId !== null)) {
              const journeyId = edit.journeyId;
              affected = new Set(after.cards.filter(card => card.journey?.journeyId === journeyId).map(card => card.id));
            }
            else if (edit.action === 'apply-project-template') affected = new Set(after.cards.filter(card => !before.cards.some(previous => previous.id === card.id)).map(card => card.id));
            else affected = new Set();
            if (edit.action === 'bulk-edit-cards' && edit.change.kind === 'promote-parent') affected.add(edit.change.cardId);
            // Record the review return reason in this card's journal transition (2026-11-04).
            let returnReasons: Map<string, string> | undefined;
            if (edit.action === 'set-card-state' && edit.returnReason?.trim()) returnReasons = new Map([[edit.cardId, edit.returnReason.trim()]]);
            if (edit.action === 'bulk-edit-cards' && edit.change.kind === 'state' && edit.change.returnReason?.trim()) {
              const reason = edit.change.returnReason.trim();
              returnReasons = new Map(before.cards.filter(card => affected.has(card.id) && card.state === 'review')
                .map(card => [card.id, reason]));
            }
            const warning = await this.journal(before, after, edit.action, affected, 'deckId' in edit ? edit.deckId ?? undefined : undefined, actorMemberId, returnReasons, savedWarning);
            if (warning) savedWarning = [savedWarning, warning].filter(Boolean).join(' ');
            // 2026-11-04: watching, guardian, and automation changes need events that describeActivity cannot distinguish.
            if (edit.action === 'set-deck-watchers' || edit.action === 'set-deck-guardians' || edit.action === 'set-deck-automation') {
              await this.journalDeckSettings(after, edit);
            }
          } catch { savedWarning = [savedWarning, serverText(serviceText).journalUpdateFailed].filter(Boolean).join(' '); }
          try {
            const view = await this.load('sandbox', async () => {
              // 2026-11-05: retain events consumed by concurrent GETs, and hold the
              // shared loading promise while installing the POST's updated snapshot.
              const pending = cached.pendingPaths;
              cached.pendingPaths = new Set();
              for (const relative of [...pending ?? [], ...invalidations.paths]) catalogFileChanged(root, relative);
              if (invalidations.full) catalogFileChanged(root);
              cached.revision += 1;
              return readProjectCatalog(root);
            });
            if (savedWarning) return { ...view, ...(bulkOutcome ? { bulkOutcome } : {}), savedWarning };
            return { ...view, ...(bulkOutcome ? { bulkOutcome } : {}) };
          }
          catch (error) {
            const message = serverText(serviceText).indexFailed(savedWarning, error);
            try {
              const view = await readProjectCatalog(root);
              return { ...view, ...(bulkOutcome ? { bulkOutcome } : {}), savedWarning: message };
            } catch { throw new CatalogError(503, serverText(serviceText).doNotCreateAgain(message), true); }
          }
        });
      } finally {
        cached.writeInvalidations = null;
        const otherLanguage = serverLang() === 'en' ? 'ru' : 'en';
        const other = this.entry(source, otherLanguage);
        other.revision += 1;
        other.pendingPaths = null;
      }
    });
    this.writes = operation.catch(() => {});
    return operation;
  }

  async close(): Promise<void> {
    await this.writes;
    for (const cached of this.entries.values()) {
      await cached.loading?.catch(() => {});
      cached.index?.close();
    }
    this.entries.clear();
  }
}
