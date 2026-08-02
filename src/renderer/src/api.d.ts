import type {
  ActionItem,
  ActionType,
  AppConfig,
  DeckItem,
  DetectedBrowser,
  InstalledApp,
  LaunchResult,
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
  update: { check(): Promise<{ status: string; version?: string }> };
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
