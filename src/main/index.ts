import { app, BrowserWindow } from 'electron';
import { createDefaultConfig } from '../shared/defaults';
import { IPC_CHANNELS } from '../shared/ipcChannels';
import { registerIpcHandlers } from './ipc';
import { ConfigStore } from './store';
import { applyPanelLayout, createPanelWindow, showPanel } from './windows/panelWindow';

type QuitAwareApp = typeof app & { isQuitting?: boolean };

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
  createPanelWindow(configStore);
  configStore.onDidChange((config) => {
    applyPanelLayout(config);
    for (const window of createSafeWindowList()) {
      window.webContents.send(IPC_CHANNELS.CONFIG_CHANGED, config);
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
