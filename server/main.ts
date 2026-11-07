import { createApp } from './app.ts';
import { loadConfig } from './config.ts';

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
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void app.close(); });
