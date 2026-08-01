import type { InstalledApp } from '../../../shared/types';

export interface AppScanner {
  list(refresh?: boolean): Promise<InstalledApp[]>;
}

export interface AppScannerBackend {
  scan(): Promise<InstalledApp[]>;
}

export interface ScannerDirectoryEntry {
  name: string;
  isDirectory(): boolean;
  isFile?(): boolean;
}

export interface ShortcutData {
  target?: string;
  cwd?: string;
  args?: string;
}

export interface WindowsScannerDependencies {
  readdir(path: string): Promise<ScannerDirectoryEntry[]>;
  access(path: string): Promise<void>;
  readShortcut(path: string): Promise<ShortcutData>;
  runStoreCommand(): Promise<string | null>;
}

export interface MacBundleMetadata {
  CFBundleDisplayName?: string;
  CFBundleName?: string;
}

export interface MacScannerDependencies {
  readdir(path: string): Promise<ScannerDirectoryEntry[]>;
  readBundleMetadata(bundlePath: string): Promise<MacBundleMetadata>;
}
