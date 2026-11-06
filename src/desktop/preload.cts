// Preload bridge (T02). Runs in the sandboxed renderer: CJS (emitted from .cts to
// preload.cjs), exposes ONLY the typed surface below via contextBridge.
// No Node APIs, no fs, no process — the main process validates every call.
import { contextBridge, ipcRenderer } from 'electron';
import type { FairyBridge, SaveProviderPayload } from './bridge.js';

const bridge: FairyBridge = {
  settings: {
    load: () => ipcRenderer.invoke('settings:load'),
    saveProvider: (p: SaveProviderPayload) => ipcRenderer.invoke('settings:saveProvider', p),
    deleteProvider: (id: string) => ipcRenderer.invoke('settings:deleteProvider', id),
    selectProvider: (id: string | null) => ipcRenderer.invoke('settings:selectProvider', id),
  },
};

contextBridge.exposeInMainWorld('fairy', bridge);
