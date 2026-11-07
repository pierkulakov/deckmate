import type { BulkOutcome } from '../src/bulk-contracts.ts';
import { beginSave } from './save-activity.ts';
import type { CatalogEdit, CatalogView } from '../src/catalog-contracts.ts';
import type { DataSource, WorkspaceSnapshot } from '../src/workspace-contracts.ts';
import { actorHeaders } from './current-member.ts';
import { defineText, locale, textNow } from './i18n.ts';
import { readCardState } from '../src/format-vocabulary.ts';
import { emitSignal } from './onboarding/signals.ts';

const text = defineText({
  connectionFailed: 'Deckmate is not responding. Check that it is running, then try again.',
  notSavedOffline: 'Not saved: Deckmate is not responding. Check that it is running, then try again.',
  unconfirmedBulk: 'The previous bulk action is unconfirmed. Refresh the catalog before retrying; your selection and settings are saved.',
  sandboxOnly: 'Catalog changes are available in the test copy. Switch the source and try again.',
  conflict: 'The catalog changed in the files. Data has been refreshed and your form values are preserved. Review them and save again.',
  partialBulk: (applied: string, pending: string) => `Saved ${applied}, remaining ${pending}. Review the remaining selected cards and try again.`,
  savedWithoutConfirmation: 'Some changes may have been saved, but the result was not received. Refresh the catalog before retrying; your selection and copy IDs are saved.',
  notLoaded: 'The catalog is not loaded.',
}, {
  connectionFailed: 'Deckmate не отвечает. Проверьте, что он запущен, и повторите.',
  notSavedOffline: 'Не сохранено: Deckmate не отвечает. Проверьте, что он запущен, и повторите.',
  unconfirmedBulk: 'Результат предыдущего массового действия не подтверждён. Обновите каталог перед повтором; выбор и параметры сохранены.',
  sandboxOnly: 'Изменения каталога доступны в тестовой копии. Переключите источник и повторите действие.',
  conflict: 'Каталог изменился в файлах. Данные обновлены, введённые значения сохранены в форме. Проверьте их и сохраните ещё раз.',
  partialBulk: (applied: string, pending: string) => `Сохранено ${applied}, осталось ${pending}. Проверьте оставшиеся выбранные карты и повторите действие.`,
  savedWithoutConfirmation: 'Часть изменений могла сохраниться, но результат не получен. Обновите каталог перед повтором; выбор и ID копий сохранены.',
  notLoaded: 'Каталог не загружен.',
});

type WithoutHash<Edit> = Edit extends CatalogEdit ? Omit<Edit, 'manifestHash'> & { manifestHash?: string } : never;
export type CatalogAction = WithoutHash<CatalogEdit>;
interface CatalogState {
  catalog: CatalogView | null;
  loading: boolean;
  pending: boolean;
  error: string | null;
  warning: string | null;
}

function optimisticCatalog(view: CatalogView, action: CatalogAction | null): CatalogView {
  if (!action || (action.action !== 'set-card-state' && action.action !== 'set-card-properties')) return view;
  const state = action.action === 'set-card-state' ? readCardState(action.state) : undefined;
  if (action.action === 'set-card-state' && !state) return view;
  const patch = action.action === 'set-card-state' ? { state: state! } : { owner: action.owner, effort: action.effort, priority: action.priority };
  return { ...view, cards: view.cards.map(card => card.id === action.cardId ? { ...card, ...patch } : card) };
}

// 2026-11-06: fetch rejects with a TypeError ("Failed to fetch") when the server is gone; the browser's own wording means
// nothing to a person, so a stopped server reads as Deckmate not responding. Server replies keep their own message.
function failureMessage(error: unknown, offline = textNow(text).connectionFailed): string {
  if (error instanceof TypeError) return offline;
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return offline;
}

async function readResponse(response: Response): Promise<CatalogView> {
  const result: unknown = await response.json();
  if (!response.ok) throw result;
  return result as CatalogView;
}

/** 2026-11-05: one confirmed snapshot per source; optimistic edits never change its revision hashes. */
export class CatalogStore {
  private state: CatalogState = { catalog: null, loading: true, pending: false, error: null, warning: null };
  private confirmed: CatalogView | null = null;
  private optimistic: CatalogAction | null = null;
  private listeners = new Set<() => void>();
  private revision = 0;
  private loadedRevision = -1;
  private writeEpoch = 0;
  private request: Promise<void> | null = null;
  private refreshQueued = false;
  private bulkNeedsRefresh = false;
  private connectionReady: Promise<void> | undefined;
  readonly source: DataSource;

  constructor(source: DataSource, connectionReady?: Promise<void>) {
    this.source = source;
    this.connectionReady = connectionReady?.then(() => { this.connectionReady = undefined; });
  }
  getSnapshot = (): CatalogState => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(change: Partial<CatalogState>) {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }
  private showConfirmed() {
    this.publish({ catalog: this.confirmed ? optimisticCatalog(this.confirmed, this.optimistic) : null });
  }
  dismissWarning = () => this.publish({ warning: null });
  invalidate() { this.revision += 1; }

  refresh = (): Promise<void> => {
    // Coalesce callers in one turn, but fence a read predating a completed CSV/planning write.
    if (!this.refreshQueued) {
      this.invalidate();
      this.refreshQueued = true;
      queueMicrotask(() => { this.refreshQueued = false; });
    }
    return this.load();
  };

  load = (): Promise<void> => {
    if (this.connectionReady) return this.connectionReady.then(() => this.load());
    if (this.request) return this.request;
    if (this.confirmed && this.loadedRevision === this.revision) return Promise.resolve();
    this.publish({ loading: true });
    this.request = this.readUntilCurrent().finally(() => {
      this.request = null;
      this.publish({ loading: false });
    });
    return this.request;
  };

  private async readUntilCurrent() {
    do {
      const revision = this.revision;
      const epoch = this.writeEpoch;
      try {
        const response = await fetch(`/api/catalog?source=${this.source}`, { cache: 'no-store' });
        const result = await readResponse(response);
        // A POST response is authoritative over a GET that started before it completed.
        if (epoch !== this.writeEpoch) continue;
        const previous = this.confirmed;
        this.confirmed = result;
        this.loadedRevision = revision;
        this.bulkNeedsRefresh = false;
        if (!this.state.pending) this.optimistic = null;
        this.showConfirmed();
        this.publish({ error: null });
        if (previous && previous !== result) emitSignal({ type: 'catalog-observed', before: previous, after: result });
      } catch (failure) {
        if (epoch !== this.writeEpoch) continue;
        this.publish({ error: failureMessage(failure) });
        return;
      }
    } while (this.loadedRevision !== this.revision);
  }

  /** Every catalog write is shown by the server status chip as Saving… and then Saved (2026-11-05); panels print no saving lines. */
  async edit(snapshot: WorkspaceSnapshot, action: CatalogAction, onOutcome?: (outcome: BulkOutcome) => void): Promise<boolean> {
    if (this.state.pending) return false;
    const settle = beginSave();
    let saved = false;
    try {
      saved = await this.send(snapshot, action, onOutcome);
      return saved;
    } finally {
      settle(saved);
    }
  }

  private async send(snapshot: WorkspaceSnapshot, action: CatalogAction, onOutcome?: (outcome: BulkOutcome) => void): Promise<boolean> {
    const isBulk = action.action === 'bulk-edit-cards' || action.action === 'bulk-assign-deck' || action.action === 'bulk-add-track';
    if (isBulk && this.bulkNeedsRefresh) {
      this.publish({ error: textNow(text).unconfirmedBulk });
      return false;
    }
    const token = (snapshot as WorkspaceSnapshot & { token?: string }).token;
    const base = this.confirmed;
    if (!snapshot.writable || snapshot.source !== this.source || this.source !== 'sandbox' || !token || !base) {
      this.publish({ error: textNow(text).sandboxOnly });
      return false;
    }
    // Dirty forms supply their own base hashes, including options/registry hashes in the action.
    const sourceHash = action.sourceHash ?? ('cardId' in action ? base.cards.find(card => card.id === action.cardId)?.sourceHash : undefined);
    const manifestHash = action.manifestHash ?? base.manifestHash;
    const startedRevision = this.revision;
    let savedWithoutConfirmation = false;
    this.optimistic = action;
    this.publish({ pending: true, error: null });
    this.showConfirmed();
    try {
      const response = await fetch('/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-deckmate-token': token, ...actorHeaders(base.members ?? []) },
        body: JSON.stringify({ ...action, source: 'sandbox', manifestHash, sourceHash }),
      });
      if (response.status === 409) {
        this.optimistic = null;
        this.showConfirmed();
        this.invalidate();
        await this.load();
        this.publish({ error: textNow(text).conflict });
        return false;
      }
      const result = await readResponse(response);
      this.writeEpoch += 1;
      this.confirmed = result;
      this.loadedRevision = startedRevision;
      this.optimistic = null;
      this.showConfirmed();
      emitSignal({ type: 'catalog-edit', action, before: base, after: result });
      this.publish({ warning: result.warnings.find(message => /изменения сохранены|не полностью|changes (?:were |have been )?saved|not (?:fully|completely)/iu.test(message)) ?? null });
      if (this.loadedRevision !== this.revision) void this.load();
      if (result.bulkOutcome) {
        onOutcome?.(result.bulkOutcome);
        if (result.bulkOutcome.pending.length > 0) {
          const numberFormat = new Intl.NumberFormat(locale());
          this.publish({ error: textNow(text).partialBulk(numberFormat.format(result.bulkOutcome.applied.length), numberFormat.format(result.bulkOutcome.pending.length)) });
          return false;
        }
      }
      return true;
    } catch (failure) {
      if (failure && typeof failure === 'object' && 'saved' in failure && failure.saved === true) {
        savedWithoutConfirmation = true;
        this.writeEpoch += 1;
        this.invalidate();
        this.bulkNeedsRefresh = isBulk;
        this.publish({ warning: failureMessage(failure), error: isBulk
          ? textNow(text).savedWithoutConfirmation : null });
        // A saved create must not be replayed with another ID; bulk retries require a fresh confirmed read.
        void this.load();
        return !isBulk;
      }
      this.publish({ error: failureMessage(failure, textNow(text).notSavedOffline) });
      return false;
    } finally {
      if (!savedWithoutConfirmation) this.optimistic = null;
      this.showConfirmed();
      this.publish({ pending: false });
    }
  }
}

const stores = new Map<DataSource, CatalogStore>();
let session: string | undefined;
let connectionReady: Promise<void> | undefined;
let releaseConnection: (() => void) | undefined;

/** Subscribe before the first GET, so no file edit can fall between the read and the socket opening. */
export function prepareCatalogSession(token: string) {
  if (token === session) return;
  stores.clear();
  session = token;
  connectionReady = new Promise(resolve => { releaseConnection = resolve; });
}

export function releaseCatalogSession(token: string) {
  if (token !== session) return;
  connectionReady = undefined;
  releaseConnection?.();
  releaseConnection = undefined;
}

export function catalogStore(source: DataSource, token?: string): CatalogStore {
  if (token !== undefined && token !== session) {
    stores.clear();
    session = token;
    connectionReady = undefined;
    releaseConnection = undefined;
  }
  let store = stores.get(source);
  if (!store) { store = new CatalogStore(source, connectionReady); stores.set(source, store); }
  return store;
}

/** Paths with no catalog representation still refresh their own consumers (Vision/activity/notifications). */
export function affectsCatalog(relativePath?: string): boolean {
  return !relativePath || (!/^boards\/[^/]+\.excalidraw$/u.test(relativePath)
    && !/^tasks\/(?:deckmate|freetion)-activity\//u.test(relativePath));
}

export function invalidateCatalogs() {
  for (const store of stores.values()) store.invalidate();
}

export async function readFreshCatalog(source: DataSource): Promise<CatalogView> {
  const store = catalogStore(source);
  await store.refresh();
  const state = store.getSnapshot();
  if (state.error || !state.catalog) throw new Error(state.error ?? textNow(text).notLoaded);
  return state.catalog;
}
