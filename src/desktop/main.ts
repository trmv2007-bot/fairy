// Electron main process (T02/T30). Shell + settings + chat + orb window.
// Renderer is fully sandboxed: contextIsolation on, nodeIntegration off, preload
// exposes exactly the typed surface in bridge.ts — nothing else.
// v0.2: Fairy's hands — the tool registry, real-device Status HUD snapshot, and
// the chat tool-execution loop are wired here.
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, safeStorage, screen, shell, powerMonitor, Tray } from 'electron';
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
import { ConversationStore } from '../storage/transcripts.js';
import type { DatabaseHandle } from '../storage/database.js';
import { loadConfig, sanitizeProvider, effectivePool } from '../providers/config.js';
import { SecretVault } from '../providers/secret-vault.js';
import { PersistedKeyStore, type KeyCodec } from '../providers/persisted-key-store.js';
import { ModelGateway, type PoolAttemptEvent } from '../providers/gateway.js';
import { ChatService, type ToolActivityEvent } from './chat.js';
import { BrokerClient, BrokerClientError } from '../native/broker-client.js';
import { ToolRegistry, buildSystemSnapshot, type SystemDeps, type SystemSnapshot } from '../system/tools.js';
import { runDoctor, formatReport } from './doctor.js';
import type { BrokerStateEvent, ChatChunkEvent, PersistedConfigWire, PoolStatusWire, ProviderWire, RuntimeStateEvent, SettingsResult } from './bridge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let orbWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

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
  // Tray present → closing parks Fairy in the tray instead of exiting (an
  // always-on assistant). No tray (Linux CI, missing indicator host) → the
  // close button quits exactly as before.
  mainWindow.on('close', (event) => {
    if (!quitting && tray !== null && mainWindow !== null) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
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

// ── Floating orb widget (v0.6) ────────────────────────────────────────────
// A borderless, transparent, always-on-top eye. Opt-in (config.floatingOrb);
// clicking it summons the panel. Shares the hardened preload/session.
function createOrbWindow(): void {
  if (orbWindow !== null) return;
  orbWindow = new BrowserWindow({
    width: 132,
    height: 120,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    title: 'Fairy',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  orbWindow.setAlwaysOnTop(true, 'screen-saver');
  orbWindow.once('ready-to-show', () => orbWindow?.show());
  orbWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  orbWindow.webContents.on('will-navigate', (event) => { event.preventDefault(); });
  const devUrl = process.env.FAIRY_DEV_URL;
  if (devUrl) {
    void orbWindow.loadURL(devUrl + (devUrl.includes('?') ? '&' : '?') + 'view=orb');
  } else {
    void orbWindow.loadFile(path.join(__dirname, '../ui/index.html'), { search: 'view=orb' });
  }
  orbWindow.on('closed', () => { orbWindow = null; });
}

function destroyOrbWindow(): void {
  // destroy(), not close(): transparent click-through widgets must never
  // re-enter close handlers, and the setting is already off.
  if (orbWindow !== null) {
    orbWindow.destroy();
    orbWindow = null;
  }
}

function applyFloatingOrb(enabled: boolean): void {
  if (enabled) createOrbWindow();
  else destroyOrbWindow();
}

/** Summon/dismiss the main panel — the one entry point for orb, tray, hotkey. */
function togglePanel(): void {
  if (mainWindow === null) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// 16×16 eye-mandala (Fairy blue on navy) — embedded as a data URL so the tray
// icon needs no packaging resources and cannot go missing in an installer.
const TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAArElEQVR4nGNkwAJY2Pn+YxP/8/MTI7oYhgBMs3frRxTxrdX8WA1hxKURpgEG0MUxXMPCzvffv+f/fxZ2PrwYpoYszdgMYcIVYDBno4cFRnjhsv3Vp/930G3E5gomXDZLifIrB5/6yBB86iPD1mp+nC7BagApgAWbIMzGtWb8cBehRyvCBAL+xOd/Fna+/yx/fn5ixBUTOG2FApTERG5CojgpUy8zYTMEr5+hAABCQq4aUlobeAAAAABJRU5ErkJggg==';

function createTray(): void {
  try {
    const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL);
    tray = new Tray(icon);
    tray.setToolTip('Fairy — Type-III intelligence');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Fairy', click: () => togglePanel() },
      { type: 'separator' },
      {
        label: 'Floating orb',
        type: 'checkbox',
        checked: settingsStore.load().floatingOrb === true,
        click: (item) => {
          try {
            const cfg = settingsStore.load();
            if (item.checked) cfg.floatingOrb = true;
            else delete cfg.floatingOrb;
            settingsStore.save(cfg);
            applyFloatingOrb(item.checked);
          } catch { /* tray mirrors the setting; the Settings tab is authoritative */ }
        },
      },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('click', () => togglePanel());
  } catch (err) {
    // No tray host (headless Linux CI, stripped desktops): everything else works.
    tray = null;
    console.error('[fairy] tray unavailable:', err instanceof Error ? err.message : String(err));
  }
}

export function getMainWindow(): BrowserWindow | null { return mainWindow; }

function broadcast(channel: string, payload: unknown): void {
  // Every window hears state: the floating orb mirrors runtime state live.
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
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

// Journal + transcripts (best effort): chat history and lifecycle events land
// in SQLite when available; chat itself works without the database.
let journal: EventJournalImpl | null = null;
let transcripts: ConversationStore | null = null;
try {
  const db: DatabaseHandle = openDatabase(path.join(app.getPath('userData'), 'fairy.db'));
  journal = new EventJournalImpl(db);
  transcripts = new ConversationStore(db);
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

// Failover audit trail: every key-pool failover decision lands in the journal —
// the record shows which key failed, why, and which key took over.
function journalPoolAttempt(e: PoolAttemptEvent): void {
  journal?.append({
    type: 'pool.failover',
    payload: { from: e.from, to: e.to, reason: e.reason, ...(e.status !== undefined ? { status: e.status } : {}) },
    acknowledged: false,
  });
}

function rebuildGateway(): void {
  const cfg = settingsStore.load();
  if (cfg.cloudProviders.length === 0) {
    gateway = null;
    return;
  }
  if (gateway !== null) {
    // Preserve pool health across settings edits: cooldowns, round-robin
    // position and session counters survive; only routes swap.
    gateway.reconfigure(cfg);
    return;
  }
  gateway = new ModelGateway(cfg, (handle) => vault.resolve(handle), { onAttempt: journalPoolAttempt });
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
  transcripts,
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
  const pool = effectivePool(cfg);
  return {
    cloudProviders: cfg.cloudProviders.map((p): ProviderWire => ({
      endpointId: p.endpointId,
      baseUrl: p.baseUrl,
      authHandle: p.authHandle,
      includedCost: p.includedCost,
      allowedDataScopes: [...p.allowedDataScopes],
      ...(p.model !== undefined ? { model: p.model } : {}),
      ...(p.supportsVision === true ? { supportsVision: true } : {}),
      ...(p.keyless === true ? { keyless: true } : {}),
      keyPresent: p.authHandle !== '' && vault.resolve(p.authHandle) !== undefined,
    })),
    ...(cfg.selectedProviderId !== undefined ? { selectedProviderId: cfg.selectedProviderId } : {}),
    ...(pool.length > 0 ? { activeProviderIds: pool } : {}),
    ...(cfg.agreementAcceptedAt !== undefined ? { agreementAcceptedAt: cfg.agreementAcceptedAt } : {}),
    ...(cfg.allowCommandExecution === true ? { allowCommandExecution: true } : {}),
    ...(cfg.floatingOrb === true ? { floatingOrb: true } : {}),
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

// Floating orb widget (v0.6): journaled like every other shell-level arm switch.
ipcMain.handle('settings:setFloatingOrb', (_event, raw: unknown): SettingsResult => {
  if (raw !== true && raw !== false) {
    return { ok: false, error: 'invalid payload (expected boolean)' };
  }
  try {
    const cfg = settingsStore.load();
    if (raw) cfg.floatingOrb = true;
    else delete cfg.floatingOrb;
    settingsStore.save(cfg);
    applyFloatingOrb(raw);
    journal?.append({ type: 'settings.floating-orb', payload: { enabled: raw }, acknowledged: true });
    return { ok: true, config: toWire(settingsStore.load()) };
  } catch (err) {
    return { ok: false, error: `floating-orb toggle failed: ${err instanceof Error ? err.message : String(err)}` };
  }
});

// Summon/dismiss the panel — orb click, tray, and the global hotkey all land here.
ipcMain.handle('shell:togglePanel', (): { ok: boolean } => {
  togglePanel();
  return { ok: true };
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
  } else if (p.keyless === true) {
    // Local keyless endpoint (Ollama): registers with no credential at all.
    p.authHandle = '';
  } else {
    return { ok: false, error: 'new provider requires an API key' };
  }
  cfg.cloudProviders = [
    ...cfg.cloudProviders.filter(c => c.endpointId !== p.endpointId),
    p,
  ];
  // Key-pool auto-join (v0.4): every key Master registers is meant to be USED —
  // new providers join the active pool automatically (untick in Providers to opt
  // a key out). Legacy selection stays anchored to the pool head for old builds.
  if (!existing) {
    const pool = effectivePool(cfg);
    if (!pool.includes(p.endpointId)) pool.push(p.endpointId);
    cfg.activeProviderIds = pool;
    if (pool.length > 0) cfg.selectedProviderId = pool[0]!;
  }
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
    // A deleted key leaves the pool with it.
    if (next.activeProviderIds !== undefined) {
      const pool = next.activeProviderIds.filter(pid => pid !== id);
      if (pool.length > 0) {
        next.activeProviderIds = pool;
        next.selectedProviderId = pool[0]!;
      } else {
        delete next.activeProviderIds;
      }
    }
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

// Key pool membership (v0.4): the ordered set of keys Fairy routes through.
// Every change is journalled — the record shows exactly which keys were armed.
ipcMain.handle('settings:setActiveProviders', (_event, raw: unknown): SettingsResult => {
  if (!Array.isArray(raw) || raw.some(x => typeof x !== 'string' || x.length === 0 || x.length > 64)) {
    return { ok: false, error: 'invalid pool payload (expected array of provider ids)' };
  }
  try {
    const cfg = settingsStore.load();
    const known = new Set(cfg.cloudProviders.map(c => c.endpointId));
    const ids = [...new Set(raw as string[])].filter(id => known.has(id)).slice(0, 32);
    const before = effectivePool(cfg);
    if (ids.length > 0) {
      cfg.activeProviderIds = ids;
      cfg.selectedProviderId = ids[0]!; // legacy anchor — old builds still route
    } else {
      delete cfg.activeProviderIds;
      delete cfg.selectedProviderId;
    }
    settingsStore.save(cfg);
    rebuildGateway();
    journal?.append({
      type: 'settings.pool',
      payload: { ids, added: ids.filter(id => !before.includes(id)), removed: before.filter(id => !ids.includes(id)) },
      acknowledged: true,
    });
    return { ok: true, config: toWire(cfg) };
  } catch (err) {
    return { ok: false, error: `pool update failed: ${err instanceof Error ? err.message : String(err)}` };
  }
});

// Live pool routing state for the Status HUD — measured, not remembered.
ipcMain.handle('settings:poolStatus', (): { ok: boolean; status?: PoolStatusWire; error?: string } => {
  try {
    return { ok: true, status: gateway?.poolStatus() ?? { activeIds: [], registered: 0, cooling: [], requests: 0, failovers: 0 } };
  } catch (err) {
    return { ok: false, error: `pool status failed: ${err instanceof Error ? err.message : String(err)}` };
  }
});

// ── Chat IPC ────────────────────────────────────────────────────────────────
ipcMain.handle('chat:send', async (_event, raw: unknown): Promise<{ ok: boolean; error?: string; message?: { id: string; role: 'assistant'; content: string }; model?: string; conversationId?: string }> => {
  if (typeof raw !== 'string') return { ok: false, error: 'invalid message payload' };
  if (chatService.isRunning) return { ok: false, error: 'a request is already in flight' };
  try {
    const result = await chatService.send(raw);
    return {
      ok: true,
      message: { id: result.messageId, role: 'assistant', content: result.content },
      model: result.model,
      ...(chatService.activeConversation !== null ? { conversationId: chatService.activeConversation } : {}),
    };
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

// ── Conversation transcripts (v0.6) ────────────────────────────────────────
ipcMain.handle('chat:history', (_event, raw: unknown) => {
  const limit = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 50;
  try {
    return { ok: true, conversations: chatService.listConversations(limit) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('chat:search', (_event, raw: unknown) => {
  if (typeof raw !== 'string') return { ok: false, error: 'invalid search payload' };
  if (raw.length > 200) return { ok: false, error: 'search query too long (max 200 chars)' };
  try {
    return { ok: true, conversations: chatService.searchConversations(raw) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('chat:open', (_event, raw: unknown) => {
  if (raw !== null && typeof raw !== 'string') return { ok: false, error: 'invalid conversation id' };
  if (typeof raw === 'string' && (raw.length === 0 || raw.length > 80)) {
    return { ok: false, error: 'invalid conversation id' };
  }
  try {
    const opened = chatService.openConversation(raw);
    return { ok: true, ...opened };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('chat:delete', (_event, raw: unknown): { ok: boolean; error?: string } => {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 80) {
    return { ok: false, error: 'invalid conversation id' };
  }
  try {
    chatService.deleteConversation(raw);
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
  const existing = cfg.cloudProviders.find(c => c.endpointId === endpointId);
  if (existing) {
    // Provider already registered (persistent profile): refresh the vaulted key
    // when the session vault lost it (restart on a machine without OS key
    // storage) or the key rotated in .env. Config only changes when the entry
    // had no handle at all (registered keyless).
    const handle = existing.authHandle;
    if (handle !== '' && vault.resolve(handle) === apiKey) return;
    const nextHandle = handle !== '' ? handle : 'cred_' + randomUUID();
    vault.store(nextHandle, apiKey);
    try {
      keyStore.setKey(nextHandle, apiKey);
      keyStore.flush();
    } catch (err) {
      console.error('[fairy] seeded key stays session-only:', err instanceof Error ? err.message : err);
    }
    if (nextHandle !== handle) {
      existing.authHandle = nextHandle;
      settingsStore.save(cfg);
    }
    console.log(`[fairy] re-vaulted seeded key for '${endpointId}'`);
    return;
  }
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
  // Seeded keys join the pool like hand-added ones.
  const pool = effectivePool(cfg);
  if (!pool.includes(endpointId)) pool.push(endpointId);
  cfg.activeProviderIds = pool;
  cfg.selectedProviderId = pool[0]!;
  settingsStore.save(cfg);
  rebuildGateway();
}

// Single-instance lock: a proactive assistant must not run twice against one state dir.
// NOTE: doctor mode must be excluded from the lock — probing a running install
// should not fight the GUI instance for the singleton.
const doctorMode = process.argv.includes('--doctor') || process.env.FAIRY_DOCTOR === '1';
const gotLock = doctorMode || app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else if (doctorMode) {
  // fairy-doctor: full-fidelity probe from inside Electron (OS key decryption
  // works here). Prints the report, exits 0 when every keyed route is live.
  app.whenReady().then(async () => {
    try {
      keyStore.loadInto((handle, key) => vault.store(handle, key));
    } catch { /* probe reports what it can see */ }
    try {
      const cfg = settingsStore.load();
      const report = await runDoctor({
        providers: cfg.cloudProviders.map(p => ({
          endpointId: p.endpointId,
          baseUrl: p.baseUrl,
          ...(p.model !== undefined ? { model: p.model } : {}),
          ...(p.keyless === true ? { keyless: true } : {}),
          authHandle: p.authHandle,
        })),
        resolveKey: (handle) => vault.resolve(handle),
        encryptionAvailable: keyCodec.available,
        persistedKeys: keyStore.size(),
        journalAvailable: journal !== null,
        pool: effectivePool(cfg),
      });
      console.log(formatReport(report));
      app.exit(report.overallOk ? 0 : 1);
    } catch (err) {
      console.error('FAIRY DOCTOR — probe failed:', err instanceof Error ? err.message : String(err));
      app.exit(2);
    }
  });
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
      // Resume where Master left off (v0.6): the latest transcript is back in
      // the live conversation before the window ever paints.
      if (chatService.resumeLatest()) console.log('[fairy] resumed the latest conversation');
    } catch (err) {
      // A bad seed must never take down startup — the user can configure via UI.
      console.error('[fairy] provider seeding failed:', err);
    }
    createWindow();
    void probeBroker();
    // Keep the H.D.D. link indicator honest without a background storm.
    setInterval(() => { void probeBroker(); }, 30_000).unref();
    // ── Shell presence (v0.6): tray, hotkey, floating orb ────────────────
    createTray();
    const hotkeyOk = globalShortcut.register('CommandOrControl+Shift+F', () => togglePanel());
    if (!hotkeyOk) console.log('[fairy] global hotkey Ctrl/Cmd+Shift+F unavailable (claimed by another app)');
    if (settingsStore.load().floatingOrb === true) createOrbWindow();
  }).catch((err: unknown) => {
    console.error('[fairy] startup failed:', err);
    dialog.showErrorBox('Fairy failed to start', err instanceof Error ? err.message : String(err));
    app.quit();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); });
}
