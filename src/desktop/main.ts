// Electron main process (T02/T30). Shell + settings + chat + orb window.
// Renderer is fully sandboxed: contextIsolation on, nodeIntegration off, preload
// exposes exactly the typed surface in bridge.ts — nothing else.
// v0.2: Fairy's hands — the tool registry, real-device Status HUD snapshot, and
// the chat tool-execution loop are wired here.
import { app, BrowserWindow, dialog, ipcMain, safeStorage, screen, shell, powerMonitor } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { connect as netConnect } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';
import * as os from 'node:os';
import { SettingsStore } from '../storage/settings.js';
import { openDatabase } from '../storage/database.js';
import { EventJournalImpl } from '../storage/journal.js';
import { loadConfig, sanitizeProvider } from '../providers/config.js';
import { SecretVault } from '../providers/secret-vault.js';
import { PersistedKeyStore, type KeyCodec } from '../providers/persisted-key-store.js';
import { ModelGateway } from '../providers/gateway.js';
import { ChatService, type ToolActivityEvent } from './chat.js';
import { BrokerClient, BrokerClientError } from '../native/broker-client.js';
import { ToolRegistry, buildSystemSnapshot, type SystemDeps, type SystemSnapshot } from '../system/tools.js';
import type { BrokerStateEvent, ChatChunkEvent, PersistedConfigWire, ProviderWire, RuntimeStateEvent, SettingsResult } from './bridge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;

export function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 780,
    minWidth: 360,
    minHeight: 520,
    show: false,
    title: 'Fairy',
    backgroundColor: '#04070a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  // Hardening: the shell never opens new windows and never navigates away from its
  // own content (dev server ORIGIN is the only exception — prefix matching would let
  // http://localhost:5173.evil.com through).
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.FAIRY_DEV_URL;
    if (devUrl && sameOrigin(url, devUrl)) return;
    event.preventDefault();
  });
  // No <webview> embedding and no device/permission prompts: everything denies by
  // default. Voice (T15) must add an explicit, user-approved mic gate first.
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });
  const devUrl = process.env.FAIRY_DEV_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../ui/index.html'));
  }
  mainWindow.on('closed', () => { mainWindow = null; });
  return mainWindow;
}

function sameOrigin(urlA: string, urlB: string): boolean {
  try {
    return new URL(urlA).origin === new URL(urlB).origin;
  } catch {
    return false;
  }
}

// webviews are never allowed, in any window, at any point in the lifecycle.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => { event.preventDefault(); });
});

export function getMainWindow(): BrowserWindow | null { return mainWindow; }

function broadcast(channel: string, payload: unknown): void {
  const win = mainWindow ?? BrowserWindow.getAllWindows()[0];
  win?.webContents.send(channel, payload);
}

// Chunk coalescing: several `chat:chunk` broadcasts can fire within one tick
// (streamed deltas arrive back-to-back). Electron has been observed to drop
// same-channel bursts against a sandboxed renderer, and invoke replies can
// overtake queued events. Batching each tick's deltas into ONE ipc message —
// flushed on a microtask, which is ordered before the chat:send reply leaves
// the process — removes both hazards and cuts re-renders.
const chunkBatch = new Map<string, string>();
let chunkFlushQueued = false;
function broadcastChunkChunked(messageId: string, delta: string): void {
  chunkBatch.set(messageId, (chunkBatch.get(messageId) ?? '') + delta);
  if (chunkFlushQueued) return;
  chunkFlushQueued = true;
  queueMicrotask(() => {
    chunkFlushQueued = false;
    const pending = [...chunkBatch.entries()];
    chunkBatch.clear();
    for (const [id, text] of pending) {
      broadcast('chat:chunk', { messageId: id, delta: text } satisfies ChatChunkEvent);
    }
  });
}

// ── Stores ──────────────────────────────────────────────────────────────────
const settingsPath = path.join(app.getPath('userData'), 'fairy-config.json');
const settingsStore = new SettingsStore(settingsPath);
const vault = new SecretVault();

// OS-backed key persistence (DPAPI on Windows). safeStorage needs the app ready,
// so restore happens in whenReady; the store file is read-only metadata before that.
const keyCodec: KeyCodec = {
  get available(): boolean {
    try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
  },
  encrypt: (plain) => safeStorage.encryptString(plain),
  decrypt: (blob) => safeStorage.decryptString(blob),
};
const keyStore = new PersistedKeyStore(path.join(app.getPath('userData'), 'fairy-keys.json'), keyCodec);

// Journal (best effort): chat + lifecycle events land in SQLite when available.
let journal: EventJournalImpl | null = null;
try {
  journal = new EventJournalImpl(openDatabase(path.join(app.getPath('userData'), 'fairy.db')));
} catch (err) {
  console.error('[fairy] journal unavailable (chat still works):', err);
}

// ── Fairy's hands: real device dependencies for the tool registry ──────────
// Electron surfaces (shell/powerMonitor/screen) plus plain Node transports; the
// broker is preferred for Windows-specific data and degrades honestly when offline.
const systemDeps: SystemDeps = {
  versions: () => ({
    node: process.versions.node ?? '?',
    electron: process.versions.electron ?? '?',
    chrome: process.versions.chrome ?? '?',
  }),
  battery: () => {
    try {
      // getSystemBatteryState() exists on modern Electron builds; the typings lag.
      const pm = powerMonitor as typeof powerMonitor & {
        getSystemBatteryState?: () => { charging: boolean; percent: number; hasBattery?: boolean };
      };
      if (typeof pm.getSystemBatteryState === 'function') {
        const s = pm.getSystemBatteryState();
        const hasBattery = typeof s.hasBattery === 'boolean'
          ? s.hasBattery
          : s.percent < 100 || s.charging;
        return { hasBattery, isCharging: s.charging, percent: s.percent };
      }
      // Fallback: drawing battery power proves a battery exists; level unknown.
      return powerMonitor.isOnBatteryPower()
        ? { hasBattery: true, isCharging: false, percent: -1 }
        : null; // on AC / no battery info — report mains honestly
    } catch {
      return null;
    }
  },
  displays: () => {
    try {
      return screen.getAllDisplays().map(d => ({ width: d.size.width, height: d.size.height }));
    } catch {
      return [];
    }
  },
  openExternal: (url) => shell.openExternal(url),
  openPath: (p) => shell.openPath(p),
  brokerWindows: async () => {
    try {
      return await broker.windowList();
    } catch {
      return null; // H.D.D. link offline — window_list reports it honestly
    }
  },
  tcpConnect: (host, port, timeoutMs) =>
    new Promise<number>((resolve, reject) => {
      const started = Date.now();
      const sock = netConnect({ host, port });
      const fail = (err: Error): void => {
        sock.destroy();
        reject(err);
      };
      sock.once('error', fail);
      sock.setTimeout(timeoutMs, () => fail(new Error(`connect timeout after ${timeoutMs}ms`)));
      sock.once('connect', () => {
        const ms = Date.now() - started;
        sock.destroy();
        resolve(ms);
      });
    }),
  dnsResolve: async (host) => {
    const r = await dnsLookup(host, { all: true });
    return r.map(a => a.address);
  },
  spawn: (command, args, opts) =>
    new Promise(resolve => {
      execFile(
        command,
        args,
        { timeout: opts.timeoutMs, cwd: opts.cwd, env: opts.env, maxBuffer: 64 * 1024, windowsHide: true },
        (err, stdout, stderr) => {
          const e = err as (NodeJS.ErrnoException & { killed?: boolean }) | null;
          const code = e === null
            ? 0
            : typeof e.code === 'number'
              ? e.code
              : e.code === 'ENOENT'
                ? 127
                : 1;
          resolve({
            code,
            stdout: String(stdout ?? ''),
            stderr: String(stderr ?? ''),
            timedOut: e?.killed === true,
          });
        },
      );
    }),
  roots: () => [os.homedir()],
  now: () => Date.now(),
};
const toolRegistry = new ToolRegistry(systemDeps);

// ── Gateway + chat ──────────────────────────────────────────────────────────
let gateway: ModelGateway | null = null;

function rebuildGateway(): void {
  const cfg = settingsStore.load();
  gateway = cfg.cloudProviders.length > 0
    ? new ModelGateway(cfg, (handle) => vault.resolve(handle))
    : null;
}
rebuildGateway();

const chatService = new ChatService(
  () => gateway,
  journal,
  {
    onChunk: (messageId, delta) => broadcastChunkChunked(messageId, delta),
    onState: (state) => broadcast('runtime:state', { state } satisfies RuntimeStateEvent),
    onToolActivity: (e) => broadcast('chat:tool', e satisfies ToolActivityEvent),
  },
  {
    registry: toolRegistry,
    allowCommandExecution: () => settingsStore.load().allowCommandExecution === true,
  },
);

// ── Broker (optional native component) ──────────────────────────────────────
let brokerOnline = false;
const broker = new BrokerClient({ pipeName: 'fairy-broker', timeoutMs: 2_000 });

async function probeBroker(): Promise<void> {
  const wasOnline = brokerOnline;
  try {
    await broker.ping();
    brokerOnline = true;
  } catch (err) {
    brokerOnline = false;
    if (process.env.FAIRY_DEBUG) {
      console.error('[fairy] broker offline:', err instanceof BrokerClientError ? err.message : err);
    }
  }
  if (brokerOnline !== wasOnline) {
    broadcast('broker:state', { online: brokerOnline } satisfies BrokerStateEvent);
  }
}

// ── Settings IPC ────────────────────────────────────────────────────────────
function toWire(cfg: ReturnType<typeof loadConfig>): PersistedConfigWire {
  return {
    cloudProviders: cfg.cloudProviders.map((p): ProviderWire => ({
      endpointId: p.endpointId,
      baseUrl: p.baseUrl,
      authHandle: p.authHandle,
      includedCost: p.includedCost,
      allowedDataScopes: [...p.allowedDataScopes],
      ...(p.model !== undefined ? { model: p.model } : {}),
      ...(p.supportsVision === true ? { supportsVision: true } : {}),
      keyPresent: p.authHandle !== '' && vault.resolve(p.authHandle) !== undefined,
    })),
    ...(cfg.selectedProviderId !== undefined ? { selectedProviderId: cfg.selectedProviderId } : {}),
    ...(cfg.agreementAcceptedAt !== undefined ? { agreementAcceptedAt: cfg.agreementAcceptedAt } : {}),
    ...(cfg.allowCommandExecution === true ? { allowCommandExecution: true } : {}),
    allowLocalModels: cfg.allowLocalModels,
  };
}

ipcMain.handle('settings:load', (): SettingsResult => {
  try {
    return { ok: true, config: toWire(settingsStore.load()) };
  } catch (err) {
    return { ok: false, error: `load failed: ${err instanceof Error ? err.message : String(err)}` };
  }
});

// Canon beat: Fairy compels a user agreement before assisting (docs/persona.md §2).
// The signature is persisted with the config and journalled for the record.
ipcMain.handle('settings:acceptAgreement', (): SettingsResult => {
  try {
    const cfg = settingsStore.load();
    if (cfg.agreementAcceptedAt !== undefined) {
      return { ok: true, config: toWire(cfg) }; // idempotent — already signed
    }
    cfg.agreementAcceptedAt = new Date().toISOString();
    settingsStore.save(cfg);
    journal?.append({
      type: 'fairy:agreement-signed',
      payload: { version: 1, acceptedAt: cfg.agreementAcceptedAt },
      acknowledged: true,
    });
    return { ok: true, config: toWire(cfg) };
  } catch (err) {
    return { ok: false, error: `agreement failed: ${err instanceof Error ? err.message : String(err)}` };
  }
});

// Master's explicit gate for the command_run tool — off by default, journalled
// on every flip so the record shows WHO armed Fairy's hands.
ipcMain.handle('settings:setCommandExecution', (_event, raw: unknown): SettingsResult => {
  if (raw !== true && raw !== false) {
    return { ok: false, error: 'invalid payload (expected boolean)' };
  }
  try {
    const cfg = settingsStore.load();
    if (raw) cfg.allowCommandExecution = true;
    else delete cfg.allowCommandExecution;
    settingsStore.save(cfg);
    journal?.append({
      type: 'settings.command-execution',
      payload: { enabled: raw },
      acknowledged: true,
    });
    return { ok: true, config: toWire(settingsStore.load()) };
  } catch (err) {
    return { ok: false, error: `command-execution toggle failed: ${err instanceof Error ? err.message : String(err)}` };
  }
});

// Real device readout for the Status HUD — every value measured, none invented.
ipcMain.handle('system:snapshot', (): { ok: boolean; snapshot?: SystemSnapshot; error?: string } => {
  try {
    return { ok: true, snapshot: buildSystemSnapshot(systemDeps) };
  } catch (err) {
    return { ok: false, error: `snapshot failed: ${err instanceof Error ? err.message : String(err)}` };
  }
});

ipcMain.handle('settings:saveProvider', (_event, raw: unknown): SettingsResult => {
  // Validate the envelope before trusting anything inside it: the renderer is
  // untrusted, so shape mismatches are rejected instead of cast blindly.
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'invalid provider payload (expected object)' };
  }
  const r = raw as Record<string, unknown>;
  const apiKey = r.apiKey;
  if (apiKey !== undefined && (typeof apiKey !== 'string' || apiKey.length > 4096)) {
    return { ok: false, error: 'invalid apiKey' };
  }
  const p = sanitizeProvider(r);
  if (!p) return { ok: false, error: 'invalid provider payload (check id, base URL, scopes)' };
  const cfg = settingsStore.load();
  const existing = cfg.cloudProviders.find(c => c.endpointId === p.endpointId);
  // Key handling: a fresh key vaults under a new handle; without one, edit mode keeps
  // the existing handle, a new provider is rejected (it cannot authenticate).
  if (typeof apiKey === 'string' && apiKey.length > 0) {
    const handle = 'cred_' + randomUUID();
    vault.store(handle, apiKey);
    p.authHandle = handle;
    // Key replacement: drop the orphaned previous handle so the vault cannot grow
    // unboundedly across edits.
    if (existing && existing.authHandle !== '') {
      vault.remove(existing.authHandle);
      keyStore.removeKey(existing.authHandle);
    }
    // Persist encrypted at rest (DPAPI/keychain). If the OS key storage is missing,
    // keep session-only and continue — saving the provider must not fail for this.
    try {
      keyStore.setKey(handle, apiKey);
      keyStore.flush();
    } catch (err) {
      console.error('[fairy] key persistence unavailable, key stays session-only:',
        err instanceof Error ? err.message : err);
    }
  } else if (existing) {
    p.authHandle = existing.authHandle;
  } else {
    return { ok: false, error: 'new provider requires an API key' };
  }
  cfg.cloudProviders = [
    ...cfg.cloudProviders.filter(c => c.endpointId !== p.endpointId),
    p,
  ];
  try {
    settingsStore.save(cfg);
  } catch (err) {
    return { ok: false, error: `persist failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  rebuildGateway();
  return { ok: true, config: toWire(cfg) };
});

ipcMain.handle('settings:deleteProvider', (_event, raw: unknown): SettingsResult => {
  const id = typeof raw === 'string' ? raw : '';
  if (id === '') return { ok: false, error: 'invalid provider id' };
  try {
    const cfg = settingsStore.load();
    const victim = cfg.cloudProviders.find(c => c.endpointId === id);
    if (victim && victim.authHandle !== '') {
      vault.remove(victim.authHandle);
      keyStore.removeKey(victim.authHandle);
      try { keyStore.flush(); } catch { /* best effort */ }
    }
    const next = { ...cfg, cloudProviders: cfg.cloudProviders.filter(c => c.endpointId !== id) };
    if (next.selectedProviderId === id) delete next.selectedProviderId;
    settingsStore.save(next);
    rebuildGateway();
    return { ok: true, config: toWire(next) };
  } catch (err) {
    return { ok: false, error: `delete failed: ${err instanceof Error ? err.message : String(err)}` };
  }
});

ipcMain.handle('settings:selectProvider', (_event, raw: unknown): SettingsResult => {
  const id = raw === null ? null : (typeof raw === 'string' ? raw : null);
  try {
    const cfg = settingsStore.load();
    if (id === null) {
      delete cfg.selectedProviderId;
    } else if (cfg.cloudProviders.some(c => c.endpointId === id)) {
      cfg.selectedProviderId = id;
    } else {
      return { ok: false, error: 'unknown provider id' };
    }
    settingsStore.save(cfg);
    rebuildGateway();
    return { ok: true, config: toWire(cfg) };
  } catch (err) {
    return { ok: false, error: `select failed: ${err instanceof Error ? err.message : String(err)}` };
  }
});

// ── Chat IPC ────────────────────────────────────────────────────────────────
ipcMain.handle('chat:send', async (_event, raw: unknown): Promise<{ ok: boolean; error?: string; message?: { id: string; role: 'assistant'; content: string }; model?: string }> => {
  if (typeof raw !== 'string') return { ok: false, error: 'invalid message payload' };
  if (chatService.isRunning) return { ok: false, error: 'a request is already in flight' };
  try {
    const result = await chatService.send(raw);
    return { ok: true, message: { id: result.messageId, role: 'assistant', content: result.content }, model: result.model };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('chat:clear', (): { ok: boolean; error?: string } => {
  try {
    chatService.clear();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

// Optional first-run seeding via env (see .env.example). Key goes to the vault only.
function seedProviderFromEnv(): void {
  const endpointId = process.env.FAIRY_SEED_PROVIDER_ENDPOINT_ID;
  const baseUrl = process.env.FAIRY_SEED_PROVIDER_BASE_URL;
  const apiKey = process.env.FAIRY_SEED_PROVIDER_API_KEY;
  if (!endpointId || !baseUrl || !apiKey) return;
  const cfg = settingsStore.load();
  if (cfg.cloudProviders.some(c => c.endpointId === endpointId)) return;
  const handle = 'cred_' + randomUUID();
  vault.store(handle, apiKey);
  try {
    keyStore.setKey(handle, apiKey);
    keyStore.flush();
  } catch (err) {
    console.error('[fairy] seeded key stays session-only:', err instanceof Error ? err.message : err);
  }
  cfg.cloudProviders = [
    ...cfg.cloudProviders,
    {
      endpointId,
      baseUrl,
      authHandle: handle,
      includedCost: process.env.FAIRY_SEED_PROVIDER_INCLUDED_COST === 'true',
      allowedDataScopes: ['public', 'internal'],
      ...(process.env.FAIRY_SEED_PROVIDER_MODEL !== undefined
        ? { model: process.env.FAIRY_SEED_PROVIDER_MODEL }
        : {}),
    },
  ];
  settingsStore.save(cfg);
  rebuildGateway();
}

// Single-instance lock: a proactive assistant must not run twice against one state dir.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => {
    try {
      // Restore persisted keys into the session vault (OS-decrypted).
      const restored = keyStore.loadInto((handle, key) => vault.store(handle, key));
      if (restored > 0) console.log(`[fairy] restored ${restored} key(s) from OS-encrypted storage`);
      seedProviderFromEnv();
      rebuildGateway();
    } catch (err) {
      // A bad seed must never take down startup — the user can configure via UI.
      console.error('[fairy] provider seeding failed:', err);
    }
    createWindow();
    void probeBroker();
    // Keep the H.D.D. link indicator honest without a background storm.
    setInterval(() => { void probeBroker(); }, 30_000).unref();
  }).catch((err: unknown) => {
    console.error('[fairy] startup failed:', err);
    dialog.showErrorBox('Fairy failed to start', err instanceof Error ? err.message : String(err));
    app.quit();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}
