// Electron main process (T02/T30). Shell + settings + orb window.
// Renderer is fully sandboxed: contextIsolation on, nodeIntegration off, preload
// exposes exactly the typed surface in bridge.ts — nothing else.
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SettingsStore } from '../storage/settings.js';
import { loadConfig, sanitizeProvider } from '../providers/config.js';
import { SecretVault } from '../providers/secret-vault.js';
import type { PersistedConfigWire, ProviderWire, SettingsResult } from './bridge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;

export function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 760,
    minWidth: 360,
    minHeight: 520,
    show: false,
    title: 'Fairy',
    backgroundColor: '#0b1120',
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

// IPC: settings load/save. Keys entered in the UI are vaulted in the main process for
// the session only; the persisted config keeps opaque handles exclusively.
const settingsPath = path.join(app.getPath('userData'), 'fairy-config.json');
const settingsStore = new SettingsStore(settingsPath);
const vault = new SecretVault();

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
    if (existing && existing.authHandle !== '') vault.remove(existing.authHandle);
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
  return { ok: true, config: toWire(cfg) };
});

ipcMain.handle('settings:deleteProvider', (_event, raw: unknown): SettingsResult => {
  const id = typeof raw === 'string' ? raw : '';
  if (id === '') return { ok: false, error: 'invalid provider id' };
  try {
    const cfg = settingsStore.load();
    const victim = cfg.cloudProviders.find(c => c.endpointId === id);
    if (victim && victim.authHandle !== '') vault.remove(victim.authHandle);
    const next = { ...cfg, cloudProviders: cfg.cloudProviders.filter(c => c.endpointId !== id) };
    if (next.selectedProviderId === id) delete next.selectedProviderId;
    settingsStore.save(next);
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
    return { ok: true, config: toWire(cfg) };
  } catch (err) {
    return { ok: false, error: `select failed: ${err instanceof Error ? err.message : String(err)}` };
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
      seedProviderFromEnv();
    } catch (err) {
      // A bad seed must never take down startup — the user can configure via UI.
      console.error('[fairy] provider seeding failed:', err);
    }
    createWindow();
  }).catch((err: unknown) => {
    console.error('[fairy] startup failed:', err);
    dialog.showErrorBox('Fairy failed to start', err instanceof Error ? err.message : String(err));
    app.quit();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}
