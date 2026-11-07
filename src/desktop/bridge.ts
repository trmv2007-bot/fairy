// Shared IPC contract between the Electron main process and the renderer.
// Types only — imported by preload (type-only, erased at runtime) and the UI.
// The renderer has NO Node access: everything it can do is listed here.
import type { ToolActivityEvent } from './chat.js';
import type { SystemSnapshot } from '../system/tools.js';

export type { ToolActivityEvent, SystemSnapshot };

export interface ProviderWire {
  endpointId: string;
  baseUrl: string;
  authHandle: string; // opaque handle — raw keys never cross this bridge
  includedCost: boolean;
  allowedDataScopes: string[];
  model?: string;
  supportsVision?: boolean;
  /** Local keyless endpoint (Ollama) — no credential exists or is needed. */
  keyless?: boolean;
  /** true when a key for this handle is present in the session vault */
  keyPresent: boolean;
}

export interface PersistedConfigWire {
  cloudProviders: ProviderWire[];
  selectedProviderId?: string;
  /** Effective key-pool member ids (explicit pool, else legacy selection). */
  activeProviderIds?: string[];
  allowLocalModels: boolean;
  /** ISO timestamp of the user-agreement signing; absent until the user signs. */
  agreementAcceptedAt?: string;
  /** Master's opt-in for the command_run tool; absent = off. */
  allowCommandExecution?: boolean;
}

export interface SaveProviderPayload {
  endpointId: string;
  baseUrl: string;
  /** Present only when adding/replacing a key. Vaulted in the main process, never persisted. */
  apiKey?: string;
  model?: string;
  includedCost: boolean;
  allowedDataScopes: string[];
  /** Local keyless endpoint — saved without a key (loopback/private hosts only). */
  keyless?: boolean;
}

export interface SettingsResult {
  ok: boolean;
  error?: string;
  config?: PersistedConfigWire;
}

// ── Key pool (v0.4) ─────────────────────────────────────────────────────────

/** Live routing state of the key pool — measured in the main process. */
export interface PoolStatusWire {
  activeIds: string[];
  registered: number;
  lastUsedId?: string;
  cooling: { id: string; untilMs: number; reason: string }[];
  requests: number;
  failovers: number;
}

export interface PoolStatusResult {
  ok: boolean;
  error?: string;
  status?: PoolStatusWire;
}

export interface SystemSnapshotResult {
  ok: boolean;
  error?: string;
  snapshot?: SystemSnapshot;
}

// ── Chat ────────────────────────────────────────────────────────────────────

export interface ChatMessageWire {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

// ── Conversation transcripts (v0.6) ────────────────────────────────────────

export interface ConversationWire {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
}

export interface ConversationListResult {
  ok: boolean;
  error?: string;
  conversations?: ConversationWire[];
}

export interface ConversationOpenResult {
  ok: boolean;
  error?: string;
  /** Active conversation id after the open ('' when the store is empty). */
  id?: string;
  messages?: ChatMessageWire[];
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
  /** Transcript the exchange landed in (v0.6) — '' when persistence is off. */
  conversationId?: string;
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
    /** Set the ordered key pool (empty array = auto routing, no preference). */
    setActiveProviders(ids: string[]): Promise<SettingsResult>;
    /** Live pool routing state for the Status HUD. */
    poolStatus(): Promise<PoolStatusResult>;
    /** Records the user-agreement signing (idempotent; journal event + persisted timestamp). */
    acceptAgreement(): Promise<SettingsResult>;
    /** Arms or disarms the command_run tool (journaled both ways). */
    setCommandExecution(enabled: boolean): Promise<SettingsResult>;
  };
  chat: {
    /** Send one user turn; resolves with the final assistant message. Deltas arrive via onChunk. */
    send(text: string): Promise<ChatSendResult>;
    /** Archives the live conversation and starts fresh — nothing durable is deleted. */
    clear(): Promise<SimpleResult>;
    /** Durable conversation list, newest first. */
    history(limit?: number): Promise<ConversationListResult>;
    /** Search conversations by title or content substring. */
    search(query: string): Promise<ConversationListResult>;
    /** Switch to a conversation (null = most recent) and return its display turns. */
    open(id: string | null): Promise<ConversationOpenResult>;
    /** Permanently delete one transcript. */
    deleteConversation(id: string): Promise<SimpleResult>;
    /** Subscribe to streaming deltas. Returns an unsubscribe function. */
    onChunk(cb: (e: ChatChunkEvent) => void): () => void;
    /** Subscribe to runtime state transitions (drives the orb). Returns an unsubscribe function. */
    onState(cb: (e: RuntimeStateEvent) => void): () => void;
    /** Subscribe to broker online/offline transitions. Returns an unsubscribe function. */
    onBrokerState(cb: (e: BrokerStateEvent) => void): () => void;
    /** Subscribe to live tool execution activity (drives the activity chips). */
    onToolActivity(cb: (e: ToolActivityEvent) => void): () => void;
  };
  system: {
    /** Real device readout for the Status HUD — measured in the main process. */
    snapshot(): Promise<SystemSnapshotResult>;
  };
}
