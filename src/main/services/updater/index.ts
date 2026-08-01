import type { ConfigStore } from '../../store';
import { createMacosUpdater } from './macos';
import type { UpdaterService } from './types';

function createNullUpdater(): UpdaterService {
  return {
    check: async () => ({ status: '이 운영체제에서는 새 버전 확인을 지원하지 않습니다.' }),
    dispose: () => undefined,
  };
}

export function configureUpdater(
  configStore: ConfigStore,
  platform: NodeJS.Platform = process.platform,
): UpdaterService {
  if (platform === 'darwin') return createMacosUpdater(configStore);
  if (platform !== 'win32') return createNullUpdater();

  const service = import('./windows').then(({ createWindowsUpdater }) =>
    createWindowsUpdater(configStore),
  );
  return {
    check: async () => (await service).check(),
    dispose: () => {
      void service.then((updater) => updater.dispose());
    },
  };
}
