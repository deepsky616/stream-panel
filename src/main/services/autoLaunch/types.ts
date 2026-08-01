export interface LoginItemSettings {
  openAtLogin: boolean;
  path?: string;
  args?: string[];
  openAsHidden?: boolean;
}

export interface AutoLaunchDependencies {
  isPackaged: boolean;
  execPath: string;
  setLoginItemSettings(settings: LoginItemSettings): void;
}

export type AutoLaunchSetter = (
  enabled: boolean,
  dependencies: AutoLaunchDependencies,
) => boolean;
