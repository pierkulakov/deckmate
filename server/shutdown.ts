import { defineText, serverText } from './i18n.ts';

const messages = defineText({
  failed: 'Deckmate: shutdown failed',
  timedOut: 'Deckmate: shutdown timed out, exiting',
}, {
  failed: 'Deckmate: не удалось завершить работу',
  timedOut: 'Deckmate: завершение работы затянулось, выход',
});

export type ParentPort = { on(event: 'message', listener: (message: { data?: unknown }) => void): void };
type ClosableApp = { close(): Promise<unknown> };
type ShutdownHost = {
  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  exit(code: number): void;
};

function isShutdownMessage(data: unknown): boolean {
  return typeof data === 'object' && data !== null && (data as { type?: unknown }).type === 'shutdown';
}

// The Electron shell runs the server through utilityProcess.fork and on Windows its kill() delivers no
// SIGINT/SIGTERM, so it first posts { type: 'shutdown' } to let Fastify, chokidar and the SQLite index
// close cleanly (2026-11-08). Signals and that message share one close path.
export function installShutdownHandlers(app: ClosableApp, parentPort: ParentPort | undefined,
  host: ShutdownHost = process): () => Promise<void> {
  let closing: Promise<void> | undefined;
  const shutdown = () => {
    if (closing) return closing;
    // A pending history or schedule write can keep close() waiting; the CLI has no parent to kill it, so the
    // process gives up after five seconds instead of hanging (2026-11-08).
    const guard = setTimeout(() => { console.error(serverText(messages).timedOut); host.exit(1); }, 5000);
    guard.unref();
    closing = app.close().then(() => host.exit(0), (error: unknown) => {
      console.error(serverText(messages).failed, error);
      host.exit(1);
    }).finally(() => clearTimeout(guard));
    return closing;
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) host.on(signal, () => { void shutdown(); });
  parentPort?.on('message', message => {
    if (isShutdownMessage(message.data)) void shutdown();
  });
  return shutdown;
}
