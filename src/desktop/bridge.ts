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

export interface FairyBridge {
  settings: {
    /** Every call returns a result envelope; I/O errors surface as ok:false, not thrown rejections. */
    load(): Promise<SettingsResult>;
    saveProvider(p: SaveProviderPayload): Promise<SettingsResult>;
    deleteProvider(id: string): Promise<SettingsResult>;
    selectProvider(id: string | null): Promise<SettingsResult>;
  };
}
