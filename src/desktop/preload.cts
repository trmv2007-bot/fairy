// Preload bridge (T02). Runs in the sandboxed renderer: CJS (emitted from .cts to
// preload.cjs), exposes ONLY the typed surface below via contextBridge.
// No Node APIs, no fs, no process — the main process validates every call.
import { contextBridge, ipcRenderer } from 'electron';
import type {
  BrokerStateEvent,
  ChatChunkEvent,
  FairyBridge,
  RuntimeStateEvent,
  SaveProviderPayload,
} from './bridge.js';

function subscribe<T>(channel: string, cb: (e: T) => void): () => void {
  const listener = (_event: unknown, payload: unknown): void => {
    cb(payload as T);
  };
  ipcRenderer.on(channel, listener as never);
  return () => {
    ipcRenderer.removeListener(channel, listener as never);
  };
}

const bridge: FairyBridge = {
  settings: {
    load: () => ipcRenderer.invoke('settings:load'),
    saveProvider: (p: SaveProviderPayload) => ipcRenderer.invoke('settings:saveProvider', p),
    deleteProvider: (id: string) => ipcRenderer.invoke('settings:deleteProvider', id),
    selectProvider: (id: string | null) => ipcRenderer.invoke('settings:selectProvider', id),
  },
  chat: {
    send: (text: string) => ipcRenderer.invoke('chat:send', text),
    clear: () => ipcRenderer.invoke('chat:clear'),
    onChunk: (cb: (e: ChatChunkEvent) => void) => subscribe<ChatChunkEvent>('chat:chunk', cb),
    onState: (cb: (e: RuntimeStateEvent) => void) => subscribe<RuntimeStateEvent>('runtime:state', cb),
    onBrokerState: (cb: (e: BrokerStateEvent) => void) => subscribe<BrokerStateEvent>('broker:state', cb),
  },
};

contextBridge.exposeInMainWorld('fairy', bridge);
