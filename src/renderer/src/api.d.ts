import type {
  ActionItem,
  ActionType,
  AppConfig,
  ApprovalMonitorStatus,
  DeckItem,
  DetectedBrowser,
  InstalledApp,
  LauncherResult,
  LaunchResult,
  WebConnectorStatus,
} from '../../shared/types';
import type { RendererEvent } from '../../shared/ipcChannels';

interface StreamPanelApi {
  config: {
    get(): Promise<AppConfig>;
    set(patch: Partial<AppConfig>): Promise<AppConfig>;
    reset(): Promise<AppConfig>;
  };
  deck: {
    upsert(input: { path: string[]; item: DeckItem }): Promise<AppConfig>;
    remove(input: { path: string[]; id: string }): Promise<AppConfig>;
    move(input: {
      from: { path: string[]; id: string };
      to: { path: string[]; position: number };
    }): Promise<AppConfig>;
    duplicate(input: { path: string[]; id: string }): Promise<AppConfig>;
  };
  button: {
    launch(input: { path: string[]; id: string; keepOpen?: boolean }): Promise<LaunchResult>;
  };
  multiAction: {
    cancel(input: { itemId: string }): Promise<{ ok: true } | { ok: false; message: string }>;
  };
  picker: {
    folder(): Promise<string | null>;
    file(): Promise<string | null>;
    executable(): Promise<{
      target: string;
      args: string[];
      workingDir?: string;
      name: string;
    } | null>;
    image(): Promise<string | null>;
  };
  icon: {
    resolve(input: { type: ActionType; target: string }): Promise<string | null>;
    importPath(path: string): Promise<string | null>;
  };
  apps: { list(input?: { refresh?: boolean }): Promise<InstalledApp[]> };
  browsers: { list(input?: { refresh?: boolean }): Promise<DetectedBrowser[]> };
  webConnector: {
    status(): Promise<WebConnectorStatus[]>;
    test(input: {
      browserId: 'chrome' | 'edge';
    }): Promise<{ ok: true } | { ok: false; message: string }>;
    openSetup(input: {
      browserId: 'chrome' | 'edge';
      target: 'pair' | 'connect' | 'folder' | 'extensions';
    }): Promise<{ ok: true } | { ok: false; message: string }>;
    openApprovalInbox(input: {
      system: 'neis' | 'edufine';
    }): Promise<{ queued: true } | { queued: false; message: string }>;
  };
  approvalMonitor: {
    status(): Promise<ApprovalMonitorStatus[]>;
    check(input?: { system?: 'neis' | 'edufine' }): Promise<ApprovalMonitorStatus[]>;
  };
  drop: {
    classify(input: { paths: string[]; text?: string }): Promise<Partial<ActionItem>[]>;
    getPathForFile(file: File): string;
  };
  window: {
    hide(): Promise<void>;
    show(): Promise<void>;
    relayout(): Promise<void>;
    setIdle(idle: boolean): Promise<void>;
  };
  editor: { open(input?: { path?: string[]; slot?: number }): Promise<void> };
  hotkey: {
    validate(input: {
      accelerator: string;
      itemId?: string;
    }): Promise<{ ok: true } | { ok: false; reason: string }>;
  };
  launcher: {
    query(input: { text: string }): Promise<LauncherResult[]>;
    run(input: { id: string }): Promise<LaunchResult>;
    close(): Promise<void>;
    resize(input: { height: number }): Promise<void>;
  };
  update: {
    check(): Promise<{ status: string; version?: string; readyToInstall?: boolean }>;
    restartAndInstall(): Promise<{ ok: boolean; message: string; version?: string }>;
  };
  app: { info(): Promise<{ version: string; platform: string; isPackaged: boolean }> };
  shell: { reveal(path: string): Promise<void> };
  on(channel: RendererEvent, callback: (payload: unknown) => void): () => void;
}

declare global {
  interface Window {
    api: StreamPanelApi;
  }
}

export {};
