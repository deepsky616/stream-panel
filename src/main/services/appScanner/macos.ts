import { readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { posix } from 'node:path';
import type { InstalledApp } from '../../../shared/types';
import type {
  AppScannerBackend,
  MacBundleMetadata,
  MacScannerDependencies,
  ScannerDirectoryEntry,
} from './types';

export function parseBundleMetadata(output: string): MacBundleMetadata {
  try {
    const parsed: unknown = JSON.parse(output);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const value = parsed as Record<string, unknown>;
    return {
      ...(typeof value.CFBundleDisplayName === 'string'
        ? { CFBundleDisplayName: value.CFBundleDisplayName }
        : {}),
      ...(typeof value.CFBundleName === 'string' ? { CFBundleName: value.CFBundleName } : {}),
    };
  } catch {
    return {};
  }
}

function defaultReadBundleMetadata(bundlePath: string): Promise<MacBundleMetadata> {
  const plistPath = posix.join(bundlePath, 'Contents', 'Info.plist');
  return new Promise((resolve) => {
    execFile(
      'plutil',
      ['-convert', 'json', '-o', '-', plistPath],
      { encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024 },
      (error, stdout) => resolve(error ? {} : parseBundleMetadata(stdout)),
    );
  });
}

const defaultDependencies: MacScannerDependencies = {
  readdir: async (path) => readdir(path, { withFileTypes: true }) as unknown as ScannerDirectoryEntry[],
  readBundleMetadata: defaultReadBundleMetadata,
};

function fallbackBundleName(path: string): string {
  return posix.basename(path, posix.extname(path));
}

function isExcludedBundleName(name: string): boolean {
  const normalized = name.trim().toLocaleLowerCase('ko-KR');
  return normalized.includes('uninstall') || normalized.startsWith('제거');
}

export class MacAppScanner implements AppScannerBackend {
  constructor(
    private readonly homePath: string,
    private readonly dependencies: MacScannerDependencies = defaultDependencies,
  ) {}

  async scan(): Promise<InstalledApp[]> {
    const roots = [
      '/Applications',
      '/System/Applications',
      posix.join(this.homePath, 'Applications'),
    ];
    const paths = (await Promise.all(roots.map((root) => this.scanDirectory(root, 0)))).flat();
    const apps: InstalledApp[] = [];
    for (const target of [...new Set(paths)]) {
      const fallbackName = fallbackBundleName(target);
      try {
        const metadata = await this.dependencies.readBundleMetadata(target);
        const name = metadata.CFBundleDisplayName || metadata.CFBundleName || fallbackName;
        if (isExcludedBundleName(name) || isExcludedBundleName(fallbackName)) continue;
        apps.push({
          name,
          type: 'app',
          target,
          args: [],
          source: 'start-menu',
        });
      } catch {
        if (isExcludedBundleName(fallbackName)) continue;
        apps.push({
          name: fallbackName,
          type: 'app',
          target,
          args: [],
          source: 'start-menu',
        });
      }
    }
    return apps;
  }

  private async scanDirectory(directory: string, depth: number): Promise<string[]> {
    try {
      const entries = await this.dependencies.readdir(directory);
      const nested = await Promise.all(entries.map(async (entry): Promise<string[]> => {
        if (!entry.isDirectory()) return [];
        const path = posix.join(directory, entry.name);
        if (posix.extname(entry.name).toLowerCase() === '.app') return [path];
        return depth < 1 ? this.scanDirectory(path, depth + 1) : [];
      }));
      return nested.flat();
    } catch {
      return [];
    }
  }
}
