import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
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
import { PLATFORM } from './platform';
import { setLauncherEnabled } from './windows/launcherWindow';
import {
  createWebConnectorService,
  setActiveWebConnectorService,
  type WebConnectorService,
} from './services/webConnector';

type QuitAwareApp = typeof app & { isQuitting?: boolean };

app.setName('stream-panel');
const gotLock = app.requestSingleInstanceLock();
let webConnectorService: WebConnectorService | null = null;
if (!gotLock) {
  console.error('다른 Stream Panel 실행 과정이 이미 단일 실행 잠금을 사용하고 있습니다.');
  app.quit();
}

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.on('will-attach-webview', (event) => event.preventDefault());
  if (app.isPackaged) contents.on('devtools-opened', () => contents.closeDevTools());
});

app.whenReady().then(async () => {
  if (PLATFORM.hideDock) app.dock?.hide();
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
  webConnectorService = createWebConnectorService({
    userDataPath: app.getPath('userData'),
    extensionDirectory: app.isPackaged
      ? join(process.resourcesPath, 'browser-extension')
      : join(app.getAppPath(), 'browser-extension'),
    notify: (message, level) => {
      for (const window of createSafeWindowList()) {
        window.webContents.send(IPC_CHANNELS.TOAST, { level, message });
      }
    },
  });
  const connectorStart = await webConnectorService.start();
  if (!connectorStart.ok) console.warn(connectorStart.message);
  setActiveWebConnectorService(webConnectorService);
  registerIpcHandlers(configStore, webConnectorService);
  void cleanupOrphanIcons(configStore.get().root, app.getPath('userData'));
  createPanelWindow(configStore);
  setLauncherEnabled(configStore.get().keyboard.quickLauncher);
  if (process.argv.includes('--editor')) openEditorWindow();
  createTray();
  registerShortcuts(configStore);
  const updater = configureUpdater(configStore);
  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, () => updater.check());
  let launchAtLogin = configStore.get().launchAtLogin;
  let quickLauncherEnabled = configStore.get().keyboard.quickLauncher;
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
    if (config.keyboard.quickLauncher !== quickLauncherEnabled) {
      quickLauncherEnabled = config.keyboard.quickLauncher;
      setLauncherEnabled(quickLauncherEnabled);
    }
  });
  app.on('second-instance', () => showPanel());
}).catch((error: unknown) => {
  console.error('앱을 시작하지 못했습니다. 설치 파일과 설정을 확인해 주세요.', error);
  app.quit();
});

function createSafeWindowList(): BrowserWindow[] {
  return BrowserWindow.getAllWindows();
}

app.on('before-quit', () => {
  (app as QuitAwareApp).isQuitting = true;
  setActiveWebConnectorService(null);
  void webConnectorService?.stop();
});

app.on('window-all-closed', () => {
  if ((app as QuitAwareApp).isQuitting) app.quit();
});
