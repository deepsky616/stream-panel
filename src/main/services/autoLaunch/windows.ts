import type { AutoLaunchSetter } from './types';

export const setWindowsAutoLaunch: AutoLaunchSetter = (enabled, dependencies) => {
  if (!dependencies.isPackaged) return false;
  dependencies.setLoginItemSettings({
    openAtLogin: enabled,
    path: dependencies.execPath,
    args: ['--hidden'],
  });
  return true;
};
