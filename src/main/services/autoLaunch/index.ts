import { app } from 'electron';
import { setMacosAutoLaunch } from './macos';
import type { AutoLaunchDependencies } from './types';
import { setWindowsAutoLaunch } from './windows';

function defaultDependencies(): AutoLaunchDependencies {
  return {
    isPackaged: app.isPackaged,
    execPath: process.execPath,
    setLoginItemSettings: (settings) => app.setLoginItemSettings(settings),
  };
}

export function setAutoLaunch(
  enabled: boolean,
  platform: NodeJS.Platform = process.platform,
  dependencies: AutoLaunchDependencies = defaultDependencies(),
): boolean {
  try {
    if (platform === 'win32') return setWindowsAutoLaunch(enabled, dependencies);
    if (platform === 'darwin') return setMacosAutoLaunch(enabled, dependencies);
    return false;
  } catch {
    return false;
  }
}
