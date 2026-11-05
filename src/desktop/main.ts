// Electron main process (T02). Minimal shell scaffold.
import { app, BrowserWindow } from 'electron';

let mainWindow: BrowserWindow | null = null;

export function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 720,
    show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.loadURL('data:text/html,<h1>Fairy shell (T02 pending)</h1>');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
