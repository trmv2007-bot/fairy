// Shared IPC contract between the Electron main process and the renderer.
// Types only — imported by preload (type-only, erased at runtime) and the UI.
// The renderer has NO Node access: everything it can do is listed here.

export interface ProviderWire {
  endpointId: string;
  baseUrl: string;
  authHandle: string; // opaque handle — raw keys never cross this bridge
  includedCost: boolean;
  allowedDataScopes: string[];
  model?: string;
  supportsVision?: boolean;
  /** true when a key for this handle is present in the session vault */
  keyPresent: boolean;
}

export interface PersistedConfigWire {
  cloudProviders: ProviderWire[];
  selectedProviderId?: string;
  allowLocalModels: boolean;
  /** ISO timestamp of the user-agreement signing; absent until the user signs. */
  agreementAcceptedAt?: string;
}

export interface SaveProviderPayload {
  endpointId: string;
  baseUrl: string;
  /** Present only when adding/replacing a key. Vaulted in the main process, never persisted. */
  apiKey?: string;
  model?: string;
  includedCost: boolean;
  allowedDataScopes: string[];
}

export interface SettingsResult {
  ok: boolean;
  error?: string;
  config?: PersistedConfigWire;
}

// ── Chat ────────────────────────────────────────────────────────────────────

export interface ChatMessageWire {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatChunkEvent {
  messageId: string;
  delta: string;
}

export interface RuntimeStateEvent {
  state: 'idle' | 'thinking' | 'working' | 'error' | 'paused';
}

export interface BrokerStateEvent {
  online: boolean;
}

export interface ChatSendResult {
  ok: boolean;
  error?: string;
  /** Final assistant message (absent on error). */
  message?: ChatMessageWire;
  model?: string;
}

export interface SimpleResult {
  ok: boolean;
  error?: string;
}

export interface FairyBridge {
  settings: {
    /** Every call returns a result envelope; I/O errors surface as ok:false, not thrown rejections. */
    load(): Promise<SettingsResult>;
    saveProvider(p: SaveProviderPayload): Promise<SettingsResult>;
    deleteProvider(id: string): Promise<SettingsResult>;
    selectProvider(id: string | null): Promise<SettingsResult>;
    /** Records the user-agreement signing (idempotent; journal event + persisted timestamp). */
    acceptAgreement(): Promise<SettingsResult>;
  };
  chat: {
    /** Send one user turn; resolves with the final assistant message. Deltas arrive via onChunk. */
    send(text: string): Promise<ChatSendResult>;
    clear(): Promise<SimpleResult>;
    /** Subscribe to streaming deltas. Returns an unsubscribe function. */
    onChunk(cb: (e: ChatChunkEvent) => void): () => void;
    /** Subscribe to runtime state transitions (drives the orb). Returns an unsubscribe function. */
    onState(cb: (e: RuntimeStateEvent) => void): () => void;
    /** Subscribe to broker online/offline transitions. Returns an unsubscribe function. */
    onBrokerState(cb: (e: BrokerStateEvent) => void): () => void;
  };
}
