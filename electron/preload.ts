import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronUpdater', {
  checkForUpdate: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  quitAndInstall: (zipPath?: string) => ipcRenderer.invoke('updater:install', zipPath),
  onUpdateStatus: (callback: (status: { type: string; info?: unknown }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: { type: string; info?: unknown }) => callback(status);
    ipcRenderer.on('updater:status', handler);
    return () => ipcRenderer.removeListener('updater:status', handler);
  },
});
