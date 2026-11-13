import type { DesktopShell, DesktopStatus } from '../desktop-bridge.ts';

export interface StartBridgeHost {
  deckmateDesktop?: DesktopShell;
  __TAURI_INTERNALS__?: {
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
    transformCallback(callback: (event: { payload: DesktopStatus }) => void): number;
    unregisterCallback(handler: number): void;
  };
  __TAURI_EVENT_PLUGIN_INTERNALS__?: { unregisterListener(event: string, eventId: number): void };
}

/** 2026-11-13: installation is explicit so importing the contract never enables IPC in another entry point. */
export function installStartBridge(host: StartBridgeHost = window): DesktopShell | undefined {
  if (host.deckmateDesktop) return host.deckmateDesktop;
  const internals = host.__TAURI_INTERNALS__;
  if (!internals) return undefined;
  const invoke = <T,>(command: string, args?: Record<string, unknown>) => internals.invoke<T>(command, args);
  let statusReady: Promise<unknown> = Promise.resolve();
  const bridge: DesktopShell = {
    getState: options => statusReady.then(() => invoke('desktop_get_state', options?.refresh === true ? { refresh: true } : undefined)),
    chooseFolder: () => invoke('desktop_choose_folder'),
    openProject: folder => invoke('desktop_open_project', { folder }),
    createProject: options => invoke('desktop_create_project', { options }),
    removeRecent: folder => invoke('desktop_remove_recent', { folder }),
    addToWorkspace: folder => invoke('desktop_add_to_workspace', { folder }),
    removeFromWorkspace: folder => invoke('desktop_remove_from_workspace', { folder }),
    moveInWorkspace: (folder, index) => invoke('desktop_move_in_workspace', { folder, index }),
    setLanguage: lang => invoke('desktop_set_language', { lang }),
    setTheme: theme => invoke('desktop_set_theme', { theme }),
    onStatus(callback) {
      let stopped = false;
      const handler = internals.transformCallback(event => { if (!stopped) callback(event.payload); });
      const listening = invoke<number>('plugin:event|listen', {
        event: 'desktop://status', target: { kind: 'WebviewWindow', label: 'main' }, handler,
      }).catch(() => { internals.unregisterCallback(handler); return null; });
      // 2026-11-13: getState replays deferred errors, so the subscription must exist before requesting it.
      statusReady = listening;
      return () => {
        if (stopped) return;
        stopped = true;
        internals.unregisterCallback(handler);
        void listening.then(eventId => {
          if (eventId === null) return;
          host.__TAURI_EVENT_PLUGIN_INTERNALS__?.unregisterListener('desktop://status', eventId);
          return invoke('plugin:event|unlisten', { event: 'desktop://status', eventId });
        }).catch(() => {});
      };
    },
  };
  Object.defineProperty(host, 'deckmateDesktop', { value: Object.freeze(bridge) });
  return bridge;
}
