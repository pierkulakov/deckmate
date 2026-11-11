import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiFailure, DataSource, WorkspaceSnapshot } from '../src/workspace-contracts.ts';
import { createRefreshBatch } from './refresh-batch.ts';
import { affectsCatalog, catalogStore, invalidateCatalogs, prepareCatalogSession, releaseCatalogSession } from './catalog-store.ts';
import { defineText, textNow, useLang, useText } from './i18n.ts';
import { publishWorkspaceFileChange } from './workspace-file-events.ts';

const text = defineText({
  watcherStopped: 'Automatic file watching has stopped. Refresh data manually or restart Deckmate.',
  connectionFailed: 'Could not connect to Deckmate. Check that the app is running.',
}, {
  watcherStopped: 'Автоматическое наблюдение за файлами остановилось. Обновляйте данные вручную или перезапустите Deckmate.',
  connectionFailed: 'Не удалось связаться с Deckmate. Проверьте, что приложение запущено.',
});

type SnapshotResponse = WorkspaceSnapshot & { token: string };
/** live: events arrive; reconnecting: the socket dropped or is opening and retries every 1.5 s; offline: stopped from the app or silent for 8 s. */
export type ConnectionState = 'live' | 'reconnecting' | 'offline';
const offlineAfterMs = 8000;
type WorkspaceFailure = ApiFailure & { textKey?: keyof typeof text.en };

export function useWorkspace() {
  const lang = useLang();
  const t = useText(text);
  const previousLang = useRef(lang);
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [source, setSource] = useState<DataSource>(() => new URLSearchParams(location.search).get('catalogSource') === 'live' ? 'live' : 'sandbox');
  const [failure, setFailure] = useState<WorkspaceFailure | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('reconnecting');
  const [sessionToken, setSessionToken] = useState<string>();
  const [updatedAt, setUpdatedAt] = useState(0);
  const [eventLatency, setEventLatency] = useState(0);
  const token = useRef('');
  const generation = useRef(0);
  const currentSource = useRef(source);
  currentSource.current = source;

  // Card edits go through useCatalog (/api/catalog); this hook only reads snapshots and handles
  // WebSocket updates. The Docs tab and its /api/block and /api/status routes were removed (2026-11-04).
  const refresh = useCallback(async (selected: DataSource, detectedAt?: number) => {
    const requestGeneration = ++generation.current;
    try {
      const response = await fetch(`/api/snapshot?source=${selected}`, { cache: 'no-store' });
      if (!response.ok) throw await response.json();
      const data = await response.json() as SnapshotResponse;
      if (requestGeneration !== generation.current || selected !== currentSource.current) return;
      if (data.source !== selected) {
        // 2026-11-05: preserve deep links while normalizing a source unavailable in this edit mode.
        const url = new URL(location.href);
        url.searchParams.set('catalogSource', data.source);
        history.replaceState(null, '', url);
        setSource(data.source);
        return;
      }
      token.current = data.token;
      prepareCatalogSession(data.token);
      setSessionToken(data.token);
      setSnapshot(data); setUpdatedAt(previous => Math.max(Date.now(), previous + 1));
      // 2026-11-06: a read that succeeds proves the server answers again, so the banner left by a restart clears itself;
      // a stopped file watcher stays reported, because a snapshot read does not restart it.
      setFailure(previous => previous?.code === 'WATCHER' ? previous : null);
      if (detectedAt) requestAnimationFrame(() => setEventLatency(Date.now() - detectedAt));
    } catch (error) {
      if (requestGeneration === generation.current && selected === currentSource.current) setFailure(normalizeFailure(error));
    }
  }, []);

  useEffect(() => {
    setFailure(null); setSnapshot(null); void refresh(source);
    return () => { generation.current += 1; };
  }, [source, refresh]);
  useEffect(() => {
    if (previousLang.current === lang) return;
    previousLang.current = lang;
    invalidateCatalogs();
    void Promise.all([catalogStore(source, token.current || undefined).load(), refresh(source)]);
  }, [lang, source, refresh]);
  useEffect(() => {
    if (!sessionToken) return;
    let disposed = false;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout>;
    let offlineTimer: ReturnType<typeof setTimeout> | undefined;
    let reconnecting = false;
    let catalogChanged = false;
    let snapshotChanged = false;
    const changedFiles = createRefreshBatch((selected, detectedAt) => {
      const needsCatalog = catalogChanged;
      const needsSnapshot = snapshotChanged;
      catalogChanged = false;
      snapshotChanged = false;
      if (disposed || selected !== currentSource.current) return;
      const store = catalogStore(selected, sessionToken);
      void Promise.all([
        needsCatalog ? store.load() : Promise.resolve(),
        needsSnapshot ? refresh(selected) : Promise.resolve(),
      ]).then(() => {
        if (disposed || selected !== currentSource.current) return;
        // 2026-11-05: boards, activity and notification consumers still receive every change batch.
        setUpdatedAt(previous => Math.max(Date.now(), previous + 1));
        requestAnimationFrame(() => setEventLatency(Date.now() - detectedAt));
      });
    });
    function connect() {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/events?token=${encodeURIComponent(sessionToken!)}`);
      socket.onopen = () => {
        if (disposed) return;
        clearTimeout(offlineTimer);
        offlineTimer = undefined;
        setConnection('live');
        releaseCatalogSession(sessionToken!);
        // Initial consumers already share their first read. A reconnect must catch missed events.
        if (reconnecting) {
          publishWorkspaceFileChange({ source: currentSource.current });
          invalidateCatalogs();
          void catalogStore(currentSource.current, sessionToken).load();
          void refresh(currentSource.current);
        }
      };
      socket.onmessage = event => {
        if (disposed) return;
        const message = JSON.parse(event.data) as { type: string; source: DataSource; relativePath?: string; detectedAt: number };
        if (message.type === 'changed') {
          publishWorkspaceFileChange(message);
          // Invalidate before batching: switching source must not lose a queued change.
          if (affectsCatalog(message.relativePath)) catalogStore(message.source, sessionToken).invalidate();
          if (message.source === currentSource.current) {
            catalogChanged ||= affectsCatalog(message.relativePath);
            snapshotChanged ||= !message.relativePath || message.relativePath === 'tasks/iterations.md';
            changedFiles.queue(message.source, message.detectedAt);
          }
        }
        if (message.type === 'watcher-error') {
          catalogStore(message.source, sessionToken).invalidate();
          if (message.source !== currentSource.current) return;
          changedFiles.cancel();
          setFailure({ code: 'WATCHER', message: textNow(text).watcherStopped, textKey: 'watcherStopped' });
          void catalogStore(message.source, sessionToken).load();
          void refresh(message.source);
        }
      };
      socket.onclose = () => {
        if (disposed) return;
        // 2026-11-05: a short drop reads as reconnecting; only a server silent for 8 s, or stopped from the app, is offline.
        setConnection(previous => previous === 'offline' ? 'offline' : 'reconnecting');
        offlineTimer ??= setTimeout(() => { if (!disposed) setConnection('offline'); }, offlineAfterMs);
        // Read-only browsing remains available if the socket is unavailable; reconnect revalidates it.
        releaseCatalogSession(sessionToken!);
        reconnecting = true;
        invalidateCatalogs();
        // A restarted server has a new token; refresh it even if the old socket cannot authenticate.
        timer = setTimeout(() => { void refresh(currentSource.current); connect(); }, 1500);
      };
      socket.onerror = () => socket?.close();
    }
    connect();
    return () => { disposed = true; clearTimeout(timer); clearTimeout(offlineTimer); changedFiles.cancel(); socket?.close(); };
  }, [sessionToken, refresh]);

  async function shutdown() {
    try {
      const response = await fetch('/api/shutdown', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-deckmate-token': token.current }, body: '{}' });
      if (!response.ok) throw await response.json();
      setConnection('offline');
      return true;
    } catch (error) { setFailure(normalizeFailure(error)); return false; }
  }

  return { snapshot, source, setSource, failure: failure?.textKey ? { ...failure, message: t[failure.textKey] } : failure,
    clearFailure: () => setFailure(null), connected: connection === 'live', connection,
    updatedAt, eventLatency, refresh: async () => {
      await Promise.all([catalogStore(source, token.current || undefined).refresh(), refresh(source)]);
    }, shutdown };
}

function normalizeFailure(error: unknown): WorkspaceFailure {
  if (error instanceof Error) return { code: 'NETWORK', message: textNow(text).connectionFailed, textKey: 'connectionFailed' };
  if (error && typeof error === 'object' && 'message' in error) return { code: 'NETWORK', ...error } as ApiFailure;
  return { code: 'NETWORK', message: textNow(text).connectionFailed, textKey: 'connectionFailed' };
}
