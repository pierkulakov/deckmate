const { contextBridge, ipcRenderer } = require('electron');

// 2026-11-08: the preload also runs on the board (http://127.0.0.1), which must not see the bridge at all.
if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('deckmateDesktop', {
    getState: () => ipcRenderer.invoke('desktop:getState'),
    chooseFolder: () => ipcRenderer.invoke('desktop:chooseFolder'),
    openProject: folder => ipcRenderer.invoke('desktop:openProject', folder),
    createProject: options => ipcRenderer.invoke('desktop:createProject', options),
    removeRecent: folder => ipcRenderer.invoke('desktop:removeRecent', folder),
    setLanguage: lang => ipcRenderer.invoke('desktop:setLanguage', lang),
    onStatus: callback => {
      const listener = (_event, status) => callback(status);
      ipcRenderer.on('desktop:status', listener);
      return () => ipcRenderer.removeListener('desktop:status', listener);
    },
  });
}
