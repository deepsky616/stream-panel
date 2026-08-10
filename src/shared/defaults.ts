import { DEFAULT_HINT_KEYS } from './hintMap';
import type { AppConfig, DeckItem } from './types';

export interface DefaultPaths {
  downloads: string;
  documents: string;
}

export const DEFAULT_GRID = {
  cols: 5,
  rows: 3,
  buttonSize: 88,
  gap: 8,
} as const;

export const DEFAULT_WINDOW = {
  x: null,
  y: null,
  alwaysOnTop: true,
  opacity: 1,
  locked: false,
  hideOnLaunch: false,
} as const;

export const DEFAULT_BEHAVIOR = {
  hideAfterLaunch: true,
  hideAfterLaunchDelayMs: 180,
  edgePeek: true,
  peekEdge: 'auto',
  peekThickness: 6,
  peekDelayMs: 220,
  idleFade: false,
  idleFadeAfterMs: 4_000,
  idleOpacity: 0.25,
} as const;

export const DEFAULT_KEYBOARD = {
  quickHints: 'on-focus',
  hintKeys: DEFAULT_HINT_KEYS,
  hideAfterHotkeyLaunch: true,
  globalNumberHotkeys: true,
  globalNumberModifier: 'Alt+Shift',
  quickLauncher: true,
  quickLauncherHotkey: 'CommandOrControl+Alt+Space',
} as const;

export const DEFAULT_APPROVAL_MONITOR = {
  sources: {
    neis: { enabled: true, browserId: 'edge' },
    edufine: { enabled: true, browserId: 'edge' },
  },
  intervalMinutes: 10,
  notifyOnlyOnIncrease: true,
  workHours: { enabled: true, start: '08:00', end: '18:00' },
} as const;

export const DEFAULT_WEB_CONNECTION = {
  autoConnectAfterPortalLogin: true,
  autoConnectTarget: 'both',
} as const;

function getRuntimePlatform(): string {
  return (globalThis as { process?: { platform?: string } }).process?.platform ?? 'win32';
}

export function resolveConfigPlatform(platform: string = getRuntimePlatform()): AppConfig['platform'] {
  return platform === 'darwin' ? 'darwin' : 'win32';
}

export function createDefaultItems(
  paths: DefaultPaths,
  createId: () => string = () => crypto.randomUUID(),
): DeckItem[] {
  return [
    {
      id: createId(),
      kind: 'action',
      label: '구글',
      type: 'url',
      target: 'https://www.google.com',
      args: [],
      icon: { kind: 'auto' },
      color: '#5B8CFF',
      position: 0,
    },
    {
      id: createId(),
      kind: 'action',
      label: '다운로드',
      type: 'folder',
      target: paths.downloads,
      args: [],
      icon: { kind: 'emoji', value: '📁' },
      color: '#5B8CFF',
      position: 1,
    },
    {
      id: createId(),
      kind: 'action',
      label: '문서',
      type: 'folder',
      target: paths.documents,
      args: [],
      icon: { kind: 'emoji', value: '📄' },
      color: '#5B8CFF',
      position: 2,
    },
  ];
}

export function createDefaultConfig(
  paths: DefaultPaths,
  createId: () => string = () => crypto.randomUUID(),
  platform: string = getRuntimePlatform(),
): AppConfig {
  const configPlatform = resolveConfigPlatform(platform);
  return {
    version: 3,
    platform: configPlatform,
    educationOfficeCode: 'goe',
    root: createDefaultItems(paths, createId),
    grid: { ...DEFAULT_GRID },
    window: { ...DEFAULT_WINDOW },
    behavior: { ...DEFAULT_BEHAVIOR },
    keyboard: {
      ...DEFAULT_KEYBOARD,
      globalNumberModifier: configPlatform === 'darwin' ? 'Control+Alt' : 'Alt+Shift',
    },
    webConnection: { ...DEFAULT_WEB_CONNECTION },
    approvalMonitor: structuredClone(DEFAULT_APPROVAL_MONITOR),
    theme: 'system',
    hotkey: 'CommandOrControl+Alt+D',
    launchAtLogin: false,
    autoUpdate: configPlatform === 'win32',
  };
}
