import { app, net } from 'electron';
import type { ConfigStore } from '../../store';
import { broadcastUpdateStatus, SIX_HOURS_MS } from './common';
import type { UpdaterService } from './types';
import { compareVersions, normalizeVersion } from './version';

const LATEST_RELEASE_API =
  'https://api.github.com/repos/deepsky616/stream-panel/releases/latest';

interface LatestReleaseResponse {
  tag_name?: unknown;
}

export function createMacosUpdater(configStore: ConfigStore): UpdaterService {
  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;

  const check = async () => {
    if (!app.isPackaged) {
      return { status: '개발 모드에서는 새 버전을 확인하지 않습니다.' };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6_000);
    try {
      broadcastUpdateStatus({ state: 'checking', message: '새 버전을 확인하는 중입니다.' });
      const response = await net.fetch(LATEST_RELEASE_API, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'StreamPanel',
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`GitHub API ${response.status}`);
      const body = (await response.json()) as LatestReleaseResponse;
      const latest = typeof body.tag_name === 'string' ? normalizeVersion(body.tag_name) : null;
      if (!latest) throw new Error('Invalid release tag');
      if (compareVersions(latest, app.getVersion()) > 0) {
        const message = `새 버전 v${latest}이 있습니다. 릴리즈 페이지에서 내려받아 주세요.`;
        broadcastUpdateStatus({ state: 'available', version: latest, message });
        return { status: message, version: latest };
      }
      const message = '현재 최신 버전을 사용 중입니다.';
      broadcastUpdateStatus({ state: 'current', version: latest, message });
      return { status: message, version: latest };
    } catch (error) {
      console.warn('맥 새 버전 확인에 실패했습니다. 네트워크 연결을 확인해 주세요.', error);
      return { status: '새 버전을 확인하지 못했습니다. 네트워크 연결을 확인해 주세요.' };
    } finally {
      clearTimeout(timeout);
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

  let autoUpdate = configStore.get().autoUpdate;
  const unsubscribe = configStore.onDidChange((config) => {
    if (config.autoUpdate === autoUpdate) return;
    autoUpdate = config.autoUpdate;
    startSchedule();
  });
  const dispose = (): void => {
    stopSchedule();
    unsubscribe();
  };
  app.once('will-quit', dispose);
  startSchedule();
  return {
    check,
    restartAndInstall: async () => ({
      ok: false,
      message: '맥에서는 릴리즈 페이지에서 새 버전을 직접 설치해 주세요.',
    }),
    dispose,
  };
}
