import { createServer } from 'node:net';

/**
 * A loopback port nothing is listening on right now (2026-11-05: fixed test ports collided with demo and agent
 * servers on this machine, 4396 and 4398). With a preferred port an EADDRINUSE probe falls back to an arbitrary
 * free one, so tools that want a stable origin keep it when possible (2026-11-11: the former private copies lived
 * in tests/free-port.ts, tools/desktop-smoke.ts, tools/updater-e2e.ts and tools/readme-shots.ts).
 */
export async function freePort(preferred = 0): Promise<number> {
  const probe = createServer();
  try {
    await new Promise<void>((resolve, reject) => { probe.once('error', reject); probe.listen(preferred, '127.0.0.1', resolve); });
    const address = probe.address();
    if (!address || typeof address === 'string') throw new Error('Cannot allocate a port.');
    return address.port;
  } catch (error) {
    if (preferred && (error as NodeJS.ErrnoException).code === 'EADDRINUSE') return freePort(0);
    throw error;
  } finally {
    if (probe.listening) await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  }
}
