import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { ConfigStore } from '../../store';
import { setTrayUpdateVersion } from '../../tray';
import { broadcastUpdateStatus, SIX_HOURS_MS } from './common';
import type { UpdaterService } from './types';

export function createWindowsUpdater(configStore: ConfigStore): UpdaterService {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;

  const check = async () => {
    if (!app.isPackaged) {
      return { status: '개발 모드에서는 업데이트를 확인하지 않습니다.' };
    }
    try {
      broadcastUpdateStatus({ state: 'checking', message: '업데이트를 확인하는 중입니다.' });
      const result = await autoUpdater.checkForUpdates();
      return { status: '업데이트 확인을 마쳤습니다.', version: result?.updateInfo.version };
    } catch (error) {
      console.warn('윈도우 업데이트 확인에 실패했습니다. 네트워크 연결을 확인해 주세요.', error);
      broadcastUpdateStatus({
        state: 'error',
        message: '업데이트를 확인하지 못했습니다. 네트워크 연결을 확인해 주세요.',
      });
      return { status: '업데이트를 확인하지 못했습니다. 네트워크 연결을 확인해 주세요.' };
    }
  };

  const stopSchedule = (): void => {
    if (startupTimer) clearTimeout(startupTimer);
    if (interval) clearInterval(interval);
    startupTimer = null;
    interval = null;
  };
  const startSchedule = (): void => {
    stopSchedule();
    if (!app.isPackaged || !configStore.get().autoUpdate) return;
    startupTimer = setTimeout(() => void check(), 10_000);
    interval = setInterval(() => void check(), SIX_HOURS_MS);
  };

  autoUpdater.on('checking-for-update', () =>
    broadcastUpdateStatus({ state: 'checking', message: '업데이트를 확인하는 중입니다.' }),
  );
  autoUpdater.on('update-available', (info) =>
    broadcastUpdateStatus({
      state: 'available',
      version: info.version,
      message: '새 버전을 내려받는 중입니다.',
    }),
  );
  autoUpdater.on('update-not-available', (info) =>
    broadcastUpdateStatus({
      state: 'current',
      version: info.version,
      message: '현재 최신 버전을 사용 중입니다.',
    }),
  );
  autoUpdater.on('download-progress', (progress) =>
    broadcastUpdateStatus({ state: 'downloading', progress: progress.percent }),
  );
  autoUpdater.on('update-downloaded', (info) => {
    setTrayUpdateVersion(info.version);
    broadcastUpdateStatus({
      state: 'downloaded',
      version: info.version,
      message: `앱을 다시 시작하면 v${info.version} 업데이트가 적용됩니다.`,
    });
  });
  autoUpdater.on('error', (error) => {
    console.warn('윈도우 업데이트 처리 중 문제가 생겼습니다.', error);
    broadcastUpdateStatus({
      state: 'error',
      message: '업데이트를 처리하지 못했습니다. 잠시 뒤 다시 확인해 주세요.',
    });
  });

  let autoUpdate = configStore.get().autoUpdate;
  const unsubscribe = configStore.onDidChange((config) => {
    if (config.autoUpdate === autoUpdate) return;
    autoUpdate = config.autoUpdate;
    startSchedule();
  });
  const dispose = (): void => {
    stopSchedule();
    unsubscribe();
    autoUpdater.removeAllListeners();
  };
  app.once('will-quit', dispose);
  startSchedule();
  return { check, dispose };
}
