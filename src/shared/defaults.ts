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
): AppConfig {
  return {
    version: 1,
    root: createDefaultItems(paths, createId),
    grid: { ...DEFAULT_GRID },
    window: { ...DEFAULT_WINDOW },
    theme: 'system',
    hotkey: 'Control+Alt+D',
    launchAtLogin: false,
    autoUpdate: true,
  };
}
