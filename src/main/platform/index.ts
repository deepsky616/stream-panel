export type SupportedPlatform = 'win32' | 'darwin';
export type PlatformAlwaysOnTopLevel = 'normal' | 'floating' | 'screen-saver';

export interface PlatformConfig {
  supported: boolean;
  platform: SupportedPlatform | null;
  alwaysOnTopLevel: PlatformAlwaysOnTopLevel;
  hideDock: boolean;
  focusAppBeforeShow: boolean;
  trayAsset: 'tray.ico' | 'trayTemplate.png';
  defaultHotkey: string;
}

export interface StartHiddenOptions {
  argv?: readonly string[];
  getWasOpenedAsHidden?: () => boolean;
}

const WINDOWS_CONFIG: PlatformConfig = {
  supported: true,
  platform: 'win32',
  alwaysOnTopLevel: 'screen-saver',
  hideDock: false,
  focusAppBeforeShow: false,
  trayAsset: 'tray.ico',
  defaultHotkey: 'CommandOrControl+Alt+D',
};

const MACOS_CONFIG: PlatformConfig = {
  supported: true,
  platform: 'darwin',
  alwaysOnTopLevel: 'floating',
  hideDock: true,
  focusAppBeforeShow: true,
  trayAsset: 'trayTemplate.png',
  defaultHotkey: 'CommandOrControl+Alt+D',
};

const NULL_CONFIG: PlatformConfig = {
  supported: false,
  platform: null,
  alwaysOnTopLevel: 'normal',
  hideDock: false,
  focusAppBeforeShow: false,
  trayAsset: 'tray.ico',
  defaultHotkey: 'CommandOrControl+Alt+D',
};

export function resolveSupportedPlatform(
  platform: NodeJS.Platform = process.platform,
): SupportedPlatform | null {
  return platform === 'win32' || platform === 'darwin' ? platform : null;
}

export function getPlatformConfig(platform: NodeJS.Platform = process.platform): PlatformConfig {
  switch (platform) {
    case 'win32':
      return WINDOWS_CONFIG;
    case 'darwin':
      return MACOS_CONFIG;
    default:
      return NULL_CONFIG;
  }
}

export function shouldStartHidden(
  platform: NodeJS.Platform = process.platform,
  { argv = process.argv, getWasOpenedAsHidden = () => false }: StartHiddenOptions = {},
): boolean {
  if (platform === 'win32') return argv.includes('--hidden');
  if (platform !== 'darwin') return false;
  try {
    return getWasOpenedAsHidden();
  } catch {
    return false;
  }
}

export const PLATFORM = getPlatformConfig();
