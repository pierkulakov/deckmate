import { watch } from 'chokidar';
import { join, relative, sep } from 'node:path';

const watchedDirectories = ['features', 'docs', 'tasks', 'cards', 'boards'];
const notifyDebounceMs = 40;

export interface ProjectFileWatcher {
  ready: Promise<void>;
  close(): Promise<void>;
}

export function watchProjectFiles(root: string, onChange: (relativePath: string) => void, onFailure?: (error: Error) => void): ProjectFileWatcher {
  const watcher = watch(watchedDirectories.map(directory => join(root, directory)), {
    ignoreInitial: true,
    followSymlinks: false,
    atomic: 100,
    awaitWriteFinish: { stabilityThreshold: 30, pollInterval: 10 },
  });
  const pendingNotifications = new Map<string, ReturnType<typeof setTimeout>>();
  let closed = false;
  let readySettled = false;
  let settleReady = () => {};

  const notifyOnce = (absolutePath: string) => {
    if (closed) return;
    const relativePath = relative(root, absolutePath).split(sep).join('/');
    if (!/^(?:(?:features|docs|cards)\/.+|tasks\/[^/]+|tasks\/(?:journeys|journey-templates|(?:deckmate|freetion)-activity)\/.+)\.md$/u.test(relativePath)
      && !/^boards\/[^/]+\.excalidraw$/u.test(relativePath)) return;
    const scheduled = pendingNotifications.get(relativePath);
    if (scheduled !== undefined) clearTimeout(scheduled);
    pendingNotifications.set(relativePath, setTimeout(() => {
      pendingNotifications.delete(relativePath);
      if (!closed) onChange(relativePath);
    }, notifyDebounceMs));
  };

  watcher.on('add', notifyOnce);
  watcher.on('change', notifyOnce);
  watcher.on('unlink', notifyOnce);

  const ready = new Promise<void>((resolve, reject) => {
    settleReady = () => {
      if (readySettled) return;
      readySettled = true;
      resolve();
    };
    watcher.once('ready', settleReady);
    watcher.on('error', (error) => {
      if (closed) return;
      if (readySettled) {
        console.error('Deckmate file watcher failed:', error);
        onFailure?.(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      readySettled = true;
      reject(error);
    });
  });

  return {
    ready,
    close: async () => {
      // 2026-11-03: Closing the OS watcher is asynchronous; block new timers before awaiting it.
      closed = true;
      for (const timer of pendingNotifications.values()) clearTimeout(timer);
      pendingNotifications.clear();
      await watcher.close();
      settleReady();
    },
  };
}
