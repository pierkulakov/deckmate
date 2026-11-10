import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { installShutdownHandlers } from './shutdown.ts';

const config = await loadConfig();
const app = await createApp(config);
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
installShutdownHandlers(app, process,
  process.env.DECKMATE_SHUTDOWN_STDIN === '1' ? process.stdin : undefined);
