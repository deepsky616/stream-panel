import type { AutoLaunchSetter } from './types';

export const setMacosAutoLaunch: AutoLaunchSetter = (enabled, dependencies) => {
  if (!dependencies.isPackaged) return false;
  dependencies.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true,
  });
  return true;
};
