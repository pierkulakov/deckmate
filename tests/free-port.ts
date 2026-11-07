import { createServer } from 'node:net';

/**
 * A port nothing listens on right now (2026-11-05): fixed test ports collided with demo and agent servers on this
 * machine (4396, 4398). Tests that start a real server take one of these instead.
 */
export async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  await new Promise<void>(resolve => probe.close(() => resolve()));
  if (!address || typeof address === 'string') throw new Error('No free port.');
  return address.port;
}
