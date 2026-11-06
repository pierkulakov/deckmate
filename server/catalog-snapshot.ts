import { AsyncLocalStorage } from 'node:async_hooks';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { CatalogView } from '../src/catalog-contracts.ts';
import { serverLang } from './i18n.ts';

type RefreshCatalog = (root: string, previous: CatalogView, paths: Iterable<string>) => Promise<CatalogView>;

interface CatalogSnapshot {
  roots: Set<string>;
  language: ReturnType<typeof serverLang>;
  view: CatalogView | null;
  initial: () => Promise<CatalogView>;
  refresh: RefreshCatalog;
  pending: Set<string>;
  reload: boolean;
}

// 2026-11-05: only catalog assembly uses this request-local snapshot. Disk reads in
// publication guards must stay fresh, including reads made after a staged write.
const snapshots = new AsyncLocalStorage<CatalogSnapshot>();

function matchingSnapshot(root: string): CatalogSnapshot | undefined {
  const snapshot = snapshots.getStore();
  return snapshot?.roots.has(path.resolve(root)) && snapshot.language === serverLang() ? snapshot : undefined;
}

/** 2026-11-05: a full scan may reuse parsing, but must still read and hash every file. */
export function currentCatalogSnapshot(root: string): CatalogView | null {
  return matchingSnapshot(root)?.view ?? null;
}

export async function withCatalogSnapshot<Result>(root: string, view: CatalogView | (() => Promise<CatalogView>), refresh: RefreshCatalog,
  operation: () => Promise<Result>): Promise<Result> {
  if (matchingSnapshot(root)) return operation();
  const roots = new Set([path.resolve(root), await realpath(root)]);
  const initial = typeof view === 'function' ? view : async () => view;
  return snapshots.run({ roots, language: serverLang(), view: typeof view === 'function' ? null : view, initial, refresh, pending: new Set(), reload: false }, operation);
}

export function catalogFileChanged(root: string, relativePath?: string): void {
  const snapshot = snapshots.getStore();
  if (!snapshot || !snapshot.roots.has(path.resolve(root))) return;
  if (relativePath === undefined) { snapshot.reload = true; return; }
  const relative = relativePath.replaceAll('\\', '/');
  snapshot.pending.add(relative);
}

export async function readCatalogSnapshot(root: string, readFresh: () => Promise<CatalogView>): Promise<CatalogView> {
  const snapshot = matchingSnapshot(root);
  if (!snapshot) return readFresh();
  snapshot.view ??= await snapshot.initial();
  if (snapshot.reload) {
    snapshot.view = await readFresh();
    snapshot.reload = false;
    snapshot.pending.clear();
  } else if (snapshot.pending.size) {
    const pending = [...snapshot.pending];
    const next = await snapshot.refresh(root, snapshot.view, pending);
    for (const relative of pending) snapshot.pending.delete(relative);
    snapshot.view = next;
  }
  return snapshot.view;
}
