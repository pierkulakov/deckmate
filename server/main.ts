import * as module from 'node:module';
import { loadConfig } from './config.ts';
import { installShutdownHandlers } from './shutdown.ts';

// 2026-11-12: the desktop sidecar runs this entry directly rather than passing through the CLI.
module.enableCompileCache?.();
const config = await loadConfig();
const { createApp } = await import('./app.ts');
const desktop = process.env.DECKMATE_SHUTDOWN_STDIN === '1';
const app = await createApp(config, {
  deferStartup: true,
  // 2026-11-13: the existing stdout pipe reaches the shell even when the board cannot finish loading.
  onStartupError: desktop ? error => console.log(`Deckmate: project-error ${JSON.stringify({
    message: (error instanceof Error ? error.message : String(error)).slice(0, 4000),
  })}`) : undefined,
});
try {
  await app.listen({ host: config.host ?? '127.0.0.1', port: config.port });
} catch (error) {
  await app.close();
  throw error;
}
export const address = `http://127.0.0.1:${config.port}`;
console.log(`Deckmate: ${address}`);
// Deckmate Desktop (Tauri) sets DECKMATE_SHUTDOWN_STDIN=1 and stops the server through its stdin; without
// the variable stdin is left alone so CLI, Docker and npm run dev keep the terminal.
installShutdownHandlers(app, process, desktop ? process.stdin : undefined);
