import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { installShutdownHandlers, type ParentPort } from '../server/shutdown.ts';

afterEach(() => { vi.restoreAllMocks(); });

function fakes(close: () => Promise<unknown> = async () => undefined) {
  const app = { close: vi.fn(close) };
  const port = new EventEmitter();
  const host = Object.assign(new EventEmitter(), { exit: vi.fn<(code: number) => void>() });
  installShutdownHandlers(app, port as ParentPort, host);
  return { app, port, host };
}

it('closes the app and exits with 0 on a shutdown message from the Electron parent', async () => {
  const { app, port, host } = fakes();
  port.emit('message', { data: { type: 'shutdown' } });
  await vi.waitFor(() => expect(host.exit).toHaveBeenCalledWith(0));
  expect(app.close).toHaveBeenCalledOnce();
});

it('ignores other parent messages', async () => {
  const { app, port, host } = fakes();
  port.emit('message', { data: { type: 'ping' } });
  port.emit('message', { data: 'shutdown' });
  port.emit('message', {});
  await Promise.resolve();
  expect(app.close).not.toHaveBeenCalled();
  expect(host.exit).not.toHaveBeenCalled();
});

it('logs a failed close and exits with 1', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const { port, host } = fakes(async () => { throw new Error('busy'); });
  port.emit('message', { data: { type: 'shutdown' } });
  await vi.waitFor(() => expect(host.exit).toHaveBeenCalledWith(1));
  expect(error).toHaveBeenCalled();
});

it('shares one close between signals and the shutdown message', async () => {
  const { app, port, host } = fakes();
  host.emit('SIGTERM');
  port.emit('message', { data: { type: 'shutdown' } });
  await vi.waitFor(() => expect(host.exit).toHaveBeenCalledWith(0));
  expect(app.close).toHaveBeenCalledOnce();
  expect(host.exit).toHaveBeenCalledOnce();
});

it('works without a parent port in plain Node', async () => {
  const app = { close: vi.fn(async () => undefined) };
  const host = Object.assign(new EventEmitter(), { exit: vi.fn<(code: number) => void>() });
  installShutdownHandlers(app, undefined, host);
  host.emit('SIGINT');
  await vi.waitFor(() => expect(host.exit).toHaveBeenCalledWith(0));
});
