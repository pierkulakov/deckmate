import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const mainSource = readFileSync(new URL('../desktop/main.js', import.meta.url), 'utf8');

// 2026-11-08: the desktop package ships only its existing entrypoints; isolate their declarations without importing Electron.
function mainDeclarations(names: string[], context: Record<string, unknown> = {}) {
  const declarations = names.map(name => {
    const declaration = mainSource.match(new RegExp(`^(?:(?:async )?function ${name}\\([^]*?^\\}|const ${name} = [^\\n]+;)`, 'm'))?.[0];
    if (!declaration) throw new Error(`Missing main-process declaration: ${name}`);
    return declaration;
  });
  return runInNewContext(`${declarations.join('\n')}\n({ ${names.join(', ')} })`, { URL, path, ...context });
}

type Sender = {
  sender: object;
  mainWebContents: object | null;
  senderFrame: { url: string } | null;
  mainFrame: { url: string };
  serverUrl: string | null;
};
type Recent = { path: string; name: string; lastOpened: string };
const { boardSenderAllowed, findRecent } = mainDeclarations(['samePath', 'boardSenderAllowed', 'findRecent']) as {
  boardSenderAllowed: (input: Sender) => boolean;
  findRecent: (recent: Recent[], input: unknown) => Recent | undefined;
};

function senderInput(): Sender {
  const frame = { url: 'http://127.0.0.1:3141/board?deck=one' };
  const contents = { mainFrame: frame };
  return { sender: contents, mainWebContents: contents, senderFrame: frame, mainFrame: frame, serverUrl: 'http://127.0.0.1:3141' };
}

describe('board sender boundary', () => {
  it('allows only the main frame at the current server origin', () => {
    expect(boardSenderAllowed(senderInput())).toBe(true);
  });

  it('rejects a foreign webContents even with the same origin', () => {
    expect(boardSenderAllowed({ ...senderInput(), sender: {} })).toBe(false);
  });

  it('rejects a same-origin Vision iframe', () => {
    const input = senderInput();
    expect(boardSenderAllowed({ ...input, senderFrame: { url: 'http://127.0.0.1:3141/r/vision.html' } })).toBe(false);
  });

  it.each([
    'http://127.0.0.1:3142/board', 'http://localhost:3141/board',
    'https://127.0.0.1:3141/board', 'file:///launcher/index.html', 'not a URL',
  ])('rejects a main frame with a different or invalid origin: %s', url => {
    const input = senderInput();
    input.mainFrame.url = url;
    expect(boardSenderAllowed(input)).toBe(false);
  });

  it('rejects an absent server, window or sender frame and a malformed server URL', () => {
    expect(boardSenderAllowed({ ...senderInput(), serverUrl: null })).toBe(false);
    expect(boardSenderAllowed({ ...senderInput(), mainWebContents: null })).toBe(false);
    expect(boardSenderAllowed({ ...senderInput(), senderFrame: null })).toBe(false);
    expect(boardSenderAllowed({ ...senderInput(), serverUrl: 'not a URL' })).toBe(false);
  });
});

const current: Recent = { path: path.resolve('Current'), name: 'Current', lastOpened: '2026-11-08T12:00:00Z' };
const other: Recent = { path: path.resolve('Other'), name: 'Other', lastOpened: '2026-11-07T12:00:00Z' };

describe('recent path lookup', () => {
  it('returns the stored entry for a differently cased path, reusing samePath', () => {
    expect(findRecent([other, current], other.path.toUpperCase())).toBe(other);
  });

  it.each([null, undefined, 42, {}, [], path.resolve('Unlisted')])('rejects an unlisted or non-string path: %j', input => {
    expect(findRecent([current, other], input)).toBeUndefined();
  });
});

type IpcEvent = { sender: object; senderFrame: object | null };
type IpcHandler = (event: IpcEvent, ...args: unknown[]) => unknown;

function boardIpc(recent = [other, current]) {
  const input = senderInput();
  const handlers = new Map<string, IpcHandler>();
  const openProject = vi.fn(async (_folder: string, _trusted: boolean) => ({ ok: true }));
  const showLauncher = vi.fn(async () => {});
  const { registerIpc } = mainDeclarations([
    'samePath', 'ok', 'fail', 'boardSenderAllowed', 'findRecent', 'handleFromBoard', 'registerIpc',
  ], {
    mainWindow: { webContents: input.mainWebContents }, server: { path: current.path, url: input.serverUrl },
    settings: { recent }, ipcMain: { handle: (channel: string, handler: IpcHandler) => handlers.set(channel, handler) },
    handleFromLauncher: () => {}, setLanguage: () => {}, chooseFolder: () => {}, openProject, showLauncher,
  });
  registerIpc();
  const event = { sender: input.sender, senderFrame: input.senderFrame };
  return { handlers, event, openProject, showLauncher, invoke: (channel: string, ...args: unknown[]) => handlers.get(channel)!(event, ...args) };
}

describe('board IPC handlers', () => {
  it('keeps recent order, returns only the contract fields and marks the running project', () => {
    const ipc = boardIpc([other, { ...current, path: current.path.toUpperCase(), extra: 'private' } as Recent]);
    expect(ipc.invoke('board:recentProjects', 'ignored')).toEqual([
      { ...other, current: false }, { ...current, path: current.path.toUpperCase(), current: true },
    ]);
  });

  it.each([null, undefined, 42, {}, path.resolve('Unlisted')])('returns not-recent without launching for %j', input => {
    const ipc = boardIpc();
    expect(ipc.invoke('board:switchProject', input, true)).toMatchObject({ ok: false, code: 'not-recent' });
    expect(ipc.openProject).not.toHaveBeenCalled();
  });

  it('does not restart the current project', () => {
    const ipc = boardIpc();
    expect(ipc.invoke('board:switchProject', current.path.toUpperCase())).toEqual({ ok: true });
    expect(ipc.openProject).not.toHaveBeenCalled();
  });

  it('opens the stored path, ignoring renderer-supplied extra arguments', async () => {
    const ipc = boardIpc();
    expect(await ipc.invoke('board:switchProject', other.path.toUpperCase(), false)).toEqual({ ok: true });
    expect(ipc.openProject).toHaveBeenCalledExactlyOnceWith(other.path, true);
  });

  it('trusts only a network path already in recent', async () => {
    const network = { ...other, path: '\\\\server\\share\\Project' };
    const ipc = boardIpc([network, current]);
    await ipc.invoke('board:switchProject', network.path.toLowerCase());
    expect(ipc.openProject).toHaveBeenCalledExactlyOnceWith(network.path, true);
    expect(ipc.invoke('board:switchProject', '\\\\server\\unlisted', true)).toMatchObject({ code: 'not-recent' });
    expect(ipc.openProject).toHaveBeenCalledTimes(1);
  });

  it('shows the launcher without forwarding renderer arguments', async () => {
    const ipc = boardIpc();
    expect(await ipc.invoke('board:showStartScreen', { phase: 'error' })).toEqual({ ok: true });
    expect(ipc.showLauncher).toHaveBeenCalledExactlyOnceWith();
  });

  it('forbids every board handler from another webContents or a same-origin iframe', () => {
    const ipc = boardIpc();
    for (const handler of ipc.handlers.values()) {
      expect(handler({ ...ipc.event, sender: {} }, other.path)).toMatchObject({ ok: false, code: 'forbidden' });
      expect(handler({ ...ipc.event, senderFrame: { url: 'http://127.0.0.1:3141/r/vision.html' } }, other.path))
        .toMatchObject({ ok: false, code: 'forbidden' });
    }
    expect(ipc.openProject).not.toHaveBeenCalled();
    expect(ipc.showLauncher).not.toHaveBeenCalled();
  });
});

describe('preload bridge exposure', () => {
  const source = readFileSync(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');

  function preload(url: string) {
    const exposeInMainWorld = vi.fn();
    const invoke = vi.fn();
    runInNewContext(source, {
      location: new URL(url), require: () => ({ contextBridge: { exposeInMainWorld }, ipcRenderer: { invoke } }),
    });
    return { exposeInMainWorld, invoke };
  }

  it('exposes only the three narrow board methods on loopback HTTP', () => {
    const { exposeInMainWorld, invoke } = preload('http://127.0.0.1:3141/');
    expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
    const [name, bridge] = exposeInMainWorld.mock.calls[0];
    expect(name).toBe('deckmateBoard');
    expect(Object.keys(bridge)).toEqual(['recentProjects', 'switchProject', 'showStartScreen']);
    bridge.recentProjects('ignored');
    bridge.switchProject(other.path, true);
    bridge.showStartScreen('ignored');
    expect(invoke.mock.calls).toEqual([
      ['board:recentProjects'], ['board:switchProject', other.path], ['board:showStartScreen'],
    ]);
  });

  it('keeps the launcher bridge exclusive to file pages', () => {
    const { exposeInMainWorld } = preload('file:///launcher/index.html');
    expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
    expect(exposeInMainWorld.mock.calls[0][0]).toBe('deckmateDesktop');
  });

  it.each(['http://localhost:3141/', 'http://example.com/', 'https://127.0.0.1:3141/'])('exposes no bridge on %s', url => {
    expect(preload(url).exposeInMainWorld).not.toHaveBeenCalled();
  });
});
