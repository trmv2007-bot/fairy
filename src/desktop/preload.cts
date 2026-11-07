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
  ToolActivityEvent,
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
    setActiveProviders: (ids: string[]) => ipcRenderer.invoke('settings:setActiveProviders', ids),
    poolStatus: () => ipcRenderer.invoke('settings:poolStatus'),
    acceptAgreement: () => ipcRenderer.invoke('settings:acceptAgreement'),
    setCommandExecution: (enabled: boolean) => ipcRenderer.invoke('settings:setCommandExecution', enabled),
  },
  chat: {
    send: (text: string) => ipcRenderer.invoke('chat:send', text),
    clear: () => ipcRenderer.invoke('chat:clear'),
    history: (limit?: number) => ipcRenderer.invoke('chat:history', limit),
    search: (query: string) => ipcRenderer.invoke('chat:search', query),
    open: (id: string | null) => ipcRenderer.invoke('chat:open', id),
    deleteConversation: (id: string) => ipcRenderer.invoke('chat:delete', id),
    onChunk: (cb: (e: ChatChunkEvent) => void) => subscribe<ChatChunkEvent>('chat:chunk', cb),
    onState: (cb: (e: RuntimeStateEvent) => void) => subscribe<RuntimeStateEvent>('runtime:state', cb),
    onBrokerState: (cb: (e: BrokerStateEvent) => void) => subscribe<BrokerStateEvent>('broker:state', cb),
    onToolActivity: (cb: (e: ToolActivityEvent) => void) => subscribe<ToolActivityEvent>('chat:tool', cb),
  },
  system: {
    snapshot: () => ipcRenderer.invoke('system:snapshot'),
  },
};

contextBridge.exposeInMainWorld('fairy', bridge);
