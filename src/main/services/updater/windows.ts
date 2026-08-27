import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { ConfigStore } from '../../store';
import { setTrayUpdateVersion } from '../../tray';
import { broadcastUpdateNotice, broadcastUpdateStatus, SIX_HOURS_MS } from './common';
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
  autoUpdater.autoRunAppAfterInstall = true;
  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  let activeCheck: Promise<{
    status: string;
    version?: string;
    readyToInstall?: boolean;
  }> | null = null;
  let checking = false;
  let downloadedVersion: string | null = null;
  let announcedVersion: string | null = null;
  let installing = false;

  const announceUpdateOnce = (version: string, message: string): void => {
    const normalized = normalizeVersion(version) ?? version;
    if (announcedVersion === normalized) return;
    announcedVersion = normalized;
    broadcastUpdateNotice(message);
  };

  const runCheck = async () => {
    if (!app.isPackaged) {
      return { status: '개발 모드에서는 업데이트를 확인하지 않습니다.' };
    }
    if (downloadedVersion) {
      const message = `v${downloadedVersion} 업데이트 준비가 완료되었습니다. 재시작하여 적용해 주세요.`;
      broadcastUpdateStatus({
        state: 'downloaded',
        version: downloadedVersion,
        message,
      });
      return {
        status: message,
        version: downloadedVersion,
        readyToInstall: true,
      };
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
          announceUpdateOnce(
            latest.version,
            `Stream Panel v${latest.version} 업데이트가 있습니다. 설정 → 정보에서 업데이트를 다시 확인하거나 다운로드 미러에서 설치해 주세요.`,
          );
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

  const restartAndInstall: UpdaterService['restartAndInstall'] = async () => {
    if (!app.isPackaged) {
      return {
        ok: false,
        message: '개발 모드에서는 업데이트를 설치할 수 없습니다.',
      };
    }
    if (!downloadedVersion) {
      return {
        ok: false,
        message: '설치할 업데이트가 아직 준비되지 않았습니다. 업데이트 확인 후 다운로드가 끝날 때까지 기다려 주세요.',
      };
    }
    if (installing) {
      return {
        ok: true,
        version: downloadedVersion,
        message: '업데이트 설치를 위해 Stream Panel을 종료하고 있습니다.',
      };
    }

    const version = downloadedVersion;
    installing = true;
    const message = `v${version} 업데이트를 적용하기 위해 Stream Panel을 다시 시작합니다.`;
    broadcastUpdateStatus({ state: 'installing', version, message });
    try {
      // Silent mode with force-run guarantees that the updated executable is
      // launched again after NSIS finishes replacing the current version.
      autoUpdater.quitAndInstall(true, true);
      return { ok: true, version, message };
    } catch (error) {
      installing = false;
      const code = await recordUpdaterFailure('install', error);
      const failureMessage = `업데이트 설치를 시작하지 못했습니다. 다시 시도해 주세요. (오류 코드: ${code})`;
      broadcastUpdateStatus({ state: 'error', version, message: failureMessage });
      return { ok: false, version, message: failureMessage };
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
    downloadedVersion = normalizeVersion(info.version) ?? info.version;
    installing = false;
    setTrayUpdateVersion(downloadedVersion);
    broadcastUpdateStatus({
      state: 'downloaded',
      version: downloadedVersion,
      message: `v${downloadedVersion} 업데이트 준비가 완료되었습니다. 재시작하여 적용해 주세요.`,
    });
    announceUpdateOnce(
      downloadedVersion,
      `Stream Panel v${downloadedVersion} 업데이트 준비가 완료되었습니다. 설정 → 정보에서 '재시작하여 업데이트 적용'을 눌러 주세요.`,
    );
  });
  autoUpdater.on('error', (error) => {
    // checkForUpdates rejects with the same error; runCheck records it and
    // attempts the independent metadata route without briefly painting a
    // misleading network error over the successful fallback result.
    if (checking) return;
    const phase = installing ? 'install' : 'download';
    installing = false;
    void recordUpdaterFailure(phase, error).then((code) => {
      console.warn(`윈도우 업데이트 ${phase === 'install' ? '설치' : '다운로드'} 중 문제가 생겼습니다. (${code})`, error);
      broadcastUpdateStatus({
        state: 'error',
        ...(downloadedVersion ? { version: downloadedVersion } : {}),
        message: phase === 'install'
          ? `업데이트 설치를 시작하지 못했습니다. 다시 시도해 주세요. (오류 코드: ${code})`
          : `업데이트를 내려받지 못했습니다. 다운로드 미러를 이용해 주세요. (오류 코드: ${code})`,
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
  return { check, restartAndInstall, dispose };
}
