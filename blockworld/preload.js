const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('blockworld', {
  getVersion: () => ipcRenderer.invoke('get-app-version'),
  platform: process.platform
});
