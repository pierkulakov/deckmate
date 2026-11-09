import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { installShutdownHandlers } from '../server/shutdown.ts';

afterEach(() => { vi.restoreAllMocks(); });

function fakes(close: () => Promise<unknown> = async () => undefined) {
  const app = { close: vi.fn(close) };
  const host = Object.assign(new EventEmitter(), { exit: vi.fn<(code: number) => void>() });
  installShutdownHandlers(app, host);
  return { app, host };
}

it('closes the app and exits with 0 on SIGINT', async () => {
  const { app, host } = fakes();
  host.emit('SIGINT');
  await vi.waitFor(() => expect(host.exit).toHaveBeenCalledWith(0));
  expect(app.close).toHaveBeenCalledOnce();
});

it('logs a failed close and exits with 1', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const { host } = fakes(async () => { throw new Error('busy'); });
  host.emit('SIGINT');
  await vi.waitFor(() => expect(host.exit).toHaveBeenCalledWith(1));
  expect(error).toHaveBeenCalled();
});

it('works without an stdin channel in plain Node', async () => {
  const { host } = fakes();
  host.emit('SIGTERM');
  await vi.waitFor(() => expect(host.exit).toHaveBeenCalledWith(0));
});

function stdinFakes(close: () => Promise<unknown> = async () => undefined) {
  const app = { close: vi.fn(close) };
  const host = Object.assign(new EventEmitter(), { exit: vi.fn<(code: number) => void>() });
  const input = new PassThrough();
  installShutdownHandlers(app, host, input);
  return { app, host, input };
}

it('closes the app and exits with 0 on a shutdown line from stdin', async () => {
  const { app, host, input } = stdinFakes();
  input.write('{"type":"shutdown"}\n');
  await vi.waitFor(() => expect(host.exit).toHaveBeenCalledWith(0));
  expect(app.close).toHaveBeenCalledOnce();
});

it('shares one close between repeated shutdown lines and the end of stdin', async () => {
  const { app, host, input } = stdinFakes();
  input.write('{"type":"shutdown"}\n{"type":"shutdown"}\n');
  input.end();
  await vi.waitFor(() => expect(host.exit).toHaveBeenCalledWith(0));
  expect(app.close).toHaveBeenCalledOnce();
  expect(host.exit).toHaveBeenCalledOnce();
});

it('shares one close between signals and the shutdown line from stdin', async () => {
  const { app, host, input } = stdinFakes();
  host.emit('SIGTERM');
  input.write('{"type":"shutdown"}\n');
  await vi.waitFor(() => expect(host.exit).toHaveBeenCalledWith(0));
  expect(app.close).toHaveBeenCalledOnce();
  expect(host.exit).toHaveBeenCalledOnce();
});

it('reads a shutdown line split across chunks', async () => {
  const { app, host, input } = stdinFakes();
  input.write('{"type":"shut');
  input.write('down"}\n');
  await vi.waitFor(() => expect(host.exit).toHaveBeenCalledWith(0));
  expect(app.close).toHaveBeenCalledOnce();
});

it('tolerates CRLF line endings on stdin', async () => {
  const { host, input } = stdinFakes();
  input.write('{"type":"shutdown"}\r\n');
  await vi.waitFor(() => expect(host.exit).toHaveBeenCalledWith(0));
});

it('ignores garbage stdin lines', async () => {
  const { app, host, input } = stdinFakes();
  input.write('garbage\nnot json\n{"type":"ping"}\n42\n');
  await new Promise(resolve => setImmediate(resolve));
  expect(app.close).not.toHaveBeenCalled();
  expect(host.exit).not.toHaveBeenCalled();
  input.write('{"type":"shutdown"}\n');
  await vi.waitFor(() => expect(host.exit).toHaveBeenCalledWith(0));
  expect(app.close).toHaveBeenCalledOnce();
});

it('shuts down when stdin ends', async () => {
  const { app, host, input } = stdinFakes();
  input.end();
  await vi.waitFor(() => expect(host.exit).toHaveBeenCalledWith(0));
  expect(app.close).toHaveBeenCalledOnce();
});

it('shuts down when stdin errors', async () => {
  const { app, host, input } = stdinFakes();
  input.emit('error', new Error('pipe broke'));
  await vi.waitFor(() => expect(host.exit).toHaveBeenCalledWith(0));
  expect(app.close).toHaveBeenCalledOnce();
});
