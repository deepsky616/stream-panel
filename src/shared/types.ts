export type ActionType = 'url' | 'folder' | 'file' | 'app' | 'uwp' | 'multi';

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
  webWorkflow?: WebWorkflowSpec;
  multiAction?: MultiActionSpec;
}

export type MultiActionStep =
  | { id: string; kind: 'action'; actionId: string }
  | { id: string; kind: 'delay'; delayMs: number };

export interface MultiActionSpec {
  steps: MultiActionStep[];
}

export interface MultiActionProgress {
  runId: string;
  itemId: string;
  label: string;
  currentStep: number;
  totalSteps: number;
  state: 'running' | 'completed' | 'failed' | 'cancelled';
  message?: string;
}

export type BuiltInWebWorkflowId =
  | 'neis-leave'
  | 'neis-trip'
  | 'neis-approval-inbox'
  | 'edufine-draft'
  | 'edufine-purchase'
  | 'edufine-approval-inbox';

export type WebWorkflowId = BuiltInWebWorkflowId | 'custom';

export type WebWorkflowSystem = 'neis' | 'edufine';

export type WebConnectorBrowserId = 'chrome' | 'edge';

export type EducationOfficeCode =
  | 'sen'
  | 'goe'
  | 'gne'
  | 'pen'
  | 'dge'
  | 'dje'
  | 'gbe'
  | 'sje'
  | 'use'
  | 'ice'
  | 'gen'
  | 'jne'
  | 'jbe'
  | 'cne'
  | 'cbe'
  | 'gwe'
  | 'jje';

export interface CustomWebWorkflowStep {
  id: string;
  label: string;
}

export interface CustomWebWorkflowDefinition {
  name: string;
  system: WebWorkflowSystem;
  steps: CustomWebWorkflowStep[];
  finalText: string;
}

export type WebWorkflowSpec =
  | {
      id: BuiltInWebWorkflowId;
      browserId: WebConnectorBrowserId;
    }
  | {
      id: 'custom';
      browserId: WebConnectorBrowserId;
      custom: CustomWebWorkflowDefinition;
    };

export interface WebConnectorStatus {
  browserId: WebConnectorBrowserId;
  paired: boolean;
  connected: boolean;
  lastSeenAt?: number;
}

export interface ApprovalMonitorSourceConfig {
  enabled: boolean;
  browserId: WebConnectorBrowserId;
}

export interface ApprovalWorkHoursConfig {
  enabled: boolean;
  start: string;
  end: string;
}

export interface ApprovalMonitorConfig {
  sources: Record<WebWorkflowSystem, ApprovalMonitorSourceConfig>;
  intervalMinutes: 5 | 10 | 30;
  notifyOnlyOnIncrease: boolean;
  workHours: ApprovalWorkHoursConfig;
}

export interface ApprovalMonitorStatus {
  system: WebWorkflowSystem;
  state: 'disabled' | 'idle' | 'checking' | 'ready' | 'login-required' | 'error';
  pendingCount?: number;
  lastCheckedAt?: number;
  message?: string;
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
  quickLauncher: boolean;
  quickLauncherHotkey: string;
}

export interface AppConfig {
  version: number;
  platform: 'win32' | 'darwin';
  educationOfficeCode: EducationOfficeCode;
  root: DeckItem[];
  grid: GridConfig;
  window: WindowConfig;
  behavior: BehaviorConfig;
  keyboard: KeyboardConfig;
  approvalMonitor: ApprovalMonitorConfig;
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
  | {
      kind: 'action-template';
      type: ActionType;
      label: string;
      emoji: string;
      target?: string;
      webWorkflow?: WebWorkflowSpec;
    }
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
