import type { Readable } from 'node:stream';
import { defineText, serverText } from './i18n.ts';

const messages = defineText({
  failed: 'Deckmate: shutdown failed',
  timedOut: 'Deckmate: shutdown timed out, exiting',
}, {
  failed: 'Deckmate: не удалось завершить работу',
  timedOut: 'Deckmate: завершение работы затянулось, выход',
});

type ClosableApp = { close(): Promise<unknown> };
type ShutdownHost = {
  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  exit(code: number): void;
};

function isShutdownMessage(data: unknown): boolean {
  return typeof data === 'object' && data !== null && (data as { type?: unknown }).type === 'shutdown';
}

// The desktop shell spawns the server as a plain child process, and on Windows killing it delivers no
// SIGINT/SIGTERM, so with DECKMATE_SHUTDOWN_STDIN=1 the shell instead writes a { "type": "shutdown" }
// line to the server's stdin to let Fastify, chokidar and the SQLite index close cleanly; the end of
// stdin, when the shell itself died, runs the same close path (2026-11-09). Without the variable stdin
// is not touched (CLI, Docker, npm run dev). Signals and stdin messages share one close path.
export function installShutdownHandlers(app: ClosableApp,
  host: ShutdownHost = process, input?: Readable): () => Promise<void> {
  let closing: Promise<void> | undefined;
  let stopReadingInput: (() => void) | undefined;
  const shutdown = () => {
    if (closing) return closing;
    stopReadingInput?.();
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
  if (input) {
    // A chunk can split a line or carry several, and lines may end with \r\n; a half-written multibyte
    // character must not become a replacement char mid-line, so decode incrementally.
    const decoder = new TextDecoder('utf-8');
    let pending = '';
    const onData = (chunk: Buffer) => {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        let message: unknown;
        try { message = JSON.parse(line.endsWith('\r') ? line.slice(0, -1) : line); } catch { continue; }
        if (isShutdownMessage(message)) void shutdown();
      }
    };
    const onInputGone = () => { void shutdown(); };
    input.on('data', onData);
    input.on('end', onInputGone);
    input.on('close', onInputGone);
    input.on('error', onInputGone);
    // Once shutdown starts, a flowing stdin handle would otherwise hold the event loop (and force the
    // unref'd five-second guard to fire); pause and unref it so close() alone decides how the process ends.
    // The error listener stays: a pipe error after the shell dies must not become an uncaught 'error'
    // event in the middle of close() (2026-11-09); shutdown() is idempotent.
    stopReadingInput = () => {
      input.off('data', onData);
      input.off('end', onInputGone);
      input.off('close', onInputGone);
      input.pause();
      (input as Readable & { unref?: () => void }).unref?.();
    };
  }
  return shutdown;
}
