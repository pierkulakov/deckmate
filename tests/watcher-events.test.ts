import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { createApp } from '../server/app.ts';
import * as fileEvents from '../server/file-events.ts';

const roots: string[] = [];
const apps: FastifyInstance[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  for (const app of apps.splice(0)) await app.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it.each(['initial scan', 'connected session'])('replays a watcher failure from the %s to later connections for an empty project', async timing => {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-watcher-events-'));
  roots.push(root);
  vi.stubEnv('DECKMATE_INDEX', path.join(root, 'index'));
  const project = path.join(root, 'project');
  await mkdir(project);
  let fail!: () => void;
  vi.spyOn(fileEvents, 'watchProjectFiles').mockImplementation((_root, _changed, onError) => {
    fail = () => onError?.(new Error('Watch unavailable'));
    return { ready: timing === 'initial scan' ? Promise.reject(new Error('Watch unavailable')) : Promise.resolve(), close: async () => {} };
  });
  const app = await createApp({ editMode: 'read-only', dataRoot: project, writeRoot: null, port: 0, python: 'python', projectName: 'Empty' }, { deferStartup: true });
  apps.push(app);
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const snapshot = await (await fetch(address + '/api/snapshot?source=live')).json() as { token: string };
  async function connect() {
    const socket = new WebSocket(address.replace('http:', 'ws:') + '/api/events?token=' + snapshot.token);
    sockets.push(socket);
    const messages: unknown[] = [];
    socket.on('message', data => messages.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    return { socket, messages };
  }
  const first = await connect();
  if (timing === 'connected session') fail();
  const event = { type: 'watcher-error', source: 'live' };
  await vi.waitFor(() => expect(first.messages).toEqual([event]));
  const view = await (await fetch(address + '/api/catalog?source=live')).json() as { cards: unknown[]; documents: unknown[]; warnings: string[] };
  expect(view.cards).toEqual([]);
  expect(view.documents).toEqual([]);
  expect(view.warnings.join(' ')).toContain('File watching has stopped');
  first.socket.close();
  await new Promise<void>(resolve => first.socket.once('close', resolve));
  const reconnected = await connect();
  await vi.waitFor(() => expect(reconnected.messages).toEqual([event]));
});
