import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { ConfigStore } from '../../store';
import { setTrayUpdateVersion } from '../../tray';
import { broadcastUpdateStatus, SIX_HOURS_MS } from './common';
import { recordUpdaterFailure } from './diagnostics';
import { lookupLatestVersion, UPDATE_MIRROR_URL } from './releaseLookup';
import type { UpdaterService } from './types';
import { compareVersions, normalizeVersion } from './version';

export function createWindowsUpdater(configStore: ConfigStore): UpdaterService {
  // The fixed Pages mirror avoids GitHub API rate limits and expiring release
  // asset redirects. The release workflow publishes latest.yml, blockmap, and
  // the installer together so electron-updater can use it as a generic feed.
  autoUpdater.setFeedURL({ provider: 'generic', url: UPDATE_MIRROR_URL });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  let activeCheck: Promise<{ status: string; version?: string }> | null = null;
  let checking = false;

  const runCheck = async () => {
    if (!app.isPackaged) {
      return { status: '개발 모드에서는 업데이트를 확인하지 않습니다.' };
    }
    checking = true;
    try {
      broadcastUpdateStatus({ state: 'checking', message: '업데이트를 확인하는 중입니다.' });
      const result = await autoUpdater.checkForUpdates();
      const latest = normalizeVersion(result?.updateInfo.version ?? '');
      if (!latest) throw new Error('자동 업데이트 서버가 올바른 버전을 반환하지 않았습니다.');
      if (compareVersions(latest, app.getVersion()) > 0) {
        const message = `새 버전 v${latest}을 내려받는 중입니다.`;
        return { status: message, version: latest };
      }
      const message = `현재 최신 버전 v${latest}을 사용 중입니다.`;
      broadcastUpdateStatus({ state: 'current', version: latest, message });
      return { status: message, version: latest };
    } catch (automaticError) {
      const automaticCode = await recordUpdaterFailure('automatic-check', automaticError);
      console.warn(`윈도우 자동 업데이트 확인에 실패했습니다. (${automaticCode})`, automaticError);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);
      try {
        const latest = await lookupLatestVersion(globalThis.fetch, controller.signal);
        if (compareVersions(latest.version, app.getVersion()) > 0) {
          const message = `새 버전 v${latest.version}이 있습니다. 자동 다운로드 연결에 실패해 다운로드 미러에서 설치해 주세요. (${automaticCode})`;
          broadcastUpdateStatus({
            state: 'available',
            version: latest.version,
            message,
          });
          return { status: message, version: latest.version };
        }
        const message = `현재 최신 버전 v${latest.version}을 사용 중입니다. 대체 확인 경로로 확인했습니다.`;
        broadcastUpdateStatus({
          state: 'current',
          version: latest.version,
          message,
        });
        return { status: message, version: latest.version };
      } catch (fallbackError) {
        const fallbackCode = await recordUpdaterFailure('fallback-check', fallbackError);
        console.warn(`업데이트 대체 확인도 실패했습니다. (${fallbackCode})`, fallbackError);
        const message = `업데이트 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요. (오류 코드: ${fallbackCode})`;
        broadcastUpdateStatus({ state: 'error', message });
        return { status: message };
      } finally {
        clearTimeout(timeout);
      }
    } finally {
      checking = false;
    }
  };
  const check = () => {
    activeCheck ??= runCheck().finally(() => { activeCheck = null; });
    return activeCheck;
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
    // checkForUpdates rejects with the same error; runCheck records it and
    // attempts the independent metadata route without briefly painting a
    // misleading network error over the successful fallback result.
    if (checking) return;
    void recordUpdaterFailure('download', error).then((code) => {
      console.warn(`윈도우 업데이트 다운로드 중 문제가 생겼습니다. (${code})`, error);
      broadcastUpdateStatus({
        state: 'error',
        message: `업데이트를 내려받지 못했습니다. 다운로드 미러를 이용해 주세요. (오류 코드: ${code})`,
      });
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
