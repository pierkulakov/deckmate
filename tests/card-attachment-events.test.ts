import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { attachmentRegistryKey, attachmentRegistryKeyFromPath, subscribeCardAttachments } from '../client/card-attachment-events.ts';
import { publishWorkspaceFileChange, subscribeWorkspaceFiles } from '../client/workspace-file-events.ts';

vi.mock('../client/workspace-file-events.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../client/workspace-file-events.ts')>();
  return { ...actual, subscribeWorkspaceFiles: vi.fn(actual.subscribeWorkspaceFiles) };
});

const unsubscribe: Array<() => void> = [];
afterEach(() => {
  for (const close of unsubscribe.splice(0)) close();
  vi.mocked(subscribeWorkspaceFiles).mockClear();
  vi.restoreAllMocks();
});
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };
const id = 'card:ca1d0000-0000-4000-8000-000000000001';

it('shares one workspace listener for hundreds of tiles and dispatches only the matching source/card', async () => {
  const callbacks = Array.from({ length: 300 }, () => vi.fn());
  for (const [index, refresh] of callbacks.entries()) {
    const cardId = 'card:ca1d0000-0000-4000-8000-' + String(index + 1).padStart(12, '0');
    unsubscribe.push(subscribeCardAttachments('sandbox', cardId, refresh));
  }
  const live = vi.fn();
  unsubscribe.push(subscribeCardAttachments('live', id, live));
  expect(subscribeWorkspaceFiles).toHaveBeenCalledTimes(1);
  publishWorkspaceFileChange({ source: 'sandbox', relativePath: `tasks/freetion-assets/cards/${id.slice(5)}/attachments.md` });
  await settle();
  expect(callbacks[0]).toHaveBeenCalledTimes(1);
  expect(callbacks.slice(1).every(refresh => refresh.mock.calls.length === 0)).toBe(true);
  expect(live).not.toHaveBeenCalled();
  publishWorkspaceFileChange({ source: 'sandbox' });
  await settle();
  expect(callbacks[0]).toHaveBeenCalledTimes(2);
  expect(callbacks.slice(1).every(refresh => refresh.mock.calls.length === 1)).toBe(true);
  expect(live).not.toHaveBeenCalled();
});

it('matches native and legacy keys, including an event before hashing finishes, and cleans up', async () => {
  const legacy = 'task:tasks/legacy.md:123';
  const hash = createHash('sha256').update(legacy).digest();
  const key = 'legacy-' + hash.toString('hex').slice(0, 16);
  expect(await attachmentRegistryKey(id.toUpperCase())).toBe(id.slice(5));
  expect(await attachmentRegistryKey(legacy)).toBe(key);
  expect(attachmentRegistryKeyFromPath(`tasks/deckmate-assets/cards/${key}/other.md`)).toBeUndefined();
  // 2026-11-10: Web Crypto completion is independent of timers; hold the digest until the early event has been published.
  let finishHash!: (value: ArrayBuffer) => void;
  const hashing = new Promise<ArrayBuffer>(resolve => { finishHash = resolve; });
  const digest = vi.spyOn(crypto.subtle, 'digest').mockReturnValueOnce(hashing);
  const refresh = vi.fn();
  const close = subscribeCardAttachments('sandbox', legacy, refresh);
  unsubscribe.push(close);
  try {
    expect(digest).toHaveBeenCalledTimes(1);
    publishWorkspaceFileChange({ source: 'sandbox', relativePath: `tasks/deckmate-assets/cards/${key}/attachments.md` });
    expect(refresh).not.toHaveBeenCalled();
  } finally {
    finishHash(Uint8Array.from(hash).buffer);
  }
  await vi.waitFor(() => { expect(refresh).toHaveBeenCalledTimes(1); });
  close();
  publishWorkspaceFileChange({ source: 'sandbox' });
  await settle();
  expect(refresh).toHaveBeenCalledTimes(1);
  const another = subscribeCardAttachments('sandbox', id, refresh);
  unsubscribe.push(another);
  expect(subscribeWorkspaceFiles).toHaveBeenCalledTimes(2);
});
