export type ActionType = 'url' | 'folder' | 'file' | 'app' | 'uwp';

export type IconSpec =
  | { kind: 'auto' }
  | { kind: 'emoji'; value: string }
  | { kind: 'file'; path: string }
  | { kind: 'letter'; value: string };

interface DeckItemBase {
  id: string;
  label: string;
  icon: IconSpec;
  color: string;
  position: number;
  globalHotkey?: string;
}

export interface ActionItem extends DeckItemBase {
  kind: 'action';
  type: ActionType;
  target: string;
  args: string[];
  workingDir?: string;
  browser?: BrowserSpec;
}

export interface BrowserSpec {
  path: string;
  profileDir?: string;
  appMode: boolean;
}

export interface BrowserProfile {
  dir: string;
  name: string;
}

export interface DetectedBrowser {
  id: 'chrome' | 'edge' | 'whale' | 'firefox' | 'safari';
  name: string;
  path: string;
  family: 'chromium' | 'firefox' | 'safari';
  supportsAppMode: boolean;
  supportsProfiles: boolean;
  profiles: BrowserProfile[];
  iconDataUrl?: string;
}

export interface FolderItem extends DeckItemBase {
  kind: 'folder';
  children: DeckItem[];
}

export type DeckItem = ActionItem | FolderItem;

export interface GridConfig {
  cols: number;
  rows: number;
  buttonSize: number;
  gap: number;
}

export interface WindowConfig {
  x: number | null;
  y: number | null;
  alwaysOnTop: boolean;
  opacity: number;
  locked: boolean;
  hideOnLaunch: boolean;
}

export interface BehaviorConfig {
  hideAfterLaunch: boolean;
  hideAfterLaunchDelayMs: number;
  edgePeek: boolean;
  peekEdge: 'auto' | 'right' | 'left' | 'top' | 'bottom';
  peekThickness: number;
  peekDelayMs: number;
  idleFade: boolean;
  idleFadeAfterMs: number;
  idleOpacity: number;
}

export interface KeyboardConfig {
  quickHints: 'on-focus' | 'always' | 'never';
  hintKeys: string;
  hideAfterHotkeyLaunch: boolean;
  globalNumberHotkeys: boolean;
  globalNumberModifier: string;
}

export interface AppConfig {
  version: number;
  platform: 'win32' | 'darwin';
  root: DeckItem[];
  grid: GridConfig;
  window: WindowConfig;
  behavior: BehaviorConfig;
  keyboard: KeyboardConfig;
  theme: 'dark' | 'light' | 'system';
  hotkey: string;
  launchAtLogin: boolean;
  autoUpdate: boolean;
}

export interface DeckLocation {
  path: string[];
  page: number;
}

export interface InstalledApp {
  name: string;
  type: 'app' | 'uwp';
  target: string;
  args: string[];
  workingDir?: string;
  source: 'start-menu' | 'store';
  iconDataUrl?: string;
}

export type LibraryEntry =
  | { kind: 'action-template'; type: ActionType; label: string; emoji: string }
  | { kind: 'folder-template'; label: string; emoji: string }
  | { kind: 'installed-app'; app: InstalledApp };

export type LaunchResult =
  | { ok: true }
  | { ok: false; code: 'NOT_FOUND' | 'BLOCKED' | 'FAILED'; message: string };

export interface LauncherResult {
  id: string;
  label: string;
  type: ActionType;
  breadcrumb: string;
  iconDataUrl?: string;
  hint?: string;
  matchRanges: [number, number][];
}
