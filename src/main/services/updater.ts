import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { ConfigStore } from '../store';
import { setTrayUpdateVersion } from '../tray';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function broadcast(payload: {
  state: string;
  progress?: number;
  version?: string;
  message?: string;
}): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_CHANNELS.UPDATE_STATUS, payload);
  }
}

export function configureUpdater(configStore: ConfigStore): {
  check: () => Promise<{ status: string; version?: string }>;
} {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;

  const check = async (): Promise<{ status: string; version?: string }> => {
    if (!app.isPackaged) return { status: '개발 모드에서는 업데이트를 확인하지 않습니다.' };
    try {
      broadcast({ state: 'checking', message: '업데이트를 확인하는 중입니다.' });
      const result = await autoUpdater.checkForUpdates();
      return { status: '업데이트 확인을 마쳤습니다.', version: result?.updateInfo.version };
    } catch (error) {
      const message = error instanceof Error ? error.message : '업데이트 확인에 실패했습니다.';
      broadcast({ state: 'error', message });
      return { status: '업데이트 확인에 실패했습니다.' };
    }
  };

  const stopSchedule = () => {
    if (startupTimer) clearTimeout(startupTimer);
    if (interval) clearInterval(interval);
    startupTimer = null;
    interval = null;
  };
  const startSchedule = () => {
    stopSchedule();
    if (!app.isPackaged || !configStore.get().autoUpdate) return;
    startupTimer = setTimeout(() => void check(), 10_000);
    interval = setInterval(() => void check(), SIX_HOURS_MS);
  };

  autoUpdater.on('checking-for-update', () =>
    broadcast({ state: 'checking', message: '업데이트를 확인하는 중입니다.' }),
  );
  autoUpdater.on('update-available', (info) =>
    broadcast({ state: 'available', version: info.version, message: '새 버전을 내려받는 중입니다.' }),
  );
  autoUpdater.on('update-not-available', (info) =>
    broadcast({ state: 'current', version: info.version, message: '현재 최신 버전을 사용 중입니다.' }),
  );
  autoUpdater.on('download-progress', (progress) =>
    broadcast({ state: 'downloading', progress: progress.percent }),
  );
  autoUpdater.on('update-downloaded', (info) => {
    setTrayUpdateVersion(info.version);
    broadcast({
      state: 'downloaded',
      version: info.version,
      message: `앱을 다시 시작하면 v${info.version} 업데이트가 적용됩니다.`,
    });
  });
  autoUpdater.on('error', (error) => {
    console.warn('Update error:', error.message);
    broadcast({ state: 'error', message: '업데이트를 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' });
  });

  let autoUpdate = configStore.get().autoUpdate;
  const unsubscribe = configStore.onDidChange((config) => {
    if (config.autoUpdate === autoUpdate) return;
    autoUpdate = config.autoUpdate;
    startSchedule();
  });
  app.once('will-quit', () => {
    stopSchedule();
    unsubscribe();
  });
  startSchedule();
  return { check };
}
