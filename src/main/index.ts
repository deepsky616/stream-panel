import { app, BrowserWindow, ipcMain } from 'electron';
import { createDefaultConfig } from '../shared/defaults';
import { IPC_CHANNELS } from '../shared/ipcChannels';
import { registerIpcHandlers } from './ipc';
import { ConfigStore } from './store';
import { applyPanelLayout, createPanelWindow, showPanel } from './windows/panelWindow';
import { cleanupOrphanIcons } from './services/iconCleanup';
import { createTray } from './tray';
import { registerShortcuts } from './shortcuts';
import { setAutoLaunch } from './services/autoLaunch';
import { configureUpdater } from './services/updater';
import { openEditorWindow } from './windows/editorWindow';

type QuitAwareApp = typeof app & { isQuitting?: boolean };

app.setName('stream-panel');
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.on('will-attach-webview', (event) => event.preventDefault());
  if (app.isPackaged) contents.on('devtools-opened', () => contents.closeDevTools());
});

app.whenReady().then(() => {
  const defaultConfig = createDefaultConfig({
    downloads: app.getPath('downloads'),
    documents: app.getPath('documents'),
  });
  const configStore = new ConfigStore({
    userDataPath: app.getPath('userData'),
    defaultConfig,
    onWarning: (message) => {
      console.warn(message);
      for (const window of app.isReady() ? createSafeWindowList() : []) {
        window.webContents.send(IPC_CHANNELS.TOAST, { level: 'info', message });
      }
    },
  });
  registerIpcHandlers(configStore);
  void cleanupOrphanIcons(configStore.get().root, app.getPath('userData'));
  createPanelWindow(configStore);
  if (process.argv.includes('--editor')) openEditorWindow();
  createTray();
  registerShortcuts(configStore);
  const updater = configureUpdater(configStore);
  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, () => updater.check());
  let launchAtLogin = configStore.get().launchAtLogin;
  setAutoLaunch(launchAtLogin);
  configStore.onDidChange((config) => {
    applyPanelLayout(config);
    for (const window of createSafeWindowList()) {
      window.webContents.send(IPC_CHANNELS.CONFIG_CHANGED, config);
    }
    if (config.launchAtLogin !== launchAtLogin) {
      launchAtLogin = config.launchAtLogin;
      setAutoLaunch(launchAtLogin);
    }
  });
  app.on('second-instance', () => showPanel());
});

function createSafeWindowList(): BrowserWindow[] {
  return BrowserWindow.getAllWindows();
}

app.on('before-quit', () => {
  (app as QuitAwareApp).isQuitting = true;
});

app.on('window-all-closed', () => {
  if ((app as QuitAwareApp).isQuitting) app.quit();
});
