import { app, BrowserWindow, ipcMain, Notification } from 'electron';
import { createDefaultConfig } from '../shared/defaults';
import { IPC_CHANNELS } from '../shared/ipcChannels';
import { isWebConnectorSupportedPlatform } from '../shared/webWorkflows';
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
import {
  createApprovalMonitorService,
  type ApprovalMonitorService,
} from './services/approvalMonitor';

type QuitAwareApp = typeof app & { isQuitting?: boolean };

app.setName('stream-panel');
const gotLock = app.requestSingleInstanceLock();
let webConnectorService: WebConnectorService | null = null;
let approvalMonitorService: ApprovalMonitorService | null = null;
let serviceShutdownStarted = false;
let serviceShutdownComplete = false;
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
  if (isWebConnectorSupportedPlatform(PLATFORM.platform)) {
    const connector = createWebConnectorService({
      userDataPath: app.getPath('userData'),
      platform: PLATFORM.platform,
      getConfig: () => configStore.get(),
      notify: (message, level) => {
        for (const window of createSafeWindowList()) {
          window.webContents.send(IPC_CHANNELS.TOAST, { level, message });
        }
      },
    });
    webConnectorService = connector;
    const connectorStart = await connector.start();
    if (!connectorStart.ok) console.warn(connectorStart.message);
    setActiveWebConnectorService(connector);
    approvalMonitorService = createApprovalMonitorService({
      userDataPath: app.getPath('userData'),
      platform: PLATFORM.platform,
      getConfig: () => configStore.get(),
      scanner: { scan: (input) => connector.scanApproval(input) },
      notify: (system, count) => {
        if (!Notification.isSupported()) return;
        const systemLabel = system === 'neis' ? '나이스' : '에듀파인';
        new Notification({
          title: `${systemLabel} 결재 대기 알림`,
          body: `결재할 문서가 ${count}건 있습니다. 스트림 패널의 결재함 키에서 확인할 수 있습니다.`,
          silent: false,
        }).show();
      },
      broadcast: (statuses) => {
        for (const window of createSafeWindowList()) {
          window.webContents.send(IPC_CHANNELS.WEB_APPROVAL_CHANGED, statuses);
        }
      },
    });
    await approvalMonitorService.start();
  }
  registerIpcHandlers(configStore, webConnectorService, approvalMonitorService);
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
    void webConnectorService?.onConfigChanged(config);
    approvalMonitorService?.onConfigChanged(config);
  });
  app.on('second-instance', () => showPanel());
}).catch((error: unknown) => {
  console.error('앱을 시작하지 못했습니다. 설치 파일과 설정을 확인해 주세요.', error);
  app.quit();
});

function createSafeWindowList(): BrowserWindow[] {
  return BrowserWindow.getAllWindows();
}

app.on('before-quit', (event) => {
  (app as QuitAwareApp).isQuitting = true;
  if ((!webConnectorService && !approvalMonitorService) || serviceShutdownComplete) return;
  event.preventDefault();
  if (serviceShutdownStarted) return;
  serviceShutdownStarted = true;
  setActiveWebConnectorService(null);
  void (async () => {
    await approvalMonitorService?.stop();
    await webConnectorService?.stop();
  })().finally(() => {
    serviceShutdownComplete = true;
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if ((app as QuitAwareApp).isQuitting) app.quit();
});
