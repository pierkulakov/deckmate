import { describe, expect, it } from 'vitest';
import type { DesktopProjectsSnapshot } from '../client/desktop-bridge.ts';
import { installStartBridge, type StartBridgeHost } from '../client/desktop/start-bridge.ts';

type Status = { phase: string; path?: string; code?: string; message?: string };

type Bridge = {
  getState: (options?: { refresh: boolean }) => Promise<unknown>;
  chooseFolder: () => Promise<unknown>;
  openProject: (folder: string, ...extra: unknown[]) => Promise<unknown>;
  createProject: (options: { folder: string }) => Promise<unknown>;
  removeRecent: (folder: string) => Promise<unknown>;
  addToWorkspace: (folder: string) => Promise<unknown>;
  removeFromWorkspace: (folder: string) => Promise<unknown>;
  moveInWorkspace: (folder: string, index: number) => Promise<unknown>;
  setLanguage: (lang: string) => Promise<unknown>;
  setTheme: (theme: string) => Promise<unknown>;
  onStatus: (callback: (status: Status) => void) => () => void;
};

type Call = [command: string, args: Record<string, unknown>];

// 2026-11-13: absent arguments become null, as they are on the Tauri IPC wire.
function loadBridge(invoke: (command: string, args: unknown) => unknown) {
  let next = 0;
  const callbacks = new Map<number, (event: { payload: unknown }) => void>();
  const removed: unknown[][] = [];
  const window = {
    __TAURI_INTERNALS__: {
      invoke,
      transformCallback(callback: (event: { payload: unknown }) => void) { callbacks.set(++next, callback); return next; },
      unregisterCallback(id: number) { callbacks.delete(id); },
    },
    __TAURI_EVENT_PLUGIN_INTERNALS__: {
      unregisterListener(...args: unknown[]) { removed.push(args); },
    },
  };
  installStartBridge(window as StartBridgeHost);
  const bridge = (window as { deckmateDesktop?: Bridge }).deckmateDesktop;
  if (!bridge) throw new Error('No window.deckmateDesktop');
  return { bridge, callbacks, removed };
}

describe('launcher tauri bridge', () => {
  it('keeps the launcher mock fallback outside Tauri', () => {
    const window = {};
    expect(installStartBridge(window)).toBeUndefined();
    expect((window as { deckmateDesktop?: unknown }).deckmateDesktop).toBeUndefined();
  });

  it('exposes precisely the launcher contract and passes only its arguments', async () => {
    const calls: Call[] = [];
    const { bridge } = loadBridge((command, args) => {
      calls.push([command, (args ?? null) as Record<string, unknown>]);
      return { ok: true };
    });
    expect(Object.isFrozen(bridge)).toBe(true);
    expect(Object.keys(bridge)).toEqual([
      'getState', 'chooseFolder', 'openProject', 'createProject', 'removeRecent',
      'addToWorkspace', 'removeFromWorkspace', 'moveInWorkspace', 'setLanguage', 'setTheme', 'onStatus',
    ]);
    await bridge.getState();
    await bridge.getState({ refresh: true });
    await bridge.chooseFolder();
    await bridge.openProject('C:/demo', true);
    await bridge.createProject({ folder: 'C:/new' });
    await bridge.removeRecent('C:/old');
    await bridge.addToWorkspace('C:/demo');
    await bridge.removeFromWorkspace('C:/old');
    await bridge.moveInWorkspace('C:/demo', -1);
    await bridge.setLanguage('ru');
    await bridge.setTheme('system');
    expect(calls).toEqual([
      ['desktop_get_state', null], ['desktop_get_state', { refresh: true }], ['desktop_choose_folder', null],
      ['desktop_open_project', { folder: 'C:/demo' }],
      ['desktop_create_project', { options: { folder: 'C:/new' } }],
      ['desktop_remove_recent', { folder: 'C:/old' }],
      ['desktop_add_to_workspace', { folder: 'C:/demo' }],
      ['desktop_remove_from_workspace', { folder: 'C:/old' }],
      ['desktop_move_in_workspace', { folder: 'C:/demo', index: -1 }],
      ['desktop_set_language', { lang: 'ru' }],
      ['desktop_set_theme', { theme: 'system' }],
    ]);
  });

  it('delivers status payloads and unsubscribes safely before registration completes', async () => {
    let registered!: (id: number) => void;
    const calls: Call[] = [];
    const { bridge, callbacks, removed } = loadBridge((command, args) => {
      calls.push([command, (args ?? null) as Record<string, unknown>]);
      if (command === 'plugin:event|listen') return new Promise(resolve => { registered = resolve; });
      return Promise.resolve();
    });
    const statuses: Status[] = [];
    const unsubscribe = bridge.onStatus(status => statuses.push(status));
    const listener = callbacks.get(calls[0][1].handler as number)!;
    listener({ payload: { phase: 'starting' } });
    unsubscribe();
    unsubscribe();
    listener({ payload: { phase: 'ready' } });
    registered(42);
    await new Promise(resolve => setImmediate(resolve));
    expect(statuses).toEqual([{ phase: 'starting' }]);
    expect(callbacks.size).toBe(0);
    expect(removed).toEqual([['desktop://status', 42]]);
    expect(calls.filter(([command]) => command === 'plugin:event|unlisten')).toHaveLength(1);
    expect(calls[1][1].eventId).toBe(42);
  });

  it('passes project snapshots and failures through without renaming or dropping fields', async () => {
    const snapshot: DesktopProjectsSnapshot = { ok: true, projects: [
      { path: 'C:/Current', name: 'Current', current: true, missing: false },
      { path: 'C:/Missing', name: 'Missing', current: false, missing: true },
    ], current: 'C:/Current' };
    for (const reply of [snapshot, { ok: true, projects: [], current: null }, { ok: false, code: 'save-failed', message: 'EACCES' }]) {
      const { bridge } = loadBridge(() => Promise.resolve(reply));
      for (const result of await Promise.all([bridge.getState(), bridge.addToWorkspace('C:/Current'),
        bridge.removeFromWorkspace('C:/Missing'), bridge.moveInWorkspace('C:/Current', 0), bridge.removeRecent('C:/Missing')])) {
        expect(result).toBe(reply);
      }
    }
  });

  it('releases its callback when the subscription fails and never rejects later', async () => {
    const { bridge, callbacks } = loadBridge(() => Promise.reject(new Error('denied')));
    const unsubscribe = bridge.onStatus(() => { throw new Error('no event expected'); });
    await new Promise(resolve => setImmediate(resolve));
    expect(callbacks.size).toBe(0);
    unsubscribe();
  });

  it('waits for status registration before state so startup errors cannot be lost on load', async () => {
    let registered!: (id: number) => void;
    const commands: string[] = [];
    const { bridge, callbacks } = loadBridge(command => {
      commands.push(command);
      if (command === 'plugin:event|listen') return new Promise(resolve => { registered = resolve; });
      callbacks.values().next().value!({ payload: { phase: 'error', code: 'start-failed', message: 'deferred failure' } });
      return Promise.resolve({ ok: true, projects: [], current: null, recent: [] });
    });
    const statuses: Status[] = [];
    bridge.onStatus(status => statuses.push(status));
    const state = bridge.getState();
    await new Promise(resolve => setImmediate(resolve));
    expect(commands).toEqual(['plugin:event|listen']);
    registered(1);
    await state;
    expect(commands).toEqual(['plugin:event|listen', 'desktop_get_state']);
    expect(statuses).toEqual([{ phase: 'error', code: 'start-failed', message: 'deferred failure' }]);
  });
});
