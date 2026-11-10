(() => {
  'use strict';
  const internals = window.__TAURI_INTERNALS__;
  if (!internals) return;
  const invoke = (command, args) => internals.invoke(command, args);
  let statusReady = Promise.resolve();
  Object.defineProperty(window, 'deckmateDesktop', {
    value: Object.freeze({
      getState: () => statusReady.then(() => invoke('desktop_get_state')),
      chooseFolder: () => invoke('desktop_choose_folder'),
      openProject: folder => invoke('desktop_open_project', { folder }),
      createProject: options => invoke('desktop_create_project', { options }),
      removeRecent: folder => invoke('desktop_remove_recent', { folder }),
      addToWorkspace: folder => invoke('desktop_add_to_workspace', { folder }),
      removeFromWorkspace: folder => invoke('desktop_remove_from_workspace', { folder }),
      moveInWorkspace: (folder, index) => invoke('desktop_move_in_workspace', { folder, index }),
      setLanguage: lang => invoke('desktop_set_language', { lang }),
      onStatus(callback) {
        let stopped = false;
        const handler = internals.transformCallback(event => {
          if (!stopped) callback(event.payload);
        });
        const listening = invoke('plugin:event|listen', {
          event: 'desktop://status', target: { kind: 'WebviewWindow', label: 'main' }, handler,
        }).catch(() => { internals.unregisterCallback(handler); return null; });
        // 2026-11-09: getState replays pending errors only after this page can receive them.
        statusReady = listening;
        // 2026-11-09: unsubscribe may run before the asynchronous listener registration completes.
        return () => {
          if (stopped) return;
          stopped = true;
          internals.unregisterCallback(handler);
          void listening.then(eventId => {
            if (eventId === null) return;
            window.__TAURI_EVENT_PLUGIN_INTERNALS__?.unregisterListener('desktop://status', eventId);
            return invoke('plugin:event|unlisten', { event: 'desktop://status', eventId });
          }).catch(() => {});
        };
      },
    }),
  });
})();
