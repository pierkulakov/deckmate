const { contextBridge, ipcRenderer } = require('electron');

// 2026-11-08: the board must not see the launcher's unrestricted project and folder bridge.
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

// 2026-11-08: project content can run on the board, so its bridge is limited to recent projects and the start screen.
if (location.protocol === 'http:' && location.hostname === '127.0.0.1') {
  contextBridge.exposeInMainWorld('deckmateBoard', {
    recentProjects: () => ipcRenderer.invoke('board:recentProjects'),
    switchProject: folder => ipcRenderer.invoke('board:switchProject', folder),
    showStartScreen: () => ipcRenderer.invoke('board:showStartScreen'),
  });
}
