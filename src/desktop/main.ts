// Electron main process (T02/T30). Shell + settings + orb window.
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SettingsStore } from '../storage/settings.js';
import { loadConfig } from '../providers/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;

export function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 760,
    show: true,
    title: 'Fairy',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
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

export function getMainWindow(): BrowserWindow | null { return mainWindow; }

// IPC: settings load/save (user configures providers themselves)
const settingsPath = path.join(app.getPath('userData'), 'fairy-config.json');
const settingsStore = new SettingsStore(settingsPath);

ipcMain.handle('settings:load', () => settingsStore.load());
ipcMain.handle('settings:save', (_e, cfg) => { settingsStore.save(loadConfig(cfg)); return true; });

if (import.meta.url === `file://${process.argv[1]}`) {
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}
