import type { DataSource } from '../src/workspace-contracts.ts';
import { subscribeWorkspaceFiles, type WorkspaceFileChange } from './workspace-file-events.ts';

function nativeCardKey(cardId: string): string | undefined {
  return /^card:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu.exec(cardId)?.[1].toLowerCase();
}

export async function attachmentRegistryKey(cardId: string): Promise<string> {
  const native = nativeCardKey(cardId);
  if (native) return native;
  // 2026-11-10: legacy IDs contain separators; the registry uses the server's SHA-256 directory key.
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cardId));
  return 'legacy-' + Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

export function attachmentRegistryKeyFromPath(relativePath: string): string | undefined {
  return /^tasks\/(?:deckmate|freetion)-assets\/cards\/([^/]+)\/attachments\.md$/u.exec(relativePath)?.[1];
}

const callbacks = new Map<DataSource, Map<string, Set<() => void>>>();
const pendingKeys = new Set<Promise<void>>();
let subscribers = 0;
let unsubscribeWorkspace: (() => void) | undefined;

async function refreshChangedCard(change: WorkspaceFileChange): Promise<void> {
  const key = change.relativePath ? attachmentRegistryKeyFromPath(change.relativePath) : undefined;
  if (change.relativePath && !key) return;
  // 2026-11-10: an event can precede a legacy key's digest, including its very first attachment.
  if (pendingKeys.size) await Promise.all(pendingKeys);
  const cards = callbacks.get(change.source);
  if (!cards) return;
  if (key) {
    for (const refresh of cards.get(key) ?? []) refresh();
  } else {
    for (const listeners of cards.values()) for (const refresh of listeners) refresh();
  }
}

export function subscribeCardAttachments(source: DataSource, cardId: string, refresh: () => void): () => void {
  // 2026-11-10: hundreds of tiles share one workspace listener; a registry event looks up only its card.
  if (!unsubscribeWorkspace) unsubscribeWorkspace = subscribeWorkspaceFiles(change => { void refreshChangedCard(change); });
  subscribers++;
  let active = true;
  let key: string | undefined;
  const ready = attachmentRegistryKey(cardId).then(value => {
    if (!active) return;
    key = value;
    let cards = callbacks.get(source);
    if (!cards) { cards = new Map(); callbacks.set(source, cards); }
    let listeners = cards.get(key);
    if (!listeners) { listeners = new Set(); cards.set(key, listeners); }
    listeners.add(refresh);
  });
  pendingKeys.add(ready);
  void ready.finally(() => pendingKeys.delete(ready));
  return () => {
    if (!active) return;
    active = false;
    const cards = callbacks.get(source);
    if (key) {
      const listeners = cards?.get(key);
      listeners?.delete(refresh);
      if (!listeners?.size) cards?.delete(key);
    }
    if (!cards?.size) callbacks.delete(source);
    if (--subscribers === 0) { unsubscribeWorkspace?.(); unsubscribeWorkspace = undefined; }
  };
}
